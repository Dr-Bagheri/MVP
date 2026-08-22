"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { CallNote } from "@/api/types";
import { formatClock } from "@/lib/format";
import { notify } from "@/lib/notify";

/**
 * The notes pad beside the recorder (user directive, 2026-08-22): while a
 * take rolls, a thought lands HERE instead of interrupting the meeting —
 * each entry stamped with the take's clock at the moment it was sent.
 * Chapters are the same gesture with a different meaning: a NAME for the
 * stretch that starts now.
 *
 * Entries write to the server immediately (they must survive the tab, like
 * the audio does) and the session's list renders from what came BACK — the
 * server's row is the record, not the draft that produced it.
 */
export function RecorderNotes({
  callId,
  atMs,
  onChapter,
}: {
  callId: string;
  /** the take's RECORDED clock right now — the stamp for new entries */
  atMs: number;
  /** lets the recorder drop a marker on its waveform timeline */
  onChapter?: (atMs: number) => void;
}) {
  const t = useTranslations("capture");
  const locale = useLocale();
  const [entries, setEntries] = useState<CallNote[]>([]);
  const [draft, setDraft] = useState("");
  const [chapterDraft, setChapterDraft] = useState("");
  const [busy, setBusy] = useState(false);

  async function add(kind: "note" | "chapter"): Promise<void> {
    const body = (kind === "note" ? draft : chapterDraft).trim();
    if (body === "" || busy) return;
    setBusy(true);
    const stamp = atMs;
    try {
      const note = await api.addCallNote(callId, { kind, at_ms: stamp, body });
      setEntries((prev) => [...prev, note]);
      if (kind === "note") setDraft("");
      else {
        setChapterDraft("");
        onChapter?.(stamp);
      }
    } catch {
      notify(t("noteFailed"), "warn");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col rounded-lg border border-border bg-surface p-3">
      <p className="text-xs font-semibold text-fg-subtle">{t("notesTitle")}</p>

      <div className="mt-2 min-h-16 flex-1 space-y-1.5 overflow-y-auto">
        {entries.length === 0 ? (
          <p className="text-xs leading-6 text-fg-muted">{t("notesEmpty")}</p>
        ) : (
          entries.map((entry) => (
            <p key={entry.id} className="text-xs leading-6 text-fg" dir="auto">
              <span className="ltr me-2 text-fg-subtle">
                {formatClock(Math.floor((entry.at_ms ?? 0) / 1000), locale)}
              </span>
              {entry.kind === "chapter" ? (
                <span className="me-1 rounded bg-accent-soft px-1 py-0.5 text-[10px] font-semibold text-accent">
                  {t("chapterChip")}
                </span>
              ) : null}
              {entry.body}
            </p>
          ))
        )}
      </div>

      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => { e.preventDefault(); void add("note"); }}
      >
        <input
          className="input h-9 flex-1 text-sm"
          placeholder={t("notesPlaceholder")}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button
          type="submit"
          className="btn-secondary h-9 px-3 text-sm"
          disabled={busy || draft.trim() === ""}
        >
          {t("noteAdd")}
        </button>
      </form>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => { e.preventDefault(); void add("chapter"); }}
      >
        <input
          className="input h-9 flex-1 text-sm"
          placeholder={t("chapterPlaceholder")}
          value={chapterDraft}
          onChange={(e) => setChapterDraft(e.target.value)}
        />
        <button
          type="submit"
          className="btn-secondary h-9 px-3 text-sm"
          disabled={busy || chapterDraft.trim() === ""}
        >
          {t("chapterAdd")}
        </button>
      </form>
    </div>
  );
}
