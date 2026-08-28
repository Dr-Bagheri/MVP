import { describe, expect, it } from "vitest";
import * as vocabulary from "@echo/core/vocabulary";

/**
 * **The guard's coverage list is itself a seam.**
 *
 * `vocabulary.guard.ts` asserts each of our unions against core/'s published
 * arrays — but the list of *which* unions it checks is hand-written, so it
 * covered every vocabulary except the one that drifted. `Role` stayed
 * two-valued for days after `owner` landed, and the guard was silent because
 * nobody had added the line. Present, reads as satisfied, blind in exactly
 * one place.
 *
 * So this asserts the list is COMPLETE: every closed vocabulary core/
 * publishes is either guarded or explicitly excluded with a reason. A new
 * vocabulary fails the build until someone decides which — the decision is
 * forced rather than defaulted to silence.
 *
 * A type-level derivation would be tighter, but it can't enumerate a module's
 * exports at compile time across the package boundary. This can, at runtime,
 * against the real module — and unlike a type it can *name* what's missing.
 */

/** Guarded in `vocabulary.guard.ts` — one `Exact<…>` line each. */
const GUARDED = [
  "CALL_STATUSES",
  "PART_STATUSES",
  "MEMBER_ROLES",
  "PROPOSAL_KINDS",
  "TRANSCRIPT_TIMINGS",
  "USER_STATUSES",
  "WEBHOOK_EVENTS",
  "WORKFLOW_RUN_STATUSES",
  "WORKFLOW_STEP_STATUSES",
];

/**
 * Deliberately NOT guarded, with the reason — an exclusion on the record is a
 * decision; an omission is an accident that looks like one.
 */
const EXCLUDED: Record<string, string> = {
  /*
   * Not mirrored, so there is nothing to mirror-check. `types.ts` re-exports
   * `AuditSource` straight from `@echo/core/wire`, and the audit screen imports
   * `AUDIT_SOURCES` from this very module — one spelling, no local copy that
   * could drift.
   *
   * An `Exact<…>` line for it would compare the imported type with itself and
   * pass forever regardless of what either side says: a check that cannot fail
   * for its own reason, which this codebase treats as worse than none. The
   * absence of a guard here is the CONSEQUENCE of importing rather than
   * copying, and that is the stronger position — every guarded entry above
   * exists because a hand-written union sits opposite it.
   */
  AUDIT_SOURCES:
    "not mirrored: `AuditSource` is imported from `@echo/core/wire` and the " +
    "values from this module, so no local union exists to drift. An assertion " +
    "would compare a type with itself and could never fail.",
  AGENT_RUN_STATUSES:
    "core-internal: web/ never renders a run's lifecycle state, so mirroring it " +
    "would be a union we own and never read — dead surface that still has to be " +
    "kept true.",
  CALENDAR_PREFERENCES:
    "not mirrored: `lib/preferences.ts` re-exports core's `CalendarPreference` " +
    "and validates stored values against `CALENDAR_PREFERENCES` itself, so there " +
    "is no local union or local member list to drift. Same reasoning as " +
    "AUDIT_SOURCES — the missing guard is the consequence of importing rather " +
    "than copying, not an oversight.",
  AGENT_CARD_KINDS:
    "not mirrored: `AgentCardItem.kind` IS core's `AgentCardKind`, imported " +
    "rather than restated, so an Exact<> here would compare a type with " +
    "itself and could never fail — the bar-ceiling trap. The import is what " +
    "closed the real drift: this union sat one kind behind the database from " +
    "0107 until 0116 precisely because it WAS a local copy.",
  INERT_PROPOSAL_KINDS:
    "server-side rule, not a wire shape: it says which proposal kinds may " +
    "apply with no human decision, and the only reader is the executor. " +
    "web/ renders proposals; it never decides whether one needs approving, " +
    "and a mirror of this list here would be a second place for that rule " +
    "to be true — which is exactly how a wall comes to have two meanings.",
  OFFERED_CONNECTOR_PROVIDERS:
    "not mirrored: this is the OFFER, and web/ consumes the array itself at " +
    "runtime — the integrations catalogue, the run dialog's picker and the " +
    "detail page's logo row all filter by it. It exists precisely BECAUSE " +
    "those were three hand-kept copies of one fact; re-stating it here as a " +
    "union would recreate the fourth. Note it is narrower than " +
    "`ConnectorProvider`, deliberately: the type says what the code can " +
    "speak, this says what the product currently sells.",
  WORKFLOW_PROPOSAL_KINDS:
    "not mirrored: the builder maps over the imported array itself " +
    "(one spelling, no local union to drift) — the AUDIT_SOURCES posture.",
  AUTO_APPLY_ELIGIBLE:
    "not mirrored: the standing-decisions card renders the imported array " +
    "directly, so W13's reversible-only floor has exactly one spelling.",
  WORKFLOW_EVENTS:
    "not mirrored: the trigger picker maps over the imported array — a new " +
    "fact appears in the menu the moment core ships it.",
  WORKFLOW_STEP_KINDS:
    "no local union exists: the run detail renders step IDS, not kinds, and " +
    "the builder (P5) will import this array rather than copy it — the " +
    "AUDIT_SOURCES posture, chosen in advance of the surface.",
  WORKFLOW_TRIGGER_KINDS:
    "no local union: `trigger_kind` travels as a string and renders inside a " +
    "translated sentence; nothing branches on its members here.",
  WORKFLOW_FAILURE_CODES:
    "no local union: failure codes render VERBATIM as mono codes (the " +
    "codes-not-content posture) — a per-code label map would be a translation " +
    "of an operator vocabulary members are not meant to interpret.",
  EXECUTABLE_STEP_KINDS:
    "core-internal: the manual-trigger route's phase gate. Web learns of it " +
    "only as core's named refusal sentence, surfaced verbatim — mirroring the " +
    "list would let the screen contradict the gate.",
  SUMMARY_TEMPLATES:
    "not mirrored: the call page imports SUMMARY_TEMPLATES and the " +
    "SummaryTemplate type straight from this module, and its label map is " +
    "typed Record<SummaryTemplate, …> — a new ruled template breaks the web " +
    "BUILD until it gets a label, which is a stronger guard than a mirror.",
};

/** A published vocabulary is a frozen array of strings. */
function publishedVocabularies(): string[] {
  return Object.entries(vocabulary)
    .filter(
      ([, value]) =>
        Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === "string"),
    )
    .map(([name]) => name);
}

describe("the guard covers every vocabulary core/ publishes", () => {
  it("can see the vocabulary module at all", () => {
    // without this, an import that resolved to {} would make the suite pass
    // by checking nothing — the empty-audit failure, in the coverage check
    expect(publishedVocabularies().length).toBeGreaterThanOrEqual(GUARDED.length);
  });

  it("leaves no published vocabulary unguarded and undeclared", () => {
    const unaccounted = publishedVocabularies().filter(
      (name) => !GUARDED.includes(name) && !(name in EXCLUDED),
    );
    expect(unaccounted).toEqual([]);
  });

  it("does not claim to guard something core/ no longer publishes", () => {
    // the mirror failure: a stale entry makes coverage look wider than it is
    const published = publishedVocabularies();
    expect(GUARDED.filter((name) => !published.includes(name))).toEqual([]);
  });
});
