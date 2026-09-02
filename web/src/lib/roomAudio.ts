/**
 * THE ROOM'S VOICES, without asking the browser to film the screen.
 *
 * User directive, 2026-09-02: "why we still using the fake call for
 * captureing the online voices i though we fix that — fix it or gave me
 * option to fix it … get the voice from online in web room from everyone
 * without faking".
 *
 * The fake was `getDisplayMedia`: to record an online meeting the recorder
 * asked to SHARE A TAB, took the audio, and threw the video away. It works,
 * and it is a lie in three directions — the person is asked for a permission
 * the feature does not want, Chrome puts a "sharing" banner over the meeting,
 * and what gets recorded is whatever that tab happens to play rather than
 * whoever is actually in the room.
 *
 * The honest source was already in the page. Every remote participant's audio
 * arrives here as a real `MediaStreamTrack` — that is how you can hear them —
 * so the recorder can mix those tracks directly. No picker, no banner, no
 * second permission, and no server credential: the tracks are already
 * subscribed, we are only tapping what the room delivered.
 *
 * WHY A MODULE SINGLETON rather than a prop. The recording engine is itself a
 * module singleton that outlives navigation (that is the whole reason a take
 * survives leaving the page), so a React prop cannot reach it. The room
 * publishes here; the engine reads here. It is the same shape as
 * `recorderSnapshot`, for the same reason.
 *
 * LATE JOINERS ARE THE POINT. Somebody who joins ten minutes in must be on
 * the recording, so this is a SUBSCRIPTION and not a getter: the engine
 * connects each new track to its mix as it arrives, rather than sampling the
 * room once at the start and silently recording an outdated cast.
 */

type Listener = (tracks: MediaStreamTrack[]) => void;

let current: MediaStreamTrack[] = [];
const listeners = new Set<Listener>();

/** Live audio tracks from the room, excluding our own microphone. */
export function roomAudioTracks(): MediaStreamTrack[] {
  return [...current];
}

/**
 * Replace the published set. Called by the room component whenever
 * subscriptions change; a no-op when the set is unchanged, so a re-render
 * does not restart anybody's mix.
 */
export function publishRoomAudio(tracks: MediaStreamTrack[]): void {
  const next = tracks.filter((t) => t.readyState === "live");
  const same = next.length === current.length
    && next.every((t, i) => current[i] === t);
  if (same) return;
  current = next;
  for (const listener of listeners) listener([...next]);
}

/** Called when the room disconnects — the room is empty, not unchanged. */
export function clearRoomAudio(): void {
  if (current.length === 0) return;
  current = [];
  for (const listener of listeners) listener([]);
}

/**
 * Subscribe. Fires IMMEDIATELY with the current set, because a subscriber
 * that only learns about the next change would miss everybody already in the
 * room — the ordinary case, since recording usually starts after people
 * arrive.
 */
export function onRoomAudio(listener: Listener): () => void {
  listeners.add(listener);
  listener([...current]);
  return () => { listeners.delete(listener); };
}
