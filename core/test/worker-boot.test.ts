/**
 * Does the worker actually BOOT — under the runtime that runs it in production?
 *
 * Every other test in this package imports modules into vitest, which
 * transpiles TypeScript fully. `npm run worker` uses
 * `node --experimental-strip-types`, which only ERASES types and performs no
 * transforms. The gap between those two has now cost this repo twice:
 *
 *   1. a TypeScript parameter property (`constructor(readonly x: string)`) —
 *      a transform, so strip-only refuses the file and the process dies at
 *      load with every test still green;
 *   2. `import.meta.url === \`file://${process.argv[1]}\`` — silently false on
 *      Windows, so `main()` never runs and the process **exits zero, in
 *      silence**, which reads as a clean start that consumed nothing.
 *
 * Backend 1 hit (1) again within an hour of it being written down, in api/.
 * A habit that has to be remembered at the moment of writing an error class is
 * not a guard; this is.
 *
 * Three deliberate choices, learned from theirs:
 *
 *   - assert `exited === null`, NOT a nonzero exit code. Bug (2) exits ZERO,
 *     so an exit-code check would have missed the one that is hardest to see.
 *   - assert the worker SURVIVES A POLL, not merely that it printed a line.
 *     A process that starts and then dies on its first database error would
 *     pass "did it boot" and fail the user.
 *   - the database URL points nowhere ON PURPOSE. The worker is designed to
 *     back off and keep running when the database is unreachable, because the
 *     work is still in the queue and will be there when it returns — so this
 *     also exercises the resilience path, which nothing else does.
 */
import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, "..", "src", "worker", "main.ts");

interface BootResult {
  exited: number | null;
  output: string;
}

/**
 * Boot the real entrypoint the real way, wait for what we are asserting, then
 * stop it.
 *
 * Waits on the CONDITION, not on a stopwatch. A fixed sleep makes this test's
 * result depend on how many other processes the suite happens to be starting —
 * and it did: it lost the race once when the api's boot test grew a second
 * spawned process. Widening the sleep would only move the race somewhere
 * slower.
 *
 * A flaky boot test is worse than most flaky tests. This is the instrument for
 * the class of bug nothing else catches — a process that cannot start while
 * every unit test passes — and one unexplained red is all it takes for someone
 * to learn to re-run it instead of reading it.
 */
async function bootUntil(marker: RegExp, ceilingMs = 15_000): Promise<BootResult> {
  const child = spawn(process.execPath, ["--experimental-strip-types", entry], {
    env: {
      ...process.env,
      // Unreachable on purpose — see the header.
      DATABASE_URL_APP: "postgresql://echo_app:pw@127.0.0.1:1/echo",
      DATABASE_URL_AGENT: "postgresql://echo_agent:pw@127.0.0.1:1/echo",
      // The signer refuses to construct when unconfigured, which is its job;
      // give it a syntactically valid config so the boot reaches the loop.
      SUPABASE_URL: "https://placeholder.supabase.co",
      SUPABASE_SERVICE_KEY: "placeholder",
      WORKER_IDLE_POLL_MS: "200",
      LOG_LEVEL: "info",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  child.stdout.on("data", (d) => (output += String(d)));
  child.stderr.on("data", (d) => (output += String(d)));

  let exited: number | null = null;
  let hasExited = false;
  child.on("exit", (code) => {
    exited = code;
    hasExited = true;
  });

  // Poll for the marker OR an exit, whichever comes first. Fast when the
  // machine is idle, patient when it is not, and it stops the moment there is
  // an answer either way — including the silent-exit-zero case, which must not
  // wait out the ceiling to be detected.
  const deadline = Date.now() + ceilingMs;
  while (Date.now() < deadline && !hasExited && !marker.test(output)) {
    await new Promise((r) => setTimeout(r, 50));
  }

  const alive = !hasExited;
  child.kill();

  return { exited: alive ? null : exited, output };
}

describe("the worker boots under the production runtime", () => {
  it("starts, stays up, and keeps polling when the database is unreachable", async () => {
    const { exited, output } = await bootUntil(/poll failed; backing off/);

    // A parameter property anywhere in the import graph fails HERE, by name.
    expect(output).not.toMatch(/ERR_INVALID_TYPESCRIPT_SYNTAX/);
    expect(output).not.toMatch(/parameter property is not supported/);

    // The entrypoint guard: a silent no-op exits 0 with no output at all.
    expect(exited, `process exited (${exited}) — output:\n${output}`).toBeNull();
    expect(output).toMatch(/worker started/);

    // And it is doing its job rather than merely existing: the database is
    // unreachable, so it must report the failure and carry on, not die.
    expect(output).toMatch(/poll failed; backing off/);
  }, 30_000);

  it("refuses to start when required configuration is absent", async () => {
    // Failing loudly at startup beats dead-lettering every job for an hour
    // while looking like a pipeline bug.
    const child = spawn(process.execPath, ["--experimental-strip-types", entry], {
      env: { ...process.env, DATABASE_URL_APP: "", DATABASE_URL_AGENT: "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (d) => (output += String(d)));
    child.stderr.on("data", (d) => (output += String(d)));

    const code = await new Promise<number | null>((resolve) => {
      child.on("exit", resolve);
      setTimeout(() => {
        child.kill();
        resolve(null);
      }, 8000);
    });

    expect(code, `expected a nonzero exit, got ${code} — output:\n${output}`).not.toBe(0);
    expect(output).toMatch(/DATABASE_URL_APP|failed to start/);
  }, 30_000);
});
