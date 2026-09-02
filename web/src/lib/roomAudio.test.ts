import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearRoomAudio, onRoomAudio, publishRoomAudio, roomAudioTracks } from "./roomAudio";

/**
 * The recorder mixes what this module publishes, so every property here is a
 * property of the RECORDING — and each failure mode is silent in the worst
 * way: the take still exists, still plays, and is simply missing a person.
 */

const track = (id: string, state: "live" | "ended" = "live") =>
  ({ id, readyState: state }) as unknown as MediaStreamTrack;

beforeEach(() => { clearRoomAudio(); });

describe("roomAudio", () => {
  it("hands a new subscriber the people ALREADY in the room", () => {
    /*
     * The ordinary case, and the one a fire-on-next-change bus gets wrong:
     * recording starts AFTER people have joined. A subscriber that only
     * learned about the next change would mix nobody who was already there
     * and nothing would look broken.
     */
    publishRoomAudio([track("a"), track("b")]);
    const seen = vi.fn();
    onRoomAudio(seen);
    expect(seen).toHaveBeenCalledWith([expect.objectContaining({ id: "a" }),
      expect.objectContaining({ id: "b" })]);
  });

  it("tells a subscriber about somebody who joins later", () => {
    const seen = vi.fn();
    onRoomAudio(seen);
    seen.mockClear();
    publishRoomAudio([track("late")]);
    expect(seen).toHaveBeenCalledWith([expect.objectContaining({ id: "late" })]);
  });

  it("stays quiet when the set has not changed", () => {
    /*
     * A React effect re-publishes on every render. Without this, each render
     * would look like a change and the engine would connect the same track to
     * its mix again — the same voice added twice, slightly louder, which
     * sounds like a bad room rather than like a bug.
     */
    const a = track("a");
    publishRoomAudio([a]);
    const seen = vi.fn();
    onRoomAudio(seen);
    seen.mockClear();
    publishRoomAudio([a]);
    expect(seen).not.toHaveBeenCalled();
  });

  it("drops a track that has already ended", () => {
    publishRoomAudio([track("live-one"), track("gone", "ended")]);
    expect(roomAudioTracks().map((t) => t.id)).toEqual(["live-one"]);
  });

  it("reports an emptied room, rather than treating it as no change", () => {
    /* leaving is a change: after everyone goes, the mix is this device only,
       and the screen says so — a bus that swallowed it would keep claiming
       voices that are gone */
    publishRoomAudio([track("a")]);
    const seen = vi.fn();
    onRoomAudio(seen);
    seen.mockClear();
    clearRoomAudio();
    expect(seen).toHaveBeenCalledWith([]);
  });

  it("stops delivering after unsubscribe", () => {
    const seen = vi.fn();
    const off = onRoomAudio(seen);
    off();
    seen.mockClear();
    publishRoomAudio([track("a")]);
    expect(seen).not.toHaveBeenCalled();
  });
});
