# NeurAI Platform — Operations Runbook

> **Purpose.** Everything needed to operate the deployed NeurAI Platform from a
> fresh machine: infrastructure map, access recovery, deploy/migrate
> procedures, and the hard-won gotchas. Lives in the repo on purpose — clone
> the repo on any machine and this comes with it. **No secrets are recorded
> here** (credentials live only in the encrypted secret store and the server's
> root-only env files); this file records *names, locations, and procedures*.

Last updated: 2026-08-19, after deploying the platform-root control plane.

---

## 1. Infrastructure map

| Piece | Where | Notes |
|---|---|---|
| **Web (UI + BFF)** | Vercel, project `mvp-web` | Public site `https://neurai.pt`. Reads the core base URL from server-only env `CORE_API_URL`. |
| **Core API** | Hetzner CX22, `178.105.251.216`, host `neurai-core-1` (Ubuntu) | Public entry `https://api.neurai.pt` via **Cloudflare Tunnel** → `localhost:8080`. Inbound: SSH only. |
| **Core services** | systemd, run as non-root `neurai` | `neurai-api.service` (:8080), `neurai-worker.service` (pgmq consumer), `neurai-ml.service` (:7801). |
| **Deploy dir** | `/opt/neurai/app` | The repo tree extracted from `git archive`. `node_modules` and `ml/models` are **not** in the archive (gitignored / untracked) and survive redeploys. |
| **Runtime** | `node --experimental-strip-types src/api/main.ts` | No build step — TypeScript runs from source. `node` v22 on the server. |
| **Env files** | `/etc/neurai/`, root-owned | `core.env` (api+worker, `root:neurai` mode `640`), `ml.env`, `env` (legacy copy). **Never print contents.** |
| **Database / Auth / Storage / queues** | Supabase (cloud) | Production project ref `icnbeprlqqjojwjzjdgj` (distinct from the dev project `aqgpxnyuxukwgphrxslw`). The server holds only the `echo_app`/`echo_agent` role URLs. |
| **Package manager** | pnpm `9.12.3` (pinned via `packageManager`) | Use `corepack pnpm@9.12.3`. |

Secret naming: every platform credential in the DPAPI store carries the
`echo_platform_` prefix; provider keys (`openrouter_key`, `soniox_key`) keep
canonical names. See `db/README.md`.

---

## 2. SSH access (and recovering it on a new machine)

Access is **key-only** for `root` (password SSH is disabled — `PermitRootLogin
prohibit-password`). A new machine has no key on the server yet. Recover it
without a password by one of these, in order of preference:

1. **Hetzner Console → reset root password**, then from your terminal:
   ```
   type <your_pubkey.pub> | ssh root@178.105.251.216 "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys"
   ```
   (enter the shown password at ssh's prompt).

2. **`ssh-import-id`** — add your public key to a GitHub account, then in the
   Hetzner **web console** (root) run `ssh-import-id-gh <github-user>`
   (all-lowercase, GitHub is case-insensitive). Minimal typing — good when the
   web console's keyboard layout mangles symbols.

3. **Rescue mode** — Hetzner Server → Rescue → *Enable rescue & power cycle*
   with a selected key; boot in, mount the real disk, append the key to the
   system's `/root/.ssh/authorized_keys`, reboot back.

> The Hetzner console "Add SSH key" dialog only affects **new** servers, not
> the running one — it is not a shortcut for the above.

Generate a fresh key per operator: `ssh-keygen -t ed25519 -f ~/.ssh/neurai_ops -N ""`.
Remove an operator's key from `/root/.ssh/authorized_keys` when done.

---

## 3. Deploying a release to Core API

The deploy is a `git archive` extract — it replaces tracked files and leaves
`node_modules` / `ml/models` in place. From a clean checkout at the release
commit:

```bash
# 1. build the release archive locally and copy it up
git archive --format=tar.gz -o /tmp/rel.tgz <commit>
scp -i <key> /tmp/rel.tgz root@178.105.251.216:/tmp/

# 2. on the server: extract, normalize ownership, reconcile deps
ssh -i <key> root@178.105.251.216
  tar -xzf /tmp/rel.tgz -C /opt/neurai/app
  chown -R neurai:neurai /opt/neurai/app
  runuser -u neurai -- env CI=1 bash -lc \
    'cd /opt/neurai/app && corepack pnpm@9.12.3 install --frozen-lockfile --config.confirmModulesPurge=false'
  rm -f /tmp/rel.tgz

# 3. sanity: the new entrypoint parses under the production runtime
runuser -u neurai -- node --experimental-strip-types --check /opt/neurai/app/core/src/api/main.ts

# 4. activate (see §5 before restarting if the release needs a migration first)
systemctl restart neurai-api.service neurai-worker.service
```

**Order rule:** if the release adds a migration, apply the migration **before**
restarting (schema leads code). Additive migrations keep the old running code
working during the window.

Health after restart (from the server, no auth needed):
```bash
node -e "fetch('http://127.0.0.1:8080/health').then(r=>console.log(r.status))"
```
And publicly: `https://api.neurai.pt/health` → `{"ok":true}`.

---

## 4. Applying database migrations

Migrations need the **owner** connection (`echo_platform_db_url` in the DPAPI
store, or the production project's `postgres` connection string from the
Supabase dashboard → Settings → Database → **Session** connection, port 5432 —
*not* the transaction pooler 6543). The server holds only app/agent roles,
which cannot run DDL, so migrations run **from an operator machine** against the
cloud DB.

```bash
cd db
DATABASE_URL="<owner-connection>" node scripts/db.mjs migrate
```

Ledger table: `public.echo_migration (version, checksum, applied_at)`. The
runner refuses to change an already-applied file (append-only).

### Two gotchas that will bite you (both hit during the 2026-08-19 deploy)

1. **CRLF vs LF checksums.** Production recorded migration checksums from an
   **LF** checkout. A Windows working tree is usually **CRLF**, so `db.mjs`
   reports `0001_foundation.sql changed after it was applied` and refuses.
   Fix: run against **LF** copies of the migration files —
   ```bash
   for f in db/migrations/*.sql; do tr -d '\r' < "$f" > "$f.__lf" && mv "$f.__lf" "$f"; done
   # …run migrate…
   git checkout -- db/migrations/     # restore the working tree afterwards
   ```
   (The real cure is a `.gitattributes` pinning `*.sql` to LF, or a
   normalize-on-read in the runner — not yet done.)

2. **`check_function_bodies` / Supabase.** Some migrations create
   `security definer` functions with `set search_path = ''`. Supabase's own
   migration path runs with `check_function_bodies = off`; `db.mjs` does not,
   so the DB validates those bodies at creation and can fail (e.g. an extension
   type like `citext` is unreachable under an empty search_path). Apply with a
   session that turns it off — via the connection string, **no persistent
   config change**:
   ```
   DATABASE_URL="<owner>?options=-c%20check_function_bodies%3Doff" node scripts/db.mjs migrate
   ```
   And **qualify extension types** used inside `search_path = ''` bodies
   (`public.citext`), or give that one function `set search_path = public`
   (all `echo.*` refs stay qualified). See migration `0067` for the pattern and
   `db/DECISIONS.md`/`0045` for the rule.

---

## 5. Platform-root bootstrap (M32) — claiming the first operator

Platform Root is a **platform-operator** role beside the org hierarchy. It sees
only lifecycle metadata (orgs, user statuses, a metadata-only platform audit
log) and may suspend/reactivate orgs, enable/disable non-root users, and
grant/revoke other roots. It has **no** access to calls, transcripts,
summaries, assistant conversations, prompts, API keys, or connectors — the org
RLS wall is unchanged. Schema: `db/migrations/0066` (+ `0067` fix), routes
`/v1/platform/*` in `core/src/api/server.ts`, UI at `web` `/[locale]/platform`.

**The bootstrap selector** names the one active account allowed to claim the
first root. It is a **temporary server-only setting, not a secret and not a
password**:

```bash
# add (append-only; preserve owner/mode), then restart
printf 'PLATFORM_ROOT_BOOTSTRAP_EMAIL=%s\n' '<account-email>' >> /etc/neurai/core.env
chown root:neurai /etc/neurai/core.env && chmod 640 /etc/neurai/core.env
systemctl restart neurai-api.service
```

Flow: the operator signs in normally → opens `https://neurai.pt/fa/platform` →
sees **“Claim platform root”** → claims it. The DB function
`echo.bootstrap_platform_root` verifies the session actor's email equals the
configured selector and that no operator exists yet, then inserts the row and
writes a `root_bootstrapped` audit line.

**After the claim succeeds, remove the selector** (it has done its job; leaving
it is unnecessary):
```bash
sed -i '/^PLATFORM_ROOT_BOOTSTRAP_EMAIL=/d' /etc/neurai/core.env
systemctl restart neurai-api.service
```
Further roots are granted in-product by an existing root (`platform_grant_root`),
never via the env selector again.

---

## 6. Vercel (web) configuration

The web app must know where the Core API is:

- **Set** `CORE_API_URL = https://api.neurai.pt` for the **Production**
  environment. **Server-only — do NOT use `NEXT_PUBLIC_CORE_API_URL`** (that
  would ship the internal base URL to the browser; `web/src/server/core.ts`
  reads `CORE_API_URL` server-side).
- **Redeploy** production from `main` so the new value takes effect.

Dashboard: Vercel → project `mvp-web` → Settings → Environment Variables → add
for Production → then Deployments → Redeploy (or push to `main`).

---

## 7. Deployment record — 2026-08-19

- Deployed core release **`16ff16a`** ("Add privacy-preserving platform root
  control plane") to `/opt/neurai/app`; `pnpm install --frozen-lockfile`
  (464 pkgs); entrypoint parses under `--experimental-strip-types`.
- Applied migrations **0065, 0066** (production was at 0064) plus a follow-up
  **0067** fixing `bootstrap_platform_root`'s `citext` resolution (commit
  `3e70eac`). Ledger now at `0067`.
- Appended `PLATFORM_ROOT_BOOTSTRAP_EMAIL=neurai.git.acc@gmail.com` to
  `/etc/neurai/core.env` (perms preserved `root:neurai 640`) and restarted
  `neurai-api` + `neurai-worker`.
- Verified: `https://api.neurai.pt/health` → 200; `/v1/platform/access` →
  401 (route exists, was 404 pre-deploy); an invented route → 404 (control).
- **Pending (operator/user actions):** set `CORE_API_URL` on Vercel + redeploy
  (§6); claim root at `/fa/platform`; then remove the bootstrap selector (§5).
- **Follow-up owed:** apply `0067` to the **dev** database too (its `0066`
  bootstrap function has the same latent citext bug); consider a `.gitattributes`
  LF pin for `db/migrations/*.sql` to end the CRLF checksum friction.

---

## 8. What never goes in this file (or any log)

Connection strings, DB passwords, API keys, service keys, JWT secrets, the
contents of `/etc/neurai/*.env`, or any customer content. When a command might
surface a URL in an error, pipe through
`sed -E 's#postgres(ql)?://[^ ]+#[redacted]#g'`.
