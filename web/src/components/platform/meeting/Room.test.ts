import { describe, expect, it } from "vitest";
import { roomName } from "./Room";

/**
 * THE ROOM'S NAME, which is the one fact the client and the server must agree
 * on exactly.
 *
 * Under LiveKit the name is not a wall — the token is, and the server derives
 * the name itself when it mints one. But the two derivations have to match or
 * a person is issued a token for a room nobody else is in, which looks
 * exactly like a working call until nobody arrives. Same function, same
 * input, both sides: `core/src/api/livekit.ts` carries the twin.
 */
describe("the meeting's room name", () => {
  it("is the meeting id with its dashes removed", () => {
    expect(roomName("f53ddbde-5d37-4602-99e3-761b6f559f1b"))
      .toBe("neurai-f53ddbde5d37460299e3761b6f559f1b");
  });

  it("is STABLE — the same meeting is the same room, every time", () => {
    const id = "f53ddbde-5d37-4602-99e3-761b6f559f1b";
    expect(roomName(id)).toBe(roomName(id));
  });

  it("gives different meetings different rooms", () => {
    expect(roomName("aaaaaaaa-0000-0000-0000-000000000001"))
      .not.toBe(roomName("aaaaaaaa-0000-0000-0000-000000000002"));
  });
});
