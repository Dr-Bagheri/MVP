"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { CallNote } from "@/api/types";
import { formatClock } from "@/lib/format";
import { notify } from "@/lib/notify";

/**
 * The notebook beside the recorder (redesigned 2026-08-22 after the user's
 * verdict on v1: "make it like real … a notebook page with a chapter or a
 * title in it and a big text box … both title and text in one place and it
 * realize the title itself").
 *
 * ONE ruled page, one big box, one rule the writer never has to think
 * about: **the first line of a multi-line entry IS the chapter title** —
 * it is saved as a chapter (marked on the waveform) and the rest as the
 * note. A single-line entry is just a note. No second input, no mode
 * switch; write the way you'd write on paper.
 *
 * Entries write to the server immediately (they must survive the tab,
 * like the audio does) and render from what came BACK — the server's row
 * is the record, not the draft that produced it.
 */

/** The split rule, exported for its test: title-and-body, or just a note. */
export function splitEntry(raw: string): { title: string | null; body: string } {
  const text = raw.replace(/\r\n/g, "\n").trim();
  const lines = text.split("\n");
  const first = (lines[0] ?? "").trim();
  const rest = lines.slice(1).join("\n").trim();
  // a title reads like a title: short, and followed by MORE writing —
  // a lone line or a long opening sentence is a note, not a heading
  if (rest && first && first.length <= 80) return { title: first, body: rest };
  return { title: null, body: text };
}

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
  const [busy, setBusy] = useState(false);

  async function add(): Promise<void> {
    const { title, body } = splitEntry(draft);
    if ((!title && !body) || busy) return;
    setBusy(true);
    const stamp = atMs;
    try {
      const saved: CallNote[] = [];
      if (title) {
        saved.push(await api.addCallNote(callId, { kind: "chapter", at_ms: stamp, body: title }));
        onChapter?.(stamp);
      }
      if (body) {
        saved.push(await api.addCallNote(callId, { kind: "note", at_ms: stamp, body }));
      }
      setEntries((prev) => [...prev, ...saved]);
      setDraft("");
    } catch {
      notify(t("noteFailed"), "warn");
    } finally {
      setBusy(false);
    }
  }

  /* the ruled paper: one repeating hairline per text row, drawn from the
     theme's own border token so the page belongs to the card it sits on —
     no boxed-off different background (the user's exact complaint) */
  const ruled: React.CSSProperties = {
    backgroundImage:
      "repeating-linear-gradient(to bottom, transparent, transparent calc(1.75rem - 1px), rgb(var(--border) / 0.55) calc(1.75rem - 1px), rgb(var(--border) / 0.55) 1.75rem)",
    lineHeight: "1.75rem",
  };

  return (
    <div className="flex h-full flex-col">
      <p className="text-xs font-semibold text-fg-subtle">{t("notesTitle")}</p>

      {entries.length > 0 ? (
        <div className="mt-2 max-h-44 overflow-y-auto pe-1" style={ruled}>
          {entries.map((entry) => (
            <p key={entry.id} dir="auto" style={{ lineHeight: "1.75rem" }}>
              {entry.kind === "chapter" ? (
                <span className="font-bold text-fg">
                  {entry.body}
                  <span className="ltr ms-2 text-xs font-normal text-fg-subtle">
                    {formatClock(Math.floor((entry.at_ms ?? 0) / 1000), locale)}
                  </span>
                </span>
              ) : (
                <span className="whitespace-pre-wrap text-sm text-fg">{entry.body}</span>
              )}
            </p>
          ))}
        </div>
      ) : null}

      <textarea
        dir="auto"
        className="mt-2 min-h-44 w-full flex-1 resize-none border-0 bg-transparent p-0 text-sm text-fg outline-none placeholder:text-fg-subtle/60"
        style={ruled}
        placeholder={t("notebookPlaceholder")}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void add();
        }}
      />

      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          className="btn-secondary h-9 px-4 text-sm"
          disabled={busy || draft.trim() === ""}
          onClick={() => void add()}
        >
          {t("notebookAdd")}
        </button>
        <span className="text-[11px] leading-4 text-fg-subtle">{t("notebookHint")}</span>
      </div>
    </div>
  );
}
