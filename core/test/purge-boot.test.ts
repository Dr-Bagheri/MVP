/**
 * Does the purge process BOOT — under the runtime that runs it in production?
 *
 * Same instrument as `worker-boot.test.ts`, for the same reason: vitest
 * transpiles TypeScript fully, `node --experimental-strip-types` only erases
 * types, and that gap has already cost this repo a process that could not start
 * while every unit test passed. `echo_purge` is a boot path nobody had
 * exercised.
 *
 * The assertion that matters most here is a REFUSAL. The purge deletes rows and
 * storage objects, and the row is the only pointer to the object — so a purge
 * that runs without storage configuration would delete the map and leave the
 * recording, invisibly. That is the exact failure the objects-first ordering
 * exists to prevent, and it must be impossible to reach by misconfiguration
 * rather than merely unlikely.
 */
import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, "..", "src", "purge", "main.ts");

interface Run {
  code: number | null;
  output: string;
}

/** Run the real entrypoint to completion. It is one-shot, so this terminates. */
async function run(env: Record<string, string>, ceilingMs = 15_000): Promise<Run> {
  const child = spawn(process.execPath, ["--experimental-strip-types", entry], {
    env: { ...process.env, LOG_LEVEL: "info", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  child.stdout.on("data", (d) => (output += String(d)));
  child.stderr.on("data", (d) => (output += String(d)));

  const code = await new Promise<number | null>((resolve) => {
    const timer = setTimeout(() => {
      child.kill();
      resolve(null);
    }, ceilingMs);
    child.on("exit", (c) => {
      clearTimeout(timer);
      resolve(c);
    });
  });

  return { code, output };
}

describe("the purge process boots under the production runtime", () => {
  it("loads without a TypeScript syntax error", async () => {
    // A parameter property anywhere in the import graph fails HERE, by name —
    // strip-only mode performs no transforms. This has already happened twice
    // in this repo, once an hour after it was written down.
    const { output } = await run({
      DATABASE_URL_PURGE: "postgresql://echo_purge:pw@127.0.0.1:1/echo",
      SUPABASE_URL: "https://placeholder.supabase.co",
      SUPABASE_SERVICE_KEY: "placeholder",
    });

    expect(output).not.toMatch(/ERR_INVALID_TYPESCRIPT_SYNTAX/);
    expect(output).not.toMatch(/parameter property is not supported/);
  }, 30_000);

  it("REFUSES to run without storage configuration", async () => {
    // The safety property. Purging rows without the ability to delete objects
    // deletes the only pointer to the audio and leaves the audio — a recording
    // surviving a purge, invisibly, after the user was told it was gone.
    // Refusing must be structural, not a habit.
    const { code, output } = await run({
      DATABASE_URL_PURGE: "postgresql://echo_purge:pw@127.0.0.1:1/echo",
      SUPABASE_URL: "",
      SUPABASE_SERVICE_KEY: "",
    });

    expect(code, `expected a nonzero exit, got ${code} — output:\n${output}`).not.toBe(0);
    expect(output).toMatch(/SUPABASE_URL|failed to run/);
    // And it must say WHY, so an operator fixes the config rather than
    // wondering why nothing was purged.
    expect(output).toMatch(/alongside the rows|SUPABASE_URL is required/);
  }, 30_000);

  it("REFUSES to run without its own credential", async () => {
    // `echo_purge` is the only role holding DELETE. Falling back to any other
    // connection would be a purge running with more authority than the
    // architecture grants it.
    const { code, output } = await run({
      DATABASE_URL_PURGE: "",
      SUPABASE_URL: "https://placeholder.supabase.co",
      SUPABASE_SERVICE_KEY: "placeholder",
    });

    expect(code).not.toBe(0);
    expect(output).toMatch(/DATABASE_URL_PURGE|failed to run/);
  }, 30_000);

  it("exits nonzero when the database is unreachable, rather than reporting success", async () => {
    // A purge that cannot connect has purged nothing. Exiting 0 would tell a
    // scheduler the window was cleared when it was not, and the next run would
    // be the first anyone noticed.
    const { code } = await run({
      DATABASE_URL_PURGE: "postgresql://echo_purge:pw@127.0.0.1:1/echo",
      SUPABASE_URL: "https://placeholder.supabase.co",
      SUPABASE_SERVICE_KEY: "placeholder",
    });

    expect(code).not.toBe(0);
  }, 30_000);
});
