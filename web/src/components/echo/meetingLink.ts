/**
 * The ONE decision behind linking a recording to a meeting (0145) —
 * extracted so it can be pinned by a unit test ("a test that is hard to
 * write correctly against the DOM is an argument for extracting the
 * decision, not for trusting it").
 *
 * The baseline is the engine's callId AT ADOPTION TIME. The recording
 * engine is module-level and survives navigation with its last take's id
 * still in hand, so "there is a callId" is NOT evidence this meeting
 * produced it — the review round's worst finding was exactly this: open a
 * due meeting right after an unrelated take and the meeting silently
 * claimed that take as its record, permanently. Only a take that STARTS
 * after adoption (the id changes from the baseline) may be linked.
 */
export function shouldLinkMeeting(
  target: { linked: boolean } | null,
  callId: string | null,
  baselineCallId: string | null,
): boolean {
  if (target === null || target.linked) return false;
  if (callId === null || callId === "") return false;
  return callId !== baselineCallId;
}
