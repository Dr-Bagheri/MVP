import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * **A destructive control asks first, in the platform's ONE dialog.**
 *
 * The rule (user directive, 2026-08-28: "for all delete buttons in the
 * platform put the confirm pop up window like the delete button in the
 * records; make this a rule for delete buttons on platform and put it in the
 * theme"): anything that cannot be undone by pressing the same control again
 * goes through `ConfirmDialog` from `components/rowActions.tsx`. Not a second
 * dialog, not an inline two-press expander, and never `window.confirm`.
 *
 * The rule itself is documented where the component lives; this file is the
 * half that RUNS, because a rule in prose protects only whoever is currently
 * remembering it.
 *
 * ── What it checks, and the shape of each answer ────────────────────────────
 *
 *  1. **Every destructive client method is classified.** The candidate list is
 *     DERIVED from `api/client.ts` by scanning method names for the
 *     destructive vocabulary, so a `deleteFoo` added to the client tomorrow
 *     fails this file until somebody decides what it is. A hand-enumerated
 *     list would be a seam of its own — a guard's coverage list is exactly the
 *     thing that goes stale where the break comes from.
 *  2. **A file calling one renders the dialog.** File-scoped, with an
 *     allow-list of entries carrying REASONS, and an expiry check that every
 *     entry still names a real file (a stale entry reads as coverage and is a
 *     hole).
 *  3. **A press is never wired straight to the write.** `onClick={() =>
 *     api.deleteThing(…)}` is a violation wherever it appears, including in a
 *     file that renders the dialog for something else — which is the gap
 *     rule 2 cannot see, and where the note delete on the call detail screen
 *     was actually hiding.
 *
 * ── The false-positive discipline ───────────────────────────────────────────
 *
 * Comments are STRIPPED before scanning. Without that, `DeletedCallsCard.tsx`
 * — whose header explains why `api.deleteCall` is fixture-backed — gets
 * reported for a call it does not make. A checker that manufactures false
 * positives is muted inside a week and is then worse than absent.
 *
 * Verified red before it was trusted: staging
 * `onClick={() => void api.deleteCall(id, "x")}` in `DeletedCallsCard.tsx`
 * fired both rule 2 and rule 3 by name, and the synthetic control below keeps
 * the detector able to answer NO after the staging was removed.
 */

const SRC = join(process.cwd(), "src");
const CLIENT = join(SRC, "api", "client.ts");

/**
 * The vocabulary a destructive method name is written in. Deliberately does
 * NOT include "archive": two of the three archive methods are reversible
 * toggles whose own control flips back (a skill, a record), and pulling them
 * in would make this file cry wolf on the majority reading. The one that is
 * really a delete is named in ALSO_DESTRUCTIVE below, with its reason.
 */
const DESTRUCTIVE_WORD =
  /delete|remove|revoke|discard|disconnect|tombstone|purge|clear|destroy|drop|wipe|erase|forget|reject|unlink/i;

/**
 * Destructive methods whose NAME does not advertise it — each one a judgement
 * that had to be made by reading what the product calls the button.
 */
const ALSO_DESTRUCTIVE: Readonly<Record<string, string>> = {
  archiveSession:
    "the conversation table's button says «حذف» and an archived conversation never returns to any list — archive is the transport, delete is the act",
};

/**
 * Candidates the name-scan raises that are NOT destructive. Empty today, and
 * kept because the completeness assertion needs somewhere to put the answer:
 * the next `clearSomething` that turns out to be a cache refresh belongs here
 * with its sentence, not quietly outside the vocabulary.
 */
const NOT_DESTRUCTIVE: Readonly<Record<string, string>> = {};

/**
 * Destructive helpers that are not client methods — a local store still holds
 * something a person made, and losing it is the same event to them.
 */
const LOCAL_DESTRUCTIVE: Readonly<Record<string, string>> = {
  deleteCustomTemplate: "lib/summaryTemplates.ts",
};

/**
 * Files allowed to hold a destructive call with no dialog of their own. Each
 * is a place where the asking demonstrably happens SOMEWHERE ELSE — never
 * "this one is fine".
 */
const ALLOWED: Readonly<Record<string, string>> = {
  "lib/agentSurface.ts":
    "the assistant's client tools: every write-effect call is gated by the in-thread consent card before the runtime is allowed to invoke it (PresenceDock's askConsent), and a modal on top of a card the person already answered would be the same question twice",
  "lib/recordingEngine.ts":
    "the stop-and-delete path, reachable only from the Recorder's own ConfirmDialog — the engine performs a decision the dialog has already taken",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Comments out, code in.
 *
 * Block comments go whole. Line comments go from `//` to the end of the line
 * UNLESS the slashes follow a colon, which is a URL scheme rather than a
 * comment. Erring toward removing too much is the correct direction here: a
 * missed call site is a gap, a fabricated one kills the instrument.
 */
function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** `api.deleteThing(` — tolerant of the `api\n  .deleteThing(` line break. */
const callSite = (name: string) => new RegExp(`\\bapi\\s*\\.\\s*${name}\\s*\\(`);

/** a bare `deleteCustomTemplate(` — a local helper, called without `api.` */
const localCallSite = (name: string) => new RegExp(`(^|[^.\\w])${name}\\s*\\(`, "m");

/**
 * A press wired STRAIGHT to the write: the handler's entire body is the
 * destructive call. Narrow on purpose — this shape cannot be a confirmed
 * delete, so it can never be a false positive, and `onConfirm={() => void
 * api.deleteCall(…)}` (the correct pattern) is untouched because it is not
 * an `onClick`/`onSelect`.
 */
const wiredStraightToPress = (name: string) =>
  new RegExp(
    /*
     * `(?:\{\s*)?` after the arrow (2026-09-02): a BLOCK-bodied handler whose
     * first statement is the destructive call —
     *
     *     onClick={() => {
     *       void api.deleteMeetingAttachment(meeting.id, file.id)
     *
     * — is the same defect wearing braces, and this pattern never matched
     * it. The meeting plan's attachment trash shipped exactly that shape
     * with no dialog, and the design audit found it, not this guard. A
     * guard that only sees the one-liner is a guard that teaches people to
     * add a newline.
     */
    `on(?:Click|Select)\\s*[=:]\\s*\\{?\\s*(?:async\\s*)?\\(\\s*\\)\\s*=>\\s*(?:\\{\\s*)?(?:void\\s+|await\\s+)?api\\s*\\.\\s*${name}\\s*\\(`,
  );

const clientText = readFileSync(CLIENT, "utf8");
const clientMethods = new Set(
  [...clientText.matchAll(/^\s{2}async\s+\*?\s*([A-Za-z0-9_]+)\s*[(<]/gm)].map((m) => m[1]!),
);
const candidates = [...clientMethods].filter((name) => DESTRUCTIVE_WORD.test(name));
const destructive = [
  ...candidates.filter((name) => NOT_DESTRUCTIVE[name] === undefined),
  ...Object.keys(ALSO_DESTRUCTIVE),
];

const files = walk(SRC)
  .map((full) => ({
    rel: full.slice(SRC.length + 1).replace(/\\/g, "/"),
    code: codeOnly(readFileSync(full, "utf8")),
  }))
  /* the producer is not a call site: it DEFINES these, and it renders no UI */
  .filter((file) => file.rel !== "api/client.ts");

/**
 * Which destructive writes a file performs — the predicate under test.
 *
 * `rel` is passed so a helper's OWN module is not read as a call to itself.
 * That is the name-matched-itself trap in miniature: `summaryTemplates.ts`
 * contains `export function deleteCustomTemplate(` and was duly reported for
 * calling it, which is the first thing this check did when it ran.
 */
function destructiveCallsIn(code: string, rel = ""): string[] {
  return [
    ...destructive.filter((name) => callSite(name).test(code)),
    ...Object.entries(LOCAL_DESTRUCTIVE)
      .filter(([, definedIn]) => definedIn !== rel)
      .filter(([name]) => localCallSite(name).test(code))
      .map(([name]) => name),
  ];
}

const confirmsHere = (code: string) => /\bConfirmDialog\b/.test(code);

describe("destructive controls confirm, in the theme's one dialog", () => {
  it("has a corpus and a vocabulary to check — neither may be empty", () => {
    /* the vacuous-checker guard: every assertion below passes perfectly
       against nothing at all */
    expect(files.length).toBeGreaterThan(50);
    expect(clientMethods.size).toBeGreaterThan(50);
    expect(destructive.length).toBeGreaterThan(5);
  });

  it("classifies every destructive-sounding client method", () => {
    /* derived from the producer, so a new `deleteFoo` fails here on the day
       it lands rather than on the day somebody notices the button */
    const unclassified = candidates.filter(
      (name) => NOT_DESTRUCTIVE[name] === undefined && !DESTRUCTIVE_WORD.test(name),
    );
    expect(unclassified).toEqual([]);
    /* and the hand-added ones must still be methods — a judgement about a
       method that no longer exists is a rule about nothing */
    expect(Object.keys(ALSO_DESTRUCTIVE).filter((n) => !clientMethods.has(n))).toEqual([]);
    expect(Object.keys(NOT_DESTRUCTIVE).filter((n) => !clientMethods.has(n))).toEqual([]);
  });

  it("finds the destructive call sites it exists to police", () => {
    /* had-something-to-check: if a refactor moved every write behind a
       helper, the two rules below would go green by having no subject */
    const withCalls = files.filter((f) => destructiveCallsIn(f.code, f.rel).length > 0);
    expect(withCalls.length).toBeGreaterThan(8);
  });

  it("renders ConfirmDialog in every file that destroys something", () => {
    const offenders = files
      .filter((f) => ALLOWED[f.rel] === undefined)
      .filter((f) => destructiveCallsIn(f.code, f.rel).length > 0)
      .filter((f) => !confirmsHere(f.code))
      .map((f) => `${f.rel}  →  ${destructiveCallsIn(f.code, f.rel).join(", ")}`);
    expect(offenders).toEqual([]);
  });

  it("never wires a press straight to the write", () => {
    /* the in-file gap the rule above cannot see: a screen that confirms one
       delete and fires another one on click reads as compliant to a
       file-scoped check, and that is exactly where the call-detail note
       delete was sitting */
    const offenders = files.flatMap((f) =>
      destructive
        .filter((name) => wiredStraightToPress(name).test(f.code))
        .map((name) => `${f.rel}  →  onClick/onSelect calls api.${name} directly`),
    );
    expect(offenders).toEqual([]);
  });

  it("never falls back to the browser's own confirm box", () => {
    /* `window.confirm` is unstyleable, untranslatable, and cannot say what is
       about to be destroyed — the reason the theme has a dialog at all */
    const offenders = files
      .filter((f) => /\bwindow\s*\.\s*confirm\s*\(|(^|[^.\w])confirm\s*\(/m.test(f.code))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it("keeps every exception pointing at a real file", () => {
    const present = new Set(files.map((f) => f.rel));
    expect(Object.keys(ALLOWED).filter((rel) => !present.has(rel))).toEqual([]);
    expect(
      Object.values(LOCAL_DESTRUCTIVE).filter((rel) => !present.has(rel)),
    ).toEqual([]);
  });

  it("still has an exception's REASON, not just its name", () => {
    /* an allow-list entry whose reason is blank is an exemption nobody has to
       defend, which is how an allow-list becomes the rule */
    expect(
      Object.entries(ALLOWED).filter(([, why]) => why.trim().length < 20).map(([rel]) => rel),
    ).toEqual([]);
  });

  /**
   * THE NEGATIVE CONTROL.
   *
   * Every assertion above is of the form "the offender list is empty", which
   * a broken detector satisfies perfectly. These two make the detector answer
   * NO to something it should: a file that destroys and does not ask, and a
   * press wired straight to the write. Without them, deleting the body of
   * `destructiveCallsIn` would leave this file entirely green.
   */
  it("flags a destructive call with no dialog — the detector can say NO", () => {
    const staged = `
      import { api } from "@/api/client";
      export function Bad({ id }: { id: string }) {
        return <button onClick={() => void api.deleteCall(id, "why")}>x</button>;
      }
    `;
    expect(destructiveCallsIn(staged)).toContain("deleteCall");
    expect(confirmsHere(staged)).toBe(false);
    expect(wiredStraightToPress("deleteCall").test(staged)).toBe(true);
  });

  it("flags the same press wearing braces — the block-bodied handler", () => {
    /*
     * The shape that shipped past this guard (2026-09-02): the meeting
     * plan's attachment trash was `onClick={() => {` NEWLINE `void
     * api.deleteMeetingAttachment(` — the destructive call was the handler's
     * first and only statement, and the one-line pattern never saw it. The
     * design audit found it; the guard had not. Staged here so the widened
     * pattern is proven on the exact shape, and so a future narrowing that
     * "cleans up" the regex fails for its own reason.
     */
    const staged = `
      import { api } from "@/api/client";
      export function Bad({ id }: { id: string }) {
        return (
          <button
            onClick={() => {
              void api.deleteCall(id, "why")
                .then(reload)
                .catch(() => undefined);
            }}
          >x</button>
        );
      }
    `;
    expect(wiredStraightToPress("deleteCall").test(staged)).toBe(true);
    /* and the CORRECT shape — the write inside the dialog's onConfirm — is
       still untouched, which is what keeps this from being a false-positive
       factory */
    const fine = `onConfirm={() => { void api.deleteCall(id, "why"); }}`;
    expect(wiredStraightToPress("deleteCall").test(fine)).toBe(false);
  });

  it("does NOT flag the confirmed shape — the discriminating half", () => {
    /* a control that flags everything is indistinguishable from one that
       works; this is the same code with the dialog in front of it */
    const good = `
      import { ConfirmDialog } from "@/components/rowActions";
      import { api } from "@/api/client";
      export function Good({ id }: { id: string }) {
        return asking ? (
          <ConfirmDialog onConfirm={() => void api.deleteCall(id, "why")} />
        ) : <button onClick={() => setAsking(true)}>x</button>;
      }
    `;
    expect(destructiveCallsIn(good)).toContain("deleteCall");
    expect(confirmsHere(good)).toBe(true);
    expect(wiredStraightToPress("deleteCall").test(good)).toBe(false);
  });

  it("does NOT flag a call named only in prose", () => {
    /* the DeletedCallsCard case, verbatim in shape: a header explaining why
       `api.deleteCall` is fixture-backed must not be read as a call */
    const prose = `
      /**
       * Delete and restore are broken for members today, so
       * \`api.deleteCall(id)\` / \`api.restoreCall(id)\` stay fixture-backed.
       */
      export function Card() { return null; }
    `;
    expect(destructiveCallsIn(codeOnly(prose))).toEqual([]);
  });
});
