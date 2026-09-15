/**
 * WHERE THE NeurAI INTERPRETER IS — a property of the MACHINE, so there is no
 * default (review F4).
 *
 * Seven scripts used to carry this line:
 *
 *   process.env.NEURAI_PYTHON ??
 *     'C:\\Users\\<someone>\\Desktop\\neurai-mvp\\server\\.venv\\Scripts\\python.exe'
 *
 * — a dead path on every machine except one, plus a stranger's username in the
 * repository. It is overridable, so nothing was *broken*; the default simply
 * guaranteed failure everywhere else, and the resulting `no NeurAI python at …`
 * reads as a missing install rather than as a hardcoded guess.
 *
 * ── TWO SHAPES THAT LOOK LIKE FIXES AND ARE NOT ────────────────────────────
 *
 * **Rebuilding from `$USERPROFILE`** removes the NAME and keeps the
 * ASSUMPTION — that a NeurAI venv sits at `~/Desktop/neurai-mvp/server/.venv`.
 * The script still fails on a machine with no such folder, and the error now
 * names *the reader's own directory*, which is harder to diagnose, not easier:
 * it sends someone hunting for a folder nobody ever told them to create.
 *
 * **A `?? '.'` rung on the end** makes the interpreter path relative to the
 * working directory. That trades a clean, reproducible failure for one that
 * resolves differently depending on where the script was invoked from — in a
 * repo whose own notes record that two shells share one cwd.
 *
 * Both were tried in an earlier round, at all seven sites. Neither is here.
 *
 * ── THE TWO KINDS OF NOTHING ───────────────────────────────────────────────
 *
 * They are different states with different remedies, so they get different
 * sentences:
 *
 *   NEURAI_PYTHON not set     → nobody has said where the interpreter is
 *   NEURAI_PYTHON set, absent → they did, and the path is wrong
 *
 * The first sends the reader to their own shell profile; the second sends them
 * to look at a path. One message would send half of them to the wrong place.
 *
 * ── WHY THIS FILE EXISTS TWICE ─────────────────────────────────────────────
 *
 * `db/` and `core/` are separate workspace packages and `db/` exports nothing,
 * so crossing the boundary means either a package export existing for four dev
 * scripts or a relative path climbing out of one package into another, which
 * typechecks under neither tsconfig root. There is a twin at
 * `db/scripts/lib/neurai-python.mjs`.
 *
 * Two copies of a rule is normally the drift shape this repo forbids. It is
 * tolerable only because this rule has no configuration to disagree about: one
 * variable name, no default, two ways of being missing. **A third copy is the
 * signal to publish it properly rather than write it again.**
 */
import { existsSync } from "node:fs";

const VAR = "NEURAI_PYTHON";

const NOT_SET =
  `${VAR} is not set. Set it to the python.exe of the NeurAI server venv on THIS machine, e.g.\n` +
  `  $env:${VAR} = "C:\\path\\to\\neurai-mvp\\server\\.venv\\Scripts\\python.exe"\n` +
  "There is no default: that path is a property of the machine, not of this repository.";

const WRONG = (path: string): string =>
  `${VAR} points at ${path}, which does not exist.\n` +
  "The variable is set, so this is a wrong path rather than a missing one — check it against the venv on this machine.";

/**
 * Report where the interpreter is, WITHOUT throwing.
 *
 * For callers that can degrade: `db.mjs` and `seed-dev.mjs` both have
 * `ECHO_ENV_FILE` / `DATABASE_URL` sinks and need no interpreter at all when
 * one of those is set, so a missing venv is not their failure to announce.
 *
 */
export function findNeuraiPython(): { path: string | null; reason: string | null } {
  const set = process.env[VAR];
  if (!set) return { path: null, reason: NOT_SET };
  if (!existsSync(set)) return { path: null, reason: WRONG(set) };
  return { path: set, reason: null };
}

/**
 * Demand the interpreter, and throw the matching sentence if it is not there.
 *
 * For callers with no second sink — `grant-login.mjs` mints credentials and
 * has nowhere else to read them from, and the four live harnesses in `core/`
 * are the same.
 *
 */
export function requireNeuraiPython(): string {
  const { path, reason } = findNeuraiPython();
  if (!path) throw new Error(reason ?? NOT_SET);
  return path;
}
