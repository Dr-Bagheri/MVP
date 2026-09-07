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
 * Where it is not available (Firefox, Safari, an older Chrome) nothing is
 * published and the recorder reads "not ours", which keeps the behaviour it
 * has always had: the tab is mixed. That is the safe direction — being wrong
 * there costs an echo, and being wrong the other way costs the silence this
 * exists to end.
 */
export const CAPTURE_HANDLE = "neurai-meeting";

interface HandleConfig {
  handle: string;
  exposeOrigin: boolean;
  permittedOrigins: string[];
}

type WithHandles = MediaDevices & {
  setCaptureHandleConfig?: (config: HandleConfig) => void;
};

/** publish it; returns a function that takes it back down */
export function publishCaptureHandle(): () => void {
  const devices = navigator.mediaDevices as WithHandles | undefined;
  if (devices?.setCaptureHandleConfig === undefined) return () => undefined;
  try {
    devices.setCaptureHandleConfig({
      handle: CAPTURE_HANDLE,
      exposeOrigin: false,
      permittedOrigins: ["*"],
    });
  } catch {
    /* a browser that has the method and refuses the config is a browser that
       simply cannot answer the question; the recorder's fallback covers it */
    return () => undefined;
  }
  return () => {
    try {
      devices.setCaptureHandleConfig?.({ handle: "", exposeOrigin: false, permittedOrigins: [] });
    } catch { /* leaving it published is harmless — it names the product */ }
  };
}
