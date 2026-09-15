"use client";

/**
 * THE MEETING TAB SAYS WHO IT IS, so the recorder can tell whether the person
 * shared the room they are sitting in (user report, 2026-09-07: a colleague's
 * voice "was completely not added to the transcription").
 *
 * The online lane records the microphone plus a shared surface. When the
 * meeting is held in OUR room, the other people's audio is already in this
 * page as real tracks — so the recorder mixes those, and the shared tab would
 * be a second, worse copy of them: a loudspeaker re-recorded through an
 * encoder, arriving a few milliseconds late. Two copies of one voice slightly
 * out of phase sound like a bad room and split into two speakers.
 *
 * Chrome's capture handle is how a captured document tells its capturer what
 * it is. `permittedOrigins: ["*"]` looks broad and is not: the handle is read
 * only by whoever is ALREADY capturing this tab — a permission the person
 * granted in the browser's own dialog — and the value is a constant that
 * identifies the product, never anything about the meeting or the person.
 *
 * The PUBLISHER IS GONE (2026-09-08). The meeting page published this handle
 * while the online lane recorded a shared surface; that lane and the video
 * room it shared went with the live screen's simplification, and every take
 * is a microphone now. `CAPTURE_HANDLE` stays because the recorder still
 * reads it — the Echo recorder can still share a tab — and its check simply
 * never matches this product's own tab any more, which is the answer it
 * gives for every other tab too.
 *
 * Where it is not available (Firefox, Safari, an older Chrome) nothing is
 * published and the recorder reads "not ours", which keeps the behaviour it
 * has always had: the tab is mixed. That is the safe direction — being wrong
 * there costs an echo, and being wrong the other way costs the silence this
 * exists to end.
 */
export const CAPTURE_HANDLE = "neurai-meeting";
