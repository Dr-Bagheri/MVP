/**
 * WHICH STARTER WORKFLOWS come up with each PLATFORM AGENT (user
 * directive, 2026-08-28: seven options per agent).
 *
 * A mirror of `AGENT_STARTERS` in `core/src/api/workflow-authoring.ts`,
 * translated from registry keys to workflow HANDLES — because handles are
 * what this side works in: the panel links to `/workflows/<handle>`, and
 * `SEEDED_STARTERS` / the locale catalogue are both keyed by handle.
 *
 * A mirror rather than an import for `workflowName.ts`'s exact reason:
 * the producing module reaches for `node:crypto` and cannot enter the
 * client bundle. Kept honest by `agentStarters.test.ts`, which imports
 * the REAL producer in Node and compares whole-object — an agent handle
 * we invented, a menu entry core dropped, and a handle typo are all the
 * same red.
 *
 * Keys are the three shipped agents' handles (db/0124). An agent handle
 * outside this map (an org's own agent, a legacy persona) simply offers
 * no starter menu — that absence is a fact about the catalogue, not a
 * failure, so callers index with `?? []`.
 */
export const AGENT_STARTER_HANDLES: Readonly<Record<string, readonly string[]>> = {
  recorder: [
    "wf-starter-record-recap",
    "wf-starter-record-decisions",
    "wf-starter-record-open",
    "wf-starter-record-speakers",
    "wf-starter-record-quotes",
    "wf-starter-record-next",
    "wf-starter-record-timeline",
  ],
  commitments: [
    "wf-starter-record-commitments",
    "wf-starter-commit-by-person",
    "wf-starter-commit-overdue",
    "wf-starter-commit-unowned",
    "wf-starter-commit-recent",
    "wf-starter-commit-followup",
    "wf-starter-commit-history",
  ],
  meetings: [
    "wf-starter-autotag",
    "wf-starter-followups",
    "wf-starter-meeting-title",
    "wf-starter-decisions-digest",
    "wf-starter-action-items",
    "wf-starter-open-questions",
    "wf-starter-topic-history",
  ],
  mail: [
    "wf-starter-mail-reply",
    "wf-starter-mail-triage",
    "wf-starter-mail-summary",
    "wf-starter-mail-reply-formal",
    "wf-starter-mail-reply-brief",
    "wf-starter-mail-meeting-request",
    "wf-starter-mail-context",
  ],
  prep: [
    "wf-starter-prep-brief",
    "wf-starter-prep-people",
    "wf-starter-prep-questions",
    "wf-starter-prep-open-decisions",
    "wf-starter-prep-related",
    "wf-starter-prep-today",
    "wf-starter-prep-agenda",
  ],
  sales: [
    "wf-starter-sales-debrief",
    "wf-starter-sales-objections",
    "wf-starter-sales-next-steps",
    "wf-starter-sales-commitments",
    "wf-starter-sales-lead-mail",
    "wf-starter-sales-meeting-prep",
    "wf-starter-sales-pipeline",
  ],
  interview: [
    "wf-starter-int-scorecard",
    "wf-starter-int-questions",
    "wf-starter-int-compare",
    "wf-starter-int-redflags",
    "wf-starter-int-candidate-mail",
    "wf-starter-int-tag",
    "wf-starter-int-debrief",
  ],
  manager: [
    "wf-starter-mgr-meeting-brief",
    "wf-starter-mgr-week-review",
    "wf-starter-mgr-delegations",
    "wf-starter-mgr-risks",
    "wf-starter-mgr-decisions-log",
    "wf-starter-mgr-escalations",
    "wf-starter-mgr-one-on-one",
  ],
};
