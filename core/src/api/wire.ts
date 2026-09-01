/**
 * The response shapes, published for consumers — `@echo/core/wire`.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 *
 * Three times now a consumer has INVENTED the shape it was consuming, and
 * three times it rendered perfectly against fixtures built by the same hand:
 *
 *   1. `CallStatus` as `queued | uploading | transcoding | …` — four of eight
 *      values had never existed. Fixed by publishing `CALL_STATUSES` as
 *      values (see vocabulary.ts).
 *   2. The call payload: `created_at` and `duration_seconds`, where the wire
 *      says `started_at` and milliseconds.
 *   3. `CallPart` as `{index, duration_seconds, starts_at_seconds, audio_url}`
 *      against a wire of `{idx, duration_ms, offset_ms}` — and `audio_url`
 *      assumed into existence entirely.
 *
 * Every one was found by a human reading prose in a message, which is the
 * slowest and least reliable instrument we have. The vocabulary module solved
 * this for closed value sets; this solves it for the shapes those values sit
 * in. A consumer that imports `CallPart` cannot misname its fields, and a
 * rename here becomes their compile error instead of their runtime `undefined`.
 *
 * ── Why it is types only ────────────────────────────────────────────────────
 *
 * `export type` is erased entirely — under `--experimental-strip-types` and in
 * any bundler — so this re-exports from modules that import `postgres` and
 * Fastify without dragging either into a browser bundle. Nothing here emits a
 * runtime import. That is what lets the shapes live beside the code that
 * produces them (where they stay correct) rather than in a copy that drifts.
 *
 * The closed VALUE sets stay in `@echo/core/vocabulary`, which imports nothing
 * at all: a union type tells you a field is a `CallStatus`, only an array can
 * tell you at runtime which statuses exist.
 */

export type { CallSummary, CallPart } from "./calls.ts";
export type { OrgRecord } from "./org.ts";
export type { AuditEntry, AuditSource, AuditPage, AuditCursor } from "./audit.ts";
/**
 * The Management·Server shapes. Published because FE3 was otherwise going to
 * hand-write `{queues, keys, storage}` — and this shape's whole point is a
 * THREE-state (`measured` / `not measured` / `unavailable-with-reason`) that a
 * consumer gets wrong by reflex, collapsing the last two into a zero. A
 * transcribed copy of exactly that distinction is the second-hand belief this
 * module exists to prevent.
 */
export type { ServerHealth, QueueHealth } from "./health.ts";
export type { MemberRecord, MeRecord } from "./members.ts";
export type { ErrorBody, RefusalKind, UnauthenticatedKind } from "./errors.ts";
export type { AgentCard } from "../agent/agent-store.ts";
export type { WorkflowCard } from "./workflows.ts";
export type {
  TaskCardRecord, TaskColumnRecord, TaskTopicRecord, TaskDetailRecord,
  TaskChecklistItemRecord, TaskCommentRecord, TaskPriority, TaskColumnTone,
} from "./tasks.ts";
export type { MeetingRecord, MeetingAgendaItem, MeetingMode } from "./meetings.ts";
export type { ConnectorStatus, ConnectorItem, ConnectorProvider, ConnectorSourceKind } from "./connectors.ts";
export type {
  PlatformAuditEntry, PlatformOrganization, PlatformOverview, PlatformPage, PlatformUser,
} from "./platform.ts";

// Re-exported so one import covers a response and the vocabularies inside it.
export type {
  AgentRunStatus, CalendarPreference, CallStatus, MemberRole, PartStatus,
  TranscriptTiming, UserStatus,
} from "./vocabulary.ts";
