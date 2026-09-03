"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import { recorderSnapshot, subscribeRecorder } from "@/lib/recordingEngine";
import type { Call } from "@/api/types";
import { uploadOnePart } from "@/lib/callUpload";
import {
  clearPart,
  clearTake,
  listLeftovers,
  readPartBlob,
  recoveryPlan,
} from "@/lib/takeBuffer";
import { useRefreshEpoch } from "@/lib/refreshBus";
import { Card, Chip } from "@/components/ui";
import { Link } from "@/i18n/routing";
import { formatDate } from "@/lib/format";

/**
 * Front and center on New meeting (user directive, 2026-08-22): the two
 * kinds of unfinished take, above the tabs where starting a NEW one lives —
 * because "continue the one you lost" beats "start again" every time.
 *
 *  - **Resume cards**: calls still in `recording` status — paused, left, or
 *    crashed AFTER their audio reached the server. One click continues them.
 *  - **Recovery card**: audio the crash buffer holds that NEVER reached the
 *    server (the tab died mid-part). Offered as save-to-record / download /
 *    discard; discard is two-step because this may be the only copy.
 */

type RecoveryGroup = ReturnType<typeof recoveryPlan>[number];

export function UnfinishedTakes() {
  const t = useTranslations("capture");
  const locale = useLocale();
  const epoch = useRefreshEpoch("calls");
  /**
   * The engine's live take is `status: "recording"` on the server too —
   * without this it listed ITSELF as "unfinished" beside its own recorder,
   * and a RESUMED take kept reappearing under the same name until finish
   * (user bug report, 2026-08-22). While a take is rolling the whole card
   * stands down: nothing can be resumed mid-take anyway (one take at a
   * time is the engine's rule).
   */
  const engine = useSyncExternalStore(subscribeRecorder, recorderSnapshot, recorderSnapshot);
  const engineBusy =
    engine.phase === "starting" || engine.phase === "recording"
    || engine.phase === "paused" || engine.phase === "finishing";

  const [unfinished, setUnfinished] = useState<Call[]>([]);
  const [recoveries, setRecoveries] = useState<RecoveryGroup[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ callId: string; kind: "saved" | "failed" } | null>(null);
  const [armedDiscard, setArmedDiscard] = useState<string | null>(null);

  const liveCallId = engine.callId;
  const refresh = useCallback(() => {
    void api
      .listCalls({ includeArchived: false })
      .then((calls) =>
        setUnfinished(
          calls
            .filter((c) => c.status === "recording" && c.id !== liveCallId)
            .slice(0, 3),
        ),
      )
      .catch(() => setUnfinished([]));
    void listLeftovers().then((parts) =>
      setRecoveries(recoveryPlan(parts).filter((g) => g.callId !== liveCallId)));
  }, [liveCallId]);

  useEffect(() => {
    refresh();
  }, [refresh, epoch]);

  async function saveRecovery(group: RecoveryGroup): Promise<void> {
    setBusy(group.callId);
    setNote(null);
    try {
      for (const part of group.parts) {
        const blob = await readPartBlob(group.callId, part.partIdx, part.mime);
        if (!blob) {
          await clearPart(group.callId, part.partIdx);
          continue;
        }
        try {
          await uploadOnePart(api, group.callId, {
            idx: part.partIdx,
            offsetMs: part.offsetMs,
            blob,
            contentType: part.mime,
          });
        } catch (err) {
          // a duplicate idx means a previous attempt DID register — the
          // server copy exists, so the local one has no job left
          const status = (err as { status?: number }).status;
          if (status !== 409) throw err;
        }
        await clearPart(group.callId, part.partIdx);
      }
      setNote({ callId: group.callId, kind: "saved" });
      refresh();
    } catch {
      setNote({ callId: group.callId, kind: "failed" });
    } finally {
      setBusy(null);
    }
  }

  async function downloadRecovery(group: RecoveryGroup): Promise<void> {
    for (const part of group.parts) {
      const blob = await readPartBlob(group.callId, part.partIdx, part.mime);
      if (!blob) continue;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const ext = part.mime.includes("mp4") ? "m4a" : "webm";
      a.download = `${group.title || "recording"}-${part.partIdx}.${ext}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }
  }

  async function discardRecovery(group: RecoveryGroup): Promise<void> {
    await clearTake(group.callId);
    setArmedDiscard(null);
    refresh();
  }

  if (engineBusy) return null; // a rolling take: nothing here is actionable
  if (unfinished.length === 0 && recoveries.length === 0) return null;

  return (
    <div className="space-y-4">
      {recoveries.map((group) => (
        <Card key={`rec-${group.callId}`} className="border-warning/40">
          <div className="flex flex-wrap items-center gap-3">
            <Chip tone="warning">{t("recoveryTitle")}</Chip>
            <span className="text-sm font-medium text-fg">
              {group.title || t("untitledCall")}
            </span>
            <span className="text-xs text-fg-muted" dir="ltr">
              {(group.parts.reduce((s, p) => s + p.bytes, 0) / (1024 * 1024)).toFixed(1)} MB
            </span>
          </div>
          <p className="mt-2 text-sm leading-6 text-fg-muted">{t("recoveryBody")}</p>
          {note?.callId === group.callId ? (
            <p
              role="status"
              className={`mt-2 text-sm ${note.kind === "saved" ? "text-success" : "text-danger"}`}
            >
              {note.kind === "saved" ? t("recoverySaved") : t("recoveryFailed")}
            </p>
          ) : null}
          {/* 2026-09-03: three buttons in one row that were drawn three
              different ways — two `.btn` variants pushed to 40px by hand, and
              a third with no `.btn` at all (`tap h-10 rounded-lg`), so the
              quiet one wore an 8px corner beside two 11px ones. All three are
              the theme's control now: `.btn` answers the box, the tone stays
              on the element, and the danger action keeps its quiet ghost
              treatment (`btn text-danger hover:bg-danger/10` — the same shape
              TaskDialogs uses for a destructive choice that is not the
              default). `.btn` composes `.tap`, so the hit area rides along. */}
          <div className="mt-3 flex flex-wrap gap-3">
            <button
              className="btn-primary"
              disabled={busy !== null}
              onClick={() => void saveRecovery(group)}
            >
              {busy === group.callId ? t("recoverySaving") : t("recoverySave")}
            </button>
            <button
              className="btn-secondary"
              onClick={() => void downloadRecovery(group)}
            >
              {t("recoveryDownload")}
            </button>
            <button
              className="btn font-medium text-danger hover:bg-danger/10"
              onClick={() => {
                if (armedDiscard === group.callId) void discardRecovery(group);
                else setArmedDiscard(group.callId);
              }}
            >
              {armedDiscard === group.callId ? t("recoveryDiscardConfirm") : t("recoveryDiscard")}
            </button>
          </div>
        </Card>
      ))}

      {unfinished.length > 0 ? (
        <Card>
          <p className="text-sm font-semibold text-fg">{t("unfinishedTitle")}</p>
          <p className="mt-1 text-sm leading-6 text-fg-muted">{t("unfinishedBody")}</p>
          <ul className="mt-3 space-y-2">
            {unfinished.map((call) => (
              <li
                key={call.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-2"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-fg">
                    {call.title || t("untitledCall")}
                  </span>
                  <span className="block text-xs text-fg-muted">
                    {formatDate(call.started_at, locale)}
                  </span>
                </span>
                <Link
                  href={`/echo/record?resume=${call.id}`}
                  /* 2026-09-03: `.btn` is already inline-flex, already centres
                     its content and already sets the padding and the type —
                     four utilities restating it left this row's button 36px
                     while the recovery card's above it was 40, for one control
                     with one job */
                  className="btn-primary"
                >
                  {t("resumeAction")}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
