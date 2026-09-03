"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  ControlBar,
  GridLayout,
  LiveKitRoom,
  ParticipantTile,
  RoomAudioRenderer,
  useTracks,
} from "@livekit/components-react";
import { clearRoomAudio, publishRoomAudio } from "@/lib/roomAudio";
import { Track } from "livekit-client";
import "@livekit/components-styles";
import { api, BffError } from "@/api/client";
import { IconCopy, IconVideo } from "@/components/icons";

/**
 * THE VIDEO ROOM — LiveKit, rendered as OUR components.
 *
 * The two rooms before this were iframes. Google Meet cannot be one at all
 * (frame-ancestors), and Jitsi can, but then Jitsi draws the interface: its
 * type, its spacing, its colours, inside a product that has spent a month
 * matching one visual system. That was the objection, and no amount of
 * `configOverwrite` reaches it.
 *
 * LiveKit's client is components. The tiles, the grid and the control bar are
 * ordinary React, laid out by our own CSS in our own theme — and there is no
 * pre-join screen to disable, no moderator to wait for and no account to
 * make, because a participant arrives with a TOKEN the server minted for the
 * meeting they were already allowed to open.
 *
 * The token is why the room is safe without a lobby: the room name and the
 * identity are baked into a signature the browser cannot forge. Under Jitsi
 * the address WAS the wall; here the address is just an address.
 */
export function roomName(meetingId: string): string {
  return `neurai-${meetingId.replace(/-/g, "")}`;
}

interface RoomTicket { token: string; url: string; expires_at: string }

function Stage() {
  /* camera and screen share, with the placeholder kept: a participant with
     their camera off is still IN the room, and a grid that dropped them
     would say they had left */
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );
  return (
    <GridLayout tracks={tracks} className="min-h-[420px] flex-1">
      <ParticipantTile />
    </GridLayout>
  );
}

/**
 * THE TAP. Publishes every remote participant's audio track so the recorder
 * can mix the room directly, instead of asking the person to share a tab and
 * stealing the audio off it (see lib/roomAudio.ts).
 *
 * It renders nothing. It lives INSIDE `LiveKitRoom` because that is where the
 * room context is, and it uses the same `useTracks` the grid does — one
 * subscription mechanism, so a track the room considers subscribed is exactly
 * the set that reaches the recording.
 *
 * `onlySubscribed: true` here, unlike the grid: the grid keeps a placeholder
 * for somebody whose camera is off because they are still in the meeting, but
 * a placeholder has no audio to record, and mixing an unsubscribed track
 * would add silence and a participant who is not really on the recording.
 */
function AudioTap() {
  const tracks = useTracks([{ source: Track.Source.Microphone, withPlaceholder: false }],
    { onlySubscribed: true });
  useEffect(() => {
    publishRoomAudio(
      tracks
        /* OURS IS NOT THEIRS: the recorder already captures this device's
           microphone. Mixing our own published track back in would record
           the local speaker twice, slightly out of phase — which sounds
           exactly like a bad room and is actually a bug. */
        .filter((ref) => !ref.participant.isLocal)
        .map((ref) => ref.publication?.track?.mediaStreamTrack)
        .filter((t): t is MediaStreamTrack => t !== undefined),
    );
  }, [tracks]);
  useEffect(() => () => { clearRoomAudio(); }, []);
  return null;
}

export function MeetingRoom({ meetingId }: { meetingId: string }) {
  const t = useTranslations("meetings");
  const [ticket, setTicket] = useState<RoomTicket | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    setFailed(null);
    void api.meetingRoomToken(meetingId)
      .then((t2) => { if (alive) setTicket(t2); })
      .catch((e: unknown) => {
        if (!alive) return;
        /* WHICH refusal: a platform with no video configured is a missing
           setting, not an outage, and telling somebody to try again would
           send them at a wall forever */
        setFailed(e instanceof BffError && e.code === "video_not_configured"
          ? t("videoNotConfigured") : t("roomLoadFailed"));
      });
    return () => { alive = false; };
  }, [meetingId, t]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  if (failed !== null) {
    return (
      <div className="grid min-h-[420px] flex-1 place-items-center bg-fg/95 p-6 text-center">
        <p className="max-w-sm text-sm leading-6 text-bg/80">{failed}</p>
      </div>
    );
  }

  if (ticket === null) {
    return (
      <div className="grid min-h-[420px] flex-1 place-items-center bg-fg/95 p-6 text-center">
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-bg/10 text-bg" aria-hidden>
          <IconVideo width={24} height={24} />
        </span>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-fg/95">
      <LiveKitRoom
        token={ticket.token}
        serverUrl={ticket.url}
        connect
        video
        audio
        /* audit finding, 2026-09-02: the product's LiveKit palette, defined
           once in globals.css. "default" is LiveKit's own — its blue, its
           Latin system font, its 8px corners. Changed here and on the guest's
           join page together: two rooms one click apart must not differ. */
        data-lk-theme="neurai"
        className="flex min-h-0 flex-1 flex-col"
      >
        <Stage />
        <AudioTap />
        <RoomAudioRenderer />
        <ControlBar variation="minimal" />
      </LiveKitRoom>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/40 bg-surface px-3 py-2">
        <p className="min-w-0 truncate text-[11px] text-fg-subtle">{t("roomOnOurServer")}</p>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(window.location.href)
              .then(() => setCopied(true))
              .catch(() => undefined);
          }}
          className="tap flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[11px] font-medium text-fg hover:bg-surface-2"
        >
          <IconCopy width={12} height={12} />
          {copied ? t("copied") : t("copyRoom")}
        </button>
      </div>
    </div>
  );
}
