"use client";

/**
 * WHAT A PERSON CHOSE IN THE ROOM, FOR AS LONG AS THE MEETING LASTS (user
 * directive, 2026-09-07: "when they join the default for the video should be
 * off and the mic should be on, and any setting they put should remain
 * through the entire session of the meeting when they are changing pages or
 * go from video to whiteboard and coming back").
 *
 * Two halves, and only one of them lives here. Switching between the video
 * and the whiteboard no longer unmounts the room at all — that was the fix
 * for the reconnect, and it is why a mode switch cannot lose a device choice
 * any more. This module answers the OTHER half: leaving the meeting page and
 * coming back rebuilds the whole component tree, and a camera that switched
 * itself on again there would be a camera the person turned off twice.
 *
 * `sessionStorage`, deliberately, and it is the reason the wording is "the
 * session": it survives navigation and a reload in this tab, and it is gone
 * when the tab is — which is the right lifetime for a decision about a
 * meeting somebody is sitting in. A `localStorage` copy would still be
 * turning their camera on for a meeting six weeks later.
 *
 * THE DEFAULTS ARE THE DIRECTIVE: camera OFF, microphone ON. A room that
 * opens every camera is a room people join with a hand over the lens.
 */

export interface RoomPrefs {
  /** the microphone starts ON — a meeting is for talking */
  mic: boolean;
  /** the camera starts OFF — nobody has agreed to be seen yet */
  cam: boolean;
}

export const ROOM_DEFAULTS: RoomPrefs = { mic: true, cam: false };

function key(meetingId: string): string {
  return `neurai-room-${meetingId}`;
}

/**
 * What this tab last knew about this meeting's devices, or the defaults.
 *
 * A malformed or partial stored value yields the DEFAULTS rather than half a
 * preference: `{mic: true}` with no `cam` must not read as "camera off
 * because it was stored", which is a different fact from "camera off because
 * nobody has said otherwise" — and only one of them should survive a change
 * to the default.
 */
export function readRoomPrefs(meetingId: string): RoomPrefs {
  try {
    const raw = sessionStorage.getItem(key(meetingId));
    if (raw === null) return ROOM_DEFAULTS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return ROOM_DEFAULTS;
    const { mic, cam } = parsed as Partial<RoomPrefs>;
    if (typeof mic !== "boolean" || typeof cam !== "boolean") return ROOM_DEFAULTS;
    return { mic, cam };
  } catch {
    /* a private window, or storage the browser refuses: the defaults are a
       correct answer here, and throwing would take the room down with it */
    return ROOM_DEFAULTS;
  }
}

export function writeRoomPrefs(meetingId: string, prefs: RoomPrefs): void {
  try {
    sessionStorage.setItem(key(meetingId), JSON.stringify(prefs));
  } catch {
    /* the room works without the memory; it just forgets */
  }
}
