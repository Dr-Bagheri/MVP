import { beforeEach, describe, expect, it } from "vitest";
import { readRoomPrefs, ROOM_DEFAULTS, writeRoomPrefs } from "./roomPrefs";

/**
 * The room's two switches (user directive, 2026-09-07: "when they join the
 * default for the video should be off and the mic should be on, and any
 * setting they put should remain through the entire session of the meeting").
 */
beforeEach(() => sessionStorage.clear());

describe("roomPrefs", () => {
  it("opens with the camera OFF and the microphone ON", () => {
    /* THE DIRECTIVE, as a fact a test holds rather than a prop somebody can
       flip back: a room that opens every camera is a room people join with a
       hand over the lens */
    expect(ROOM_DEFAULTS).toEqual({ mic: true, cam: false });
    expect(readRoomPrefs("m-1")).toEqual({ mic: true, cam: false });
  });

  it("remembers what the person chose, per meeting", () => {
    writeRoomPrefs("m-1", { mic: false, cam: true });
    expect(readRoomPrefs("m-1")).toEqual({ mic: false, cam: true });
    /* another meeting is another decision — a camera turned on for a demo
       must not be on for tomorrow's review */
    expect(readRoomPrefs("m-2")).toEqual(ROOM_DEFAULTS);
  });

  it("a half-written value is not half a preference", () => {
    /*
     * `{mic:true}` with no `cam` would read as "camera off because it was
     * stored", which is a different fact from "camera off because nobody has
     * said otherwise" — and only one of them should survive a change to the
     * default. Anything that is not both booleans is nobody's choice.
     */
    sessionStorage.setItem("neurai-room-m-1", JSON.stringify({ mic: true }));
    expect(readRoomPrefs("m-1")).toEqual(ROOM_DEFAULTS);

    sessionStorage.setItem("neurai-room-m-1", "not json at all");
    expect(readRoomPrefs("m-1")).toEqual(ROOM_DEFAULTS);

    sessionStorage.setItem("neurai-room-m-1", JSON.stringify(null));
    expect(readRoomPrefs("m-1")).toEqual(ROOM_DEFAULTS);
  });
});
