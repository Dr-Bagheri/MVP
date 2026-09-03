/**
 * Every closed vocabulary this API emits, in one dependency-free module.
 *
 * **This file imports nothing, and must never import anything.** That is its
 * only real constraint and its whole purpose: `web/` can import it without
 * dragging Fastify, `postgres`, or the worker's module graph into a browser
 * bundle. It is wired as the `@echo/core/vocabulary` export so a consumer
 * never has to reach into `src/api/calls.ts` to get a list of strings.
 *
 * ── Why these are published as VALUES ────────────────────────────────────────
 *
 * Because a consumer invented them otherwise, and nobody found out for weeks.
 * The frontend's `CallStatus` union was
 * `queued | uploading | transcoding | transcribing | diarizing | summarizing |
 * ready | failed` — **four of those eight have never existed**. It rendered
 * correctly the whole time because its fixtures used the same invented
 * values: a closed loop with both ends built by the same hand. Tone colours
 * and Persian labels had been written for states the product cannot produce.
 *
 * The same week, `AgentRunStatus` in this package said `succeeded | failed`
 * against a schema enum of `ok | error`, so every agent run inserted as
 * `running` and could never leave. Two instances of one shape: a vocabulary
 * asserted rather than sourced.
 *
 * So these are exported as `as const` arrays, not merely as types — a type
 * vanishes at build time and cannot be checked against anything at runtime,
 * while an array can be compared to `pg_enum` on a live connection.
 * `test/e2e/schema-contract.ts` does exactly that (rule 10: a boundary shape
 * comes from the producer, and for an enum the producer is the catalogue).
 */

/**
 * Timestamps on the wire are ISO 8601 (UTC), always.
 *
 * `String(new Date())` gives
 * `"Wed Aug 12 2026 19:52:44 GMT+0100 (British Summer Time)"` — the SERVER's
 * timezone, in English, in a format whose parseability is implementation
 * defined. Four repos here did exactly that, and it went out on a live
 * response before anyone noticed: every unit test compared it to a string
 * fixture that was already in the shape the code produced.
 *
 * It matters more than usual for this product. The UI is Persian-first with
 * Jalali dates, so every timestamp is reformatted client-side, and a value
 * carrying the server's local offset would silently shift a meeting's date
 * for anyone in a different zone — wrong by a day, never by an error.
 *
 * Lives in vocabulary.ts because it is part of the published contract rather
 * than a helper: the wire says ISO 8601, and this is what makes that true.
 */
export function isoOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  // Already a string (pg can return one depending on parser config), or
  // something unexpected — parse it rather than trusting its shape.
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** Same, for a column the schema guarantees is NOT NULL. */
export function iso(value: unknown): string {
  return isoOrNull(value) ?? new Date(0).toISOString();
}

/**
 * `echo.call_status` (db/0001). Call-level only.
 *
 * Note what is NOT here: no `transcribing`, no `diarizing`. Per-part work
 * happens INSIDE `processing` — the per-part DAG is transcode → vad →
 * transcribe → diarize and the call-level status does not decompose it.
 * `linking` is link-speakers across all parts, so by the time a call reaches
 * it every part has been transcribed.
 */
export const CALL_STATUSES = [
  "recording",
  "processing",
  "linking",
  "summarizing",
  "ready",
  "failed",
] as const;
export type CallStatus = (typeof CALL_STATUSES)[number];

/**
 * `echo.part_status` (db/0001). The per-part ladder (M7).
 *
 * Published because a consumer typed `CallPart.status` as `CallStatus` — the
 * same mistake one level down — and then correctly refused to guess a second
 * time. `vad_done` is the spelling; it is not `vad` and not `vadDone`.
 *
 * A part carries its own `failed`, distinct from the call's: one failed part
 * is a visible gap in a call that otherwise succeeds (M20), not a failed call.
 */
export const PART_STATUSES = [
  "pending",       // row exists, bytes do not
  "uploaded",
  "transcoded",
  "vad_done",
  "transcribed",
  "diarized",
  "failed",
] as const;
export type PartStatus = (typeof PART_STATUSES)[number];

/** `echo.agent_run_status` (db/0001). NOT `succeeded`/`failed` — see above. */
export const AGENT_RUN_STATUSES = ["running", "ok", "error"] as const;
export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];

/**
 * How a person wants dates rendered (FE2's review-round-2 preference).
 *
 * **`auto` is a VALUE, not an absence** — it means "follow the active
 * language" (Jalali in fa, Gregorian in en), which is exactly today's
 * behaviour and therefore the default. FE2 made the case and it decides the
 * column shape: if this were nullable, `null` and `"auto"` would be two
 * spellings of one state, and the codebase has spent a day on what happens
 * when two spellings of one fact drift.
 *
 * So there is no "clear" operation for it. Resetting IS choosing `auto`.
 *
 * Published before the column exists so FE2 can import the set rather than
 * re-type it. Application-level, not a database enum — if db/ makes it one,
 * this gains a `pg_enum` assertion in `schema-contract.ts` like the others.
 */
export const CALENDAR_PREFERENCES = ["auto", "jalali", "gregorian"] as const;
export type CalendarPreference = (typeof CALENDAR_PREFERENCES)[number];

/**
 * Timezone is a free string rather than a closed set — IANA has ~420 zones
 * and they change — with ONE sentinel: `"auto"` means "follow the device",
 * resolved at render time rather than snapshotted. Snapshotting the browser's
 * zone at the moment of choosing would silently freeze a traveller's dates,
 * which is FE2's point and a good one.
 */
export const TIMEZONE_AUTO = "auto";

/**
 * The three halves of the audit trail (M25).
 *
 * Moved here from `audit.ts` at FE3's asking, and they were right about the
 * reason: it is a closed vocabulary crossing the boundary, which is exactly
 * what this module is for. They had written a local `as const` copy with a
 * two-way type assertion to catch a fourth source being added — a good
 * stopgap, and still two spellings of one list that nobody chose to have.
 *
 * NOT a database enum: these are the union's own labels, so this array IS the
 * authority rather than a mirror of one. `schema-contract.ts` cannot check it
 * against `pg_enum` because there is nothing to check against — the guard is
 * that the SQL naming them lives beside it in `audit.ts`.
 */
export const AUDIT_SOURCES = ["admin_action", "proposal_decision", "agent_run", "deletion"] as const;
export type AuditSource = (typeof AUDIT_SOURCES)[number];

/**
 * `echo.member_role` — and published NOW, before it changes, on purpose.
 *
 * M23 revokes the two-role rule and adds `owner`. I published this list while
 * the catalogue still said `member | admin`, deliberately matching the
 * catalogue rather than the plan, and armed the `schema-contract.ts`
 * assertion to go red the day db/'s migration landed.
 *
 * **It fired within the hour**, on the first run after their migration:
 *
 *     FAIL core/'s MEMBER_ROLES matches pg_enum exactly
 *          {"catalogue":["member","admin","owner"],"typescript":["member","admin"]}
 *
 * That is the entire value of the pattern. The same drift caught
 * `agent_run_status` weeks late, after every terminal write had been failing
 * in production; here it was named on arrival, and it pointed straight at
 * three gates comparing `role !== "admin"` that would have refused the org's
 * ROOT as insufficiently privileged. A vocabulary that is CHECKED can afford
 * to be behind. One that is merely believed cannot.
 */
export const MEMBER_ROLES = ["member", "admin", "owner"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

/**
 * `echo.user_status`. `pending` is M15's waiting room, `disabled` is
 * reversible (M24 keeps it distinct from true delete).
 */
export const USER_STATUSES = ["pending", "active", "disabled"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/**
 * Proposed-write kinds (M4). Published here rather than left in agent/ for
 * the reason every list in this file is published: a consumer had already
 * hand-written `edit_speakers` and nothing in the system could contradict it
 * — the fourth invented vocabulary this week.
 *
 * Not a database enum: proposals live inside `agent_run.steps`, so this list
 * IS the authority rather than a mirror of one.
 */
export const PROPOSAL_KINDS = [
  "correct_transcript",
  "edit_speaker_roster",
  "replace_summary",
] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

/**
 * Provenance of word-level timing across a call's transcribed parts (M20).
 * `null` on the wire — not a member here — means no transcript exists yet;
 * "none" would claim a real prose-only transcript.
 */
export const TRANSCRIPT_TIMINGS = ["full", "mixed", "none"] as const;
export type TranscriptTiming = (typeof TRANSCRIPT_TIMINGS)[number];

/**
 * Summary TEMPLATES (user ruling, 2026-08-23 — this exact list, no sales
 * and no standup): a template is a structural addendum to the summarizer's
 * skill prompt, chosen per regeneration, never a second skill. The keys
 * are the wire vocabulary; the Persian addenda live with the worker.
 */
export const SUMMARY_TEMPLATES = [
  "board",
  "group",
  "team",
  "it_team",
  "interview",
] as const;
export type SummaryTemplate = (typeof SUMMARY_TEMPLATES)[number];

/** The regenerate door's instruction field is bounded like every reason. */
export const SUMMARY_INSTRUCTION_MAX = 500;

/**
 * M41 — THE WORKFLOW ENGINE's closed vocabularies. Mirrored by db/0104's
 * check constraints; the db test suite and these constants are two
 * spellings deliberately kept in sight of each other (a drift shows as a
 * red on whichever side moved).
 *
 * Ten step kinds — and the catalogue is load-bearing: the executor's
 * dispatch test asserts every kind here is actually handled, so adding a
 * kind without an executor arm fails the suite, not the 3 a.m. run.
 */
export const WORKFLOW_STEP_KINDS = [
  "search", "fetch", "ask", "extract", "decide",
  "foreach", "propose", "apply", "notify", "wait",
] as const;
export type WorkflowStepKind = (typeof WORKFLOW_STEP_KINDS)[number];

export const WORKFLOW_TRIGGER_KINDS = ["manual", "event", "schedule", "signal"] as const;
export type WorkflowTriggerKind = (typeof WORKFLOW_TRIGGER_KINDS)[number];

/** seven, not four: "waiting on a human" and "still working" are different
    nothings, and so are refused / cancelled / expired (rule 12) */
export const WORKFLOW_RUN_STATUSES = [
  "running", "waiting", "done", "failed", "refused", "cancelled", "expired",
] as const;
export type WorkflowRunStatus = (typeof WORKFLOW_RUN_STATUSES)[number];

export const WORKFLOW_STEP_STATUSES = [
  "running", "done", "failed", "skipped", "refused",
] as const;
export type WorkflowStepStatus = (typeof WORKFLOW_STEP_STATUSES)[number];

/** codes only, never content — each names WHICH nothing (M41 s5.6) */
export const WORKFLOW_FAILURE_CODES = [
  "owner_not_found", "owner_inactive", "step_dead_letter", "budget_exceeded",
  "model_refused", "schema_invalid", "source_purged", "stalled",
  /* runtime-only pair (P1): a trigger binding the run does not carry, and a
     step kind outside the phase's executable set reaching the executor
     anyway (gated at trigger time; here = forged payload or bug) */
  "binding_unresolved", "kind_unavailable",
] as const;
export type WorkflowFailureCode = (typeof WORKFLOW_FAILURE_CODES)[number];

/**
 * The kinds the EXECUTOR can run TODAY (M41 build phases). The manual
 * trigger route refuses to start a run whose graph steps outside this set —
 * a workflow that would fail on step 3 is refused at step 0, naming the
 * kinds it needs (rule 12: the refusal says WHICH nothing). Grows with the
 * phases: P2 adds extract/decide/foreach, P3 propose/wait/apply, P4 fetch.
 */
export const EXECUTABLE_STEP_KINDS = [
  "search", "ask", "notify",
  /* P2 (2026-08-27): the graph becomes a program */
  "extract", "decide", "foreach",
  /* P3 (2026-08-27): the writes — propose/wait/apply through the M4
     machinery. `fetch` alone stays gated: the connector poller it needs
     is deferred, on the record. */
  "propose", "wait", "apply",
  /* P5 (2026-08-28): `fetch` runs. It reads ONE connector source under the
     owner's own grant and declares a trust-labelled envelope, which is what
     lets a reply's recipient be BOUND to a header rather than written by a
     model. Its gate came off with that shape, not before it. */
  "fetch",
] as const;

/**
 * M41 P3 — what a workflow may PROPOSE (the mechanical propose step's
 * closed set). Both v1 kinds target the run owner's own call, which is
 * load-bearing twice: the decision row carries the call so its own
 * decider can read it back (the read policy follows the call), and the
 * agent role's apply grant is owner-only on exactly these two columns.
 */
/**
 * The dock's card kinds (db/0074, widened by 0107 and 0116).
 *
 * Exported because the web's union drifted silently once already: 0107 added
 * `workflow_result` and `web/src/api/types.ts` never learned it, since
 * nothing derived that list from a producer. It does now.
 */
export const AGENT_CARD_KINDS = [
  "post_call_brief", "weekly_digest", "workflow_result", "mail_draft", "meeting_prep",
  /* 0167 — the one kind with a human sender. Every other card here is
     something the platform made for you; this one is something a colleague
     sent, and that difference is why it carries its own text instead of
     pointing at a conversation. */
  "member_message",
] as const;
export type AgentCardKind = (typeof AGENT_CARD_KINDS)[number];

export const WORKFLOW_PROPOSAL_KINDS = ["add_tags", "set_title", "draft_mail"] as const;

/**
 * Proposal kinds whose `apply` needs no human decision first, because what
 * it creates **cannot act**.
 *
 * `draft_mail` writes a row into `echo.mail_draft`, which is inert by
 * construction: `echo_agent` holds INSERT and not UPDATE (db/0114), so the
 * draft sits `pending` until a person presses Send on `echo_app`. The draft
 * IS the decision surface — putting a `proposal_decision` row in front of it
 * would mean approving a thing in order to be asked to approve it, and
 * 0114's header already ruled out the null-call decision row that would
 * require.
 *
 * Nothing else may join this list without the same argument: the test that
 * matters is the NEGATIVE one — `add_tags` writes a call and still waits for
 * a human, so an apply that skipped its decision would be a silent write.
 */
export const INERT_PROPOSAL_KINDS = ["draft_mail"] as const;
export type WorkflowProposalKind = (typeof WORKFLOW_PROPOSAL_KINDS)[number];

/**
 * W13's platform floor: only REVERSIBLE kinds may ever auto-apply. Tags
 * can be removed; a title overwrite loses the previous title — so
 * set_title always keeps a live human, whatever the org enables.
 */
export const AUTO_APPLY_ELIGIBLE = ["add_tags"] as const;

/**
 * The connector providers this platform OFFERS today (user directive,
 * 2026-08-28: "remove the microsoft from the workflow for now we just go
 * with the google").
 *
 * One list, because there were four: core's own `PROVIDERS`, the
 * integrations catalogue, the run dialog's picker, and the workflow detail
 * page's logo row — each a hand-kept copy of the same fact, which is the
 * drift shape this repo keeps paying for. Narrowing it here narrows every
 * surface at once.
 *
 * It is the OFFER, not the world: `connector_connection` still accepts
 * `microsoft` and the Graph code paths are untouched, so a connection that
 * already exists stays visible and disconnectable. Hiding a live grant
 * would leave somebody unable to revoke it, which is a worse thing to do
 * than showing a provider we are not currently selling.
 */
/**
 * The extract schemas a graph may declare, by name.
 *
 * The definitions live in `workflow-graph.ts` (they are shapes, and that is
 * where shapes are validated); the NAMES live here because the builder has
 * to offer them and web/ imports this module and not that one. A test in
 * core holds the two together — a name here with no schema there is a
 * picker offering something publish refuses.
 */
export const EXTRACT_SCHEMA_NAMES = [
  "topics_v1", "decisions_v1", "action_items_v1", "mail_reply_v1",
] as const;

/** the connector sources a `fetch` step may read */
export const FETCH_SOURCE_KINDS = ["calendar_event", "mail_message"] as const;

export const OFFERED_CONNECTOR_PROVIDERS = ["google"] as const;

/**
 * M41 L1 — the facts that may trigger a workflow (P4; closed).
 *
 * Every entry has a REAL emitter. (These spellings were shared with the
 * gateway's WEBHOOK_EVENTS until 2026-08-29, when the webhook feature was
 * removed — this list is now the only place a call fact is named.)
 *
 *  · `call.created`     — the api, the moment a recording or upload makes
 *                         its row (user directive, 2026-08-28: "add when
 *                         the record start");
 *  · `call.transcribed` — the worker, when the transcript lands;
 *  · `call.summarized`  — the worker, when the summary lands;
 *  · `mail.received`    — the mail poller, once per NEW inbox message;
 *  · `meeting.soon`     — the calendar poller, once per meeting entering
 *                         its lead window.
 *
 * The pollers still own detection, dedupe and the cursor — machinery no
 * author touches, exactly as every mature engine arranges it — and hand the
 * graph a REFERENCE, never content.
 */
export const WORKFLOW_EVENTS = [
  "call.created", "call.transcribed", "call.summarized",
  "mail.received", "meeting.soon",
] as const;
export type WorkflowEvent = (typeof WORKFLOW_EVENTS)[number];
