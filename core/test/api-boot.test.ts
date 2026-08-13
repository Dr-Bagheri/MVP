/**
 * Does the api process actually START under the production runtime?
 *
 * This exists because the answer was "no" three times in one day, and the
 * suite was green every time:
 *
 *   1. `src/api/main.ts` did not exist at all, while package.json's `api`
 *      script pointed at it. 219 tests passed; there was no process.
 *   2. `import.meta.url === \`file://${process.argv[1]}\`` is silently false
 *      on Windows, so `main()` never ran and the process exited 0 in silence.
 *   3. A TypeScript parameter property (`constructor(readonly kind: T)`) in
 *      errors.ts — `node --experimental-strip-types` erases types and
 *      performs NO transforms, so that is a load-time syntax error. tsc
 *      accepted it and vitest transpiled it happily.
 *
 * Every one of those is invisible to a suite that imports `buildServer`
 * directly, which is what all the other tests do — correctly, since that's
 * where the behaviour lives. The gap is the entrypoint itself. The steward
 * made "starts under the production runtime AND answers one request" a
 * milestone bar; (3) happened minutes after that ruling, which is the
 * argument for it being a test rather than a habit.
 *
 * Deliberately NOT mocked, and deliberately spawns a real node: a fake
 * runtime cannot reproduce a runtime's parser.
 */
import { createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entrypoint = path.join(packageRoot, "src", "api", "main.ts");

/** A port nothing else in this repo uses, so a stray server can't fake a pass. */
const PORT = 8137;
const BOOT_SECRET = "boot-smoke";

/** A structurally valid token, so the request fails in the DATA layer. */
function boomToken(): string {
  const b64 = (v: object) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({ sub: "11111111-1111-4111-8111-111111111111", exp: Math.floor(Date.now() / 1000) + 600 });
  const sig = createHmac("sha256", Buffer.from(BOOT_SECRET, "utf8"))
    .update(`${head}.${body}`).digest().toString("base64url");
  return `${head}.${body}.${sig}`;
}

interface BootResult {
  health: unknown;
  unauthorized: number;
  /** Everything the process wrote to stdout — where pino sends its lines. */
  stdout: string;
  stderr: string;
  exited: number | null;
}

async function bootAndProbe(): Promise<BootResult> {
  const child = spawn(process.execPath, ["--experimental-strip-types", entrypoint], {
    cwd: packageRoot,
    env: {
      ...process.env,
      // postgres.js connects lazily, so an unreachable database is fine here:
      // this asks whether the process STARTS and SERVES, not whether it can
      // read. Both required — booting and then 500ing on every route would
      // pass a "does it start" check and fail the user.
      DATABASE_URL_APP: "postgresql://u:p@127.0.0.1:1/db",
      DATABASE_URL_AGENT: "postgresql://u:p@127.0.0.1:1/db",
      SUPABASE_JWT_SECRET: BOOT_SECRET,
      PORT: String(PORT),
      HOST: "127.0.0.1",
      // NOT "silent": this test now asserts that a 500 is logged, and a
      // silenced process would pass by producing nothing — the exact failure
      // it exists to catch.
      LOG_LEVEL: "info",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  let stdout = "";
  let exited: number | null = null;
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
  child.on("exit", (code) => { exited = code; });

  try {
    // Poll rather than sleep a fixed time: a slow machine shouldn't fail this
    // and a fast one shouldn't wait.
    const deadline = Date.now() + 20_000;
    for (;;) {
      if (exited !== null) {
        // Exited before serving. This is the (2) and (3) shape — and note
        // that (2) exits ZERO, so a nonzero-exit check alone would miss it.
        return { health: null, unauthorized: 0, stdout, stderr, exited };
      }
      try {
        const response = await fetch(`http://127.0.0.1:${PORT}/health`);
        const health: unknown = await response.json();
        const walled = await fetch(`http://127.0.0.1:${PORT}/v1/calls`);
        /**
         * Provoke a 500 and watch for the log line (steward, rule 13).
         *
         * `buildServer` defaults `logger: false` — right for tests, wrong for
         * the process — and main.ts did not turn it on, so
         * `request.log.error({err, pg}, "internal error")` went nowhere:
         * **every 500 in production was silent.** Built, ratified, tested,
         * and not switched on. This asserts the configuration rather than the
         * code, because the code was never the part that was wrong.
         *
         * A valid token with an unreachable database gets past auth's shape
         * checks and fails in the data layer — a real internal error, which
         * is exactly the class that must never be silent.
         */
        const faulty = await fetch(`http://127.0.0.1:${PORT}/v1/calls`, {
          headers: { authorization: `Bearer ${boomToken()}` },
        }).catch(() => null);
        // give pino a moment to flush the line
        await new Promise((resolve) => setTimeout(resolve, 400));
        return {
          health, unauthorized: walled.status, stdout, stderr, exited: null,
          faultStatus: faulty?.status ?? 0,
        } as BootResult & { faultStatus: number };
      } catch {
        if (Date.now() > deadline) return { health: null, unauthorized: 0, stdout, stderr, exited };
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    }
  } finally {
    child.kill();
  }
}

describe("the api process boots under the production runtime", () => {
  /**
   * ONE boot, both assertions.
   *
   * Each `it` used to spawn its own process. That doubled the real processes
   * this file starts, and the worker package's boot test — which also spawns
   * a real process with a fixed startup window — failed once in a full run
   * and passed in isolation and on two reruns. Classic contention, and the
   * load was mine to remove rather than theirs to absorb.
   *
   * The two assertions stay separate `it`s: they answer different questions
   * (does it serve / does it log a fault), and collapsing them would report
   * one failure for two unrelated regressions.
   */
  let booted: (BootResult & { faultStatus: number }) | undefined;
  beforeAll(async () => {
    booted = await bootAndProbe() as BootResult & { faultStatus: number };
  }, 40_000);

  it("starts, serves /health, and walls an unauthenticated request", () => {
    const result = booted!;

    // Positive assertions: the process is serving, not merely "not crashed".
    expect(result.stderr).not.toContain("ERR_INVALID_TYPESCRIPT_SYNTAX");
    expect(result.exited, `process exited (${result.exited}); stderr:\n${result.stderr}`).toBeNull();
    expect(result.health).toEqual({ ok: true });
    // and it is the real server, not something else on the port
    expect(result.unauthorized).toBe(401);
  });

  it("LOGS a 500 rather than failing silently", () => {
    // The configuration assertion (steward, rule 13). The error handler and
    // its structured-field convention were built, ratified and tested — and
    // `logger` was left off in the process, so every 500 in production
    // emitted nothing at all. Code was never the part that was wrong, so the
    // test asserts the running configuration.
    const result = booted!;

    expect(result.exited, `process exited; stderr:
${result.stderr}`).toBeNull();
    // a valid token against an unreachable database is a real internal error
    expect(result.faultStatus).toBe(500);
    // …and it must be visible
    expect(result.stdout, "a 500 produced no log line — logger is off").toContain("internal error");
    /**
     * Structured fields, not a quoted message. The real line is:
     *   {"level":50,…,"err":"Error","pg":{"code":"ECONNREFUSED"},"msg":"internal error"}
     *
     * `err` is the error's CLASS name and `pg` its schema identifiers —
     * neither can contain a row value, which for this product can be
     * transcript content. My first version of this assertion required
     * `[A-Za-z]+Error` and failed on the plain `"Error"` a connection refusal
     * actually produces: the regex was stricter than the contract, which is
     * a test asserting a detail nobody promised.
     */
    expect(result.stdout).toMatch(/"err":"\w*Error"/);
    expect(result.stdout).toMatch(/"pg":\{"code":"[A-Z0-9]+"/);
    // and NOT the message text, which is where a row value would ride
    expect(result.stdout).not.toContain("connect ECONNREFUSED 127.0.0.1:1");
  });
});
