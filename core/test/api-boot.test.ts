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
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entrypoint = path.join(packageRoot, "src", "api", "main.ts");

/** A port nothing else in this repo uses, so a stray server can't fake a pass. */
const PORT = 8137;

interface BootResult {
  health: unknown;
  unauthorized: number;
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
      SUPABASE_JWT_SECRET: "boot-smoke",
      PORT: String(PORT),
      HOST: "127.0.0.1",
      LOG_LEVEL: "silent",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  let exited: number | null = null;
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  child.on("exit", (code) => { exited = code; });

  try {
    // Poll rather than sleep a fixed time: a slow machine shouldn't fail this
    // and a fast one shouldn't wait.
    const deadline = Date.now() + 20_000;
    for (;;) {
      if (exited !== null) {
        // Exited before serving. This is the (2) and (3) shape — and note
        // that (2) exits ZERO, so a nonzero-exit check alone would miss it.
        return { health: null, unauthorized: 0, stderr, exited };
      }
      try {
        const response = await fetch(`http://127.0.0.1:${PORT}/health`);
        const health: unknown = await response.json();
        const walled = await fetch(`http://127.0.0.1:${PORT}/v1/calls`);
        return { health, unauthorized: walled.status, stderr, exited: null };
      } catch {
        if (Date.now() > deadline) return { health: null, unauthorized: 0, stderr, exited };
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    }
  } finally {
    child.kill();
  }
}

describe("the api process boots under the production runtime", () => {
  it("starts, serves /health, and walls an unauthenticated request", async () => {
    const result = await bootAndProbe();

    // Positive assertions: the process is serving, not merely "not crashed".
    expect(result.stderr).not.toContain("ERR_INVALID_TYPESCRIPT_SYNTAX");
    expect(result.exited, `process exited (${result.exited}); stderr:\n${result.stderr}`).toBeNull();
    expect(result.health).toEqual({ ok: true });
    // and it is the real server, not something else on the port
    expect(result.unauthorized).toBe(401);
  }, 30_000);
});
