/**
 * A BACKGROUND JOB OPENS A BACKGROUND JOB'S SESSION (db/0221).
 *
 * Four writers in `core/src/worker` open a conversation to hold text nobody
 * asked for — signal-step's post-call brief and weekly digest, meeting-prep,
 * mail-poll, and workflow-step's `notify`. Every one of them called
 * `sessions.resolveForAsk(identity, null, title)`, which is the ask route's
 * own call, and so every one of them put a row in somebody's conversation
 * sidebar. Four rehearsal meetings, four «خلاصهٔ آمادهٔ …» rows.
 *
 * Fixing the four is not the same as fixing the class. The fifth background
 * writer will be written by somebody reading the fourth, and the default is
 * `"user"` precisely so a caller who has a person in front of them need not
 * think about it — which means a caller who does NOT have a person in front of
 * them can forget, and nothing goes red. This is the check that goes red.
 *
 * The list is DERIVED from the directory rather than enumerated: this repo has
 * already had a queue-handler guard that named four worker files and could not
 * see the fifth, and the general form is rule 13½'s — a guard's coverage list
 * is itself a seam.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const WORKER = join(fileURLToPath(new URL("../src/worker/", import.meta.url)));

/**
 * Every `resolveForAsk(...)` call in a source, as its argument text.
 *
 * A regex over the whole call rather than a name-grep: this file's own subject
 * is a missing ARGUMENT, and `text.includes("resolveForAsk")` is satisfied by
 * the very call that omits it — the name matching itself, which this repo has
 * shipped twice (a column tripwire and a dialog-sections guard, both green
 * against the bug they were written for).
 */
export function resolveForAskCalls(source: string): string[] {
  return [...source.matchAll(/resolveForAsk\(([\s\S]*?)\);/g)].map((m) => m[1] ?? "");
}

/** A call that opens a NEW session — `null` where a session id would go. */
const opensNew = (args: string) => /,\s*null\s*,/.test(args);

describe("a background job's session is the background job's", () => {
  const sources = readdirSync(WORKER)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => ({ file: f, text: readFileSync(join(WORKER, f), "utf8") }));

  it("every worker that opens a conversation opens it as `agent`", () => {
    const offenders: string[] = [];
    let checked = 0;
    for (const { file, text } of sources) {
      for (const args of resolveForAskCalls(text)) {
        if (!opensNew(args)) continue;
        checked += 1;
        if (!/"agent"/.test(args)) offenders.push(`${file}: resolveForAsk(${args.trim()})`);
      }
    }
    /*
     * HAD SOMETHING TO CHECK. A guard that walks a tree and finds nothing
     * reports a perfect pass — the same shape as an empty error page scoring
     * clean inside an accessibility audit. If the workers ever stop opening
     * sessions this number goes to zero and the assertion below says so
     * instead of quietly certifying an empty corpus.
     */
    expect(checked).toBeGreaterThanOrEqual(4);
    expect(offenders).toEqual([]);
  });

  it("fires on a background writer that forgets — the control", () => {
    /*
     * The check must be able to FAIL for its own reason, and this is the exact
     * text every one of the four carried this morning. Without this case,
     * "offenders is empty" is equally true of a matcher that matches nothing.
     */
    const staged = `const c = await sessions.resolveForAsk(identity, null, title);`;
    const [args] = resolveForAskCalls(staged);
    expect(opensNew(args!)).toBe(true);
    expect(/"agent"/.test(args!)).toBe(false);
  });

  it("leaves a RESUMED conversation alone — the second control", () => {
    /*
     * `resolveForAsk(identity, id, "")` resolves an existing thread and writes
     * no row, so it has no origin to get wrong. A guard that demanded "agent"
     * of every call would report the regenerate route as an offender, and a
     * guard that manufactures false positives is muted within a week — which
     * this repo has already paid for once, in a checker written to catch the
     * name-matching-itself trap.
     */
    const staged = `await sessions.resolveForAsk(identity, id, "");`;
    expect(opensNew(resolveForAskCalls(staged)[0]!)).toBe(false);
  });
});
