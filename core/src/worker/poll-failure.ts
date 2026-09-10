/**
 * WHAT A POLLER LOGS WHEN A ROUND FAILS — one shape for the mailbox, the
 * calendar and the bot (2026-09-10).
 *
 * `error_type: "TypeError"` was the whole of the line on 2026-09-08, twice:
 * the Telegram poller calling a method the repo defined and did not export,
 * once a minute, and the mail poller once that evening with nothing beside
 * the word. The class name cannot tell a fetch failure from a missing method
 * from a bad argument, so the Telegram fix added two fields, and this module
 * is that line moved to where all three pollers read it:
 *
 *   cause_code      — undici's ENOTFOUND / ECONNREFUSED / UND_ERR_* family on
 *                     a failed fetch; a code, never content;
 *   provider_status — the status class when a PROVIDER refused (a 401 on a
 *                     stored token is the commonest way a mailbox stops being
 *                     pollable, and it is not a crash);
 *   at              — the first four words of the message, which for a
 *                     TypeError is the callee ("Cannot read properties of")
 *                     and for our own errors the clause that names the step.
 *                     Four, because a provider's error SENTENCE can quote a
 *                     subject line or a calendar entry further along
 *                     (invariant 7): the cut lands where the callee ends and
 *                     the quoting could begin.
 *
 * Never the message whole, never a stack: a stack names paths, which are
 * ours to know and not the log's to carry.
 */
export interface PollFailureFields {
  error_type: string;
  cause_code?: string;
  provider_status?: number;
  at?: string;
}

const AT_WORDS = 4;

export function pollFailureFields(error: unknown): PollFailureFields {
  if (!(error instanceof Error)) return { error_type: typeof error };
  /* the CLASS, as the api's handler names it — `name` is "Error" for every
     subclass that does not set it, and ProviderRefusal does not */
  const fields: PollFailureFields = { error_type: error.constructor?.name || error.name };
  const cause = (error as { cause?: { code?: unknown } }).cause;
  if (typeof cause?.code === "string") fields.cause_code = cause.code;
  const status = (error as { providerStatus?: unknown }).providerStatus;
  if (typeof status === "number") fields.provider_status = status;
  const at = error.message.split(/\s+/).filter(Boolean).slice(0, AT_WORDS).join(" ");
  if (at !== "") fields.at = at;
  return fields;
}
