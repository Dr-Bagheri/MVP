"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
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

  const [unfinished, setUnfinished] = useState<Call[]>([]);
  const [recoveries, setRecoveries] = useState<RecoveryGroup[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ callId: string; kind: "saved" | "failed" } | null>(null);
  const [armedDiscard, setArmedDiscard] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void api
      .listCalls({ includeArchived: false })
      .then((calls) =>
        setUnfinished(calls.filter((c) => c.status === "recording").slice(0, 3)),
      )
      .catch(() => setUnfinished([]));
    void listLeftovers().then((parts) => setRecoveries(recoveryPlan(parts)));
  }, []);

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
          <div className="mt-3 flex flex-wrap gap-3">
            <button
              className="btn-primary h-10 px-4"
              disabled={busy !== null}
              onClick={() => void saveRecovery(group)}
            >
              {busy === group.callId ? t("recoverySaving") : t("recoverySave")}
            </button>
            <button
              className="btn-secondary h-10 px-4"
              onClick={() => void downloadRecovery(group)}
            >
              {t("recoveryDownload")}
            </button>
            <button
              className="tap h-10 rounded-lg px-4 text-sm text-danger hover:bg-danger/10"
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
                  className="btn-primary inline-flex h-9 items-center px-4 text-sm"
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
