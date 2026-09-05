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
          className="btn-secondary"
          disabled={busy || draft.trim() === ""}
          onClick={() => void add()}
        >
          {t("notebookAdd")}
        </button>
      </div>
    </div>
  );
}

/**
 * The ACTION-ITEMS panel (the reference recorder's right card; user
 * directive, 2026-08-26). It IS the agenda, relocated out of the notebook:
 * pending items live in client state — a plan is a draft — and ticking one
 * is the event worth keeping: it persists as a stamped «✓ item» chapter,
 * anchoring the transcript at the moment the topic was covered, and drops
 * a marker on the wave.
 */
export function AgendaPanel({
  callId,
  atMs,
  onChapter,
}: {
  /** null before the take exists — items can be planned, not yet ticked */
  callId: string | null;
  atMs: number;
  onChapter?: (atMs: number) => void;
}) {
  const t = useTranslations("capture");
  const [items, setItems] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  async function tick(index: number): Promise<void> {
    const item = items[index];
    if (!item || busy || callId === null) return;
    setBusy(true);
    const stamp = atMs;
    try {
      await api.addCallNote(callId!, { kind: "chapter", at_ms: stamp, body: `✓ ${item}` });
      onChapter?.(stamp);
      setItems((prev) => prev.filter((_, i) => i !== index));
    } catch {
      notify(t("noteFailed"), "warn");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="well p-3">
      <p className="text-sm font-semibold text-fg">{t("agendaTitle")}</p>
      {items.length > 0 ? (
        /* the measured Otter/Fireflies anatomy: bare rows on a ~40px
           pitch, no box around each item — the checkbox IS the row's
           chrome */
        <ul className="mt-1">
          {items.map((item, i) => (
            <li
              key={`${item}-${i}`}
              className="flex min-h-10 items-center gap-2.5 text-sm text-fg"
            >
              <input
                type="checkbox"
                checked={false}
                disabled={busy || callId === null}
                aria-label={t("agendaTick", { item })}
                onChange={() => void tick(i)}
              />
              <span className="min-w-0 flex-1 truncate">{item}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {/* the ghost add-row (Otter's «＋ Add action item»): an input wearing
          placeholder gray, no field chrome until it holds text */}
      <input
        dir="auto"
        className="mt-1 h-9 w-full border-0 bg-transparent p-0 text-sm text-fg outline-none placeholder:text-fg-subtle"
        placeholder={`＋ ${t("agendaPlaceholder")}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && draft.trim()) {
            setItems((prev) => [...prev, draft.trim()]);
            setDraft("");
          }
        }}
      />
    </div>
  );
}
