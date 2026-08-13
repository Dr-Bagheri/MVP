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
 * Webhook events (M17). Not a database enum — a `text[]` column with an
 * application-level closed set, so this list IS the authority rather than a
 * mirror of one. An unknown event is a 400 that names the bad value.
 */
export const WEBHOOK_EVENTS = [
  "call.created",
  "call.transcribed",
  "call.summarized",
  "call.failed",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

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
