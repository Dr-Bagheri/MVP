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
  CallStatus,
  GatewayEvent,
  PartStatus,
  TranscriptTiming,
} from "./types";
import {
  CALL_STATUSES,
  PART_STATUSES,
  TRANSCRIPT_TIMINGS,
  WEBHOOK_EVENTS,
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
 * `transcript_timing` is `TranscriptTiming | null` on the wire — the null is
 * ours to model, not core/'s, and is deliberately NOT a member of their array:
 * "none" claims a real prose-only transcript, absent claims nothing at all.
 * So the non-null part must match exactly.
 */
export const TRANSCRIPT_TIMING_MATCHES: Exact<
  TranscriptTiming,
  (typeof TRANSCRIPT_TIMINGS)[number]
> = true;
