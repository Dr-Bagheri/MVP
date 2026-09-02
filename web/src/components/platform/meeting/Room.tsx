"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { IconCopy, IconOpen } from "@/components/icons";

/**
 * THE VIDEO ROOM, INSIDE OUR OWN BOX.
 *
 * Why this is not Google Meet in an iframe: it cannot be. Google serves
 * meet.google.com with a frame-ancestors policy naming only its own origins,
 * so a browser refuses to render it inside anybody else's page. A Meet room
 * can only ever be a link that opens a window.
 *
 * Why it is not a raw iframe either — the first attempt was, and that is what
 * the user was looking at when they said it was not good enough. A plain
 * frame gets Jitsi's PRE-JOIN screen: a name box and a join button, inside a
 * page the person already walked into. The `#config.…` hash meant to turn
 * that off is advisory, and the public instance ignores it.
 *
 * `external_api.js` is the supported embed, and `configOverwrite` is not
 * advisory: the room opens straight into video with the person's own name on
 * it. It also lets us choose the toolbar, and it emits events — leaving is a
 * STATE we can render, rather than a dead frame showing somebody else's
 * "you have left the meeting" page with no way back.
 *
 *   NEXT_PUBLIC_MEET_DOMAIN unset → meet.jit.si, the public instance. Works
 *     with no infrastructure, and it is a THIRD PARTY: media crosses servers
 *     we do not run, which is a different promise from the one this product
 *     makes about everything else. The footer says so on screen.
 *   NEXT_PUBLIC_MEET_DOMAIN set   → our own, and the footer's sentence
 *     changes with it, because the claim stops being true the moment the
 *     media stops leaving the building.
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
 * `neurai-<meeting id>` — long, opaque, and stable across reloads so everyone
 * who opens this meeting lands in the same room. The id is already a UUID,
 * which is the part a stranger cannot guess.
 */
export function roomName(meetingId: string): string {
  return `neurai-${meetingId.replace(/-/g, "")}`;
}

export function roomUrl(meetingId: string): string {
  return `https://${domain()}/${roomName(meetingId)}`;
}

/** the script is fetched ONCE per document, however many rooms mount */
let apiScript: Promise<void> | null = null;
function loadExternalApi(host: string): Promise<void> {
  if (apiScript !== null) return apiScript;
  apiScript = new Promise<void>((resolve, reject) => {
    if (typeof document === "undefined") { reject(new Error("no document")); return; }
    const script = document.createElement("script");
    script.src = `https://${host}/external_api.js`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("external_api.js did not load"));
    document.head.appendChild(script);
  });
  return apiScript;
}

interface JitsiApi {
  dispose: () => void;
  addListener: (event: string, handler: () => void) => void;
}
type JitsiCtor = new (host: string, options: Record<string, unknown>) => JitsiApi;

export function MeetingRoom({ meetingId, displayName, videoUrl }: {
  meetingId: string;
  displayName: string;
  /**
   * An override, when somebody has pointed this meeting at a specific room.
   * `null` is the normal state and means "the room this meeting owns".
   *
   * A custom URL is embedded as a plain frame rather than driven by the API:
   * it may be any provider, and the API only exists for Jitsi.
   */
  videoUrl: string | null;
}) {
  const t = useTranslations("meetings");
  const locale = useLocale();
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const [left, setLeft] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);
  const custom = videoUrl !== null && videoUrl.trim() !== "" ? videoUrl.trim() : null;
  const url = custom ?? roomUrl(meetingId);

  /* the copy flash clears itself; the timer is cleaned up so a fast unmount
     does not set state on a component that is gone */
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    if (custom !== null || left) return;
    let api: JitsiApi | null = null;
    let alive = true;
    const host = domain();
    void loadExternalApi(host)
      .then(() => {
        const Ctor = (window as unknown as { JitsiMeetExternalAPI?: JitsiCtor }).JitsiMeetExternalAPI;
        if (!alive) return;
        if (Ctor === undefined || box.current === null) { setFailed(true); return; }
        box.current.innerHTML = "";
        api = new Ctor(host, {
          roomName: roomName(meetingId),
          parentNode: box.current,
          width: "100%",
          height: "100%",
          userInfo: { displayName },
          configOverwrite: {
            /* the whole reason this is the API and not a frame: a name box
               and a join button, inside a room the person already walked
               into, is a wall in the middle of what they came to see */
            prejoinPageEnabled: false,
            prejoinConfig: { enabled: false },
            startWithVideoMuted: false,
            startWithAudioMuted: false,
            disableDeepLinking: true,
            disableThirdPartyRequests: true,
            defaultLanguage: locale === "en" ? "en" : "fa",
          },
          interfaceConfigOverwrite: {
            MOBILE_APP_PROMO: false,
            SHOW_JITSI_WATERMARK: false,
            SHOW_BRAND_WATERMARK: false,
            SHOW_POWERED_BY: false,
            DISABLE_JOIN_LEAVE_NOTIFICATIONS: true,
            TOOLBAR_BUTTONS: [
              "microphone", "camera", "desktop", "chat", "raisehand",
              "participants-pane", "tileview", "settings", "hangup",
            ],
          },
        });
        api.addListener("videoConferenceLeft", () => { if (alive) setLeft(true); });
        api.addListener("readyToClose", () => { if (alive) setLeft(true); });
      })
      .catch(() => { if (alive) setFailed(true); });
    return () => {
      alive = false;
      api?.dispose();
    };
  }, [meetingId, displayName, locale, custom, left]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-fg/95">
      {custom !== null ? (
        <iframe
          src={custom}
          title={t("modeVideo")}
          allow="camera; microphone; fullscreen; display-capture; autoplay; clipboard-write"
          className="min-h-[420px] w-full flex-1 border-0"
        />
      ) : failed ? (
        <div className="grid min-h-[420px] flex-1 place-items-center p-6 text-center">
          <div>
            <p className="text-sm text-bg/80">{t("roomLoadFailed")}</p>
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="tap mt-3 inline-flex h-10 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-on-accent"
            >
              <IconOpen width={14} height={14} />
              {t("openRoomOutside")}
            </a>
          </div>
        </div>
      ) : left ? (
        /* leaving is a STATE. Without it the box keeps showing Jitsi's own
           "you have left" page, which has no way back into OUR room. */
        <div className="grid min-h-[420px] flex-1 place-items-center p-6 text-center">
          <div>
            <p className="text-sm text-bg/80">{t("roomLeft")}</p>
            <button
              type="button"
              onClick={() => setLeft(false)}
              className="tap mt-3 inline-flex h-10 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-on-accent"
            >
              {t("roomRejoin")}
            </button>
          </div>
        </div>
      ) : (
        <div ref={box} title={t("modeVideo")} className="min-h-[420px] w-full flex-1" />
      )}

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
