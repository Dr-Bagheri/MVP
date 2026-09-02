import { createHmac } from "node:crypto";
import { ValidationError } from "./errors.ts";
import type { Identity } from "../agent/types.ts";

/**
 * THE VIDEO ROOM'S TOKEN.
 *
 * LiveKit takes an ordinary HS256 JWT signed with the project's API secret,
 * so this mints one with Node's own crypto rather than pulling in a library.
 * The whole format is thirty lines and it is documented; a dependency here
 * would be a supply chain, a version to keep, and an upgrade note, in
 * exchange for a base64 join.
 *
 * WHAT THE TOKEN DECIDES, and why it is minted HERE rather than in the
 * browser: the room name and the identity are the two facts a participant
 * must not be able to choose. A client that signed its own token could join
 * any meeting in the platform by typing a different room into it — which is
 * exactly the wall this replaces, since the room's address was the only wall
 * the Jitsi version had. The secret never leaves the server, and the caller
 * gets a token for the room they were already allowed to open.
 *
 * The grant is deliberately plain: join, publish, subscribe. No recording
 * (the platform records through its own engine, on the person's device), and
 * no room administration — a participant cannot end somebody else's meeting.
 */
const TTL_SECONDS = 60 * 60 * 6;

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export interface LiveKitConfig {
  url: string;
  apiKey: string;
  apiSecret: string;
}

/**
 * Read the configuration, or say plainly that there is none.
 *
 * `null` rather than a throw: a platform with no video configured is a
 * SETTING that is absent, not a fault, and the route above turns it into a
 * named refusal the screen can render. A throw here would reach the browser
 * as an upstream fault and send somebody looking for an outage.
 */
export function livekitConfig(): LiveKitConfig | null {
  const url = process.env.LIVEKIT_URL?.trim() ?? "";
  const apiKey = process.env.LIVEKIT_API_KEY?.trim() ?? "";
  const apiSecret = process.env.LIVEKIT_API_SECRET?.trim() ?? "";
  if (url === "" || apiKey === "" || apiSecret === "") return null;
  return { url, apiKey, apiSecret };
}

export function mintRoomToken(
  config: LiveKitConfig,
  identity: Identity,
  room: string,
  displayName: string,
): { token: string; url: string; expires_at: string } {
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(room)) {
    /* the room name reaches this from a derivation, never from a caller —
       but a name with a slash in it would address a different resource, and
       a validation that only runs when someone is hostile is not one */
    throw new ValidationError("unusable room name", { code: "room_name_invalid" });
  }
  const now = Math.floor(Date.now() / 1000);
  const exp = now + TTL_SECONDS;
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({
    iss: config.apiKey,
    sub: identity.userId,
    /* the NAME shown to other participants. It comes from the identity the
       server resolved, not from the browser: a display name a caller could
       set is a caller who can appear as somebody else. */
    name: displayName,
    nbf: now,
    exp,
    video: {
      room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    },
  }));
  const signature = base64url(
    createHmac("sha256", config.apiSecret).update(`${header}.${payload}`).digest(),
  );
  return {
    token: `${header}.${payload}.${signature}`,
    url: config.url,
    expires_at: new Date(exp * 1000).toISOString(),
  };
}

/**
 * `neurai-<meeting id>` — the same derivation the client uses to name the
 * room it is asking about. Stable across reloads so everyone opening one
 * meeting lands in one room, and unguessable because the id is a UUID.
 */
export function roomNameFor(meetingId: string): string {
  return `neurai-${meetingId.replace(/-/g, "")}`;
}
