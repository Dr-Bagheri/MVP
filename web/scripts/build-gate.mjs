/**
 * The production-build gate.
 *
 *   node scripts/build-gate.mjs
 *
 * **Why this exists.** `next build` failed on the hub for an unknown length of
 * time while every instrument we had said the app was fine: the suite was
 * green, `tsc --noEmit` was clean on the offending file, and the dev server
 * rendered the page perfectly. The failure — `useSearchParams()` without a
 * Suspense boundary — only exists in a production build, and nothing in web/
 * ever ran one.
 *
 * That is the same class core/ answered with `test/api-boot.test.ts`: a green
 * suite is not evidence the process starts. This is web/'s equivalent, and the
 * property it enforces is one sentence — **a change that breaks the production
 * build cannot stay green.**
 *
 * **It builds into its own directory.** `next dev` and `next build` both write
 * `.next`, and this repo runs one shared dev server across several sessions;
 * pointing the gate at the same directory corrupts the running app. Both
 * failure modes were observed together — a wedged build and 500s on every
 * route — before the gate was given `NEXT_BUILD_DIR`.
 *
 * Output is forwarded rather than captured: when this fails, the Next error is
 * the whole point, and a wrapper that swallowed it would send the reader to run
 * the build by hand anyway.
 *
 * **`next build` rewrites `tsconfig.json`** — it appends its own types glob for
 * whatever `distDir` is in play. `.next-gate/types/**\/*.ts` is therefore
 * committed to `include` deliberately: with the entry already present Next has
 * nothing to add, so running this gate is idempotent instead of leaving a diff
 * in a shared file every time anyone runs it.
 *
 * **It typechecks too**, which is not redundant with `tsc --noEmit`: this one
 * runs against the production compilation, and it is the step that fails on a
 * file another session has deliberately broken for a verify-red. A gate failure
 * naming someone else's file is usually that, not a defect.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
/*
 * NEXT'S OWN SCRIPT, RUN BY THIS NODE — not the `.bin` shim through a shell
 * (2026-09-08).
 *
 * The shim needs `shell: true` on Windows to be executable at all, and a
 * shelled command is a STRING: a checkout under a directory whose name
 * contains a space broke at that space, and cmd reported everything
 * before it as "is not recognized" — under the gate's own
 * "the production build does not complete", a harness failure wearing a
 * build failure's words, which is the shape that sends somebody to debug
 * their app. Spawning the resolved .js with `process.execPath` needs no
 * shell, so there is no string for a space to split, and the platform fork
 * for `next.CMD` disappears with it.
 */
const next = join(webRoot, "node_modules", "next", "dist", "bin", "next");

const result = spawnSync(process.execPath, [next, "build"], {
  cwd: webRoot,
  stdio: "inherit",
  /* read by next.config.mjs's `distDir` — this repo's own variable, not
     Next's, so the name has to match the config exactly */
  env: { ...process.env, NEXT_BUILD_DIR: ".next-gate" },
});

if (result.status !== 0) {
  console.error(
    "\nBUILD GATE FAILED — the production build does not complete.\n" +
      "The suite and the typechecker cannot see this class of failure; that is why this gate exists.\n",
  );
  process.exit(1);
}
console.log("\nBUILD GATE PASSED — production build completes.\n");
