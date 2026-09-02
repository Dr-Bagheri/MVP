import { describe, expect, it } from "vitest";
import { roomName, roomUrl } from "./Room";

/**
 * THE ROOM'S ADDRESS, which is the load-bearing fact about it.
 *
 * Two people in two different rooms looks exactly like a working call until
 * nobody arrives, so the derivation has to be stable — the same meeting must
 * produce the same room on every load, on every device — and it has to be
 * unguessable, which it is because the meeting id is already a UUID.
 *
 * A pure function, tested as one: the embed itself needs a browser and a
 * network, and pinning the address through the component would be testing the
 * hardest part of the system to reach in order to check the easiest.
 */
describe("the meeting's room address", () => {
  it("is derived from the meeting id, dashes stripped", () => {
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

  it("addresses the room on the configured host", () => {
    const url = roomUrl("f53ddbde-5d37-4602-99e3-761b6f559f1b");
    expect(url.startsWith("https://")).toBe(true);
    expect(url.endsWith(roomName("f53ddbde-5d37-4602-99e3-761b6f559f1b"))).toBe(true);
  });
});
