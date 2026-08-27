/**
 * Rule 10, enforced: the CONSUMER asserts the PRODUCER's shape.
 *
 * Every union in `types.ts` that mirrors a closed vocabulary is checked here
 * against core/'s published `@echo/core/vocabulary` — the same arrays core/
 * asserts against `pg_enum` on a live connection. So the chain runs
 * database → core/ → here, and a drift at either link fails this file by name.
 *
 * This exists because four of eight `CallStatus` values in this codebase never
 * existed. They rendered correctly for weeks — tone colours, Persian labels,
 * the lot — because the fixtures used the same invented values: a closed loop
 * with both ends built by the same hand. *A fake cannot disagree with a
 * schema; an invented vocabulary cannot disagree with anything.* One assertion
 * closes the class for every enum at once, which is worth more than the six
 * individual bugs it would have caught.
 *
 * TYPE-ONLY BY CONSTRUCTION. Nothing here is imported by application code and
 * nothing is emitted, so `@echo/core` never enters a browser bundle and Next
 * needs no `transpilePackages`. The link is a tsconfig `paths` mapping rather
 * than a workspace dependency, deliberately: it buys the compile-time check
 * without touching install state or the dev server. If a RUNTIME import of
 * core/ is ever wanted, that is the point to add the real dependency — this
 * guard does not need it and should not acquire it.
 */
import type {
  AgentProposal,
  Call,
  CallStatus,
  GatewayEvent,
  PartStatus,
  Role,
  UserStatus,
  TranscriptTiming,
  WorkflowRunRecord,
  WorkflowStepRunRecord,
} from "./types";
import type { CallSummary } from "@echo/core/wire";
import {
  CALL_STATUSES,
  MEMBER_ROLES,
  PART_STATUSES,
  PROPOSAL_KINDS,
  TRANSCRIPT_TIMINGS,
  USER_STATUSES,
  WEBHOOK_EVENTS,
  WORKFLOW_RUN_STATUSES,
  WORKFLOW_STEP_STATUSES,
} from "@echo/core/vocabulary";

/**
 * Mutual assignability. Both directions matter and they fail differently:
 * A-extends-B catches a value we invented, B-extends-A catches one core/ added
 * that we never handled. A one-way check would have missed the invented four.
 */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

export const CALL_STATUS_MATCHES: Exact<CallStatus, (typeof CALL_STATUSES)[number]> = true;
export const PART_STATUS_MATCHES: Exact<PartStatus, (typeof PART_STATUSES)[number]> = true;
export const GATEWAY_EVENT_MATCHES: Exact<GatewayEvent, (typeof WEBHOOK_EVENTS)[number]> = true;

/**
 * The union this file existed to protect and didn't cover.
 *
 * M23 added `owner` to `echo.member_role`; `Role` here stayed two-valued for
 * days. Every other closed vocabulary was asserted — so the guard was
 * present, read as satisfied, and silent on the one that drifted. It cost a
 * `String(u.role) === "owner"` cast in another session's screen, which is the
 * shape a missing assertion takes: someone routes around the disagreement
 * instead of the type reporting it.
 *
 * Adding a union to `types.ts` means adding its line here, same edit.
 */
export const ROLE_MATCHES: Exact<Role, (typeof MEMBER_ROLES)[number]> = true;

/**
 * Found by the coverage check on its first run — a second union this file
 * mirrored and never asserted, sitting beside the one that drifted. Two
 * blind spots in a hand-written list is the argument for the list not being
 * hand-written.
 */
export const USER_STATUS_MATCHES: Exact<UserStatus, (typeof USER_STATUSES)[number]> = true;

/**
 * M41 P1: the run ledger's two status unions are hand-written mirrors in
 * `types.ts` (the tone maps and the `status_*` copy keys are typed off
 * them), which is exactly the drift-prone shape this file exists for — a
 * new run status on core's side must break the BUILD here, not render as
 * an unknown chip.
 */
export const WORKFLOW_RUN_STATUS_MATCHES: Exact<
  WorkflowRunRecord["status"], (typeof WORKFLOW_RUN_STATUSES)[number]
> = true;
export const WORKFLOW_STEP_STATUS_MATCHES: Exact<
  WorkflowStepRunRecord["status"], (typeof WORKFLOW_STEP_STATUSES)[number]
> = true;

/**
 * The last closed vocabulary this codebase held a hand-written copy of. It
 * said `edit_speakers`; core/ says `edit_speaker_roster` — the fourth
 * invented vocabulary in a week, and the fourth that nothing could contradict
 * until it was published as a value.
 */
export const PROPOSAL_KIND_MATCHES: Exact<
  AgentProposal["kind"],
  (typeof PROPOSAL_KINDS)[number]
> = true;

/**
 * SHAPES, not just value sets. `vocabulary` closed the "which values exist"
 * gap; `@echo/core/wire` closes the "what fields are they in" gap, which is
 * the one that kept costing a human reading prose — `created_at` vs
 * `started_at`, `duration_seconds` vs `duration_ms`, and a whole `CallPart`
 * transcribed from a message.
 *
 * These assertions make a rename on core/'s side a COMPILE error here rather
 * than a runtime `undefined`, which reverses who finds it and when.
 *
 * Type-only by construction, like the rest of this file: `wire.ts`
 * re-exports from modules that import `postgres` and Fastify, and only
 * `export type` erasure keeps a database driver out of a browser bundle.
 */
/**
 * NOT ASSERTED YET, deliberately — and this comment is the placeholder rather
 * than a weak check.
 *
 * The honest assertion is `Exact<Call, CallSummary>`, and it would be RED
 * today: `Call` still carries hand-written `parts` (`index` /
 * `starts_at_seconds` / `duration_seconds` / `audio_url`) against a wire that
 * says `idx` / `offset_ms` / `duration_ms` and no url at all, plus local-only
 * fields core/ never sends. Writing a weaker assertion that passes would be
 * worse than none: it would read as protection while proving nothing — the
 * "present and reads as satisfied" failure, imported into the guard whose job
 * is catching exactly that.
 *
 * So the migration comes first — replace the hand-written shapes with the
 * imported ones — and the assertion lands with it, verified red before
 * trusted. The import path is already wired (`@echo/core/wire` in tsconfig
 * `paths`), so that work is now type-checked rather than transcribed.
 */
export const CALL_SHAPE_MATCHES: Exact<Call, CallSummary> = true;

/**
 * The keys, checked separately — because `Exact<>` alone is BLIND HERE and I
 * would rather say so than let the line above read as more than it is.
 *
 * `Exact<>` is mutual assignability, and an interface with an extra OPTIONAL
 * property stays mutually assignable with one that lacks it. So `Call` could
 * grow `owner_display_name?` — invented, unserved, rendering as `undefined` —
 * and the assertion above would still be green. That is precisely the failure
 * this file exists to catch, one level up: a guard that reads as satisfied.
 *
 * Measured, not reasoned: adding a throwaway `temp_probe_field?: string` to
 * `Call` failed THIS line and left `CALL_SHAPE_MATCHES` above it green. Both
 * assertions were seen red before either was trusted.
 *
 * This checks the key SETS instead, with the local-only fields named. Adding a
 * field core/ does not send now fails the build unless it is added to this
 * list, which turns "I invented a field" into a deliberate, reviewed line
 * rather than a silent one. A field core/ ADDS fails it too, from the other
 * direction — that half is what caught nothing for weeks while the wire
 * carried `archived_at` and this codebase did not know.
 */
type LocalOnly = "owner_name" | "org_id" | "parts";
export const CALL_KEYS_MATCH: Exact<Exclude<keyof Call, LocalOnly>, keyof CallSummary> = true;

/**
 * `transcript_timing` is `TranscriptTiming | null` on the wire — the null is
 * ours to model, not core/'s, and is deliberately NOT a member of their array:
 * "none" claims a real prose-only transcript, absent claims nothing at all.
 * So the non-null part must match exactly.
 */
export const TRANSCRIPT_TIMING_MATCHES: Exact<
  TranscriptTiming,
  (typeof TRANSCRIPT_TIMINGS)[number]
> = true;
