"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { IconCopy, IconOpen } from "@/components/icons";

/**
 * THE VIDEO ROOM, INSIDE OUR OWN BOX.
 *
 * Why this is not Google Meet in an iframe: it cannot be. Google serves
 * meet.google.com with a frame-ancestors policy that names only its own
 * origins, so a browser refuses to render it inside anybody else's page —
 * that is a decision at Google's end and no amount of markup gets past it.
 * A Meet room can only ever be a link that opens a window, which is exactly
 * what the user was looking at when they said they did not want it there.
 *
 * What CAN live inside the box is a room we serve ourselves. This embeds
 * Jitsi Meet, which is built to be embedded — the same shape the reference
 * product uses — and which runs equally well on somebody else's instance or
 * on ours:
 *
 *   NEXT_PUBLIC_MEET_DOMAIN unset  → meet.jit.si, the public instance. It
 *     works today with no infrastructure, and it is a THIRD PARTY: the media
 *     goes through servers we do not run, which is a different promise from
 *     the one this product makes about everything else. That is why the
 *     footer says so on screen rather than only here.
 *   NEXT_PUBLIC_MEET_DOMAIN set    → our own Jitsi, and the sentence in the
 *     footer changes with it, because the claim it makes stops being true
 *     the moment the media stops leaving the building.
 *
 * The room NAME is derived from the meeting id and never guessed: two
 * meetings must not collide, and a name a stranger can guess is a door.
 */
const PUBLIC_INSTANCE = "meet.jit.si";

function domain(): string {
  const configured = process.env.NEXT_PUBLIC_MEET_DOMAIN?.trim();
  return configured !== undefined && configured !== "" ? configured : PUBLIC_INSTANCE;
}

/** ours if the domain was configured; the public instance otherwise */
export function roomIsOurs(): boolean {
  return domain() !== PUBLIC_INSTANCE;
}

/**
 * `neurai-<meeting id>` — long, opaque, and stable across reloads so that
 * everyone who opens this meeting lands in the same room. The id is already
 * a UUID, which is the part a stranger cannot guess.
 */
export function roomName(meetingId: string): string {
  return `neurai-${meetingId.replace(/-/g, "")}`;
}

export function roomUrl(meetingId: string): string {
  return `https://${domain()}/${roomName(meetingId)}`;
}

export function MeetingRoom({ meetingId, displayName, videoUrl }: {
  meetingId: string;
  displayName: string;
  /**
   * An override, when somebody has pointed this meeting at a specific room —
   * a second instance, a self-hosted one on another host. `null` is the
   * normal state and means "the room this meeting owns", derived below.
   *
   * It is EMBEDDED like any other, not opened: the whole point of this
   * component is that the call happens inside the page.
   */
  videoUrl: string | null;
}) {
  const t = useTranslations("meetings");
  const locale = useLocale();
  const [copied, setCopied] = useState(false);
  const frame = useRef<HTMLIFrameElement | null>(null);
  const url = videoUrl !== null && videoUrl.trim() !== "" ? videoUrl.trim() : roomUrl(meetingId);

  /* the copy flash clears itself; the timer is cleaned up so a fast unmount
     does not set state on a gone component */
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  /*
   * The hash carries the display name and turns OFF the pre-join screen:
   * inside our own page the person has already said they are joining by
   * walking into the stage, and a second "are you ready" is a wall in the
   * middle of a room they are looking at.
   */
  const src = `${url}#userInfo.displayName=${encodeURIComponent(displayName)}`
    + `&config.prejoinPageEnabled=false&config.startWithVideoMuted=false`
    + `&interfaceConfig.DEFAULT_BACKGROUND=%22%23111111%22`
    + `&config.defaultLanguage=%22${locale === "en" ? "en" : "fa"}%22`;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-fg/95">
      <iframe
        ref={frame}
        src={src}
        title={t("modeVideo")}
        allow="camera; microphone; fullscreen; display-capture; autoplay; clipboard-write"
        className="min-h-[420px] w-full flex-1 border-0"
      />
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/40 bg-surface px-3 py-2">
        <p className="min-w-0 truncate text-[11px] text-fg-subtle">
          {roomIsOurs() ? t("roomOnOurServer") : t("roomOnPublicInstance")}
        </p>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(url)
                .then(() => setCopied(true))
                .catch(() => undefined);
            }}
            className="tap flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[11px] font-medium text-fg hover:bg-surface-2"
          >
            <IconCopy width={12} height={12} />
            {copied ? t("copied") : t("copyRoom")}
          </button>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="tap flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[11px] font-medium text-fg hover:bg-surface-2"
          >
            <IconOpen width={12} height={12} />
            {t("openRoomOutside")}
          </a>
        </div>
      </div>
    </div>
  );
}
