"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";
import { api } from "@/api/client";
import type { MeetingAgendaItem, MeetingMode, MeetingRecord } from "@/api/types";
import { Overlay } from "./Overlay";
import { Select } from "@/components/Select";
import { DateField, TimeField } from "@/components/DateTimeFields";
import {
  IconArchive, IconCalendar, IconCheck, IconChevronRight, IconClose,
  IconFolder, IconMic, IconPencil, IconPlus, IconTrash, IconUpload, IconVideo,
} from "@/components/icons";
import { ConfirmDialog, KebabMenu } from "@/components/rowActions";
import { Skeleton } from "@/components/scaffold";
import { dayKeyOf, digits, formatDate, formatTime, monthGridAt, nowFields, instantFromFields } from "@/lib/format";

/**
 * MEETINGS (0145, the reference adoption) — "add a part name meeting and
 * add the online section that we dont have".
 *
 * A meeting is a scheduled fact that later gains a record, and its screen
 * follows that life:
 *
 *   · the LIST: upcoming first (nearest at the top), then the past. Each
 *     row carries its holding mode as a badge, because the mode is the one
 *     fact that changes what "start" means.
 *   · the STAGE is DERIVED, never stored: no record and still ahead = pre;
 *     no record and due = ready to hold; a linked record = held. A stored
 *     stage would be a second spelling of facts the row already carries.
 *   · شروع جلسه hands the meeting to the RECORDER (/echo?meeting=id) —
 *     online mode arrives there as the system-audio source, in-person as
 *     the microphone, upload as the upload lane. The recorder patches
 *     call_id back, which is what moves the meeting to its post stage.
 */

export const MODE_ICON: Record<MeetingMode, ReturnType<typeof IconMic>> = {
  upload: <IconUpload width={14} height={14} />,
  in_person: <IconMic width={14} height={14} />,
  online: <IconVideo width={14} height={14} />,
};

/**
 * The strip's inline name box, used by BOTH adding and renaming.
 *
 * One component for the two because they are the same interaction with a
 * different starting value — a second copy is the one that stops matching
 * the first the day either gains a rule.
 */
function TopicNameBox({ initial, onCancel, onSubmit }: {
  initial: string;
  onCancel: () => void;
  onSubmit: (name: string) => void;
}) {
  const t = useTranslations("meetings");
  const [name, setName] = useState(initial);
  return (
    <span className="flex items-center gap-1">
      <input
        autoFocus
        value={name}
        maxLength={80}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && name.trim() !== "") onSubmit(name.trim());
          if (e.key === "Escape") onCancel();
        }}
        placeholder={t("topicNamePlaceholder")}
        className="input h-[34px] min-h-[34px] w-40 border-accent"
      />
      <button
        type="button"
        disabled={name.trim() === ""}
        onClick={() => onSubmit(name.trim())}
        className="btn btn-icon bg-accent text-on-accent"
        aria-label={t("save")}
      >
        <IconCheck width={12} height={12} />
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="btn btn-icon border border-border text-fg-muted hover:text-fg"
        aria-label={t("cancel")}
      >
        <IconClose width={12} height={12} />
      </button>
    </span>
  );
}

export function Meetings() {
  const t = useTranslations("meetings");
  const locale = useLocale();
  const router = useRouter();
  const [rows, setRows] = useState<MeetingRecord[] | null | "failed">(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* the reference's own two axes: a view and a stage filter, plus topics */
  const [view, setView] = useState<"list" | "calendar">("list");
  const [filter, setFilter] = useState<"all" | "ahead" | "held" | "archived">("all");
  const [topic, setTopic] = useState<string>("all");
  const [condemned, setCondemned] = useState<MeetingRecord | null>(null);

  const load = useCallback(() => {
    void api.meetings({ archived: filter === "archived" })
      .then(setRows)
      .catch(() => setRows("failed"));
  }, [filter]);
  useEffect(load, [load]);

  /* ?new=1 — the dashboard's «شروع ضبط جلسه» and the rail's CTA land here
     with the dialog already open, its time defaulted to the click moment.
     useSearchParams (the house pattern) rather than a mount-only read:
     the rail's link must work while ALREADY standing on /meetings. */
  const params = useSearchParams();
  useEffect(() => {
    if (params.get("new") === "1") setCreating(true);
  }, [params]);

  const refusal = () => setError(t("writeFailed"));

  /*
   * THE FOLDERS ARE ROWS NOW (0151), not the distinct values of a column.
   * That is the whole difference the user asked for: a folder can be made
   * before any meeting uses it, and renaming one is one write rather than a
   * rewrite of every meeting that happened to share a spelling.
   */
  const [topicRows, setTopicRows] = useState<Array<{ id: string; name: string }>>([]);
  const loadTopics = useCallback(() => {
    void api.meetingTopics().then(setTopicRows).catch(() => setTopicRows([]));
  }, []);
  useEffect(loadTopics, [loadTopics]);
  const [renamingTopic, setRenamingTopic] = useState<{ id: string; name: string } | null>(null);
  const [addingTopic, setAddingTopic] = useState(false);

  const shown = useMemo(() => {
    if (!Array.isArray(rows)) return [];
    const now = Date.now();
    return rows.filter((m) => {
      const ahead = new Date(m.scheduled_at).getTime() >= now && m.call_id === null;
      if (filter === "ahead" && !ahead) return false;
      if (filter === "held" && m.call_id === null) return false;
      if (topic !== "all" && (topic === "none" ? m.topic_id !== null : m.topic_id !== topic)) return false;
      return true;
    }).sort((a, b) => b.scheduled_at.localeCompare(a.scheduled_at));
  }, [rows, filter, topic]);

  const chip = (active: boolean, label: string, onClick: () => void) => (
    <button
      key={label}
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`btn btn-sm gap-1.5 font-medium ${
        active ? "bg-accent text-on-accent" : "text-fg-muted hover:bg-surface-2 hover:text-fg"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* ── the toolbar, in the reference's order ─────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1">
          {chip(view === "list", t("viewMeetingList"), () => setView("list"))}
          {chip(view === "calendar", t("viewMeetingCalendar"), () => setView("calendar"))}
          <span className="mx-1 h-5 w-px bg-border" aria-hidden />
          {chip(filter === "all", t("filterAll"), () => setFilter("all"))}
          {chip(filter === "ahead", t("filterAhead"), () => setFilter("ahead"))}
          {chip(filter === "held", t("filterHeld"), () => setFilter("held"))}
          {chip(filter === "archived", t("filterArchived"), () => setFilter("archived"))}
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="btn bg-accent text-on-accent shadow-accent hover:opacity-90"
        >
          <IconPlus width={14} height={14} />
          {t("newMeeting")}
        </button>
      </div>

      {/* ── the topic row ────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          aria-pressed={topic === "all"}
          onClick={() => setTopic("all")}
          className={`btn btn-sm gap-1.5 border font-medium ${
            topic === "all" ? "border-accent bg-accent-soft font-semibold text-accent" : "border-border text-fg-muted hover:text-fg"
          }`}
        >
          <IconFolder width={12} height={12} />
          {t("allMeetings")}
          <span className="badge-num rounded-md bg-surface-2 px-1 text-[10px]">
            {digits(Array.isArray(rows) ? rows.length : 0, locale)}
          </span>
        </button>
        {/* ONLY A REAL FOLDER carries a menu (user directive: "only the added
            one can be edited"). «همه جلسات» and «بدون موضوع» are the absence
            of a filter and the absence of a folder — there is nothing there
            to rename, and offering it would be a menu over a fiction. */}
        {topicRows.map((row) => (
          /*
           * The chip and its menu are SIBLINGS, not a span pretending to be a
           * button inside a button — which is what stood here, with the ⋯
           * wearing `role="button"` because real nesting is invalid HTML.
           * And the menu is the platform's KebabMenu: what it replaced was a
           * hand-positioned `absolute end-0 top-9` panel that the
           * floating-panel rule exists to forbid and only missed because it
           * spelled its offset `top-9` instead of `top-full`.
           */
          /*
           * THE MENU LIVES INSIDE THE CHIP (user directive, 2026-09-02: "put
           * the kebab menu inside the item in the second sub menu — do it for
           * tasks and meetings"). Beside it, the ⋯ read as a separate control
           * in the row rather than as this folder's own options.
           *
           * The chip is a SPAN with a bordered look and the select is a
           * button inside it, because a button cannot contain a button and
           * the previous shape only avoided that by giving a span
           * `role="button"` — a control a screen reader announces but the
           * platform cannot style, focus or disable like the real thing.
           */
          <span
            key={row.id}
            className={`btn btn-sm inline-flex cursor-default items-center gap-1.5 border pe-1 font-medium ${
              topic === row.id ? "border-accent bg-accent-soft font-semibold text-accent" : "border-border text-fg-muted"
            }`}
          >
            <button
              type="button"
              aria-pressed={topic === row.id}
              onClick={() => setTopic((cur) => (cur === row.id ? "all" : row.id))}
              className="tap inline-flex items-center gap-1.5 hover:text-fg"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
              {row.name}
              <span className="badge-num rounded-md bg-surface-2 px-1 text-[10px]">
                {digits(Array.isArray(rows) ? rows.filter((m) => m.topic_id === row.id).length : 0, locale)}
              </span>
            </button>
            <KebabMenu
              label={t("topicOptions")}
              triggerClassName="h-5 w-5 rounded text-current opacity-60 hover:opacity-100"
              items={[
                {
                  key: "rename",
                  label: t("renameTopic"),
                  icon: <IconPencil width={14} height={14} />,
                  onSelect: () => setRenamingTopic({ id: row.id, name: row.name }),
                },
                {
                  key: "remove",
                  label: t("removeTopic"),
                  icon: <IconTrash width={14} height={14} />,
                  danger: true,
                  /* ARCHIVED, not deleted: the meetings in it are re-pointed
                     to no-folder by the schema, and a folder that vanished
                     would take the answer to "where did that go" with it */
                  onSelect: () => {
                    void api.updateMeetingTopic(row.id, { archived: true })
                      .then(() => { setTopic((cur) => (cur === row.id ? "all" : cur)); loadTopics(); load(); })
                      .catch(refusal);
                  },
                },
              ]}
            />
          </span>
        ))}
        <button
          type="button"
          aria-pressed={topic === "none"}
          onClick={() => setTopic((cur) => (cur === "none" ? "all" : "none"))}
          className={`btn btn-sm gap-1.5 border font-medium ${
            topic === "none" ? "border-accent bg-accent-soft font-semibold text-accent" : "border-border text-fg-muted hover:text-fg"
          }`}
        >
          <IconFolder width={12} height={12} />
          {t("noTopic")}
          <span className="badge-num rounded-md bg-surface-2 px-1 text-[10px]">
            {digits(Array.isArray(rows) ? rows.filter((m) => m.topic_id === null).length : 0, locale)}
          </span>
        </button>

        {/* the ADD, at the end of the strip like the reference's */}
        {addingTopic || renamingTopic !== null ? (
          <TopicNameBox
            initial={renamingTopic?.name ?? ""}
            onCancel={() => { setAddingTopic(false); setRenamingTopic(null); }}
            onSubmit={(name) => {
              const done = () => { setAddingTopic(false); setRenamingTopic(null); loadTopics(); load(); };
              const target = renamingTopic;
              void (target !== null
                ? api.updateMeetingTopic(target.id, { name })
                : api.createMeetingTopic(name).then(() => undefined))
                .then(done)
                .catch(() => { refusal(); done(); });
            }}
          />
        ) : (
          <button
            type="button"
            aria-label={t("addTopic")}
            title={t("addTopic")}
            onClick={() => setAddingTopic(true)}
            className="btn btn-icon border border-dashed border-border text-fg-muted hover:border-border-strong hover:text-fg"
          >
            <IconPlus width={12} height={12} />
          </button>
        )}
      </div>

      {error !== null ? (
        <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </p>
      ) : null}

      {rows === null ? (
        /* audit finding, 2026-09-02: while the list fetched, the column held a
           lone «…» — indistinguishable from a broken tile (the dashboard's own
           verdict on the ellipsis), and the layout jumped when the rows landed.
           The frame is the ROWS' OWN SHAPE: three `tile tile-row` placeholders
           with the icon / title / meta / stage slots of the real row below, so
           nothing moves when the rows replace them. Not SkeletonCards: its card
           body (p-7, four stacked bars) is a tile's anatomy and overflows a
           68px row by twice its height — a reserved space of the wrong size
           still moves the layout, which is the thing a skeleton exists to
           prevent. */
        <ul className="space-y-2" aria-hidden>
          {Array.from({ length: 3 }, (_, i) => (
            <li key={i} className="tile tile-row flex items-center gap-3 p-3.5">
              <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
              <span className="min-w-0 flex-1">
                <Skeleton className="h-4 w-48 max-w-full" />
                <Skeleton className="mt-1.5 h-3 w-64 max-w-full" />
              </span>
              <Skeleton className="h-6 w-14 shrink-0 rounded-lg" />
            </li>
          ))}
        </ul>
      ) : rows === "failed" ? (
        <p className="text-sm text-fg-subtle">{t("readFailed")}</p>
      ) : shown.length === 0 ? (
        <div className="tile grid place-items-center p-10 text-center">
          <IconCalendar width={24} height={24} />
          <p className="mt-2 text-sm text-fg-muted">
            {filter === "archived" ? t("archiveEmpty") : rows.length === 0 ? t("empty") : t("noneInFilter")}
          </p>
        </div>
      ) : view === "calendar" ? (
        <MeetingCalendar meetings={shown} locale={locale}
          onOpen={(id) => router.push(`/meetings/${id}`)} />
      ) : (
        <ul className="space-y-2">
          {shown.map((m) => (
            <li key={m.id} className="relative">
              <div
                role="button"
                tabIndex={0}
                onClick={() => router.push(`/meetings/${m.id}`)}
                onKeyDown={(e) => { if (e.key === "Enter") router.push(`/meetings/${m.id}`); }}
                /* `tile-row`, not the flex-row utility: `.tile` is unlayered and
                   beats every Tailwind class written beside it, so the utility
                   version of this fix read as applied and computed as a column
                   anyway. See the class in globals.css. */
                className="tile tile-row flex cursor-pointer items-center gap-3 p-3.5 transition-colors hover:border-border-strong"
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-surface-2 text-fg-muted" aria-hidden>
                  <IconCalendar width={16} height={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-fg">{m.title}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-fg-subtle">
                    <span>
                      {formatDate(m.scheduled_at, locale)}
                      {t("dateAtTime", { time: formatTime(m.scheduled_at, locale) })}
                    </span>
                    <span>·</span>
                    <span>{t(`mode_${m.mode}`)}</span>
                    <span>·</span>
                    <span>{t("agendaCount", { n: digits(m.agenda.length, locale) })}</span>
                  </span>
                </span>
                <span className={`shrink-0 rounded-lg px-2 py-1 text-[11px] font-medium ${
                  m.minutes_closed_at !== null ? "bg-success/10 text-success"
                    : m.call_id !== null ? "bg-accent-soft text-accent"
                      : "bg-surface-2 text-fg-muted"
                }`}>
                  {m.minutes_closed_at !== null ? t("stageClosed")
                    : m.call_id !== null ? t("tabReview") : t("stage_pre")}
                </span>
                {/* THE THEME'S KEBAB, not a hand-rolled panel (audit finding,
                    2026-09-02). The panel this replaced had learned to
                    position itself, close on outside press and Escape, and
                    step its topic list — every one a thing KebabMenu already
                    does, and the two it never reached (focus trap, arrow
                    keys) it now gets for free. Topics are a SUB flyout with
                    the current one carrying the check; archive and delete
                    are ordinary items, and `danger` sorts delete to the
                    bottom under its rule, so nobody has to remember to. */}
                <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                  <KebabMenu
                    label={t("rowOptions")}
                    items={[
                      {
                        key: "topic",
                        label: t("moveToTopic"),
                        icon: <IconFolder width={14} height={14} />,
                        sub: [{ id: null as string | null, name: t("noTopic") }, ...topicRows].map((row) => ({
                          key: row.id ?? "__none",
                          label: row.name,
                          /* the CURRENT topic wears the check — the menu says where
                             the meeting IS as well as where it can go */
                          icon: (m.topic_id ?? null) === row.id ? <IconCheck width={12} height={12} /> : null,
                          onSelect: () => {
                            if ((m.topic_id ?? null) === row.id) return;
                            void api.updateMeeting(m.id, { topic_id: row.id }).then(load).catch(refusal);
                          },
                        })),
                      },
                      {
                        key: "archive",
                        label: m.archived ? t("unarchive") : t("archiveMeeting"),
                        icon: <IconArchive width={14} height={14} />,
                        onSelect: () => {
                          void api.updateMeeting(m.id, { archived: !m.archived }).then(load).catch(refusal);
                        },
                      },
                      {
                        key: "delete",
                        label: t("deleteMeeting"),
                        icon: <IconTrash width={14} height={14} />,
                        danger: true,
                        onSelect: () => setCondemned(m),
                      },
                    ]}
                  />
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {creating ? (
        <NewMeetingDialog
          topics={topicRows}
          onClose={() => setCreating(false)}
          /*
           * A FUTURE meeting is a PLAN — it goes on the list and stays there
           * (user directive, 2026-09-02: "if it sets for future, just add it
           * in table for meeting and don't show the before page even").
           *
           * Opening the meeting's own screen straight after scheduling one
           * assumes the next thing wanted is to prepare it, and the common
           * case is the opposite: somebody is writing down three meetings and
           * being thrown into the first one's agenda each time is friction
           * for a task nobody started.
           *
           * A meeting scheduled for NOW is the other intent — that person is
           * about to hold it — so that one still opens.
           */
          onCreated={(m) => {
            setCreating(false);
            load();
            if (new Date(m.scheduled_at).getTime() <= Date.now() + 60_000) {
              router.push(`/meetings/${m.id}`);
            }
          }}
          onRefused={refusal}
        />
      ) : null}

      {condemned !== null ? (
        <ConfirmDialog
          title={t("deleteMeetingTitle", { title: condemned.title })}
          body={t("deleteMeetingBody")}
          confirmLabel={t("deleteMeeting")}
          cancelLabel={t("cancel")}
          onCancel={() => setCondemned(null)}
          onConfirm={() => {
            const target = condemned;
            setCondemned(null);
            /* 0148 argued this onto the closed DELETE list: a meeting is a
               PLAN, and the record it produced is a different row this
               cannot reach — the schema asserts that, not this file */
            void api.deleteMeeting(target.id).then(load).catch(refusal);
          }}
        />
      ) : null}
    </div>
  );
}

/** the meetings calendar: their month grid, meetings on their days */
function MeetingCalendar({ meetings, locale, onOpen }: {
  meetings: MeetingRecord[];
  locale: string;
  onOpen: (id: string) => void;
}) {
  const t = useTranslations("meetings");
  const [offset, setOffset] = useState(0);
  const grid = useMemo(() => monthGridAt(new Date(), locale, offset), [locale, offset]);
  const byDay = new Map<number, MeetingRecord[]>();
  for (const m of meetings) {
    const key = dayKeyOf(m.scheduled_at);
    const bucket = byDay.get(key);
    if (bucket) bucket.push(m);
    else byDay.set(key, [m]);
  }
  return (
    <div className="tile flex min-h-0 flex-1 flex-col p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {/* audit finding, 2026-09-02 (sibling of the dialog pair, same file):
              «امروز» was a hand-rolled 32px box with the 12px panel corner,
              sitting between two `.btn-icon`s — a third button shape in one
              row. The control guard cannot see it (no flex/items-center), so
              it survived the dialog fix; `.btn-sm` is the toolbar's own size. */}
          <button type="button" onClick={() => setOffset(0)}
            className="btn btn-sm border border-border text-fg hover:border-border-strong">
            {t("today")}
          </button>
          <button type="button" aria-label={t("prev")} onClick={() => setOffset((v) => v - 1)}
            className="btn btn-icon border border-border text-fg-muted hover:text-fg">
            <IconChevronRight width={12} height={12} className="rotate-180 rtl:rotate-0" />
          </button>
          <span className="px-1 text-sm font-semibold text-fg">{grid.title}</span>
          <button type="button" aria-label={t("next")} onClick={() => setOffset((v) => v + 1)}
            className="btn btn-icon border border-border text-fg-muted hover:text-fg">
            <IconChevronRight width={12} height={12} className="rtl:rotate-180" />
          </button>
        </div>
      </div>
      <ul className="grid grid-cols-7 gap-1.5 pb-1">
        {grid.weekdays.map((day, i) => (
          <li key={i} className="text-center text-[10px] text-fg-subtle">{day}</li>
        ))}
      </ul>
      <ul className="scroll-quiet grid min-h-0 flex-1 grid-cols-7 gap-1.5 overflow-y-auto">
        {grid.cells.map((cell) => (
          <li key={cell.key}
            className={`flex min-h-24 flex-col rounded-xl border p-1.5 ${
              cell.today ? "border-accent/40 bg-accent-soft"
                : cell.weekend ? "border-transparent bg-danger/5"
                  : cell.inMonth ? "border-border bg-surface"
                    : "border-transparent bg-surface-2/40"
            }`}>
            <span className={`mb-1 text-xs tabular-nums ${
              cell.today ? "grid h-5 w-5 place-items-center rounded-full bg-accent font-bold text-on-accent"
                : cell.weekend ? "text-danger" : cell.inMonth ? "text-fg" : "text-fg-subtle"
            }`}>
              {cell.label}
            </span>
            <div className="min-h-0 flex-1 space-y-1">
              {(byDay.get(cell.key) ?? []).map((m) => (
                <button key={m.id} type="button" onClick={() => onOpen(m.id)} title={m.title}
                  className="block w-full truncate rounded-md bg-accent-soft px-1.5 py-0.5 text-start text-[10px] leading-4 text-accent">
                  {formatTime(m.scheduled_at, locale)} {m.title}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** the three holding modes, as the reference's picker tiles */
function ModePicker({ value, onChange }: { value: MeetingMode; onChange: (m: MeetingMode) => void }) {
  const t = useTranslations("meetings");
  return (
    <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t("fieldMode")}>
      {(["upload", "in_person", "online"] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          role="radio"
          aria-checked={value === mode}
          onClick={() => onChange(mode)}
          className={`tap flex flex-col items-center gap-1.5 rounded-xl border p-3 text-xs font-medium transition-colors ${
            value === mode
              ? "border-accent bg-accent-soft text-accent"
              : "border-border bg-surface text-fg-muted hover:border-border-strong"
          }`}
        >
          {MODE_ICON[mode]}
          {t(`mode_${mode}`)}
        </button>
      ))}
    </div>
  );
}

/** invitee chips: names or addresses as typed, Enter adds, × removes */
export function InviteeInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const t = useTranslations("meetings");
  const [draft, setDraft] = useState("");
  const add = () => {
    const name = draft.trim();
    if (name === "" || value.includes(name)) { setDraft(""); return; }
    onChange([...value, name]);
    setDraft("");
  };
  return (
    <div className="rounded-xl border border-border bg-surface p-2 transition-colors focus-within:border-accent">
      {value.length > 0 ? (
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          {value.map((name) => (
            <span key={name} className="flex items-center gap-1 rounded-lg bg-surface-2 px-2 py-0.5 text-xs text-fg">
              {name}
              <button
                type="button"
                aria-label={t("removeInvitee", { name })}
                onClick={() => onChange(value.filter((v) => v !== name))}
                className="text-fg-subtle hover:text-danger"
              >
                <IconClose width={12} height={12} />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
        onBlur={add}
        placeholder={t("inviteePlaceholder")}
        className="w-full bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle"
      />
    </div>
  );
}

/** agenda rows: title + planned minutes, add and remove */
export function AgendaEditor({ value, onChange }: {
  value: MeetingAgendaItem[]; onChange: (v: MeetingAgendaItem[]) => void;
}) {
  const t = useTranslations("meetings");
  const locale = useLocale();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");

  const add = () => {
    const clean = title.trim();
    if (clean === "") return;
    onChange([...value, { title: clean, minutes: null }]);
    setTitle("");
    setAdding(false);
  };

  /*
   * THE REFERENCE'S AGENDA (user directive, 2026-09-02: "the agenda must look
   * like these and you add it like this").
   *
   * Each clause is EDITABLE IN PLACE with a minutes stepper beside it, rather
   * than a read-only line plus a composer underneath. The difference is not
   * decorative: an agenda is written by adjusting it — a clause gets renamed,
   * five minutes become ten — and a row you can only delete and re-add makes
   * every correction a retype.
   *
   * The stepper is − / + around the number rather than a text field, because
   * the number is always a small multiple of five and the keyboard was the
   * long way to say "a bit longer".
   */
  const patch = (index: number, next: Partial<MeetingAgendaItem>) => {
    onChange(value.map((item, i) => (i === index ? { ...item, ...next } : item)));
  };
  const STEP = 5;

  return (
    <div className="space-y-1.5">
      {value.map((item, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input
            value={item.title}
            onChange={(e) => patch(i, { title: e.target.value })}
            aria-label={t("agendaTitlePlaceholder")}
            className="input h-[34px] min-h-[34px] flex-1"
          />
          <span className="flex shrink-0 items-center gap-0.5 rounded-md border border-border bg-field px-1">
            <button
              type="button"
              aria-label={t("agendaLess")}
              onClick={() => patch(i, { minutes: Math.max(0, (item.minutes ?? 0) - STEP) || null })}
              className="tap grid h-6 w-6 place-items-center rounded text-fg-subtle hover:text-fg"
            >
              −
            </button>
            <span className="badge-num w-14 text-center text-[11px] text-fg-muted">
              {item.minutes === null
                ? t("agendaNoMinutes")
                : t("agendaMinutes", { n: digits(item.minutes, locale) })}
            </span>
            <button
              type="button"
              aria-label={t("agendaMore")}
              onClick={() => patch(i, { minutes: (item.minutes ?? 0) + STEP })}
              className="tap grid h-6 w-6 place-items-center rounded text-fg-subtle hover:text-fg"
            >
              +
            </button>
          </span>
          <button
            type="button"
            aria-label={t("removeAgendaItem", { title: item.title })}
            onClick={() => onChange(value.filter((_, j) => j !== i))}
            className="tap grid h-[34px] w-8 shrink-0 place-items-center rounded-md text-fg-subtle hover:text-danger"
          >
            <IconTrash width={12} height={12} />
          </button>
        </div>
      ))}

      {adding ? (
        <div className="flex items-center gap-1.5">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); add(); }
              if (e.key === "Escape") { setTitle(""); setAdding(false); }
            }}
            placeholder={t("agendaTitlePlaceholder")}
            className="input h-[34px] min-h-[34px] flex-1"
          />
          <button
            type="button"
            onClick={add}
            disabled={title.trim() === ""}
            className="btn btn-sm shrink-0 bg-accent text-on-accent"
          >
            {t("add")}
          </button>
        </div>
      ) : (
        /* the reference's dashed "add a clause" row — a whole-width target
           where the next clause will appear, rather than a button beside a
           field that is empty most of the time */
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="btn btn-sm w-full justify-center border border-dashed border-border font-medium text-fg-muted hover:border-border-strong hover:text-fg"
        >
          <IconPlus width={12} height={12} />
          {t("agendaAdd")}
        </button>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-fg-muted">{label}</span>
      {children}
    </label>
  );
}

/**
 * The reference's create dialog, exactly: title, an optional description,
 * date and time DEFAULTING TO THE CLICK MOMENT (user directive: "the date
 * and time ... should be the date and time of the clicked button"), a topic
 * folder, and the three mode tiles. The agenda and the invitees are NOT
 * here — the subtitle says so, and the meeting's own page owns them.
 */
function NewMeetingDialog({ topics, onClose, onCreated, onRefused }: {
  topics: Array<{ id: string; name: string }>;
  onClose: () => void;
  onCreated: (m: MeetingRecord) => void;
  onRefused: () => void;
}) {
  const t = useTranslations("meetings");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  /* the click moment, captured when this dialog MOUNTS — and it mounts on
     every open, because the caller renders it conditionally. `nowFields`
     carries the rule and its test; these two lines only decide WHEN to ask. */
  const [date, setDate] = useState(() => nowFields().date);
  const [time, setTime] = useState(() => nowFields().time);
  const [topic, setTopic] = useState("");
  const [mode, setMode] = useState<MeetingMode>("online");
  const [busy, setBusy] = useState(false);

  const submit = () => {
    if (title.trim() === "" || date === "" || time === "" || busy) return;
    setBusy(true);
    void api.createMeeting({
      title: title.trim(),
      /* the fields are wall clock in the PLATFORM's zone, so they are read
         back in it — `new Date("...T...")` reads the browser's, which stored
         an instant off by the offset for anyone outside their own zone */
      scheduled_at: instantFromFields(date, time).toISOString(),
      mode,
      topic_id: topic === "" ? undefined : topic,
      description: description.trim() === "" ? undefined : description,
    })
      .then(onCreated)
      .catch(() => { setBusy(false); onRefused(); });
  };

  return (
    <Overlay onClose={onClose} label={t("newMeeting")} size="md">
      <div className="mb-1 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-fg">{t("newMeeting")}</h2>
          <p className="mt-0.5 text-xs text-fg-muted">{t("newMeetingSubtitle")}</p>
        </div>
        {/* audit finding, 2026-09-02: this × was a hand-rolled 36px box with the
            16px tile corner while InviteDialog's, one dialog over in the same
            flow, is the theme's 28px `.btn-icon` — two close buttons in the
            same corner of two dialogs, different sizes. This is InviteDialog's
            line, verbatim. */}
        <button type="button" aria-label={t("close")} onClick={onClose}
          className="btn btn-icon shrink-0 border border-border text-fg-subtle hover:text-fg">
          <IconClose width={14} height={14} />
        </button>
      </div>
      <div className="scroll-quiet min-h-0 flex-1 space-y-3 overflow-y-auto pe-1 pt-2">
        {/* audit finding, 2026-09-02: the title box and the description wore a
            file-local INPUT recipe — white ground, 16px corner — while the
            Select and the date/time pickers three rows down are `.input`
            (recessed `--field` ground, 11px corner). Two input looks inside one
            form. The const is deleted rather than corrected: `.input` is the
            one spelling, and a second one is what stops matching the first. */}
        <Field label={t("fieldTitleRequired")}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="input"
            placeholder={t("titlePlaceholder")} />
        </Field>
        <Field label={t("fieldDescriptionOptional")}>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)}
            rows={3} placeholder={t("descriptionPlaceholder")}
            className="input min-h-[80px] py-2" />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          {/* OUR pickers, not the browser's: a native date input renders a
              Gregorian popup with English weekday initials on a Persian-first
              product, and no attribute changes that — the control is drawn by
              the browser. The VALUE is unchanged; only the reading is ours. */}
          <Field label={t("fieldDateRequired")}>
            <DateField value={date} onChange={setDate} />
          </Field>
          <Field label={t("fieldTimeRequired")}>
            <TimeField value={time} onChange={setTime} />
          </Field>
        </div>
        <Field label={t("fieldTopicFolder")}>
          {/* the FOLDERS, by id (0151). The «new folder» row is gone from
              here: folders are made on the strip now, where they are also
              renamed and removed, and a second place to create one is a
              second thing to keep in step. */}
          <Select
            value={topic}
            ariaLabel={t("fieldTopicFolder")}
            onChange={setTopic}
            options={[
              { value: "", label: t("noTopic") },
              ...topics.map((row) => ({ value: row.id, label: row.name })),
            ]}
          />
        </Field>
        <div>
          <span className="mb-1 block text-xs font-medium text-fg-muted">{t("fieldMode")}</span>
          <ModePicker value={mode} onChange={setMode} />
        </div>
      </div>
      {/* audit finding, 2026-09-02: the pair was 40px tall with the 16px tile
          corner, while the «جلسه جدید» button that OPENED this dialog is the
          38px, 11px-cornered `.btn` — the primary action changed shape between
          the page and its own dialog. `.btn` owns height, corner, padding and
          the disabled state now (the local `disabled:opacity-50` restated what
          the class already does). This was the control guard's one worklist
          entry for this file; the entry is gone with it. */}
      <div className="mt-3 flex items-center justify-between">
        <button type="button" onClick={onClose}
          className="btn border border-border text-fg">
          {t("cancel")}
        </button>
        <button type="button" onClick={submit} disabled={title.trim() === "" || date === "" || time === "" || busy}
          className="btn bg-accent text-on-accent shadow-accent">
          <IconPlus width={14} height={14} />
          {t("createMeeting")}
        </button>
      </div>
    </Overlay>
  );
}
