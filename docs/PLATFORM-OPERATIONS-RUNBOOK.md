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

## 8. What never goes in this file (or any log)

Connection strings, DB passwords, API keys, service keys, JWT secrets, the
contents of `/etc/neurai/*.env`, or any customer content. When a command might
surface a URL in an error, pipe through
`sed -E 's#postgres(ql)?://[^ ]+#[redacted]#g'`.
