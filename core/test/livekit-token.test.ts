import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { mintRoomToken, roomNameFor, type LiveKitConfig } from "../src/api/livekit.ts";
import type { Identity } from "../src/agent/types.ts";

/**
 * THE TOKEN IS THE WALL, so it gets asserted like one.
 *
 * Under the old room the ADDRESS was the wall: anybody with the link was in.
 * Here a participant arrives with a signed claim naming the room and the
 * person, minted by the server for a meeting the caller had already proved
 * they could open. That is only true if the signature is real, if the claims
 * are the ones we meant, and if the name the client asks about is the name
 * the server signs — the third is a cross-package agreement and the one that
 * fails silently, because two different rooms look exactly like a working
 * call until nobody arrives.
 */
const CONFIG: LiveKitConfig = {
  url: "wss://example.livekit.cloud",
  apiKey: "APIexample",
  apiSecret: "s3cret-for-the-test-only",
};
const IDENTITY = { userId: "u-1", orgId: "o-1" } as unknown as Identity;

function decode(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

describe("a room token", () => {
  it("is signed with the project secret — verifiable, not merely shaped right", () => {
    const { token } = mintRoomToken(CONFIG, IDENTITY, "neurai-abc", "سینا");
    const [header, payload, signature] = token.split(".");
    const expected = createHmac("sha256", CONFIG.apiSecret)
      .update(`${header}.${payload}`)
      .digest("base64url");
    expect(signature).toBe(expected);
    /* the control: the SAME token must not verify under another secret, or
       the assertion above would pass for a signature over anything */
    const wrong = createHmac("sha256", "another-secret")
      .update(`${header}.${payload}`)
      .digest("base64url");
    expect(signature).not.toBe(wrong);
  });

  it("names the room and the person, and grants only what a participant needs", () => {
    const { token } = mintRoomToken(CONFIG, IDENTITY, "neurai-abc", "سینا");
    const claims = decode(token.split(".")[1]!);
    expect(claims.iss).toBe(CONFIG.apiKey);
    expect(claims.sub).toBe("u-1");
    expect(claims.name).toBe("سینا");
    const video = claims.video as Record<string, unknown>;
    expect(video.room).toBe("neurai-abc");
    expect(video.roomJoin).toBe(true);
    /* the NEGATIVE half, and the one that matters: a participant may not
       administer the room or start a recording. A grant nobody asserts
       against is a grant that widens the day somebody copies this. */
    expect(video.roomAdmin).toBeUndefined();
    expect(video.roomRecord).toBeUndefined();
  });

  it("expires", () => {
    const { token, expires_at } = mintRoomToken(CONFIG, IDENTITY, "neurai-abc", "س");
    const claims = decode(token.split(".")[1]!);
    expect(typeof claims.exp).toBe("number");
    expect((claims.exp as number) * 1000).toBeGreaterThan(Date.now());
    expect(new Date(expires_at).getTime()).toBe((claims.exp as number) * 1000);
  });

  it("refuses a room name that could address something else", () => {
    expect(() => mintRoomToken(CONFIG, IDENTITY, "../other-room", "س")).toThrow();
  });

  it("derives the room the way the CLIENT does — the cross-package agreement", () => {
    /*
     * web/src/components/platform/meeting/Room.tsx carries the twin of this
     * line. They are two hand-written beliefs about one name, which is the
     * boundary rule's own warning — so the value is pinned on both sides and
     * the shape is written out here rather than computed, or the test would
     * agree with the code by construction.
     */
    expect(roomNameFor("f53ddbde-5d37-4602-99e3-761b6f559f1b"))
      .toBe("neurai-f53ddbde5d37460299e3761b6f559f1b");
  });
});
