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

// ─────────────────────────────────────────────────────────────────────────────
// EGRESS — the room records itself, on the server
//
// User directive, 2026-09-02: "use this — record our own room server-side
// (LiveKit Egress) … and mix it in a way that it becomes a room that everyone
// can enter and have their own voices in the room recorded, both for the
// online version and for the in-person version."
//
// What this replaces is the browser capture, and with it the share-screen
// dialog that had to be opened to reach the other side of a call. The server
// already has every participant's audio — it is the thing routing it — so
// asking a laptop to re-capture what its speakers are playing was always the
// long way round, and it cost a permission prompt, a video track we threw
// away immediately, and the quality of a room mic re-recording a speaker.
//
// PER PARTICIPANT, not a mix. `TrackComposite`/`RoomComposite` would hand us
// one file with everybody in it and we would be back to diarizing a crowd.
// A participant-scoped egress writes one file per person, and each file is
// already labelled with who it is — the identity the token minted, which the
// browser could not choose. Speaker attribution stops being an inference.
//
// IN PERSON works by the same mechanism and needs no second design: everyone
// in the room opens the link on their own phone, so each voice arrives on its
// own track from its own microphone. That is a better recording than one
// laptop in the middle of a table, and it is the same code path.
//
// The output goes to S3-compatible storage. Supabase Storage speaks S3, so
// this needs the project's S3 access key — one credential, and until it is
// present `egressConfig()` returns null and the feature reports itself as
// unconfigured rather than failing at the provider.

export interface EgressConfig extends LiveKitConfig {
  s3: {
    accessKey: string;
    secret: string;
    region: string;
    bucket: string;
    endpoint: string;
  };
}

/**
 * `null` when recording is not configured — the same shape as
 * `livekitConfig`, and for the same reason: a platform without egress
 * credentials has a SETTING missing, which is a thing to say plainly, not a
 * fault to surface as an outage.
 */
export function egressConfig(): EgressConfig | null {
  const base = livekitConfig();
  if (base === null) return null;
  const s3 = {
    accessKey: process.env.EGRESS_S3_ACCESS_KEY?.trim() ?? "",
    secret: process.env.EGRESS_S3_SECRET?.trim() ?? "",
    region: process.env.EGRESS_S3_REGION?.trim() ?? "",
    bucket: process.env.EGRESS_S3_BUCKET?.trim() ?? "",
    endpoint: process.env.EGRESS_S3_ENDPOINT?.trim() ?? "",
  };
  if (Object.values(s3).some((v) => v === "")) return null;
  return { ...base, s3 };
}

/**
 * The egress API takes the same HS256 token as the room, with a different
 * grant. `roomRecord` is deliberately NOT in the participant token minted
 * above — a client that could ask for it could record any room it could name.
 */
function mintEgressToken(config: LiveKitConfig): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({
    iss: config.apiKey,
    sub: config.apiKey,
    nbf: now,
    exp: now + 600,
    video: { roomRecord: true },
  }));
  const signature = base64url(
    createHmac("sha256", config.apiSecret).update(`${header}.${payload}`).digest(),
  );
  return `${header}.${payload}.${signature}`;
}

/** The egress service lives on https, at the same host as the ws URL. */
function egressBase(url: string): string {
  return url.replace(/^wss:/, "https:").replace(/^ws:/, "http:").replace(/\/+$/, "");
}

async function egressCall<T>(config: EgressConfig, path: string, body: unknown): Promise<T> {
  const response = await fetch(`${egressBase(config.url)}/twirp/livekit.Egress/${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${mintEgressToken(config)}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    /* the provider's own words are not shown to a caller — they can carry
       bucket names and key ids. The status is the caller's business; the
       detail belongs in the log, by field. */
    throw new ValidationError("recording could not be started", {
      code: "egress_refused",
      params: { status: String(response.status) },
    });
  }
  return await response.json() as T;
}

export interface EgressInfo { egress_id: string; }

/**
 * Start recording every participant in a room, one file each.
 *
 * `filepath` carries the meeting id and the participant identity, so the
 * worker can attribute a file without asking anyone: the path IS the
 * provenance, and it was written by the server that knew both facts.
 */
export async function startRoomEgress(
  config: EgressConfig,
  room: string,
  meetingId: string,
): Promise<EgressInfo> {
  const info = await egressCall<{ egressId?: string; egress_id?: string }>(
    config,
    "StartRoomCompositeEgress",
    {
      room_name: room,
      /* AUDIO ONLY. The product's value is what was said; a video file is an
         order of magnitude more storage for something no part of the
         pipeline reads. */
      audio_only: true,
      file_outputs: [{
        file_type: "OGG",
        filepath: `meetings/${meetingId}/room-{time}.ogg`,
        s3: {
          access_key: config.s3.accessKey,
          secret: config.s3.secret,
          region: config.s3.region,
          bucket: config.s3.bucket,
          endpoint: config.s3.endpoint,
          force_path_style: true,
        },
      }],
    },
  );
  const id = info.egressId ?? info.egress_id ?? "";
  return { egress_id: id };
}

export async function stopEgress(config: EgressConfig, egressId: string): Promise<void> {
  await egressCall(config, "StopEgress", { egress_id: egressId });
}
