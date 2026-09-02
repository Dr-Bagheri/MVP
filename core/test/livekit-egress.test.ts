import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { egressConfig, mintRoomToken, roomNameFor } from "../src/api/livekit.ts";

/**
 * The recording path's two facts worth asserting: the participant token must
 * NOT carry the recording grant, and the configuration must report itself
 * absent rather than half-present.
 */
const ENV_KEYS = [
  "LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET",
  "EGRESS_S3_ACCESS_KEY", "EGRESS_S3_SECRET", "EGRESS_S3_REGION",
  "EGRESS_S3_BUCKET", "EGRESS_S3_ENDPOINT",
] as const;

const FULL: Record<string, string> = {
  LIVEKIT_URL: "wss://example.livekit.cloud",
  LIVEKIT_API_KEY: "APIprobe",
  LIVEKIT_API_SECRET: "s3cr3t-probe-value",
  EGRESS_S3_ACCESS_KEY: "AKIAPROBE",
  EGRESS_S3_SECRET: "probe-secret",
  EGRESS_S3_REGION: "eu-central-1",
  EGRESS_S3_BUCKET: "call-audio",
  EGRESS_S3_ENDPOINT: "https://example.supabase.co/storage/v1/s3",
};

function setEnv(values: Record<string, string | undefined>): void {
  for (const key of ENV_KEYS) {
    const v = values[key];
    if (v === undefined) delete process.env[key];
    else process.env[key] = v;
  }
}

afterEach(() => setEnv({}));

describe("egress configuration", () => {
  it("is present only when EVERY value is", () => {
    setEnv(FULL);
    expect(egressConfig()).not.toBeNull();
  });

  it("reports ABSENT when any single value is missing — never half-configured", () => {
    /*
     * The load-bearing case. A config that returned a partial object would
     * reach the provider and fail there, and the screen would show a
     * transport error for what is really an unset setting — the wrong kind
     * of nothing, delivered by the layer that knew better.
     *
     * Every key is dropped in turn rather than one: a check that only ever
     * removes the first value proves nothing about the eighth.
     */
    for (const key of ENV_KEYS) {
      setEnv({ ...FULL, [key]: undefined });
      expect(egressConfig(), `${key} missing should make the whole config absent`).toBeNull();
    }
  });
});

describe("the participant token", () => {
  it("does NOT carry the recording grant", () => {
    /*
     * The wall. `roomRecord` is minted only for the server's own egress
     * calls; a participant token carrying it would let anyone who could join
     * a room start recording it — and a recording nobody in the room asked
     * for is the exact failure this separation exists to make impossible.
     */
    setEnv(FULL);
    const { token } = mintRoomToken(
      { url: FULL.LIVEKIT_URL!, apiKey: FULL.LIVEKIT_API_KEY!, apiSecret: FULL.LIVEKIT_API_SECRET! },
      { userId: "11111111-1111-4111-8111-111111111111" } as never,
      roomNameFor("22222222-2222-4222-8222-222222222222"),
      "کاربر",
    );
    const claims = JSON.parse(
      Buffer.from(token.split(".")[1]!, "base64url").toString("utf8"),
    ) as { video: Record<string, unknown> };
    expect(claims.video.roomRecord).toBeUndefined();
    expect(claims.video.roomAdmin).toBeUndefined();
    /* and the control: the grants it SHOULD carry are there, so the
       assertion above is about an absent key rather than an absent claim */
    expect(claims.video.roomJoin).toBe(true);
    expect(claims.video.canPublish).toBe(true);
  });

  it("is signed with the secret, and a wrong secret does not verify", () => {
    setEnv(FULL);
    const { token } = mintRoomToken(
      { url: FULL.LIVEKIT_URL!, apiKey: FULL.LIVEKIT_API_KEY!, apiSecret: FULL.LIVEKIT_API_SECRET! },
      { userId: "11111111-1111-4111-8111-111111111111" } as never,
      roomNameFor("22222222-2222-4222-8222-222222222222"),
      "کاربر",
    );
    const [header, payload, signature] = token.split(".");
    const recompute = (secret: string): string =>
      createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
    expect(recompute(FULL.LIVEKIT_API_SECRET!)).toBe(signature);
    expect(recompute("not-the-secret")).not.toBe(signature);
  });
});
