import type { GatewayEvent } from "@/api/types";

/**
 * The event picker's list, and the reason it is a list at all.
 *
 * core/ 400s an unknown event and names the bad value on purpose: an org that
 * subscribed to a typo would receive nothing forever and reasonably conclude
 * the feature is broken. So the picker is fixed and never free text.
 *
 * A fixed list has its own failure, though, and it is quieter than a typo: it
 * can go STALE. core/ adds a fifth event, this array does not, and the picker
 * silently stops offering something the product supports — with no error
 * anywhere, because nothing invalid was ever sent.
 *
 * Hence the assertion below. `types.ts`'s `GatewayEvent` union is already
 * checked against core/'s `WEBHOOK_EVENTS` by `vocabulary.guard.ts` (rule 10),
 * so pinning this array to that union both ways extends the same chain one
 * link further: database → core/ → types.ts → this picker. Adding a value
 * core/ doesn't have, or missing one it does, fails typecheck by name.
 */
export const GATEWAY_EVENTS = [
  "call.created",
  "call.transcribed",
  "call.summarized",
  "call.failed",
] as const;

/** Mutual assignability — one direction alone would miss the omission case. */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
export const GATEWAY_EVENTS_COMPLETE: Exact<GatewayEvent, (typeof GATEWAY_EVENTS)[number]> = true;

/**
 * Wire value → message key, because the wire values contain dots and next-intl
 * reads a dot as a nesting step: `t("event.call.created")` looks for
 * `gateway.event.call.created`, three levels down, and a label that resolves to
 * a missing key renders as the key path. The indirection is one line and the
 * alternative is JSON shaped around a punctuation coincidence.
 *
 * `satisfies Record<GatewayEvent, string>` is the point of the annotation:
 * adding a fifth event to the union without giving it a label stops the build,
 * so an unlabelled event can never reach the picker.
 */
export const EVENT_LABEL_KEY = {
  "call.created": "eventCreated",
  "call.transcribed": "eventTranscribed",
  "call.summarized": "eventSummarized",
  "call.failed": "eventFailed",
} as const satisfies Record<GatewayEvent, string>;
