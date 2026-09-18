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
| **Env files** | `/etc/neurai/`, root-owned | `core.env` (api+worker, `root:neurai` mode `640`), `ml.env`, `env` (legacy copy). **Never print contents** — `grep -oE '^[A-Za-z_][A-Za-z0-9_]*=' core.env` lists the NAMES safely. The two database ones are **`DATABASE_URL_APP`** and **`DATABASE_URL_AGENT`**; there is no plain `DATABASE_URL`, and a probe that reads that name gets an empty string and connects to a local default — which answers ECONNREFUSED, or worse, answers. |
| **M5 env rung** | `WORKER_SUMMARY_MODEL` in `core.env` | The operator's model fallback (owner pref → org first choice → THIS → skip). Set 2026-08-27 (`google/gemini-2.5-flash`) after the P2 workflow acceptance found it EMPTY: a member with no preference in an org with no curation had no model at all, and the summarizer had been riding the higher rungs by luck. |
| **Database / Auth / Storage / queues** | Supabase (cloud) | Production and dev project refs are held in the DPAPI store and in `ECHO_DEV_PROJECT_REF`, not written here — a ref names a live endpoint. They are distinct projects. The server holds only the `echo_app`/`echo_agent` role URLs. |
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
- **Root claimed** by `neurai.git.acc@gmail.com`; the bootstrap selector was
  then **removed** from `core.env` and `neurai-api` restarted
  (`/v1/platform/bootstrap` now returns 404 — the door is closed; the operator
  row persists in the DB). `CORE_API_URL=https://api.neurai.pt` was set on
  Vercel and the web redeployed.
- **Console made fully operable** (commit `8267b18`): every control (org
  suspend/reactivate, user disable/reactivate, grant/revoke root) has its own
  confirm-and-reason dialog; tabbed Organizations/Users/Audit; overview,
  filters, humanized metadata-only audit log. Privacy boundary unchanged.
- **Follow-up owed:** apply `0067` to the **dev** database too (its `0066`
  bootstrap function has the same latent citext bug); consider a `.gitattributes`
  LF pin for `db/migrations/*.sql` to end the CRLF checksum friction.

---

## 7b. Deployment record — 2026-08-20 (console edit + soft-delete/restore)

Feature commit **`c26344a`** ("Add edit + soft-delete/restore to the
platform-root console"). Shipped a metadata edit + 7-day soft-delete/restore
for orgs and users, entirely inside the M32 content wall.

- Applied migrations **0068** (soft-delete columns on `echo.org`/`echo.app_user`
  + six new `platform_audit_action` enum values) and **0069** (six
  `security definer` functions: `platform_update_org`, `platform_update_user`,
  `platform_soft_delete_org`, `platform_restore_org`, `platform_soft_delete_user`,
  `platform_restore_user`; executable to `echo_app` only). Ledger now at `0069`.
  Migration run by the user with the Session/owner connection (LF-normalize +
  `check_function_bodies=off` per §4). **Verified** against the production
  catalogue as the `echo_app` role: 6/6 columns and 6/6 functions present.
- Deployed core `c26344a` (git-archive → `/opt/neurai/app`, `chown`,
  `--experimental-strip-types --check` on `main.ts`). **No `pnpm install`**:
  no dependency/lockfile change in the range, so `node_modules` was untouched;
  only `neurai-api` restarted (`platform.ts`/`server.ts` are api-only).
  **Verified:** `/health` 200; the four new routes (`DELETE`/`POST …/restore`
  on org + user) return **401** (wired behind auth) not 404, on localhost and
  publicly via `api.neurai.pt`.
- Pushed `c26344a` to `main`. **Web did NOT come up:** the production alias
  `mvp-web-beta.vercel.app` returned **`DEPLOYMENT_NOT_FOUND`** before and after
  the push (polled ~6 min, never recovered). A `git push` cannot take a site
  down, so the alias was already detached from a live deployment. Resolve in the
  Vercel dashboard: confirm the GitHub→Vercel auto-deploy of `main` produced a
  production deployment from `c26344a`, then ensure `mvp-web-beta.vercel.app` is
  assigned to it (Project → Domains), or use whatever URL the project shows as
  **Production**. No Vercel CLI/token exists on the operator machine — this step
  is dashboard-only.
- The backend feature is fully live regardless of the web alias; once web serves
  again, hard-refresh `/fa/platform` to see Edit / Delete (7-day) / Recently
  deleted + Restore on both tabs.

---

## 7c. Deployment record — 2026-08-20 (tenancy-audit hardening)

Four-pass multi-tenancy audit (db/RLS, core, web, docs): **no cross-org data
path found at any layer**; the user re-affirmed one-org-per-user (recorded in
ARCHITECTURE.md M2). Hardening shipped:

- **db/0070** — `FORCE ROW LEVEL SECURITY` on `echo.platform_operator` +
  `echo.platform_audit` (the only two tables missing it; db/test/50's
  every-table tripwire demands it and had not been run since 0066 landed).
  Owner-connection migration — apply per §4.
- **core** — agent tools now run on `echo_agent` via `agentToolsDb`
  (identity.ts; explicit app-role requests fail loudly, no actor-less door);
  **proven against the production catalogue**: every tool-path table +
  `fa_fold` OK as echo_agent, `connector_secret` refused (42501) as the
  negative control. `/v1/admin/server` queue depths are platform-root-gated
  (deployment-wide counts are a cross-tenant activity signal; org admins get
  a named refusal). Worker now REQUIRES `DATABASE_URL_AGENT` (fallback to the
  app URL removed — the api's refuse-to-boot posture, adopted).
- **web** — `setPreferredModel` swapped to the live `PUT /api/models`;
  caller-less fixtures `agentRuns`/`correctLine` DELETED (tenant-identical
  fabrications; correctLine reported a correction saved that no server ever
  received); the client's last mutable fixture state (`me`/`users`/
  `transcripts`) removed with them; sign-out sweeps `neurai-draft-*` from
  sessionStorage so a half-typed question can't reach the next account on
  the same tab.

Remaining from the audit, deliberately NOT built (user's scope ruling):
multi-org membership (declined for v1), per-org quotas/usage view, billing,
custom domains, compliance-grade deletion. Self-serve signup unblock =
Supabase dashboard work (custom SMTP + Site URL), tracked separately.

---

## 7d. Deployment record — 2026-08-20 (auth flow, history, org workflows)

Commits `f3b234b` + `1c8a81c`. Migration **0072** applied (org-authored
workflows: org_id/created_by on workflow_template, tenant-scoped read
policy, admin-gated insert). Reset/invite completion now ends at the
SIGN-IN form (no auto-session — user ruling); invited arrivals register
server-side during reset. History delete works (the archive BFF hop
existed nowhere); session lists carry message_count. Hub composer's Tools
menu removed. Create-workflow shipped end to end.

Test residue erased: both test identities removed product-side via
`db/scripts/erase-user.mjs`
(owner-run; savepoint-per-delete catalogue walk; accepts emails or raw
UUIDs — an email lookup misses TOMBSTONED rows) and then auth-side via the
admin API (verified 0 matches). Note: the walk deletes RESTRICT-referencing
rows, so two platform_audit lines about the test users went with them —
acceptable for test residue, would not be for a real account.

Supabase dashboard config the flows depend on (user-side): Auth → Email
Templates must link Invite → `{{ .SiteURL }}/fa/reset?token_hash={{ .TokenHash }}&type=invite`,
Reset → same with `type=recovery`, Confirm signup →
`{{ .SiteURL }}/api/auth/confirm?token_hash={{ .TokenHash }}&type=signup`;
Site URL = `https://app.neurai.pt`. Custom SMTP still pending for volume.

---

## 7e. Deployment record — 2026-08-21 (the AI-native shift, Phases A–D)

Commits `72000d4`→ (Phase A) → `630894f` (B) → `2a23db6` (C) → Phase D.
M33–M36 ratified in ARCHITECTURE.md; full plan + deferrals in
docs/AI-NATIVE-PLAN.md. Shipped: client tools (the agent drives the
surface — start/pause/resume recording, navigate, open, search — under
the user's own session with consent cards), the presence dock (orb on
every route, Ctrl/⌘-K, daily continuous thread, page context), the
autonomy dial (watch/assist/act + org ceiling), signals (post-call brief
+ weekly digest as cards→conversations, run AS the owner), reasoning
traces, the Assistant-activity governance card, generative answer
blocks, and read-aloud.

**PENDING MIGRATIONS on production: 0073, 0074, 0075** (owner-run, the
§4 procedure). Until they land, core capability-detects and degrades
loudly: dial = assist for everyone (boot log names 0073), signals
skipped with a warn per message (0074), ceiling uncapped (0075). After
migrating, RESTART api + worker — the capability cache clears on boot.
Verify: the api boot log's `capability_missing` line disappears.

Deferred with reasons (see the plan doc): realtime STT proxy (live
catch-me-up + translation lane — the Soniox key must never reach the
browser), wake word (explicit opt-in UI first), Act for server
proposals, model-composed briefs.

---

## 7f. Deployment record — 2026-09-15 (the other machine's tree lands: c39a8a3)

Commit `c39a8a3` is the whole tree built on the other PC, applied on top of
`05fe3e4` as ONE commit (382 files: 99 added, 258 modified, 22 deleted, 3
renamed — the dashboard and the old meeting stage removed on purpose). Vercel
built the web from the push at once; core and ml were deployed by this
procedure four hours later, from the Asus laptop — whose server key is
`~/.ssh/neurai_claude`, not `neurai_hetzner` (§2: the key is a property of
the machine).

**Schema first, and it was already done.** Production's Supabase project is
the one this laptop's `.env` names (`icnbeprlqqjojwjzjdgj`), so the owner
connection for §4 was at hand — with one trap: its password contains `#`.
Node's `--env-file` cuts an unquoted value at `#` (48 characters arrived of
111), and `repair-ledger-0154.mjs` hands the URL to `pg` raw, so the scripts
were driven through a small loader that reads `.env` whole and percent-encodes
the password exactly as `db.mjs`'s `normalizeDbUrl` does (there is no
`.env.dev` on this machine; that is the file the seed/repair scripts look for).
  1. `node db/scripts/repair-ledger-0154.mjs` → `renamed
     0132_the_sweeps_get_their_indexes → 0154_…` — the ledger still held the
     file under its old number; without it `migrate` re-runs the file and
     fails on indexes that already exist.
  2. `node db/scripts/db.mjs migrate` → applied 0218–0222; ledger 222 rows.
  3. `node db/scripts/db.mjs test` (fixture-only, nothing dropped) → 71
     files, 1007 checks, all PASS — "the wall holds".

Then §3 exactly: `git archive` of c39a8a3 (24.6 MB; sha256 `6190f903…`
identical on both ends) → extract over `/opt/neurai/app` → chown →
`pnpm install --frozen-lockfile` (3.2 s; the only new packages are the
web's `react-markdown`/`remark-gfm`) → `api/main.ts` AND `worker/main.ts`
parsed with `--experimental-strip-types --check` → ml rebuilt with
`node node_modules/typescript/bin/tsc -p tsconfig.json` and the emitted
`dist/src/config.js` checked for the new marker (`int(90 * 60 * 1000)`
present, the old 35-minute one absent — the 2026-09-10 rule: read the
artifact, never the exit code) → restart ml, api, worker. No env name is new
since 05fe3e4, so `core.env` was not touched. Health 200 after 1 s; ml's
health names `sherpa-eres2netv2`; the worker started at concurrency 2; zero
level≥40 lines in the three journals afterwards.

**The discriminating pair at three altitudes** — on the server, through
`api.neurai.pt`, and through `app.neurai.pt`'s BFF: `/v1/platform/demo-orgs`
**401** beside `/v1/nonsense` 404 and `/v1/me` 401; on the BFF
`/api/platform/demo-orgs` 401, `/api/nonsense` 404, an empty POST 400. Before
this deploy the same route answered 404 at every altitude, which is exactly
what the platform console's «not found» on «Create demo organization» was:
the web had shipped ahead of the server, and a no-such-route nothing reads
as a no-such-feature nothing from a browser.

Not done here, on purpose: the demo seed itself was not pressed (it writes
an organisation into production — the operator's button).

## 7g. Deployment record — 2026-09-15, evening (6a36862, core only)

No migration in this release, so §5 does not apply and §3 ran straight
through. Archive 24 587 280 bytes, sha256 `4e88c6ae…`, **compared on both
ends before extracting** — the cheap half of "verify the artifact, not the
command that made it". `pnpm install --frozen-lockfile` reported the lockfile
up to date and nothing to do (this release touches no dependency), both
entrypoints passed `--experimental-strip-types --check`, then
`systemctl restart neurai-api.service neurai-worker.service`. ml was not
rebuilt: nothing under `ml/` changed.

**Markers checked on disk before restarting**, because an extract that lands
in the wrong tree restarts cleanly and changes nothing (the 2026-09-06
`/opt/neurai` vs `/opt/neurai/app/core` lesson): the navigate enum has zero
occurrences of `"/search"`, and `client-tools.ts` carries the new comment.

After: both units `active`, `/health` `{"ok":true}`, no level≥40 journal lines
in the minute after the restart, and the pair at the server altitude —
`/v1/me` **401**, `/v1/assistant/sessions/<uuid>/messages` **401**,
`/v1/nonsense` **404**.

**Order note worth keeping:** this release REMOVES a client tool
(`set_search`) whose executor the web had already dropped. Core was deployed
as soon as Vercel's build went green rather than left for later — a core still
advertising a tool the browser cannot run is the same seam as a web ahead of
its server, pointed the other way, and the model would have called it.

---

## 7h. Deployment record — 2026-09-15, night (5971511 + 7747e93: M54, db/0223)

A migration first (§5): `0223_a_person_arrives_into_their_own_workspace`
applied from this laptop through the `.env` loader (the `#` in the owner
password — see 7f) — its self-checks ran on production and rolled their probe
back; then the fixture-scoped suite against production: **72 files PASS, "the
wall holds"**, 127 at 20 checks against the live door. Read afterwards at
owner altitude (counts only): 3 orgs, all `team`; no intake org marked
(= B2C mode); 14 active humans and 6 agent seats backfilled as onboarded, the
2 disabled accounts not; both new triggers present; neither new definer door
executable by PUBLIC.

Then §3 for core at 7747e93: archive 24 642 612 bytes, sha256 `5dc55de4…`
equal on both ends; markers on disk before restarting (`/v1/me/onboarding`
×1 in server.ts, `hasOnboarding` ×3 in members.ts); `pnpm install` had
nothing to do; both entrypoints parse under strip-types; both units `active`,
`/health` `{"ok":true}`, no warnings in the minute after; the pair at the
server: `PATCH /v1/me/onboarding` **401**, `/v1/me` **401**, `/v1/nonsense`
**404**.

Web on Vercel from the same push. Probed from outside: `/fa/sign-up` 307 →
`/fa/sign-in`; `/fa/onboarding` signed out 307 → sign-in; `POST
/api/auth/otp` with a malformed address 400 `invalid` (GoTrue's own
sentence, nothing created), with no body 400 `bad_body`; `POST
/api/auth/otp/verify` with an invented address 401 `invalid`; `PATCH
/api/me/onboarding` signed out 401 against `/api/nonsense` 404. In the
user's Chrome, rendered text (script text rejected, catalogue-only control 0):
the gate is one email field with «ادامه» and «ورود با گذرواژه» and nothing
else; on Home the first-run door opened for the owner with its five choices,
«همین حالا امتحان کن» / «بعداً», no `<video>` and the «coming soon» line.

**Operator step outstanding:** the Supabase Magic Link template
(docs/ONBOARDING.md §5). Until it is changed, the mail carries neither our
link nor the code — the gate is correct in code and unreachable in
configuration.

---

## 7i. Deployment record — 2026-09-16 (28af01e: four doors, the verification wall, db/0224–0225)

Migrations first (§5), both from this laptop through the `.env` loader (7f):
`0224_a_workspace_is_verified_before_its_agents_spend` (the column and its
backfill, `register_account` rebuilt with a NULL founding stamp, the
`agent_run` trigger, `platform_set_org_verified`, `platform_list_orgs`
DROP+CREATE with `verified_at`) and `0225_the_gate_learns_apple_microsoft_and_sso`
(the `signin_method` check widened, three rows OFF). Self-checks ran on
production and rolled their probes back. The fixture suite's FIRST run
against production failed two files, neither about these migrations:
`65_signin_methods` asserted `count(*) = 2` on a table that now holds five,
and `40_purge` asserted `count(*) = 1` on the purge role — which is
actor-independent and sees the whole database's expired calls: ONE real
call (a failed take soft-deleted 2026-08-17) crossed its window at 00:04 UTC
today, after the nightly `neurai-purge.timer` last ran (03:39 UTC 09-15,
`callsPurged: 0`) and before its next sweep (03:37 UTC today). Nothing is
wrong with the purge; the tests were counting. Both assert the property now,
and the re-run reads **"the wall holds"** — 128 at 14 checks against the
live door, 40 at 23, 65 at 10. Read afterwards at owner altitude (counts and
switch names only): 3 orgs, all verified with `verified_at = created_at`;
the trigger present; the trigger function, `platform_set_org_verified` and
`platform_list_orgs` not executable by PUBLIC; `platform_list_orgs` carries
`verified_at`; `signin_method` reads google/github on, apple/azure/sso off.

Then §3 for core at 28af01e: archive 24 677 747 bytes, sha256 `eb75a866…`
equal on both ends; markers on disk before restarting
(`core/src/agent/verification.ts` present, `setOrganizationVerified` ×1 in
platform.ts, `SIGNIN_METHODS` ×2 in vocabulary.ts, `assertOrgVerified` ×5 in
server.ts); `pnpm install` had nothing to do; both entrypoints parse under
strip-types; both units `active`, `/health` `{"ok":true}`, zero level≥40
journal lines in the minute after; the probes at the server: `POST
/v1/assistant/ask` **401**, `PATCH /v1/platform/organizations/x` **401**,
`GET /v1/nonsense` **404**.

Web on Vercel from the same push (`fra1`, live at 00:51 UTC: `GET
/api/auth/sso` **405** where `/api/nonsense` 404s — the route is POST-only,
and 405 is the not-404 that says it exists). From outside: `POST
/api/auth/sso` with `{"email":"example.com"}` → 400 `code: disabled` (the
switch is off — the sentence, never a provider page); with no usable field →
400 `invalid`. The gate, signed out, in the built-in browser at 1280 (the
first JS read came back at vw 0 — a hidden pane lays out at zero; re-read
right after a screenshot): `<html dir="rtl">`, the split grid `dir="ltr"`
(1084 wide, display grid, 2 children), the FORM on the right at 721–1113 and
the demo section on the left at 98–629, buttons «ادامه با گوگل / اپل /
مایکروسافت / ورود سازمانی (SSO)», «یا», an email input, «حساب دارید؟ با
گذرواژه وارد شوید», zero `<video>` (no demo URL set — the scenes cycled
between two screenshots), catalogue-only control 0. In the user's Chrome,
signed in, 1280 with the assistant open: **meetings** — rows at 72 and 122
and the folder strip THIRD at 173 wearing the tinted rail
(`FILTER_TRACK`), «همه جلسات ۰», the dashed `+` labelled «موضوع جدید», the
page's only combobox the top-bar search (the topic dropdown is gone); the
org has no meeting folder, so a chip's ⋯ could not be read there — it was
read on **tasks**, the SAME component: «دیتابیس صوتی ۰» carrying its ⋯
(«گزینه‌ها») beside «پوشهٔ جدید» and «پروژهٔ تازه»; **projects** — the
rail reads home / meetings / **projects (182) / tasks (235)** top to bottom,
no integrations entry; the toolbar's tracks are the board's; «پروژهٔ جدید»
absent on the kanban (the columns' «افزودن پروژه» rows are the door) and
present on the list view as `.btn btn-primary` — at 1280 with the assistant
open row one WRAPS (three tracks) and the end slot lands at y=166; through
the 1920 iframe instrument (root 16.34) it sits in row one at y=80, 601–707,
39px tall, at the row's end; **home** `/fa?view=integrations` — the sidebar
«گفت‌وگوها» lists «عامل‌ها» at 133 and «اتصال‌ها» directly under it at 170
(`aria-pressed` true), the pane 13 tiles / 6 «متصل است», the verification
banner ABSENT with both controls («اتصال» on screen 1, «تأیید دسترسی
دستیارها» catalogue-only 0); **profile** — «خروج از حساب» is a `btn btn-sm`
pill with its glyph at 422–538 on the row-one line (top 75, 32px, = the
menu's tabs), in its own end track at 419–542 flush with the column's end
(the menu track sits at 806–1188), zero danger buttons; **console** — three
«تأییدشده» chips, zero «در انتظار تأیید», three kebabs.

**Operator steps outstanding:** (1) the Supabase Magic Link template
(docs/ONBOARDING.md §5) — unchanged from 7h; (2) Apple, Azure and SSO exist
as doors on the gate and as switches in Settings · Sign-in methods, all OFF
until the provider is configured in Supabase Auth and the switch flipped —
a press on an off door answers a sentence, never a broken redirect;
(3) `NEXT_PUBLIC_DEMO_VIDEO_URL` in Vercel turns the gate's left half from
the illustrated scenes into the demo video; (4) a workspace founded through
the gate is born UNVERIFIED — its agents refuse (403 `org_unverified`, the
banner on Home) until the platform root presses «تأیید دسترسی دستیارها» in
the console; the three existing organisations were backfilled verified.

---

## 7j. Deployment record — 2026-09-16, later (ec45c44: web only — the language into Settings, Persian default, the org form, the boards' rows)

No migration and no core change: web on Vercel from the push (`Vercel – mvp`
success on the commit status; the signed-in probe below is the deploy
marker, since the settings page had two cards before it). Signed out from
outside, a bare `/` with `Accept-Language: en-US` → 307 `/fa/sign-in` (our
gate's own spelling, true before and after). **In the user's Chrome, signed
in, whose browser asks for English (`navigator.languages` = en-US, en)**:
`https://app.neurai.pt/` lands on **`/fa`** — the default is Persian for a
browser that would have been sent to /en before this deploy. The top bar's
end cluster reads bell · chat · theme with **zero** fa/en buttons. Settings ·
General: three cards «پوسته», «زبان رابط», «تاریخ و زمان»; the language
select reads «فارسی», the zone select **«تهران»** (was `Asia/Tehran`); the
clock at the date card's other end read «۲۵ شهریور ۱۴۰۵ · ۰۵:۱۰:۱۶» and two
seconds later «… ۰۵:۱۰:۱۸», on the title's line (tops 382 / 379) at the
row's end (424–572 against the title at 1105–1172, RTL). Management ·
General: the labels in document order are «نشان سازمان», «نام سازمان»,
«ایمیل», «وب‌سایت», «زبان پیش‌فرض سازمان»; the inputs are org-name,
org-email, org-website; no «توضیح», no «مکان», no «رایانامهٔ عمومی» anywhere
on the page. Profile: zero `<dl>`, zero `.tile`, the identity form present.
Tasks at 1280 with the assistant open (main 1212): row one's three rails at
y=72 (231 / 267 / 238 wide), row two's tinted rail at y=122 **356 wide** —
it had spanned the column — inside a `flex-wrap` row. Projects: row one's
two rails at 72, row two's tinted rail at 122, 338 wide, in a wrap row, its
items `tab:پروژه‌های من`, `tab:همه پروژه‌ها`, `button:مهلت امروز`. Security:
ten session rows; the device column reads «اج» for the Edge session and
«مرورگر» for the unbranded ones, with no Latin on the page but colleagues'
names and a username. NOT read live: the zone dropdown's option labels —
the tool's click did not hold the Radix panel open for a read; the
`GeneralSettings.test` case pins every option Persian.

---

## 7k. Deployment record — 2026-09-16, later (65a3f30: web only — the buttons take the rail's box, the meetings sort joins row one and the search becomes a key, Help leaves the rail, «ذخیره», the voice picker creates nobody)

No migration and no core change: web on Vercel from the push (`Vercel – mvp`
success on the commit status). **In the user's Chrome, signed in, at 1280
(root 15.06)**, the meetings page: row one is TWO grey rails at y=72 — the
slices «گذشته / پیش‌رو / آرشیو» and the sort, a `tablist` labelled
«مرتب‌سازی» with `data-key` date · people · status — and the lit pill in
either reads 32px tall, a 16px corner, weight 500; the two buttons at the
row's end, «جلسه جدید» (`btn-primary`) and «جلسه پیش‌رو» (`btn-secondary`),
sit at y=72 at **39.5px, 16px, 500** — the pill plus the track's padding
(34 + 8 at that root = 32 + 7.5), which is the one family the ruling asked
for (they had measured 35.8 / 11px / 600 beside a 39.5 rail). Row two at
y=122: the strip's tinted rail — «همه جلسات ۰» lit (32 / 16px) and the
dashed `+` «موضوع جدید» (26.4px on an 8px corner) — inside a
`flex flex-wrap items-center justify-between` row, and at the row's other
end ONE tinted track: «فهرست» (pressed), «تقویم», and the search key
«جست‌وجوی جلسه» (`aria-pressed` false), each 32px. Pressing the key:
`aria-pressed` true, ONE `<input>` inside that same tinted track, focused,
32px tall and 181px wide in a 12rem wrapper, the track 114 → 295px. Typing
«جلسه» → the field reads it. Pressing the key again → `aria-pressed` false
and ZERO inputs; pressing it once more → the field comes back EMPTY (the
query cleared on close — the assertion that matters). The rail reads
«خانه · جلسات · پروژه‌ها · تسک‌ها · مدیریت · تنظیمات» and no «راهنما».
Management · General: the labels in document order «نشان سازمان», «نام
سازمان», «ایمیل», «وب‌سایت», «زبان پیش‌فرض سازمان»; the page's only buttons
are «فارسی» and **«ذخیره»** (39.5 / 16px / 500); the rendered-text walk
finds no «ذخیرهٔ تغییرات» (with the catalogue-only control at 0). NOT read
live: the search narrowing rows (this organisation has no meeting, so the
empty state stood under the field) and the voice picker (no record with
speakers on it) — both pinned by their unit tests. Probe note: a synchronous
read in the same JS call as a `.click()` sees the state BEFORE React's
flush (the key read "not pressed, no input"); the read in the next call
saw the field. Read after the click, never beside it.

---

## 7l. Deployment record — 2026-09-16, last (035926b: web only — the projects page takes the board's two rows)

No migration and no core change: web on Vercel from the push (`Vercel – mvp`
success on the commit status; the deploy marker is the strip itself, which
the page did not have before). **In the user's Chrome, signed in, at 1280
(root 15.06), /fa/projects**: row one is THREE grey rails at y=72 inside one
wrap row — the views (231px wide), the sorts (270px), and the toggles
(212px) holding «پروژه‌های من» and «مهلت امروز», each 32px, `aria-pressed`
false at rest; ZERO `.btn-primary` above y=150 (the row-one create is gone);
the kanban's four columns keep their «افزودن پروژه» rows. Row two at y=122:
the strip's tinted rail, **316px wide** in a `justify-between` wrap row (its
content, not the column): «همه پروژه‌ها ۱» lit, the chip «📁 دیتابیس صوتی»
carrying a ⋯ labelled «گزینه‌ها», and the dashed `+` «پروژهٔ جدید» (26.4px).
The ⋯ opens two entries, «ویرایش» and «حذف» (the second in the danger
coat); «ویرایش» opened the project's own panel — a `role="dialog"` headed
«دیتابیس صوتی» at **`/fa/projects?project=30ae8ef4-…`** — and Escape closed
it back to `/fa/projects`. Pressing «پروژه‌های من»: `aria-pressed` true,
the pill lifted (`bg-surface` + `shadow-card`), the one card stayed (the
reader is on that project) while the strip's count stayed «۱» (the strip
lists every project; the toggle filters the cards); pressed again → false.
NOT pressed live: «حذف» (it deletes a real project) and the `+` (it opens
the create dialog; pinned by the unit test as opening the dialog and not
the inline box).

---

## 7m. Deployment record — 2026-09-16, later (f525157: db/0226 project folders, core + web — the attendees row, the folders' strip, the picture control, the column slot)

**Schema first (§3's order rule).** 0226 was applied to the throwaway
Postgres on this laptop and the SQL suite run there (129 PASS with 16
checks; 102 purge coverage, 109 the set-null class and 30 the agent wall
all PASS; the two `auth.sessions` files are the recorded local-shim reds),
then to PRODUCTION through the `.env` runner (`applied 0226_a_project_
sits_in_a_folder.sql`) with the suite after it («the wall holds»). Then
core: `git archive` of f525157, sha256 `654cc88537629c26` equal at both
ends, `pnpm install --frozen-lockfile` («Done in 1.7s»), both entrypoints
parse under `--experimental-strip-types`, `server.ts` on disk names
`projects/folders` three times, both units `active`, health
`{"ok":true}`; the altitude probe on the server reads **401** on
`/v1/projects/folders` and `/v1/me` against **404** on `/v1/nonsense`;
zero warning-level journal lines in the three minutes after the restart.
Then the push: `Vercel – mvp` success on the commit status.

**In the user's Chrome, signed in, at 1280 (root 15.06).**
`/fa/projects`, kanban: row one three grey rails at y=72 (231 / 270 / 212
wide — views, sorts, the two toggles at rest); row two the tinted rail
**160px wide** at y=122 holding «همه پروژه‌ها ۱» (lit) and the dashed
«پوشهٔ جدید» — NO chip named after a project, NO «پروژهٔ جدید» button,
four «افزودن پروژه» rows in the columns. «لیست» pressed: «پروژهٔ جدید» is
`.btn btn-primary` at 39.5px / 16px in row one's end slot (top 119: the
slot wrapped to a second line at this width with the assistant open, the
kit's own rule), the strip still there, zero column rows. `/fa/meetings`,
«جلسه جدید» pressed: the dialog's field order is «عنوان جلسه *» ·
«موضوع (پوشه)» · **«شرکت‌کنندگان»** · «نحوهٔ برگزاری»; the attendees box
opens with the HOST row «دکتر باقری · میزبان (شما)», nine colleague rows
each `aria-pressed="false"`, the guest field «نام مهمان…» at 32px and its
«افزودن» key; closed, «جلسه پیش‌رو» pressed: one dialog titled «جلسه
پیش‌رو» with the same host row, nine colleagues and the guest field beside
its two date/time inputs. `/fa/management/general`: the logo (45px at
950,137) wears a 26px camera badge at its lower corner (948,158) named
«تعویض تصویر» and a 26px trash beside it (913,147) named «حذف»; the file
input is still the row's labelled control («نشان سازمان», type file); the
page's buttons are exactly «تعویض تصویر», «حذف», «فارسی», «ذخیره» — no
retry glyph, no «انتخاب تصویر», and none of those words as rendered text.
`/fa/profile`: the photo (45px at 950,137), its badge «تغییر عکس» at
(948,158) and its trash «حذف عکس» at (913,147) — the SAME numbers as the
logo's, which is what "so they become the same" measures as; no «حذف عکس»
text on the page. `/fa/tasks`: the lane's children are four `<section>`s
of 185px and nothing else, `scrollWidth === clientWidth` (773 = 773); the
only dashed controls outside the columns are the strip's own «پوشهٔ جدید»
and «پروژهٔ تازه».

NOT pressed live (writes on the organisation's data): a folder's create,
rename or archive, a project filed into one, a meeting created with
attendees, a photo or logo changed or removed. Each is pinned by its unit
test and by the verify-red mutations of the round.

---

## 7n. Deployment record — 2026-09-16, last (7c2673e: web only — the attendees dropdown, the circle, the composer's row)

No migration and no core change: web on Vercel from the push (`Vercel – mvp`
success on the commit status). **In the user's Chrome, signed in, at 1280.**
`/fa/meetings`, «جلسه جدید» pressed: the dialog carries TWO comboboxes,
«موضوع (پوشه)» reading «بدون موضوع» and «شرکت‌کنندگان» reading «دکتر
باقری» — both `.input`, both **37.6px** tall on an **11px** corner, and the
attendees box has ZERO `aria-pressed` rows of its own (it was nine an hour
earlier, which is the shape the directive replaced). Opening the attendees
control: a listbox with `aria-multiselectable="true"` and ten options, the
first «دکتر باقری — میزبان (شما)» carrying `aria-disabled="true"`. Pressing
the first colleague: the panel **stayed open**, that row went
`aria-selected="true"` with a check glyph, and the closed control then read
«دکتر باقری، Behnaaz Behjati». Escaped without creating anything.
`/fa/management/general`: the logo computes `border-radius: 9999px` at
45×45 — the profile photo's own numbers, and the class list reads
`rounded-full`. The assistant sidebar's composer row has exactly two
children: `type="submit"` with the enter glyph at the row's start (left 340
on the RTL row) and the mic with `ms-auto` at its end (left 18), with no
`[data-icon="plus"]` anywhere in the row.

NOT pressed live: creating the meeting (a write on the organisation's data),
and the mic itself (it opens the microphone).

---

## 7o. Deployment record — 2026-09-16, later (54b442f: web only — the films just play, the two reveals wear the questions' anatomy, the first-run door stays shut over its lesson)

No migration and no core change: web on Vercel from the push (`Vercel – mvp`
success on the commit status, four polls). **In the built-in browser pane,
signed OUT, at 1280×720** — the gate is the signed-out screen, and the user's
Chrome holds the owner's session, which the gate routes home. `/fa/sign-in`:
the `<video>` reads `controls: false` (no `controls` attribute in the DOM),
`muted: true`, `loop: false` (the carousel), 486×364; the section under it
carries exactly ONE paragraph (the film's sentence, «دربارهٔ جلساتت سؤال
بپرس…») and the five chips «جلسات · دستیار · کارها · تیم شما · اتصال‌ها».
The caption «ویدیوهای نمونهٔ ۱۰ ثانیه‌ای · دادهٔ فرضی · بدون صدا» is absent
from the RENDERED text (SCRIPT/STYLE/TEMPLATE rejected) and from the flight
payload too — its key left the catalogue — with the two controls that make
the reading evidence: an on-screen string («عضویت در نورای») found, a
catalogue-only string («حذف اتاق») not found. Playback with no chrome: the
film was 8.8 s in and `paused: false` on one read, and 2.5 s later the
element carried `/demo/fa/tasks.mp4` — it had reached its end and advanced
to the next clip on `ended`, having already stepped from `meeting` to `ask`
while the probe was set up.

NOT read live, and why: the two onboarding screens (the flow refuses a
member whose stamp is set — the owner's is — and a fresh sign-up is a write
on production) and the first-run door's remount (the owner's `firstRunSeen`
is already true, so the door does not open for them). Both are pinned by
tests with the production-shaped fixture; the screens reuse the exact split
frame the four question pages render live.

---

## 7p. Deployment record — 2026-09-16, later (447a371: db/0227 the task's room and the project reach, core + web — M55)

Migration first (schema leads code), then core on Hetzner, web on Vercel.
0227 applied on production and the fixture suite re-run — 75 PASS, "the wall
holds", 130 (32 checks) and 106 (18) among them. Core: archive hashes equal
end to end (`ff31674…`), both entrypoints parse under strip-types, both units
active, health `{"ok":true}`, zero level≥40 journal lines after; the room
route reads **401** at `/v1/tasks/:id/room` against `/v1/nonsense` **404**.
Web built from the push (`Vercel – mvp` success on the first poll); the BFF
pair discriminates — the room route **401** unauthenticated, `/api/nonsense`
**404**.

**Read on production in the user's Chrome, at 1280.** The meetings ⋯ menu is
**142px** wide (its longest entry «انتقال به موضوع»), not the old 13.5rem
floor; opening «انتقال به موضوع» drew the flyout at **136px** BESIDE it
(both panels `parentIsBodyChild`, `ancestorClips` empty — portaled, nothing
clips them), and three hit-tests across the flyout's own rect all landed
INSIDE it, where before only a 12px sliver did. The task detail's rail
carries «اتاق گفت‌وگو» as a combobox reading «اتاقی ندارد» at 38px, in order
موضوع · وضعیت · مسئول‌ها · **اتاق گفت‌وگو** · اولویت · مهلت · برچسب‌ها, with
«اتاق تازه» (`btn btn-sm btn-secondary`, 32px) beside it — the owner's
control. Projects: the owner sees «۱۰۰ ساعت …» (created by an admin, Sina)
at «همه پروژه‌ها» with its trash, and pressing «پروژه‌های من» flips it
`aria-pressed=true` and HIDES the card — the owner is not on that one
project, which is «mine» working from an admin's seat (the bug was the
toggle emptying the page).

NOT exercised live, and why: putting a task in a room, «اتاق تازه», and the
seating (a write on the org's data, the 2026-09-06 lesson); the positive
half of «mine» for an admin (the org has one project and the owner did not
make it — pinned by projectReach's unit matrix and db/test/130 instead).

## 7q. Deployment record — 2026-09-17 (7c9f5ee: db/0228 the letterhead, core + web — the صورت‌جلسه, the company sheet, the agent's two halves)

Migration first (schema leads code), then core on Hetzner, web on Vercel.
0228 applied on production and the fixture suite re-run there — «the wall
holds», with **131_letterhead (14 checks)** among them; locally the same file
was flipped twice and went red by name. Core: archive hashes equal end to end
(`b708e64fe9a03c2a`), both entrypoints parse under strip-types, both units
active, health `{"ok":true}`, **zero** level≥40 journal lines after. Web built
from the push and read with a cache-buster **100s** later.

**The route probe needed correcting mid-flight, which is the point of having
one.** `GET /v1/admin/org/sheet` answered **404** where I had predicted 401 —
that route is POST/PATCH/DELETE only, so Fastify was right and the probe was
asking the wrong question. Asked properly: `POST`, `PATCH` and `DELETE` on
`/v1/admin/org/sheet` and `POST /v1/meetings/:id/minutes-text` all **401**,
`GET /v1/org/sheet` **401**, against `POST /v1/nonsense/sheet` **404**.

**And the Vercel probe was vacuous on its first run, for a new reason.** The
key I used as its control (`minutesSignatures`) belonged to the round being
deployed, so control and subject read 0 together and the reading said
nothing about either. Re-run with a key that went live this morning
(`peopleInRoom` → 1) and an invented one (→ 0), it discriminates: before the
build landed the subject read 0 with the control at 1, and after it, 1.

**What was verified against real renderers rather than asserted.** The Word
file was opened in **Word 16 through COM** and exported to PDF: 3 pages,
page setup 52/24/20mm, one **floating** header shape 595×842pt, and the
letterhead drawn on pages one and three. Two earlier shapes were measured
the same way and failed — an `<img>` in the header (inline; header a page
tall; **58 pages**) and `v:imagedata` with a data URI (floating, correctly
sized, **blank**). The printed PDF came from **headless Chrome**: the
sheet's bands at **0.0mm and 296.6mm** — the paper's own edges — with the
first line at **57.7mm** under a 52mm header, on pages one and three. The
anchor that forced the design was measured too: a fixed box under a 52mm
page margin lands at **52.2mm** (the page AREA, not the paper) and repeats,
while the same box at `top:-52mm` lands at **221.3mm** and does not repeat
at all.

NOT exercised live, and why: no letterhead has been uploaded to production —
that is an org-wide write on real data, and the whole path is proven against
fixtures, Word and a real print instead. The assistant's draft spends a
provider run, so it waits for a real press.

## 7r. Deployment record — 2026-09-17, later (5a2807a: db/0229 the signatures, core + web — the minutes are signed by the people in the room)

Migration first, then core on Hetzner, then the push (Vercel). 0229 applied on
production and the fixture suite re-run there — «the wall holds», **77 PASS**,
with **132_the_minutes_are_signed (29 checks)**, **50_identity_search_gateway
(30)** (the closed DELETE list grew its two argued entries) and **102_purge_
coverage (3)** (the purge learned both tables) among them. Locally the same
132 was flipped twice — an admin reading a colleague's signature on file, an
outsider signing — and went red by name each time, with the control green
either side.

Core: archive hashes equal end to end (`67c765ca65f1236a`), both entrypoints
parse under strip-types, both units active, health `{"ok":true}`, **zero**
level≥warning journal lines after the restart. The six new routes read **401**
signed out — `GET`/`PUT` `/v1/me/signature`, `GET`/`POST` `/v1/meetings/:id/
signatures`, `DELETE …/signatures/me`, `GET …/signatures/:userId/image` —
against `GET /v1/nonsense/signature` **404**. The BFF, read cache-busted from
outside **90 s** after the push: `/api/me/signature` went **404 → 401** (the
route did not exist before this build, so the flip IS the deploy marker), the
meeting routes 401, an empty POST body **400** and a real one **401** (the
2026-09-04 pair), the control 404.

**Read on production in the user's Chrome.** The summary tab of Sina's meeting
carries a FIFTH section «۵. امضای حاضران» as the last section inside the card
(23 px above the card's foot), reading «هنوز کسی امضا نکرده است.» with **no
control** — and that absence is the policy answering, not a gap: the server's
own record says `can_sign: false`, because the signed-in owner is neither the
host (Sina) nor on the roster. Being the org owner buys nothing here, which is
the design. The profile's identity section carries «امضا» directly under the
photo: a white 136×45 well reading «ثبت نشده», the camera badge at **26 px**
(= the photo's), no trash — the empty state, since `/api/me/signature` answers
404 for this account.

NOT exercised live, and why: every write. Signing, withdrawing and uploading a
signature are writes on the organisation's own records, and this org holds
two meetings, neither hosted by nor including the signed-in account — so the
positive half (the control drawn for a host; a picture landing in the
document's row) is pinned by the unit matrix (eleven mutations red, control
green) and by 132 on the fixture, and the first real signing is the screen's
own proof. Word's rendering of a body data-URI image was measured on the
letterhead round (7q) and is relied on here rather than re-measured.

## 7s. Deployment record — 2026-09-17, later (c5517f6 + 1131d07: web only — the front end unified at the CLASS, and the summary's ladder)

Nothing in core or db. Two pushes, Vercel only; each read back on
production in the user's Chrome (tab 842554675, app.neurai.pt) rather than
assumed from the push.

**c5517f6 — every button wears a kit coat, every heading a kit role.** The
disconnect the user reported was MEASURED first: a same-origin iframe walk
over 22 signed-in pages at 1280 (computed styles per control, grouped into
signatures — fire-and-forget into `window.__audit` and polled, because CDP's
`Runtime.evaluate` times out at 45 s and the walk took ~5 min) plus a source
census. It sat one property below the kit: cards, rails and fields were
already one recipe each; BUTTONS had two secondaries (51 outlined by hand
against 59 filled `.btn-secondary`, and the dialog kit's own `FOOTER_CANCEL`
outlined), 25 hand-drawn green primaries with a shadow and a heavier weight,
44 icon buttons with private hover grounds — 278 sites in 133 spellings;
HEADINGS in 46 spellings across 107; the new-task dialog carried TWO field
heights (42 vs 38); and the meeting page's tab rail measured 50 px against
40 everywhere else — `scroll-quiet`'s `scrollbar-width: thin`, which Chrome
honours natively on an overflowing horizontal box and which takes ~10 px of
layout. Fixed at the class: seven coats in `globals.css` (`btn-primary`,
`btn-secondary`, `btn-ghost`, `btn-danger`, and the three the screens had
been drawing by hand — `btn-soft`, `btn-dashed`, `btn-ghost-danger`), five
heading roles (`h-page` 16/700, `h-dialog` 15/700, `h-section` 15/600,
`h-card` 14/600, `h-label` 11/600 subtle), `PANEL_INPUT` on `.input`'s one
height, `.track-scroll` (no scrollbar at all) on both rails, and
`PanelHeader` deleted. 178 button sites in 63 files and 68 headings in 37
files moved by codemod; two guards refuse the hand-drawn spellings tree-wide
(`buttonCoat.guard`, `heading.guard`), each with a control proving it can
answer NO and verify-red by mutation.

Deploy check for c5517f6 was cache-busted through a class that exists ONLY
in the new build (`track-scroll`), with a both-builds control (`scroll-quiet`,
found in each) and an invented-class control (found in neither) — a marker
from the previous commit reports "deployed" on the first attempt, and one
with no subject reports nothing. **Read on production**: the meeting page's
two rails **40 / 40** (the tab rail had been 50); the summary tab's title on
`h-section` and its sections on `h-card`, its buttons `btn-secondary` /
`btn-soft`; the new-task dialog's title `h-dialog` at **14.1 / 700**, its
fields **38 / 38** on an 11 px corner, its footer «انصراف» `btn-secondary`
(40 px, `rgb(237,234,227)`, no border, weight 500) beside «ساختن تسک»
`btn-primary` (40 px, `rgb(1,116,63)`), its column chips 32 px on a
0.67 px edge.

**1131d07 — the summary's headings step DOWN.** The reading above found
the next one: inside section 2 the models' own «**Next steps**» rendered
at **17.8 / 700** ABOVE the card's numbered sections at 13.2 / 600 —
`SummaryBody.tsx` and `markdown.tsx` had been EXCEPTED from the heading
guard that afternoon as "content that scales with its prose", and content
inside a card with headings of its own is chrome. Every rung wore a legal
role, so no guard could see a ladder that climbs as it descends. The ladder
now: name `h-page` → numbered sections `h-section` → the prose's own
headings `h-card` (SummaryBody's, and markdown's top level) → markdown's
lower levels `h-label`; both renderers left the exception list (three files
remain), and the guard's first run on the tightened corpus named markdown's
`<h3>` at `text-sm font-semibold` before any green. `Summary.test` pins the
ORDER of roles on the rendered tab — three flattenings each red on its own
line — because a flattened ladder is spelled legally and only a rendered
test refuses it. The build gate's stricter typecheck caught a destructured
`HTMLElement | undefined` that `tsc` had passed (`?? null`).

Verified before the push: web tsc 0; 1795 web tests in 247 files (the one
red is the recorded `selectMenuWidth` load flake — 3.05 s under the full
suite, 5/5 alone); the build gate alone; the encoding sweep (1534 files);
verify-red by mutation on the guard (four reds by name) and on the ladder
test (three). Vercel: `neurai-site` completed at once, `mvp` building at the
time of writing; the production reading of 1131d07 follows below.

**Read on production (1131d07)**, both Vercel projects `success` on the
commit status, `/fa/meetings/c68e7943-…` → «خلاصه», at 1280 / root
15.06: the document's name `<h2>` on **`h-page` 15.1 / 700** (that class
on that element exists only in this build — the deploy marker), the five
numbered sections on **`h-section` 14.1 / 600**, and inside section 2 the
prose's own «تصمیم‌ها» and «اقدامات بعدی» on **`h-card` 13.2 / 600** —
one step UNDER the section they sit in, where the previous build had them
at 1.18 em bold above it. Eight headings on the tab, every one wearing a
kit role, none spelling a size. NOT exercised live: nothing — this round
is read-only on the org's data.

## 7t. Deployment record — 2026-09-17, later (1cd8450 + 0729876: web only — the sub-menus take design «ج», and the kit's chip collides with the theme's badge)

**1cd8450 — design «ج» applied in the kit.** The user chose «ج» from
the three designs on the canvas; applied at the kit so every page follows,
never per page. Row one is a SEGMENTED CONTROL for the views (`TAB_TRACK`:
`rounded-md bg-surface-2 p-[3px]`, the chosen entry a `btn btn-xs` pill in
the surface tone with the card shadow) beside the sorts and the filters as
MENUS — `ToolbarMenu` on `btn-ghost btn-sm`, «مرتب‌سازی» reading its chosen
value on the button, «فیلتر» carrying a count badge that is absent at zero;
radio rows for a choice, check rows for on/off, a check keeping the menu
OPEN — and the create button at the row's end in `btn-primary btn-sm`. Row
two is a bare LINE of 24px chips with no rail behind it, which REVERSES
the 2026-09-15 shape (two 40px rails cost 104px before the first card at
the 16px root). `.btn-xs` (28, the 8px corner, the caption size) and the
chip are the kit's two new shapes; `MENU_PANEL_CLASS` / `MENU_ENTRY_CLASS`
are exported from rowActions.tsx so the toolbar's menus and the row menus
are one panel. Tasks, projects and meetings rewritten onto it (the
meetings strip's `end` slot removed — the search KEY sits in row one beside
the view control). Guards: toolbar.guard's control asserts the segmented
track, `btn btn-xs`, the card shadow and the chip pair, and refuses a
ground on `FILTER_TRACK`; panelStyle.test pins `TAB_BAR` / `tabClass`;
filterChips.test rewritten (8); buttonCoat.guard and units.guard learn
`xs` and the chip. Verify-red by mutation on eleven behaviours, control
green either side, each red on its own test. icons.guard fired on the
first full run — the two «فیلتر» glyphs at 13px, off the scale — a true
positive before green; 14 now, the row's own size. Verified: web tsc 0;
1796 tests (the one red the recorded `selectMenuWidth` load flake, 5/5
alone); the build gate alone; the sweep (1534 files).

**0729876 — the kit's chip is `.filter-chip`.** Reading 1cd8450 on
production rather than its source: the chips computed **0.71875rem** where
their class says `text-caption` (0.6875rem), with a 0.25rem vertical
padding from nowhere. globals.css had carried a `.chip` since 2026-09-03 —
THE THEME'S BADGE, a borderless pill the calls page's share codes, the
skills page's tool names, the Hub's agent names and the assistant
settings' hotkey state all wear — and design «ج» had added a second
`.chip` two hundred lines above it. Two valid rules for one name, each
right on its own: the later one won the size and the padding on the kit's
chip, and the kit's rule gave every badge in the product a hairline, a
fixed 24px height, a pointer and a hover it never asked for. Typecheck,
1796 tests and the build gate were green throughout — a duplicate class
rule is valid CSS and only the computed value disagrees (the
artifact-reads-as-satisfied class, one layer down from `text-on-accent`).
Mine: a kit class added without grepping for the name. Renamed
`.filter-chip` / `.filter-chip-on` (the badge and its seven consumers
untouched); `cssRule.guard.test.ts` is the rule — a plain class selector
is defined ONCE in globals.css at one at-rule context (a redefinition
inside `@media` is the override it looks like), comments stripped first,
the parser proven on five fixtures and red by mutation on a staged second
`.btn-xs`. Its first tree run named one more: `.wave-scope`, whose
`transition` sat in a one-line second rule beside the glow states —
folded into the block. Verified: tsc 0; 1798 tests (the same flake, 5/5
alone); the gate alone; the sweep.

**Read on production (0729876)**, both Vercel projects `success` on the
commit status, in the user's Chrome at 1280 / root 15.06, the deploy
marker being `.filter-chip` (a class that exists only in this build — 4 on
tasks, 1 on projects, 2 on meetings) with the invented-class control at 0.
TASKS: the views on a **32.4px** segmented track (`rgb(237,234,227)`, 11px
corner, 3px padding) with the chosen «کانبان» a **26.4px** `btn btn-xs`
pill on an 8px corner, white, weight 600, the card shadow present — the
THIRD entry in the computed string after the two transparent ring
placeholders, which the first read had sliced away and reported as no
shadow; «فیلتر» a `btn-ghost btn-sm` at **32** on the same line (71.7 vs
71.5); the chips **22.6** (`h-6`) at the pill's own **10.35px**, fully
round, the hairline `rgb(232,231,226)`, the lit «همه تسک‌ها ۱» on the
accent edge `rgb(1,116,63)` over the soft tint `rgb(230,241,236)`; the line
transparent, 26.4 tall (the dashed `+`); zero retired rails; the first
column **81.3px** under the row's top, where the two rails had cost ~98 at
this root. The «فیلتر» menu opened on a synthetic pointerdown: five
`menuitemradio` rows with `data-key` all / critical / high / medium / low
and two `menuitemcheckbox` rows; pressing «فقط تسک‌های من» left the menu
OPEN, the trigger's badge read «۱» (`badge-num … bg-accent text-on-accent`),
a second press cleared it — local state only, nothing written. PROJECTS:
«مرتب‌سازی» reads «تازه‌ترین» on its button beside «فیلتر», both 32; the
same track and pill; «همه پروژه‌ها ۱» lit; no `btn-primary` above the
kanban (the columns' rows are the door); 81.3 to content. MEETINGS: two
`tablist` tracks (the slices with «گذشته» lit; the icon-only list /
calendar pair), «مرتب‌سازی» reading «تاریخ», the search key `btn-ghost
btn-sm px-2` at 32 IN row one, «جلسه پیش‌رو» `btn-secondary btn-sm` and
«جلسه جدید» `btn-primary btn-sm` at 32 at the row's end; «همه جلسات ۲» and
«تیم فنی ۱» on the line; 81.3 to content. THE BADGE CONTROL: on the skills
page five `.chip` spans read border 0, cursor auto, 18.3 tall, 10.82px —
the theme's badge exactly as before the round. NOT the mock's number: «ج»
drew 70px to content at the 16px root and production reads 86 (81.3 ×
16 / 15.06) — the kit's two 12px row gaps (2026-09-05, "an equal gap under
every toolbar") and the 28px dashed `+` were kept where the mock drew 8px
gaps and a 24px `+`; tightening either is one token and the user's call.
Probe notes: the MCP tab's window shrank to 523px and went hidden between
two reads, so the root fell to its 14px floor and every px moved while
every rem held, and screenshots timed out for the whole read — read
`innerWidth` and the root before believing a px; `resize_window` to 1280
restores the frame. NOT exercised live: nothing — this round writes
nothing on the org's data.

## 7u. Deployment record — 2026-09-17, later (6a68d04 + 24e598c: web only — the meetings row's view keys join the slices' track, and the search key stands at the end of the folder line)

**6a68d04 — the row.** User, on the row design «ج» had shipped that
morning: "add the list and calendar to the first set of items in the first
sub-menu like the tasks and other, and bring the search icon to the second
row at the end of it and open it to the right in the fa version, so the
search icon will be the left side of the second sub-menu." Row one is ONE
segmented control now — گذشته / پیش‌رو / آرشیو, a `TRACK_DIVIDER`, then
«فهرست» and «تقویم» with their words on the pills (the task board's shape:
one rail across a divider, two questions; the view keys are `aria-pressed`
toggles, not tabs of a second tablist). Row two keeps the search: the key
in the strip's `end` slot at the row's END (the LEFT edge of a Persian
screen), `btn-ghost btn-icon` — the folder line's own 28, the dashed `+`'s
square — with its field as the key's PRECEDING sibling, so it opens on the
key's start side, toward the chips. Meetings.test pins the structure
(jsdom lays nothing out): both view keys children of the slices' track and
exactly one tablist in row one; the key in the strip's row, not in the chip
line, not in row one; the field before the key in DOM order; closing
clears. Verify-red by mutation, five reds by name — and the second
mutation's first anchor missed the blank line before the toolbar's close
and made the key VANISH, a red naming a different defect; corrected before
it counted. Verified: tsc 0; 1798 tests; the gate alone; the sweep.

**24e598c — the field APPEARS rather than slides, and the reason is a
production measurement.** Read on 6a68d04 at 1280 / root 15.06: pressed,
the key went `aria-pressed`, the input mounted, took focus and measured
180.7px — and its wrapper's USED width was **0**, its box **26.4** (the key
alone), so the field was open, focused and clipped to nothing, its rect
146px past the row's edge. Three experiments on the live page, restored
after each: with the width transition on, wrapper 0 / box 26.4, and a
forced relayout of the box took them to 180.7 / 207.1; with the transition
class removed and the same inline width, 180.7 / 207.1 from the first
frame; `flex-basis: 12rem` likewise. So a `shrink-0` flex container's
intrinsic width is taken at the child's FIRST frame of a `width`
transition (0) and Chrome does not re-run it as the animated width grows;
with `overflow: hidden` the child's min-width is 0 and it shrinks to the
box that was sized around its starting value. The 2026-09-16 wrapper had
measured 12rem because it stood in a track with other content sizing the
box. The wrapper is gone; the input mounts at `w-48` before the key. Same
five mutations red by name on the re-anchored script; 1798 tests; gate;
sweep.

**Read on production (24e598c)**, both Vercel projects `success`, in the
user's Chrome at 1280 / root 15.06. `/fa/meetings`: ONE tablist in row one
whose children read گذشته · پیش‌رو · آرشیو · SPAN · فهرست · تقویم — the
divider a 1×18.8 span, every pill 26.4 in a **32.4** track spanning the
row's start; the search key **26.4** square at the row's LEFT edge (its
left 408.8 = the row's 408.8), on the chip line's own row (top 115.2 on
both), the line and the dashed `+` at the same 26.4; pressed → the field
**435.2–615.9, to the RIGHT of the key at 408.8–435.2**, inside its box
(now 207.1, was 26.4 closed), 180.7 wide, focused, with 338px to the first
chip; closed → no field, the box back to 26.4. `/en/meetings`: the mirror
— Past · Upcoming · Archive · SPAN · List · Calendar; the key at the row's
RIGHT edge; the field 664.1–844.8 to the LEFT of the key at 844.8–871.2,
inside its box, 334px to the chips. Nothing exercised live that writes:
the key's press and release are local state.

## 7v. Deployment record — 2026-09-17, later (9bd350e + c22b70e: web only — every page's create at the end of row one, and the profile picture with eight ready-made avatars)

**9bd350e.** User: "add a new project and new tasks in the sub-menu top for
each page, the related one, at the end of the first sub-menu top; in
profile change «عکس نمایه» to «تصویر پروفایل», and in front of it put a
divider and add 8 avatar images, 5 girls and 3 boys, animated, for them to
select as a profile image." The task board's row one ends with «تسک جدید»
(`btn-primary btn-sm`) beside the columns' own «افزودن تسک» rows, opening
the dialog on the FIRST column; the projects page carries «پروژهٔ جدید» at
the row's end on EVERY view — reversing 2026-09-05 for the kanban, whose
columns keep their «افزودن پروژه» rows as well; meetings already ended its
row with «جلسه جدید». `platform/avatarPresets.ts` draws eight faces as
inline SVG (five women — long hair, a bob, curls, a bun, a headscarf —
then three men — short hair, a beard, curls and glasses); the profile's
picture row is the picture control, a vertical hairline, then the eight as
round 36px keys named «آواتار ۱» … «۸»; a preset takes the photo's OWN
road — rasterised to the same 256px JPEG a picked file becomes, shown in
the accept card, uploaded only on the accept — so the server learns
nothing new. The keys are not `btn`s (the picture IS the control; the
family's corner and inset would frame a face); `control.guard` carries
the entry with that reason. Tests: AvatarEditor (the divider directly
between the control and the group, eight keys each a picture named by
its number, a press → the accept card with nothing uploaded → the accept
uploads what the canvas drew; canvas and Image stubbed), TaskBoard (the
create in row one's end slot, opening on the first column), Projects
(both doors on the kanban). Verify-red by mutation, six reds by name —
after one vacuous mutation of mine: hiding the button with a Tailwind
class is invisible to jsdom, so that red could never fire; re-anchored to
remove the slot. Verified: tsc 0; 1801 tests (the recorded
`selectMenuWidth` load flake, 5/5 alone); the gate alone; the sweep.

**c22b70e — the avatars had wrapped.** Read on 9bd350e: the separator
stood directly after the picture control and directly before the group,
every key a round 33.9px picture — and the group's first key sat at
x 961.8 while the separator sat at 900.6: the group had WRAPPED under the
picture, so the divider ended a line with nothing beside it. `FormRow`
caps its control column at 380px (2026-09-02, for a text field's sake)
and a picture control, a divider and eight faces measure ~470. `FormRow`
gained `wide` (the row's whole width, start-aligned — neither the cap nor
`controlAtEnd`'s end slot); the photo row wears it; scaffold.test pins
the three-way pair and is red by name when the wide branch is capped
again. 1802 tests; gate; sweep.

**Read on production**, both Vercel projects `success`, in the user's
Chrome at 1280 / root 15.06. 9bd350e — `/fa/tasks`: «تسک جدید»
`btn-primary btn-sm` **32px** in row one's END slot at the row's left
edge (416.6), on the track's line, beside **4** «افزودن تسک» rows; pressed
→ the dialog «تسک جدید» with the org's FIRST column «بک‌لاگ» checked and
the other three not, closed on Escape. `/fa/projects` (kanban): «پروژهٔ
جدید» `btn-primary btn-sm` 32px at the row's end beside **4** «افزودن
پروژه» rows. `/fa/profile`: «تصویر پروفایل» in the rendered text and
«عکس نمایه» absent (with the catalogue-only control present in the
payload and absent from the text); the separator 1×30 directly after the
picture control and directly before the group «آواتارهای آماده»; eight
keys «آواتار ۱» … «۸», all **33.9px** and fully round, each carrying its
SVG; «آواتار ۳» pressed → the accept card «از این عکس استفاده شود؟» with
a **256×256 `data:image/jpeg`** preview and nothing uploaded; «انصراف» →
the card gone. c22b70e — the same row on ONE line: the picture at
912.9–995.7, the hairline at 900.6, the keys from 855.4 running left to
565.6, every key's centre within 2px of the separator's, in a control
column of 430.1 (was capped at 380). NOT exercised live: an accept (a
write on the person's profile) and a create on either board.

## 7w. Deployment record — 2026-09-17, later (17bd0de: web only — the profile's eight avatars are generated from DiceBear's Avataaars, never drawn by hand)

**17bd0de.** User: "change the avatars image, use something better
designed, use skills and plugins to do it." The eight hand-drawn faces of
9bd350e are replaced by DiceBear's Avataaars (Pablo Stanley,
https://avataaars.com/ — free for personal and commercial use, no
attribution owed), rendered once by `web/scripts/gen-avatar-presets.mjs`
into the same `platform/avatarPresets.ts`; `@dicebear/core` 9.4.3 and
`@dicebear/avataaars` 9.4.2 are devDependencies and the app never loads
them. **The choice was measured**: the four attribution-free styles
(Avataaars; Lorelei, Notionists and Open Peeps, all CC0 — the CC BY ones
would owe a visible credit) were rendered on one sheet, each as a curated
set of five women and three men with every trait pinned by name, at 96px
and at the profile key's 36px. At 36 Notionists is a grey scribble and
Lorelei's white line-art faces lose their features; Avataaars keeps a
silhouette, a hair colour and a shirt, is the smallest (37KB for eight
against 98KB) and carries a hijab. The sheet is a canvas for the user
(https://claude.ai/artifact/YZsJuRGzMaPPzwjDyKyao7); another style is one
table in the script. **The generator is the source**: `--check [path]`
exits 1 when the module on disk disagrees with a fresh render, and
`avatarPresets.test.ts` runs it WITH the control — the same check against
a copy with one character changed must exit 1. **A key is an `<img>` data
URL, never the SVG inlined**: every DiceBear SVG carries
`id="viewboxMask"`, and eight inlined into one document resolve every
`url(#viewboxMask)` to the first — measured on the candidate sheet, where
a second style's faces were clipped to a quarter of a circle by the first
style's mask. The road is unchanged (rasterised to the crop's 256px JPEG,
the accept card, uploaded on the accept only); RULEBOOK's picture bullet
rewritten. Verify-red by mutation, control green either side, each red on
exactly its own test: the module edited by hand; a man listed first and
the module regenerated; the keys inlining their SVG again; a preset
landing its SVG URL straight in the accept card. Verified: tsc 0; 1804
web tests in 249 files; the gate alone from PowerShell; the encoding sweep
(1538 tracked text files, staged); the token verifier.

**Read on production**, both Vercel projects `success` at 23:49:46, in
the user's Chrome at 1280 / root 15.06 on `/fa/profile`: the group
«آواتارهای آماده» holds **8** keys «آواتار ۱» … «۸», every one a round
(9999px) **33.9px** button whose `<img>` fills it (ratio 1.00), `src` a
`data:image/svg+xml` URL carrying `id="viewboxMask"` (this build only —
the previous build inlined `<svg>` elements), `complete` with
`naturalWidth` **256**; **0** inline `<svg>` in the group; all eight on
ONE line (top 136) running left from 855 to 566, the 1×30.1 separator at
901 directly after the picture control (the camera badge in its previous
sibling) and directly before the group; «تصویر پروفایل» in the rendered
text with the accept card's sentence absent from it and present in the
payload (the catalogue-only control). «آواتار ۵» (the headscarf) pressed →
the accept card «از این عکس استفاده شود؟» rendered with a **256×256
`data:image/jpeg`** preview (~16.8KB) and the accept/cancel pair;
«انصراف» → the card gone, the two JPEGs left on the page being the
owner's own saved photo (the control and the rail). NOT exercised live:
an accept (a write on the person's profile).

## 7x. Deployment record — 2026-09-18 (50e3fa5: web only — the button family is the tactile design in ink)

**50e3fa5.** The user chose from a nine-way canvas (three button designs
in three colourways each, dark and light, the product's own coats, sizes,
states and labels; https://claude.ai/artifact/VDRGQZHJmHM5SjfpAQXxiw):
"Ink · monochrome — dark #E6E9EC on #101316 · light #1C1A16 on #FFFFFF —
Tactile". Applied at the button classes in `globals.css`; no call site
changed. The corner is the panel's `rounded-lg` (12) on `.btn` and
`.btn-sm` (the 16 was "the rail's own box" of 2026-09-16, and the rail
became design «ج» on 2026-09-17); the 8px squares and pills are untouched.
Every FILLED coat wears a lighter top fading into the fill, an edge one step
darker, a lip of light (`inset 0 1px 0`) and a small drop, and presses IN
(`active:` swaps the shadow for an inset and drops the box a pixel); the
ghost coats stay flat. The primary's fill is `--btn`, the page's own ink,
with `--on-btn` on it; the secondary is a raised neutral in the same
recipe; the soft coat a chosen state on `--btn-soft`, flatter than the
secondary; the danger the recipe in red. The tokens are their own pair in
both theme blocks (with `--btn-lip`, `--btn-hover` 1.06 / 1.45 and
`--btn-hover-2` 1.08 / .96 — a near-black fill needs a bigger brightness
step than a near-white one before a pointer can see it) and are registered
in tailwind as `btn` / `on-btn` / `btn-soft`; `--accent` and `--primary`
stay green, so chips, links, toggles, the focus ring and the brand keep the
platform's colour. verify-pairs gained three floors (ink on the fill 15.29
/ 17.37, fg on the soft ground 11.94 / 13.8, the fill against the panel
13.46 / 17.37 as a control edge). `buttonTactile.test.ts` reads the rule
bodies: the corner, the primary on the ink tokens and not the accent, the
lip and the press on every filled coat and their ABSENCE on the ghost
coats, the tokens in both themes at the chosen values, the accent still
green, the three colours in tailwind. Verify-red by mutation, control green
either side, each red on exactly its own test: the primary back on the
green, its lip removed, the 16 corner back, a lip on the ghost, the light
theme losing `--btn`, the accent turned to ink, the secondary losing its
press. Verified: tsc 0; 1809 web tests (the two reds under full-suite load
are the recorded `selectMenuWidth` and `SpeakersDirectory.account` flakes,
green alone); the build gate alone; the token verifier; the encoding sweep
(1539). Rendered on the dev server before the deploy (the sign-in gate).

**Read on production**, both Vercel projects `success`, at 1280 / root
15.06. In the user's Chrome (their theme is LIGHT), `/fa/tasks`: «تسک جدید»
(`btn-primary btn-sm`) **32px**, corner **12px**, `background-image:
linear-gradient(#403E3B-ish 0%, rgb(28,26,22) 100%)`, ink **white**, a
0.67px edge one step darker than the fill, `box-shadow` = the lip
`rgba(255,255,255,.28) 0 1px 0 inset` + `0 1px 2px` + `0 3px 8px`;
«فیلتر» (`btn-ghost btn-sm`) 32 / 12px / no image / no shadow / no edge
— flat; the six «افزودن تسک» rows `btn-dashed` on a 0.67px border-strong
dashed edge. The new-task dialog: «ساختن تسک» **39.5** (= the 42 token)
with the same recipe, «انصراف» (`btn-secondary`) 39.5 / 12px /
`linear-gradient(rgb(237,234,227) 0%, rgb(255,255,255) 100%)` / ink
rgb(28,26,22) / a 0.67px `rgba(143,139,128,.55)` edge / the lip at .6 +
`0 1px 2px`; the dialog itself still 18px. In the built-in pane on the
signed-out gate with `neurai-theme` set to **dark** and a full reload
(the user's own preference untouched): body rgb(15,17,19), «ادامه»
(`btn-primary`) 39.5 / 12px / `linear-gradient(#EAECEF 0%,
rgb(230,233,236) 100%)` / ink **rgb(16,19,22)** / a 0.67px #A6A8AA edge /
the lip at .28; «ادامه با گوگل» (`btn-secondary`) `linear-gradient(
rgb(36,42,48) 0%, rgb(27,32,37) 100%)` / ink rgb(242,244,246) / a
`rgba(114,121,130,.55)` edge / the lip at .14. NOT read live: a press
(the inset and the 1px drop are pinned by the rule-body test), the soft
coat and the danger coat (no consent card or delete was raised on real
data), and hover.

## 7y. Deployment record — 2026-09-18, later (0f2a9ad: web only — every button one step down)

**0f2a9ad.** User, an hour after 7x: "make all button one size smaller".
The scale moved ONCE, at `SCAFFOLD.controlHeight / Sm / Icon`: 42 / 34 /
28 → **34 / 28 / 24**. Every class keeps its name and its readers, so the
icon squares (`.btn-icon-lg` / `-sm` / `.btn-icon` → 34 / 28 / 24), the
pagination arrows, the record transport and the meetings strip's search
field follow with no line of their own; the padding and the small type
went one step each (13 / 10 / 8; detail / caption / caption); the corners
did not move; inputs read `fieldHeight` and are untouched. THE
RELATIONSHIP THAT HAD TO MOVE WITH IT: `TAB_TRACK` put 3px around a 28
pill because 34 was the compact control's height, so the menus and the
row-one create stood level with the segmented control; with the pill at
24 that sum is 30 against a `btn-sm` of 28, so the track is 2px now (24 +
4 = 28), and `buttonTactile.test` asserts the SUM rather than either
number. Three tests that pinned `p-[3px]` as a string follow. Verify-red
by mutation, control green either side, each red on its own test:
`controlHeight` back to 42; the track back to 3px around the 24 pill;
`.btn-sm` back on the 12.5 text; `.btn` spelling a `h-[42px]` beside the
token. Verified: tsc 0; 1812 web tests (no flake this run); the build
gate alone; the encoding sweep; rendered on the dev server first (the
gate's primary 34 at the 16px root, the top-bar square 28).

**Read on production**, both Vercel projects `success`, in the user's
Chrome at 1280 / root 15.06 on `/fa/tasks`, BEFORE and AFTER the deploy on
the same page and the same probe: the segmented track **32.4 → 26.6** with
its padding **3 → 2px**, the pill **26.4 → 22.6** (inset 9.4 → 7.5, its
caption 10.35 unchanged); «تسک جدید» (`btn-primary btn-sm`) **32 → 26.4**
(inset 13 → 9.4, type 11.77 → 10.35); «فیلتر» (`btn-ghost btn-sm`) 32 →
26.4, the track standing **0.2px** off the menu's height where it stood
0.4 before — level; the board's «افزودن تسک» rows 26.4 → 22.6; the top
bar's `btn-icon-sm` 32 → 26.4; the strip's `btn-icon` 26.4 → 22.6; the
chips 22.6 unchanged; every row-one element on one top (72). The new-task
dialog: «ساختن تسک» and «انصراف» **39.5 → 32** (inset 13), the text field
**37.6 unchanged**. NOT read live: the meeting page's post tabs and the
record transport (both read the same tokens).

## 7z. Deployment record — 2026-09-18, later (9ca6668: web only — the onboarding's «later» begins with the permissions stage) + the model reading

**9ca6668.** User: "for onboarding remove the later for the first four
pages." `steps.ts` carries `FIRST_SKIPPABLE = "data"` and `canSkip(step)`;
the flow draws «بعداً» only where `canSkip` says so, so the four sign-up
questions (welcome, goals, work, places) are answered, never skipped, and
every screen from the permissions stage on keeps the exit. steps.test
asserts the RELATIONSHIP (everything before the door is sign-up, nothing
after it is); the rendered test asserts the PAIR (absent on each of the
four, present on `data`); the two exit tests resume at `data`. Verify-red
by mutation, control green either side: `canSkip` always true (2 red), the
door removed everywhere (3 red), the door one question early (2 red).
Verified: tsc 0; 1814 web tests (the one red under load is the recorded
`SpeakersDirectory.account` flake, 6/6 alone); the build gate alone; the
encoding sweep. Deployed: both Vercel projects `success` at 17:44:21.
**NOT provable live**: the flow refuses a stamped member and a fresh
sign-up is a write on production — the tests are the proof.

**The model reading, taken for the user's choice (no change made).**
`/api/models` on production: the org's allow-list is the 2026-08-16 seven
and its DEFAULT is `google/gemini-3.1-pro-preview` at **$2 / $12 per M**
— a PREVIEW id and the dearest entry but Kimi K3. The server's `core.env`
carries no `*MODEL*` key (the ladder falls to the org preference). The
bundled catalogue (`getBuiltinModels("openrouter")` from
`@earendil-works/pi-ai/providers/all`, 335 ids) is a SNAPSHOT whose prices
can be stale against OpenRouter's live list (445 ids, fetched 2026-09-18):
`deepseek/deepseek-v4-pro` reads $0.435/$0.87 in the picker and
$1.60/$3.20 live; `z-ai/glm-5.3` and `glm-5.3-flash` (2026-08-18 / -26)
are on OpenRouter and NOT in the catalogue, so the picker cannot offer
them until the package is bumped. Live, tool-capable, open-weight
candidates: `deepseek/deepseek-v4-flash-0731` $0.06/$0.12 · 1.3M ctx ·
MIT · 284B-A13B; `z-ai/glm-5.3-flash` $0.09/$0.30 · 320B-A18B · MIT;
`z-ai/glm-5.2` $0.55/$1.74 · 753B-A40B · MIT; `deepseek/deepseek-v4-pro`
$1.60/$3.20 · 1.6T-A49B; `qwen/qwen3.7-flash` $0.03/$0.13 (closed
weights); `minimax/minimax-m3` $0.30/$1.20. Persian quality of the 2026
generation is UNMEASURED anywhere this side could find — the acceptance
run on real records is the user's call (a provider spend and summary
writes). The recommendation and the tool-structure proposal
(docs/AGENT-TOOLS-STRUCTURE.md) went to the user in chat.

## 7aa. DeepSeek V4 Flash set as the default, Persian test passed live, and a dry-run bug found — 2026-09-18, later (no commit for the model change: a production config write through the product's own routes)

User: "set deepseek v4 flash as default and run the persian test." Both done
on production, in the owner's Chrome, through the product's own BFF routes —
no raw SQL, so the writes are the ones an admin would make and are audited.

**Set (two writes, reversible).** `PATCH /api/admin/org` put
`deepseek/deepseek-v4-flash` FIRST in `allowed_models` (so `allowed[0]` — the
org default rung for members with no preference and for the unattended
workers — is DeepSeek), keeping the previous seven behind it; `PUT
/api/models` set the owner's `preferred_model` to the same. `/api/models`
then read back `preferred_model: deepseek/deepseek-v4-flash`, `selected:
true`, `tools: true`, 1M context. The id is the plain alias, not `-0731`: the
bundled pi-ai catalogue labels the alias "V4 Flash 0423" at $0.088/$0.176,
but a call to OpenRouter with the alias resolves to the latest build at call
time, so inference is current and the displayed price is a stale snapshot
label (live OpenRouter: $0.05/$0.10 — ~20–40× under the $2/$12 preview it
replaced).

**The Persian test, live, on the real path.** The dry-run route was tried
first and 400'd (see the bug below), so the test ran through the ASSISTANT on
production — the more representative path anyway (DeepSeek + tools + Persian).
Asked «چند پروژهٔ فعال داریم و اسم‌هایشان چیست؟ کوتاه به فارسی جواب بده.»;
the answer: «یک پروژهٔ فعال: ۱۰۰ ساعت دیتای لیبل خورده — با ۴ نفر، هنوز هیچ
تسکی نداره.» — fluent idiomatic Persian, Persian digits, and it CALLED A
TOOL (`list_projects`) to get the real project, its member count and that it
has no tasks. Confirmed at owner altitude on the live db: the newest
`echo.agent_run` (16:09:35 UTC today) spent `deepseek/deepseek-v4-flash`; the
runs before it were `google/gemini-3.1-pro-preview`. So the change is live and
the model reasons + calls tools + writes correct Persian. One throwaway test
conversation is in the owner's history (theirs to delete). Persian
SUMMARY-vs-summary between models was not run (see the bug); the assistant
answer is the acceptance evidence.

**BUG FOUND (pre-existing, latent, separate): `/v1/skills/dry-run` 400s
`bad_id` on the first live call.** `skill-dry-run.ts` builds the draft skill
with `id: ""` on purpose (nothing is a saved row) and hands it to the
runtime, which persists an `agent_run` whose skill id column is a uuid — the
empty string is 22P02 (invalid uuid), mapped to 400 `bad_id`. The runbook
already recorded dry-run as "NOT proven live," and the first live run is what
surfaces this. Not fixed here (out of the two asks); flagged as a task. The
fix is to write NULL (or a generated uuid) for a dry run's skill id rather
than `""`, and verify red against the empty string first.

**Tools:** user said "for now keep the agent tool," so the 2026-09-18
tool-structure proposal (docs/AGENT-TOOLS-STRUCTURE.md) stays a proposal;
nothing changed. **Organizational brain:** the "different approaches"
directive is answered in docs/ORGANIZATIONAL-BRAIN-APPROACHES.md — five
approaches (connector mirror / ingestion lake / provenance-first derived
graph / federated MCP / on-prem sidecar), the two hard sub-problems (entity
resolution, write-back), and a phased path with C as the recommended spine.
A discussion doc; nothing built, ARCHITECTURE.md untouched.

## 7ab. The entity spine (db/0230) and the DeepSeek speed fix — 2026-09-18, later

User: "start building the entity spine for the organizational brain, ALSO
deep seek speed is too low, what is the problem can you fix it as well."

### The speed: it is WHICH PROVIDER OpenRouter routes to, not the model

Measured ON THE SERVER, where production calls the provider (key read from
`/etc/neurai/core.env`, never printed), 3 reps each, the same Persian prompt,
`reasoning: { effort: "medium" }` — which is what pi-ai's `reasoningFor()`
sends:

| model id sent | routed to | tok/s |
|---|---|---|
| `deepseek/deepseek-v4-flash` (the alias we had set) | OpenInference / StreamLake | **27** |
| `deepseek/deepseek-v4-flash-0731` (the dated GA build) | Baidu / CoreWeave | **58** |
| `deepseek/deepseek-v4-flash:nitro` | Alibaba | **69** |

Same weights, same prompt, same effort — 2.2× between the first two rows.
OpenRouter's default route optimises for PRICE, and the alias's cheapest
serving provider is its slowest. **A model id is not a performance decision
and a routing alias is: an alias hands the choice of machine to whoever is
cheapest this week, which is why the same model got slower without anything
in this repo changing.**

Two things ruled OUT by the same measurement rather than by argument:

- **Reasoning is not the cost.** With `reasoning` OFF the SAME build was
  *worse* — 14422 ms, 15 tok/s — because DeepSeek V4 thinks anyway and the
  parameter only stops us being billed for the trace we then do not get.
  The repo's existing `reasoning: "medium"` is right and stays.
- **`:nitro` is not the fix**, although it is the fastest row. This repo
  deliberately treats a routing suffix as NOT A MODEL — `NOT_A_MODEL`
  excludes `/:[a-z]+$/` and `baseModelId()` strips only `:online` — so a
  `:nitro` id stored in `allowed_models` or `preferred_model` would be a
  string the product's own model wall does not recognise as a model. The
  wall is worth more than 11 tok/s.

**Fix applied: the default is the dated GA id `deepseek/deepseek-v4-flash-0731`.**
A real model id, no suffix, 2.2× the throughput, pure config — written
through the product's own routes (`PATCH /api/admin/org` for
`allowed_models[0]`, `PUT /api/models` for the owner's `preferred_model`), so
the writes are the ones an admin makes and are audited. Read back:
`selected: true`, `tools: true`.

**Live on production after the change:** first text **989 ms**; a full
Persian turn that called tools **13990 ms** end to end, the answer accurate
and idiomatic.

**Left for the user, not changed:** on 0731, `effort: "medium"` is 8189 ms
against `"low"` at 3606 ms on the same prompt. That is a quality/latency
trade this repo made deliberately and it is theirs to move, not a defect.

### The spine: db/0230 `echo.entity` + `echo.entity_alias`

The one thing every approach in docs/ORGANIZATIONAL-BRAIN-APPROACHES.md needs
first. One node per real-world thing; one row per identifier that names it.

**Why a spine and not another column.** The product already carries the pain:
`person.app_user_id` links a directory person to an account and was NULL on
nine of this organisation's rows, because the only writer is an admin
pressing a control and the server's guess (`fa_fold(name) = fa_fold(name)`)
cannot cross a transliteration — the directory says «سینا سپاسی» and the
account says "Sina Sepasi". One nullable column per pair of things does not
reach a CRM id, a Slack handle and a mailbox; each new pair would be another
column and another migration.

**Names are NOT aliases, and that is the load-bearing decision.** Two
colleagues here are both «سینا», so a unique key over names would refuse the
second — and a system that treats a name as an identifier is the one that
silently attaches a colleague's identity to somebody else's voice (the
2026-09-16 finding that took exactly that out of the voice picker). Names
live on the node with fold indexes; matching by name returns CANDIDATES.
`confidence` + `evidence` carry provenance, so an inferred link is a thing to
ASK about rather than act on.

**Shape.** `(id, org_id)` unique on the node, so every child FK is composite
and a cross-org alias is refused BY STRUCTURE rather than by a policy that
only refuses the people it runs as (D9). `merged_into` is `on delete set null
(merged_into)` — the column named, because a bare set-null over a composite
key containing a NOT NULL `org_id` can only ever RAISE (0188). Unique
`(org_id, source, kind, value)` is what makes resolution a lookup.

**Backfill seeds only what is already asserted:** every account, every
directory person, every project becomes a node, and a directory person an
admin HAS linked lands on its account's node. The cross-transliteration guess
stays a QUERY — the fold indexes make it cheap — and is deliberately not
written as a link.

**Found by its own self-check, first run.** The DELETE assertion counted 2
grants nothing had made: `information_schema.role_table_grants` also reports
the table OWNER's implicit privileges, so it was measuring who owns the table
rather than who may delete from it. Rule 11's catalogue trap, and it refused
a correct migration. Scoped to `grantee like 'echo\_%'` — what db/test/50
means by the closed allow-list — in both the migration and the test; the
migration rolled back cleanly and re-applied.

**Verified on production:** 0230 applied, then the db suite fixture-scoped
(`node scripts/db.mjs test` — no `--fresh`, and `reset()` refuses a remote
target without `ECHO_ALLOW_REMOTE_RESET=1`): "the wall holds", including the
three standing derived checks a new org-scoped table must satisfy — **102**
purge coverage (both tables enumerated, aliases before entities), **109** the
set-null class, **50** the closed DELETE allow-list and RLS forced — plus
**133** (17 checks): one identifier names one thing, two entities may share a
name and the fold finds BOTH, a cross-org alias and a cross-org merge refused
by structure, a real in-org merge, another organisation sees nothing, a
PENDING member writes nothing (04 is dan — without that line every "a member
may write" assertion would be measuring `actor_is_active()`), the agent reads
and cannot write, no product role holds DELETE.

**Backfill state on the live organisation** (read-only, owner altitude):

| | |
|---|---|
| entities | 47 (46 person, 1 project) |
| aliases | 121 — 37 app_user, 37 email, 29 person, 17 handle, 1 project |
| accounts / directory people | 37 / 29 |
| directory people already sharing a node with their account | 20 |

The nine unlinked directory people show up as fold candidates («شهلا حسینی»,
«پاسارگاد — خانم مرادی», …) — queryable, deliberately unwritten. Those are
two nodes for what is probably one person, which is the state the resolver
exists to offer and NOT to decide.

**NOT YET BUILT, named rather than implied (rule 13½ — a producer with no
consumer is a defect):** nothing READS the spine. The next slice is the
core-side resolver (lookup by identifier, candidates by folded name, a
confirm door that writes an asserted alias) and the first surface to use
it — the directory's own person-to-account link, which is the gap this
exists to close.

## 8. What never goes in this file (or any log)

Connection strings, DB passwords, API keys, service keys, JWT secrets, the
contents of `/etc/neurai/*.env`, or any customer content. When a command might
surface a URL in an error, pipe through
`sed -E 's#postgres(ql)?://[^ ]+#[redacted]#g'`.
