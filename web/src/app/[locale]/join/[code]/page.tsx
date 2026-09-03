"use client";

import { use, useState } from "react";
import { useTranslations } from "next-intl";
import {
  ControlBar,
  GridLayout,
  LiveKitRoom,
  ParticipantTile,
  RoomAudioRenderer,
  useTracks,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import "@livekit/components-styles";
import { IconVideo } from "@/components/icons";

/**
 * THE GUEST'S WHOLE EXPERIENCE (user directive, 2026-09-02: "how should
 * anyone from outside come to the online meeting").
 *
 * Deliberately outside the platform shell: no rail, no top bar, no
 * breadcrumb, no assistant. Every one of those is a door into a product this
 * person has no account in, and offering doors that refuse is worse than
 * offering none. What a guest gets is one screen — the meeting's name, a box
 * for what to call them, and the room.
 *
 * The code in the URL is the authorisation and the only one there is. Nothing
 * on this page reads a session, because there is none to read.
 */
function Stage() {
  const tracks = useTracks(
    [{ source: Track.Source.Camera, withPlaceholder: true },
     { source: Track.Source.ScreenShare, withPlaceholder: false }],
    { onlySubscribed: false },
  );
  return (
    <GridLayout tracks={tracks} className="min-h-0 flex-1">
      <ParticipantTile />
    </GridLayout>
  );
}

export default function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const t = useTranslations("meetings");
  const tCommon = useTranslations("common");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ticket, setTicket] = useState<{ title: string; token: string; url: string } | null>(null);

  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/join/${encodeURIComponent(code)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!response.ok) {
        /* an unknown code and a revoked one answer the same way on purpose —
           "this link used to work" tells a stranger there is something here */
        setError(t("joinRefused"));
        return;
      }
      setTicket(await response.json() as { title: string; token: string; url: string });
    } catch {
      setError(t("joinRefused"));
    } finally {
      setBusy(false);
    }
  };

  if (ticket !== null) {
    return (
      <div className="flex h-dvh min-h-0 flex-col bg-fg/95">
        <p className="shrink-0 truncate bg-surface px-4 py-2 text-sm font-semibold text-fg">
          {ticket.title}
        </p>
        <LiveKitRoom
          token={ticket.token}
          serverUrl={ticket.url}
          connect
          video
          audio
          /* audit finding, 2026-09-02: "default" is LIVEKIT's palette — its
             blue, its Latin system font, its 8px corners — and it was the
             only thing declaring the `--lk-*` variables the room's own
             controls read, so the guest met the stock kit one click after a
             screen wearing ours. The named theme is defined once in
             globals.css; LiveKit's generic `[data-lk-theme]` rules still
             apply, its `[data-lk-theme=default]` palette no longer does. */
          data-lk-theme="neurai"
          className="flex min-h-0 flex-1 flex-col"
        >
          <Stage />
          <RoomAudioRenderer />
          <ControlBar variation="minimal" />
        </LiveKitRoom>
      </div>
    );
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-bg p-6">
      <div className="w-full max-w-sm">
        <div className="card">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-accent-soft text-accent" aria-hidden>
            <IconVideo width={24} height={24} />
          </span>
          <h1 className="mt-4 text-page-title font-bold text-fg">{t("joinTitle")}</h1>
          <p className="mt-1 text-xs leading-6 text-fg-muted">{t("joinHint")}</p>

          <label className="mt-4 block">
            <span className="mb-1.5 block text-xs text-fg-muted">{t("joinName")}</span>
            <input
              autoFocus
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && name.trim() !== "") void join(); }}
            />
          </label>

          {error !== null ? (
            <p role="alert" className="mt-3 text-xs text-danger">{error}</p>
          ) : null}

          <button
            type="button"
            className="btn-primary mt-4 w-full"
            disabled={busy || name.trim() === ""}
            onClick={() => void join()}
          >
            {busy ? tCommon("loading") : t("joinAction")}
          </button>
        </div>
      </div>
    </div>
  );
}
