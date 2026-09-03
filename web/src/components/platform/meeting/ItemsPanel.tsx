"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/api/client";
import { MEETING_ITEM_KINDS, type MeetingItem, type MeetingItemKind } from "@/api/types";
import { IconCheck, IconClose, IconPencil, IconPlus, IconSparkle, IconTrash } from "@/components/icons";
import { ConfirmDialog } from "@/components/rowActions";
import { Skeleton } from "@/components/scaffold";
import { digits, formatClock } from "@/lib/format";

/**
 * مصوبات / اکشن‌آیتم‌ها / سؤالات / ریسک‌ها / موجودیت‌ها — the five lists a
 * meeting produces, and the surface the user asked for on 2026-09-02: "make
 * it like this that user can add edit and remove them — it does not need for
 * AI to make them, the AI can add it as well like the user if its asked to".
 *
 * WHY THIS REPLACED A READER. Until 0160 these panels were slices of the
 * SUMMARY'S PROSE: parse the body, match headings, render the paragraphs.
 * That is why they were empty on the screenshot that prompted this — a
 * summary only exists once a recording has been processed, so before that
 * there was nothing to slice and no way to write anything down. And it is
 * why they could never have had an edit button: "remove this action item"
 * against a paragraph means rewriting a model's text and hoping the headings
 * still line up.
 *
 * THE BADGE IS A FACT. `source` is pinned by the writing ROLE in the
 * database — echo_app can only ever write 'user', echo_agent can only ever
 * write 'ai', and echo_agent holds INSERT and nothing else. So the sparkle on
 * a row is not a flag somebody set, and no assistant can edit or remove a
 * line a person wrote. The screen states that plainly because the GRANT, not
 * a prompt, is what makes it true.
 *
 * The TIME on a row is nullable and that is load-bearing: null means a person
 * typed it, which is a different thing from "at zero". Only a row that came
 * from the recording offers to play from its moment.
 */

const EMPTY: Record<MeetingItemKind, MeetingItem[]> = {
  decision: [], action: [], question: [], risk: [], entity: [],
};

function group(rows: MeetingItem[]): Record<MeetingItemKind, MeetingItem[]> {
  const out: Record<MeetingItemKind, MeetingItem[]> = {
    decision: [], action: [], question: [], risk: [], entity: [],
  };
  for (const row of rows) out[row.kind].push(row);
  return out;
}

export function ItemsPanel({ meetingId, callId, onSeek, locale }: {
  meetingId: string;
  /** the meeting's recording, when it has one — a task made from an action
      item points at the call it came from, so the board can lead back */
  callId?: string | null;
  /** a row that came from the recording can play from its moment */
  onSeek?: (ms: number) => void;
  locale: string;
}) {
  const t = useTranslations("meetings");
  const [rows, setRows] = useState<MeetingItem[] | null | "failed">(null);
  const [kind, setKind] = useState<MeetingItemKind>("decision");
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  /* the platform's one dialog stands between the pencil's neighbour and an
     unrecoverable line — a decision somebody typed has no undo, and the
     trash sits two pixels from the edit button */
  const [confirming, setConfirming] = useState<MeetingItem | null>(null);
  /* the composer is CLOSED by default — the dashed button is the resting
     state, and an input that is always open is a thing to look past */
  const [composing, setComposing] = useState(false);

  useEffect(() => {
    let alive = true;
    void api.meetingItems(meetingId)
      .then((r) => { if (alive) setRows(r); })
      .catch(() => { if (alive) setRows("failed"); });
    return () => { alive = false; };
  }, [meetingId]);

  const buckets = Array.isArray(rows) ? group(rows) : EMPTY;

  const add = async () => {
    const body = draft.trim();
    if (body === "" || busy) return;
    setBusy(true); setFailed(false);
    try {
      const created = await api.addMeetingItem(meetingId, { kind, body });
      /* adopt the SERVER's row rather than the draft — if it normalised the
         text, that is the text, and a projection that disagrees with the
         record is a second copy of one fact */
      setRows((prev) => (Array.isArray(prev) ? [...prev, created] : [created]));
      setDraft("");
      setComposing(false);
    } catch { setFailed(true); } finally { setBusy(false); }
  };

  const saveEdit = async () => {
    if (editing === null || busy) return;
    const body = editing.body.trim();
    if (body === "") return;
    const id = editing.id;
    setBusy(true); setFailed(false);
    try {
      await api.updateMeetingItem(meetingId, id, { body });
      setRows((prev) => (Array.isArray(prev)
        ? prev.map((r) => (r.id === id ? { ...r, body } : r)) : prev));
      setEditing(null);
    } catch { setFailed(true); } finally { setBusy(false); }
  };

  const toggleDone = async (row: MeetingItem) => {
    setFailed(false);
    const next = !row.done;
    setRows((prev) => (Array.isArray(prev)
      ? prev.map((r) => (r.id === row.id ? { ...r, done: next } : r)) : prev));
    try {
      await api.updateMeetingItem(meetingId, row.id, { done: next });
    } catch {
      /* put the tick back where it was: a checkbox that stays ticked after a
         refused write is a lie that only the next reload corrects, silently */
      setFailed(true);
      setRows((prev) => (Array.isArray(prev)
        ? prev.map((r) => (r.id === row.id ? { ...r, done: row.done } : r)) : prev));
    }
  };

  /**
   * Every un-ticked action item becomes a task on the board, and is then
   * ticked here so the two surfaces agree about what is still outstanding.
   *
   * Ticked ONE AT A TIME as each task lands, rather than all at the end: if
   * the fourth write fails, the first three tasks exist and their items are
   * marked, which is a true record of a partial run. Marking them all at the
   * end would either lose three tasks' worth of state or claim work that was
   * never created.
   */
  const convertToTasks = async () => {
    const pending = buckets.action.filter((r) => !r.done);
    if (pending.length === 0 || busy) return;
    setBusy(true); setFailed(false);
    try {
      for (const row of pending) {
        await api.createTask({ title: row.body.slice(0, 200), ...(callId === null ? {} : { call_id: callId }) });
        await api.updateMeetingItem(meetingId, row.id, { done: true });
        setRows((prev) => (Array.isArray(prev)
          ? prev.map((r) => (r.id === row.id ? { ...r, done: true } : r)) : prev));
      }
    } catch { setFailed(true); } finally { setBusy(false); }
  };

  const remove = async (row: MeetingItem) => {
    setFailed(false);
    setBusy(true);
    try {
      await api.deleteMeetingItem(meetingId, row.id);
      setRows((prev) => (Array.isArray(prev) ? prev.filter((r) => r.id !== row.id) : prev));
      setConfirming(null);
    } catch { setFailed(true); } finally { setBusy(false); }
  };

  return (
    <section aria-label={t("itemsTitle")} className="tile flex min-h-0 flex-col p-4">
      <div role="tablist" className="mb-3 flex flex-wrap items-center gap-1 rounded-xl bg-surface-2 p-1">
        {MEETING_ITEM_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={kind === k}
            onClick={() => { setKind(k); setEditing(null); }}
            /* 2026-09-03: `.btn btn-sm` is the platform's segmented tab — globals
               names that case by name when it records the measurement (h34 / 8px),
               and the meeting page's own tab row, the task detail's and the
               platform console's all wear it. These five had invented a 32px /
               10px one instead, so the tab strip inside the meeting disagreed with
               the tab strip ABOVE it on the same screen. The active/idle classes
               stay: they belong to the element, not to its geometry. */
            className={`btn btn-sm font-medium ${
              kind === k ? "bg-surface text-fg shadow-card" : "text-fg-muted hover:text-fg"
            }`}
          >
            {t(`item_${k}`)}
            {buckets[k].length > 0 ? (
              <span className="badge-num ms-1.5 text-[10px] text-fg-subtle">
                {digits(buckets[k].length, locale)}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      <div className="scroll-quiet min-h-0 flex-1 space-y-1.5 overflow-y-auto pe-1">
        {rows === null ? (
          /* the list's own frame, the platform's loading rule — the panel does
             not change height when the rows land under the pointer */
          <div className="space-y-1.5">
            {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-12 w-full rounded-xl" />)}
          </div>
        ) : rows === "failed" ? (
          <p className="p-2 text-sm text-fg-muted">{t("readFailed")}</p>
        ) : buckets[kind].length === 0 ? (
          /* NOT "the assistant found nothing": nothing has been written down
             yet, by anyone, and the copy says who may write it */
          <p className="px-1 py-6 text-center text-xs leading-6 text-fg-subtle">
            {t(`itemEmpty_${kind}`)}
          </p>
        ) : (
          buckets[kind].map((row) => (
            <div
              key={row.id}
              className="flex items-start gap-2 rounded-xl border border-border bg-surface p-2.5 shadow-card"
            >
              {kind === "action" ? (
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={row.done}
                  aria-label={t("itemDone")}
                  onClick={() => void toggleDone(row)}
                  /* 2026-09-03: KEPT as drawn, and recorded in control.guard's
                     worklist as such. This is a TICK BOX, not a button: 16px is
                     the platform's one checkbox size, spelled identically in
                     TaskBoard, TaskViews, TaskDetail and MiniTasks, and `.btn-icon`
                     would put a 28px square beside a 14px line of text. `.tap`
                     stays, because that is what gives the 16px box a 44px reach. */
                  className={`tap mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border transition-colors ${
                    row.done ? "border-accent bg-accent text-on-accent" : "border-border-strong"
                  }`}
                >
                  {row.done ? <IconCheck width={12} height={12} /> : null}
                </button>
              ) : null}

              <div className="min-w-0 flex-1">
                {editing !== null && editing.id === row.id ? (
                  <div className="flex gap-1.5">
                    <input
                      className="input h-8 text-sm"
                      value={editing.body}
                      autoFocus
                      aria-label={t("itemEdit")}
                      onChange={(e) => setEditing({ id: row.id, body: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); void saveEdit(); }
                        if (e.key === "Escape") setEditing(null);
                      }}
                    />
                    <button type="button" onClick={() => void saveEdit()}
                      className="btn btn-sm shrink-0 bg-accent text-on-accent">{t("save")}</button>
                    <button type="button" onClick={() => setEditing(null)}
                      className="btn btn-sm btn-icon shrink-0 border border-border text-fg-subtle"
                      aria-label={t("cancel")}><IconClose width={12} height={12} /></button>
                  </div>
                ) : (
                  <p className={`text-sm leading-6 ${row.done ? "text-fg-subtle line-through" : "text-fg"}`}>
                    {row.body}
                  </p>
                )}
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  {row.source === "ai" ? (
                    <span className="flex items-center gap-1 rounded-md bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent">
                      <IconSparkle width={12} height={12} />
                      {t("itemByAssistant")}
                    </span>
                  ) : null}
                  {row.owner !== null ? (
                    <span className="text-[10px] text-fg-subtle">{row.owner}</span>
                  ) : null}
                  {row.at_ms !== null && onSeek !== undefined ? (
                    <button
                      type="button"
                      onClick={() => { if (row.at_ms !== null) onSeek(row.at_ms); }}
                      className="badge-num text-[10px] text-fg-subtle hover:text-accent"
                      title={t("playFromHere")}
                      dir="ltr"
                    >
                      {formatClock(Math.floor(row.at_ms / 1000), locale)}
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-0.5">
                <button
                  type="button"
                  aria-label={t("itemEdit")}
                  onClick={() => setEditing({ id: row.id, body: row.body })}
                  className="btn btn-icon text-fg-subtle hover:text-fg"
                >
                  <IconPencil width={12} height={12} />
                </button>
                <button
                  type="button"
                  aria-label={t("itemRemove")}
                  onClick={() => setConfirming(row)}
                  className="btn btn-icon text-fg-subtle hover:text-danger"
                >
                  <IconTrash width={12} height={12} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/*
        THE REFERENCE'S ADD CONTROL (user directive, 2026-09-02: "make the add
        button for the risk and following section there like the image").

        A dashed full-width button that OPENS a composer, rather than a text
        field parked at the foot. The difference is not decoration: an always-
        present input is a thing to look past on a list you came to read,
        while a dashed outline reads as a place where a row would go — which
        is what it is. It is also what makes room for a composer with more
        than one field the day a kind needs one.
      */}
      <div className="mt-2 space-y-1.5 border-t border-border pt-2.5">
        {composing ? (
          <div className="rounded-xl border border-accent bg-surface p-2">
            <textarea
              className="input min-h-[64px] resize-none py-2 text-sm"
              placeholder={t(`itemAdd_${kind}`)}
              aria-label={t(`itemAdd_${kind}`)}
              value={draft}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                /* Enter sends, Shift+Enter breaks the line — a risk is often
                   a sentence and a composer that submitted on every Enter
                   would make the multi-line box a lie */
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void add(); }
                if (e.key === "Escape") { setComposing(false); setDraft(""); }
              }}
            />
            <div className="mt-1.5 flex justify-end gap-1.5">
              <button
                type="button"
                className="btn btn-sm border border-border font-medium text-fg-muted hover:text-fg"
                onClick={() => { setComposing(false); setDraft(""); }}
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                className="btn btn-sm bg-accent font-medium text-on-accent"
                disabled={draft.trim() === "" || busy}
                onClick={() => void add()}
              >
                {t("add")}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setComposing(true)}
            className="tap flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border py-2.5 text-xs font-medium text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
          >
            <IconPlus width={12} height={12} />
            {t(`itemAddLabel_${kind}`)}
          </button>
        )}

        {/*
          CONVERT WHAT IS LEFT (same directive: "and one for transform them
          into tasks"). Only on action items, and only the ones NOT ticked —
          "all remaining" is the reference's own word and it is the honest
          one: an action item somebody already finished does not need a task,
          and creating one would put closed work back on the board.

          It is deliberately not reversible-looking: each converted item is
          ticked, so pressing it twice creates nothing the second time.
        */}
        {kind === "action" && buckets.action.some((r) => !r.done) ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void convertToTasks()}
            className="tap flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-accent bg-accent-soft py-2.5 text-xs font-medium text-accent transition-colors hover:bg-accent-soft/70 disabled:opacity-50"
          >
            <IconPlus width={12} height={12} />
            {t("convertRemainingToTasks")}
          </button>
        ) : null}
      </div>
      {failed ? <p className="mt-1.5 text-[11px] text-danger">{t("itemWriteFailed")}</p> : null}

      {confirming !== null ? (
        <ConfirmDialog
          title={t("itemRemoveTitle")}
          body={confirming.body}
          confirmLabel={t("itemRemove")}
          cancelLabel={t("cancel")}
          busy={busy}
          onConfirm={() => { void remove(confirming); }}
          onCancel={() => setConfirming(null)}
        />
      ) : null}
    </section>
  );
}
