/**
 * The api process (M1: one codebase, two processes).
 *
 * Thin by design — read config, build pools, build the server, listen. Every
 * decision worth making is made below this file.
 *
 * Runs under `node --experimental-strip-types`, which performs no transforms:
 * TypeScript that isn't erasable (parameter properties, enums, namespaces) is
 * a LOAD-TIME syntax error here while vitest transpiles it happily. That is
 * why this process is booted under the real runtime once per milestone, not
 * just exercised through tests — a suite that never starts the process cannot
 * see the class of failure that stops it from starting. (CLAUDE.md rule 9;
 * the worker package hit exactly this with 39 green tests.)
 */
import { pathToFileURL } from "node:url";

import pino from "pino";
import postgres from "postgres";

import { buildServer } from "./server.ts";
import { createDb, type SqlClient } from "../db/identity.ts";

const log = pino({
  level: process.env.LOG_LEVEL || "info",
  base: { svc: "api" },
  // Content never reaches a log (invariant 7). Connection strings and signed
  // URLs are credentials; `detail` is where Postgres quotes the offending
  // row, which for us can be transcript text.
  redact: {
    paths: ["url", "text", "words", "authorization", "token", "detail", "err.detail"],
    censor: "[redacted]",
  },
});

/**
 * Percent-encode the password before the URL is parsed — same fix, and same
 * reason, as worker/main.ts. Duplicated rather than imported because
 * importing from that module to get one function would drag the worker's
 * pino instance and its dependency graph into the api process.
 */
export function normalizeDbUrl(raw: string): string {
  const match = /^(\w+:\/\/)([^@]*)@(.*)$/s.exec(raw);
  if (!match) return raw;
  const [, scheme, credentials, rest] = match as unknown as [string, string, string, string];
  const split = credentials.lastIndexOf(":");
  if (split < 0) return raw;
  const user = credentials.slice(0, split);
  const password = credentials.slice(split + 1);
  if (password === "" || password !== decodeURIComponent(password)) return raw; // already encoded
  return `${scheme}${user}:${encodeURIComponent(password)}@${rest}`;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`api: ${name} is required`);
  return value;
}

/**
 * Where the project publishes its signing keys.
 *
 * Explicit `SUPABASE_JWKS_URL` wins; otherwise it is derived from
 * `SUPABASE_URL`, because the path is fixed by Supabase and a hand-copied URL
 * is one more thing to typo in a deployment. Returns undefined when neither
 * is set, which leaves the api on the shared-secret path — correct for a
 * project still using legacy signing.
 */
function jwksUrl(): string | undefined {
  const explicit = process.env.SUPABASE_JWKS_URL;
  if (explicit) return explicit;
  const base = process.env.SUPABASE_URL;
  if (!base) return undefined;
  return `${base.replace(/\/+$/, "")}/auth/v1/.well-known/jwks.json`;
}

/**
 * Refuse to boot with NEITHER verification path configured.
 *
 * `SUPABASE_JWT_SECRET` used to be `requireEnv`, which is what kept this
 * honest. Making it optional for ES256 projects removed that guard, so the
 * check moves here rather than disappearing — an api that starts cleanly and
 * rejects every token is the failure this whole change exists to end, and it
 * would be a bitter way to reintroduce it.
 */
function assertVerificationConfigured(): void {
  if (!process.env.SUPABASE_JWT_SECRET && !jwksUrl()) {
    throw new Error(
      "api: no token verification configured — set SUPABASE_JWKS_URL or SUPABASE_URL "
      + "(asymmetric signing keys), or SUPABASE_JWT_SECRET (legacy shared secret)");
  }
}

export async function main(): Promise<void> {
  assertVerificationConfigured();
  const port = Number(process.env.PORT || 8080);
  if (!Number.isFinite(port)) throw new Error("api: PORT must be a number");

  const appUrl = normalizeDbUrl(requireEnv("DATABASE_URL_APP"));
  // No fallback to the app URL. The worker has one and it is a live hazard:
  // a missing variable there silently turns the agent pool into echo_app and
  // every agent-role limit evaporates with nothing visibly breaking. Backend
  // 3 confirmed the roles hold no membership in each other, so `set local
  // role` in db/identity.ts would now fail loudly (42501) — but the honest
  // fix is to refuse to start, not to fail per request.
  const agentUrl = normalizeDbUrl(requireEnv("DATABASE_URL_AGENT"));

  const pools = {
    app: postgres(appUrl, { max: 10 }) as unknown as SqlClient,
    agent: postgres(agentUrl, { max: 4 }) as unknown as SqlClient,
  };

  const app = buildServer({
    db: createDb(pools),
    /**
     * BOTH signing paths, and the secret is no longer required.
     *
     * A project on asymmetric signing keys has no shared secret at all, so
     * `requireEnv("SUPABASE_JWT_SECRET")` would refuse to boot the very
     * configuration that is now correct. It stays supported because a project
     * on legacy signing still uses it and the test suite mints those.
     *
     * `SUPABASE_JWKS_URL` is derived from `SUPABASE_URL` when not given
     * explicitly — one fewer thing to get subtly wrong in a deployment, and
     * the derived form is the one Supabase documents.
     */
    jwtSecret: process.env.SUPABASE_JWT_SECRET,
    jwksUrl: jwksUrl(),
    issuer: process.env.SUPABASE_JWT_ISSUER,
    /*
     * The upload surface (Part 5). Absent config = uploads answer with a
     * NAMED refusal, never a stub — the env already carries both on the
     * server (they are the purge job's pair, reused, same M10 posture).
     */
    storageUrl: process.env.SUPABASE_URL,
    storageServiceKey: process.env.SUPABASE_SERVICE_KEY,
    // M39 voice enrollment — same box as the worker's default; empty string
    // deliberately disables (an explicit "no ml here" for split deployments)
    mlBaseUrl: process.env.ML_BASE_URL === "" ? undefined : (process.env.ML_BASE_URL ?? "http://127.0.0.1:7801"),
    /**
     * M32's one-time root claim. This is an email selector, not a password or
     * a browser-visible token; the matching person still authenticates through
     * the normal email/password or OAuth flow.
     */
    platformBootstrapEmail: process.env.PLATFORM_ROOT_BOOTSTRAP_EMAIL,
    /**
     * `tools` and `toolDeps` are OMITTED so the server builds the shipped set
     * — the four read tools and the three write tools.
     *
     * This said `tools: []` and it was written before the default existed.
     * When I made `[]` mean "deliberately none" (so an explicit empty array
     * would stop being overridden), this line silently became a real
     * instruction: the live api offered the model **zero tools**. Every unit
     * test passes `tools: []` on purpose, so none of them could notice that
     * the entrypoint did too.
     *
     * Found by asking the audit trail — `request->>'tools'` on the failed run
     * read `[]`, which answered in one query what three model probes had not.
     * A fix for absent-vs-empty that created an absent-vs-empty bug one file
     * away, and the tests that would normally catch a regression were the
     * exact shape of the regression.
     */
    toolDeps: {},
    openrouterKey: process.env.OPENROUTER_API_KEY,
    /*
     * M30 first-party work connectors. These are deliberately optional at
     * boot: an unset OAuth app leaves Google/Microsoft visibly "not
     * configured" rather than taking the entire assistant offline. Values
     * use the Echo-platform secret namespace; no provider credential is ever
     * read from a generic supabase_/echo_supabase_ DPAPI name.
     */
    connectorOAuth: {
      publicWebUrl: process.env.echo_platform_web_url,
      encryptionKey: process.env.echo_platform_connector_encryption_key,
      providers: {
        google: {
          clientId: process.env.echo_platform_google_oauth_client_id,
          clientSecret: process.env.echo_platform_google_oauth_client_secret,
        },
        microsoft: {
          clientId: process.env.echo_platform_microsoft_oauth_client_id,
          clientSecret: process.env.echo_platform_microsoft_oauth_client_secret,
        },
      },
    },
    /**
     * ON, and it was off.
     *
     * `buildServer` defaults `logger` to false — right for tests, wrong for
     * the process. The error handler's whole point is
     * `request.log.error({err, pg}, "internal error")`, the structured
     * convention the steward ratified so a database failure is diagnosable
     * without putting a row value in a log. With the logger disabled that
     * call went nowhere: **every 500 in production was silent.**
     *
     * Found because a confirm returned `{"error":"internal error"}` and there
     * was nothing whatsoever to read. The log was built, ratified, tested —
     * and not turned on, which no test could see, because tests construct the
     * server themselves and want it quiet.
     */
    logger: true,
  });

  const shutdown = async (signal: string): Promise<void> => {
    log.info({ signal }, "shutting down");
    await app.close();
    await Promise.all([pools.app.end(), pools.agent.end()]);
    process.exit(0);
  };
  process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
  process.on("SIGINT", () => { void shutdown("SIGINT"); });

  await app.listen({ port, host: process.env.HOST || "0.0.0.0" });
  log.info({ port }, "api listening");
}

/**
 * `pathToFileURL`, not a template string.
 *
 * `file://${process.argv[1]}` is the common idiom and it is wrong on Windows:
 * argv[1] is `C:\path\main.ts` while import.meta.url is
 * `file:///C:/path/main.ts` — drive letter, forward slashes, three slashes.
 * The comparison is silently false, main() never runs, and the process exits
 * 0 with no output. It looks like a clean start and serves nothing. Found by
 * booting it; no test could have, since tests import buildServer directly.
 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    // Message only, never the error object: a postgres connection failure
    // carries the connection string, password included.
    log.error({ err: (error as Error).message }, "api failed to start");
    process.exit(1);
  });
}
