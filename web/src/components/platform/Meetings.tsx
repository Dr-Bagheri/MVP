"use client";


import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";
import { api } from "@/api/client";
import { useRefreshEpoch } from "@/lib/refreshBus";
import type { MeetingMode, MeetingRecord } from "@/api/types";
import { Overlay } from "./Overlay";
import { DIALOG_BODY } from "./tasks/panelStyle";
import { Select } from "@/components/Select";
import { DateField, TimeField } from "@/components/DateTimeFields";
import { stashUpload } from "@/lib/pendingUpload";
import { audioContentType, readDurationSeconds, uploadRejection } from "@/components/echo/uploadRules";
import {
  IconArchive, IconArrowDown, IconArrowUp, IconCalendar, IconCheck, IconCheckCircle,
  IconChevronRight, IconClose, IconFolder, IconMic, IconPencil, IconPeople3, IconPlus,
  IconRows, IconSearch, IconTrash, IconUpload, IconVideo,
} from "@/components/icons";
import {
  FILTER_TRACK, FilterChips, TAB_TRACK, TOOLBAR_GROUPS, TRACK_DIVIDER, Toolbar, filterChipClass, sectionTabClass,
} from "./sectionTabs";
import { ConfirmDialog, KebabMenu } from "@/components/rowActions";
import { Avatar } from "@/components/Avatar";
import { Skeleton } from "@/components/scaffold";
import {
  dayKeyOf, digits, formatDate, formatDuration, formatTime, monthGridAt, personName,
} from "@/lib/format";
import { notifyError } from "@/lib/notify";

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
 * THE ROW'S STATUS, in three words: upcoming, processing, done.
 *
 * It is DERIVED, like the stage it replaces — a stored status would be a
 * second spelling of `call_id`, `call_status` and `minutes_closed_at`, and
 * the three of them already answer the question between them:
 *
 *   · no take at all                        → upcoming
 *   · the browser is still capturing          → ongoing
 *   · capturing is over, the take has not
 *     landed                                  → processing
 *   · the take is ready, or the minutes are
 *     closed                                  → done
 *
 * «ongoing» is its own word rather than a shade of «processing» (2026-09-09:
 * "processing is after"). `echo.call_status` already draws that line — only
 * `recording` means the browser is still capturing parts; `processing`,
 * `linking` and `summarizing` are all AFTER the room emptied — and a person
 * sitting in the meeting reads «Processing» as a machine getting ahead of
 * them.
 *
 * A FAILED take reads as «processing» here. That is a deliberate rounding,
 * not an oversight: «done» on a recording that produced nothing is the worse
 * of the two lies. The meeting's own page says `failed` in full.
 */
export type MeetingStatus = "upcoming" | "ongoing" | "processing" | "done";

export function meetingStatus(m: MeetingRecord): MeetingStatus {
  if (m.minutes_closed_at !== null || m.call_status === "ready") return "done";
  if (m.call_status === "recording") return "ongoing";
  if (m.call_id !== null) return "processing";
  return "upcoming";
}

/** the sort's rank for a status — the pipeline's own order, not the alphabet */
const STATUS_RANK: Record<MeetingStatus, number> = { upcoming: 0, ongoing: 1, processing: 2, done: 3 };

/**
 * WHO WAS THERE, as one list of people rather than two shapes.
 *
 * `attendees` are the members (db/0202) with names resolved from user
 * management; `invitees` are the people with no account, who are a string
 * and can never be more than one. The row draws them the same way because a
 * reader is asking "who is in this meeting", not "which table are they in".
 *
 * The ones who actually TURNED UP come first — that is the `attended` flag,
 * the nearest thing the list has to "the speakers were identified" — so a
 * held meeting's stack shows the people who were in the room.
 */
export function meetingPeople(m: MeetingRecord, locale: string): Array<{ key: string; name: string; attended: boolean }> {
  const members = m.attendees.map((a) => ({
    key: a.user_id, name: personName(a, locale), attended: a.attended,
  }));
  const guests = m.invitees.map((name) => ({ key: `invitee:${name}`, name, attended: false }));
  return [...members, ...guests].sort((a, b) => Number(b.attended) - Number(a.attended));
}

export function Meetings() {
  const t = useTranslations("meetings");
  const locale = useLocale();
  const router = useRouter();
  const [rows, setRows] = useState<MeetingRecord[] | null | "failed">(null);
  const [creating, setCreating] = useState(false);
  /* the SECOND way in. A separate dialog rather
     than a date field back inside the new-meeting one: that dialog is now
     «record this second», and a date on it would make its own primary
     button — «همین حالا ضبط کن» — a lie half the time. Two buttons, two
     sentences: the green one starts a call, the grey one writes a plan. */
  const [scheduling, setScheduling] = useState(false);
  /* the reference's own two axes: a view and a stage filter, plus topics */
  const [view, setView] = useState<"list" | "calendar">("list");
  /*
   * «همه» IS GONE (user, 2026-09-08: "remove the all, instead we have held and
   * upcomming and the held is the default front").
   *
   * The two that remain are exact COMPLEMENTS — every un-archived meeting is
   * either ahead-and-unrecorded or it is not — which is what makes removing
   * «همه» safe: with an overlap or a gap between them, dropping the catch-all
   * would have stranded rows in a list nobody can reach.
   *
   * «آرشیو» stays. It is not a third slice of the same set: an archived
   * meeting is EXCLUDED from both of the others by the read itself, so
   * removing the chip would strand every archived row rather than tidy the
   * strip.
   */
  const [filter, setFilter] = useState<"past" | "ahead" | "archived">("past");
  const [topic, setTopic] = useState<string>("all");
  /* the two controls beside the list: a search over the rows, and a sort with
     its own direction */
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"date" | "people" | "status">("date");
  const [descending, setDescending] = useState(true);
  const [condemned, setCondemned] = useState<MeetingRecord | null>(null);

  const load = useCallback(() => {
    void api.meetings({ archived: filter === "archived" })
      .then(setRows)
      .catch(() => setRows("failed"));
  }, [filter]);
  /* the same subscription the board takes: a meeting created in the assistant
     panel lands on this list without a reload (user report, 2026-09-04) */
  const meetingsEpoch = useRefreshEpoch("meetings");
  useEffect(load, [load, meetingsEpoch]);

  /* ?new=1 — the dashboard's «شروع ضبط جلسه» and the rail's CTA land here
     with the dialog already open, its time defaulted to the click moment.
     useSearchParams (the house pattern) rather than a mount-only read:
     the rail's link must work while ALREADY standing on /meetings. */
  const params = useSearchParams();
  useEffect(() => {
    if (params.get("new") === "1") setCreating(true);
  }, [params]);

  const refusal = () => notifyError(t("writeFailed"));

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
  useEffect(loadTopics, [loadTopics, meetingsEpoch]);
  /*
   * THE FACES, read once for the page.
   *
   * `meetingPeople` keys a member by their `user_id`, so the roster answers
   * every stack in the list from one request — and a guest with no account
   * keys as `invitee:…`, misses the map, and keeps their initial, which is
   * the only mark the product has for somebody it holds no row for.
   *
   * A failed roster read leaves the map EMPTY rather than the list broken: a
   * stack of initials is exactly what this screen showed before there were
   * photos, so the degradation is the old, correct picture (M21).
   */
  const [photos, setPhotos] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    void api.orgPeople()
      .then((people) => setPhotos(new Map(
        people.filter((p) => p.avatar_url !== null).map((p) => [p.id, p.avatar_url as string]),
      )))
      .catch(() => setPhotos(new Map()));
  }, []);
  /* ONE piece of state for naming a folder: `null` is closed, a row with no
     id is the NEW one. Two booleans said the same thing in three ways and
     could both be true at once — a state the screen has no picture for. */
  const [namingTopic, setNamingTopic] = useState<{ id: string | null; name: string } | null>(null);
  /* the topic the dropdown is standing on, or null for «همه جلسات» — which
     is the absence of a filter and so has nothing to rename or remove */
  const selectedTopic = topicRows.find((row) => row.id === topic) ?? null;

  const shown = useMemo(() => {
    if (!Array.isArray(rows)) return [];
    const now = Date.now();
    /* folded once, not per row: a locale-insensitive contains is the whole
       search, and `toLocaleLowerCase` on every field of every row for every
       keystroke is the same answer at twenty times the cost */
    const needle = query.trim().toLocaleLowerCase(locale);
    const kept = rows.filter((m) => {
      const ahead = new Date(m.scheduled_at).getTime() >= now && m.call_id === null;
      if (filter === "ahead" && !ahead) return false;
      /* «گذشته» is the COMPLEMENT of «پیش‌رو», not "has a recording": a
         meeting whose time has passed and was never recorded is past, and
         under the old spelling it belonged to neither chip. */
      if (filter === "past" && ahead) return false;
      if (topic !== "all" && m.topic_id !== topic) return false;
      if (needle !== "") {
        const hay = [
          m.title, m.description, m.topic ?? "", m.call_title ?? "",
          ...meetingPeople(m, locale).map((person) => person.name),
        ].join(" ").toLocaleLowerCase(locale);
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    const direction = descending ? -1 : 1;
    return kept.sort((a, b) => {
      /* the date is the TIE-BREAK for the other two, so a stack of meetings
         sharing a status or a headcount still reads in a stable order rather
         than in whatever order the wire happened to send them */
      const byDate = a.scheduled_at.localeCompare(b.scheduled_at);
      if (sort === "people") {
        const gap = meetingPeople(a, locale).length - meetingPeople(b, locale).length;
        return gap !== 0 ? gap * direction : byDate * direction;
      }
      if (sort === "status") {
        const gap = STATUS_RANK[meetingStatus(a)] - STATUS_RANK[meetingStatus(b)];
        return gap !== 0 ? gap * direction : byDate * direction;
      }
      return byDate * direction;
    });
  }, [rows, filter, topic, query, sort, descending, locale]);

  /* THE VIEW SWITCH'S KEY: the theme's icon button, rounded into a circle
     because the pair reads as a segmented switch (see the track below).
     `aria-label` and `aria-pressed` are not optional here — an icon-only
     control has no accessible name unless it is given one, and this is
     exactly the kind that is easy to leave nameless because the glyph
     "obviously" says list. */
  const viewKey = (mode: "list" | "calendar", label: string, icon: React.ReactNode) => (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={view === mode}
      onClick={() => setView(mode)}
      className={`${filterChipClass(view === mode)} px-2`}
    >
      {icon}
    </button>
  );

  /* 2026-09-08: the slice filter now wears the platform's segmented tab —
     the same track-and-pill the meeting's ItemsPanel tablist uses (a
     `rounded-xl bg-surface-2 p-1` rail, the selected one lifted out of it in
     `bg-surface` with `shadow-card`). It used to be three free-standing
     `.btn-sm` lozenges with the selected one filled solid accent, which read
     as three separate actions rather than one three-way switch. */
  const chip = (active: boolean, label: string, onClick: () => void) => (
    <button
      key={label}
      type="button"
      role="tab"
      aria-selected={active}
      aria-pressed={active}
      onClick={onClick}
      className={sectionTabClass(active)}
    >
      {label}
    </button>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* ── ROW ONE: the kit's track, and the two actions at its end ── */}
      <Toolbar
        end={(
          <>
            {/* GREY, and grey is the whole point: this is the secondary of the
                two — a row on a list — beside a primary that opens a
                microphone. `.btn-secondary` is the theme's own grey. */}
            <button
              type="button"
              onClick={() => setScheduling(true)}
              className="btn-secondary"
            >
              <IconCalendar width={14} height={14} />
              {t("scheduleMeeting")}
            </button>
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="btn btn-primary"
            >
              <IconPlus width={14} height={14} />
              {t("newMeeting")}
            </button>
          </>
        )}
      >
        <div role="tablist" className={TAB_TRACK}>
          {chip(filter === "past", t("filterPast"), () => setFilter("past"))}
          {chip(filter === "ahead", t("filterAhead"), () => setFilter("ahead"))}
          {chip(filter === "archived", t("filterArchived"), () => setFilter("archived"))}
        </div>
      </Toolbar>

      {/*
        * ── ONE TOOLBAR ROW ───────────────────────────────────────
        *
        * User, 2026-09-08: "it should be like a horizontal tool bar and not
        * full width … the filtering should be topic with drop down and not
        * folders, and not a list of fully width vertical items, one row with
        * dropdowns".
        *
        * TWO things were wrong and they had the same cause. The folders were
        * a STRIP — one chip per topic, wrapping onto its own line as soon as
        * there were four of them — and the search and the sort were laid out
        * as `flex-1` and `w-full` controls, so each took the page's whole
        * width and stacked. Three stacked full-width bands above a list is
        * not a toolbar; it is a form.
        *
        * So every control here is SIZED TO ITS CONTENT and they share one
        * line: a search box that stops at 18rem, the topic as a dropdown
        * whose height is fixed however many topics exist, the sort field and
        * its direction key. `flex-wrap` is kept for the narrow viewport,
        * where wrapping is the correct answer rather than the accident.
        */}
      <div className={TOOLBAR_GROUPS}>
      {/*
        * ── THE SORT, AS THE SECOND SUB-MENU ──────────────────────────────
        *
        * User, 2026-09-15: "for the meeting table fix the sort as the second
        * top sub menu like the last image" — the image being the security
        * page's «همه ۱۶ | آنلاین ۴ | آفلاین ۱۲».
        *
        * It was a `w-[11rem]` dropdown in the row above, which cost two
        * presses to see three options and was the one control on the page
        * with a silhouette nothing else shares. `FilterChips` is the shape
        * every other second row in the product already wears (security, the
        * audit log, the workflow shelf, both boards' strips), so this page
        * stops being the exception rather than gaining a fourth dialect.
        *
        * NO `FILTER_ROW_GAP` HERE, and that is not an oversight: the class is
        * `mb-3`, the parent is already `flex-col gap-3`, and wearing both
        * would put 24px under a row the rest of the product sets at 12.
        *
        * THE DIRECTION STAYS A SEPARATE KEY, for the reason the dropdown's
        * own note gave and this move does not change: the field and the
        * direction are two questions, and folding them together means six
        * chips that grow by two every time a sort field is added.
        */}
      <FilterChips
        label={t("sortBy")}
        active={sort}
        onSelect={setSort}
        chips={[
          { key: "date", label: t("sortDate"), icon: <IconCalendar width={12} height={12} /> },
          { key: "people", label: t("sortPeople"), icon: <IconPeople3 width={12} height={12} /> },
          { key: "status", label: t("sortStatus"), icon: <IconCheckCircle width={12} height={12} /> },
        ]}
      >
        <span className={TRACK_DIVIDER} aria-hidden />
        <button
          type="button"
          aria-label={descending ? t("sortDescending") : t("sortAscending")}
          title={descending ? t("sortDescending") : t("sortAscending")}
          aria-pressed={descending}
          onClick={() => setDescending((v) => !v)}
          className={filterChipClass(false)}
        >
          {descending
            ? <IconArrowDown width={14} height={14} />
            : <IconArrowUp width={14} height={14} />}
        </button>
      </FilterChips>
        <label className="relative w-full sm:w-[18rem]">
          <span className="sr-only">{t("searchMeetings")}</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchMeetings")}
            className="input ps-9"
          />
          <span
            aria-hidden
            className="pointer-events-none absolute top-1/2 -translate-y-1/2 text-fg-subtle"
            style={{ insetInlineStart: "0.75rem" }}
          >
            <IconSearch width={14} height={14} />
          </span>
        </label>

        {/*
          * THE TOPIC, AS A DROPDOWN.
          *
          * The strip could show a count per folder and this cannot show more
          * than one at a time, so the count travels INTO the label — the
          * number was the strip's one advantage and losing it silently would
          * be trading a fact for a layout.
          *
          * `Select` is `w-full` by its own class, which is what made the last
          * attempt span the page: the width belongs to the WRAPPER, not to a
          * `w-auto` written beside a `w-full` that outranks it in the
          * stylesheet. That is why these two sit in fixed-width boxes.
          */}
        <div className="w-[11rem] shrink-0">
          <Select
            value={topic}
            ariaLabel={t("fieldTopicFolder")}
            /*
             * «موضوع جدید» IS THE LAST ROW (user, 2026-09-08: "new topic
             * should be at the last item in the dropdown").
             *
             * It is an ACTION in a list of values, which is the thing this
             * file's own note above the folder menu argues against — and the
             * distinction that makes it right here is which noun it acts on.
             * Rename and remove act on the CURRENT selection, so as options
             * they would be rows that change the meaning of the row above
             * them; «موضوع جدید» acts on nothing and adds a value to this
             * very list, which is why every picker in every product puts it
             * exactly here. It stays LAST so the list's own values are never
             * pushed down the panel as folders are added.
             *
             * The sentinel is filtered out before it can reach `topic`: a
             * meeting whose `topic_id` is the string "__new" is not a state
             * this list can produce, and the guard is what keeps it that way.
             */
            onChange={(next) => {
              if (next === "__new") { setNamingTopic({ id: null, name: "" }); return; }
              setTopic(next);
            }}
            options={[
              {
                value: "all",
                label: `${t("allMeetings")} (${digits(Array.isArray(rows) ? rows.length : 0, locale)})`,
              },
              ...topicRows.map((row) => ({
                value: row.id,
                label: `${row.name} (${digits(Array.isArray(rows) ? rows.filter((m) => m.topic_id === row.id).length : 0, locale)})`,
              })),
              /* the + says this row ACTS rather than selects, before it is
                 pressed — it rides the same
                 leading slot a value's colour dot would */
              { value: "__new", label: t("addTopic"), icon: <IconPlus width={12} height={12} /> },
            ]}
          />
        </div>

        {/*
          * THE FOLDER ACTIONS, which the strip carried per chip.
          *
          * They cannot live in the dropdown — a listbox row is a VALUE, and
          * an option that renames itself when picked is a control pretending
          * to be a choice — so they are one menu beside it. Rename and remove
          * act on the SELECTED topic and are disabled while «همه جلسات» is
          * chosen: that entry is the absence of a filter, and offering to
          * rename it would be a menu over a fiction (the strip's own rule,
          * kept).
          */}
        {/*
          * NAMING A FOLDER IS A DIALOG NOW.
          *
          * The inline box REPLACED the picker while it was open, so the list
          * a person had just been reading vanished under a 144px field — and
          * the act it belongs to is reached from inside that list's own
          * dropdown, which closes to reveal the box that took its place.
          * A dialog leaves the row where it was and gives the field the
          * width a folder name deserves.
          *
          * BOTH jobs, not only the new one. Renaming is the same interaction
          * with a starting value, and converting one would have left two
          * shapes for one act inside a single component — which is the drift
          * this dialog exists to end rather than start.
          */}
        <KebabMenu
            label={t("topicOptions")}
            triggerClassName="btn btn-icon shrink-0 border border-border text-fg-muted hover:text-fg"
            items={[
              /* «موضوع جدید» left this menu for the dropdown's last row on
                 2026-09-08. Two doors to one box is how they drift. */
              {
                key: "rename",
                label: t("renameTopic"),
                icon: <IconPencil width={14} height={14} />,
                disabled: selectedTopic === null,
                onSelect: () => {
                  if (selectedTopic !== null) setNamingTopic({ id: selectedTopic.id, name: selectedTopic.name });
                },
              },
              {
                key: "remove",
                label: t("removeTopic"),
                icon: <IconTrash width={14} height={14} />,
                danger: true,
                disabled: selectedTopic === null,
                /* ARCHIVED, not deleted: the meetings in it are re-pointed
                   to no-folder by the schema, and a folder that vanished
                   would take the answer to "where did that go" with it */
                onSelect: () => {
                  if (selectedTopic === null) return;
                  void api.updateMeetingTopic(selectedTopic.id, { archived: true })
                    .then(() => { setTopic("all"); loadTopics(); load(); })
                    .catch(refusal);
                },
              },
            ]}
        />

        {/* THE SORT MOVED OUT OF THIS ROW — see the chip row below. */}

        {/*
          * THE VIEW SWITCH, AT THE FAR END OF THIS SAME LINE (user,
          * 2026-09-08: "should be at the right most at the same toolbar
          * line"). `ms-auto` rather than a spacer element — the gap is a
          * consequence of there being nothing else to put there, and a
          * `flex-1` filler would be an element in the tree that means
          * nothing to a reader of it.
          *
          * FULLY ROUNDED, also asked for the same day ("the calender list at
          * the end, highlighted should be fully rounded"). `.btn-icon`'s own
          * corner is the theme's 8px, which on a 28px square reads as a
          * pressed toolbar key; a circle inside a pill-shaped track reads as
          * a SEGMENTED SWITCH, which is what this pair is. `rounded-full` is
          * a utility and `.btn-icon` a component class, so the utility layer
          * wins on its own and no `!` is needed.
          */}
        <div className={`${FILTER_TRACK} ms-auto`}>
          {viewKey("list", t("viewMeetingList"), <IconRows width={14} height={14} />)}
          {viewKey("calendar", t("viewMeetingCalendar"), <IconCalendar width={14} height={14} />)}
        </div>
      </div>


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
                {/*
                  * THE META LINE, AFTER THE 2026-09-08 CUT.
                  *
                  * «آپلود فایل» and «۰ بند» left it in that cut, and neither
                  * is a loss: the
                  * mode is a fact about how the recorder will be opened, which
                  * is the meeting page's business, and an agenda count of zero
                  * — which is what almost every row said — is a number whose
                  * only reading is "nothing here".
                  *
                  * What stands in their place is the DATE, the LENGTH, and
                  * WHO IS IN IT.
                  */}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-fg">{m.title}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-caption text-fg-subtle">
                    <span>
                      {formatDate(m.scheduled_at, locale)}
                      {t("dateAtTime", { time: formatTime(m.scheduled_at, locale) })}
                    </span>
                    {/* the LENGTH, and only when there is one. `duration_minutes`
                        is nullable on the wire and null is a real state — a
                        meeting nobody has timed — so an unset length is an
                        ABSENT chip rather than a «۰ دقیقه» that reads as a
                        measurement somebody took. */}
                    {m.duration_minutes !== null ? (
                      <>
                        <span>·</span>
                        <span>{formatDuration(m.duration_minutes * 60, locale)}</span>
                      </>
                    ) : null}
                  </span>
                </span>
                <PeopleStack meeting={m} locale={locale} photos={photos} />
                {/*
                  * THE STATUS PILL. The tone follows the word rather than the
                  * field: green is the finished take, danger is the take being
                  * made RIGHT NOW (the recording dot's own colour, so a live
                  * row is findable down a long list), the accent is one in the
                  * pipeline, and the quiet surface is a meeting that has not
                  * happened yet.
                  */}
                {(() => {
                  const status = meetingStatus(m);
                  return (
                    <span className={`shrink-0 rounded-lg px-2 py-1 text-caption font-medium ${
                      status === "done" ? "bg-success/10 text-success"
                        : status === "ongoing" ? "bg-danger/10 text-danger"
                          : status === "processing" ? "bg-accent-soft text-accent"
                            : "bg-surface-2 text-fg-muted"
                    }`}>
                      {/* literal keys, not `t(`status_${status}`)`: the message
                          scanner reads literal calls only, and a computed key
                          is a key nothing checks exists in both locales */}
                      {status === "done" ? t("status_done")
                        : status === "ongoing" ? t("status_ongoing")
                          : status === "processing" ? t("status_processing")
                            : t("status_upcoming")}
                    </span>
                  );
                })()}
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

      {namingTopic !== null ? (
        <TopicDialog
          topic={namingTopic}
          onClose={() => setNamingTopic(null)}
          onDone={() => { setNamingTopic(null); loadTopics(); load(); }}
          onRefused={refusal}
        />
      ) : null}

      {creating ? (
        <NewMeetingDialog
          topics={topicRows}
          onClose={() => setCreating(false)}
          onCreated={(m) => {
            setCreating(false);
            load();
            /*
             * EVERY NEW CALL OPENS NOW, because every new call IS now
             * (2026-09-08). The branch that stood here — open it if it is
             * due, leave it on the list if it is a plan — was the right
             * answer while this dialog could write a FUTURE meeting; with
             * the date gone there is no second case left for it to decide,
             * and a condition with one reachable arm reads as a rule the
             * next person has to disprove.
             *
             * NO `?stage=` ANY MORE (2026-09-08). The parameter existed to
             * put somebody in «حین جلسه» past a stepper, and the stepper is
             * gone: the meeting page reads its own record now, so a meeting
             * with no take and a microphone lane IS the live screen and an
             * upload IS the processing card. One address, and it cannot
             * disagree with the pipeline.
             */
            router.push(`/meetings/${m.id}`);
          }}
          onRefused={refusal}
        />
      ) : null}

      {scheduling ? (
        <ScheduleMeetingDialog
          topics={topicRows}
          onClose={() => setScheduling(false)}
          onCreated={() => {
            setScheduling(false);
            /* THE FILTER MOVES WITH IT. A meeting written for next Tuesday is
               by definition not in «برگزارشده», which is the slice this list
               opens on — leaving the filter alone would have answered a
               successful write with a list that does not contain the row. */
            setFilter("ahead");
            load();
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

/**
 * WHO IS IN THE MEETING, as a stack of marks (user, 2026-09-08: "the
 * participants — profile pictures of the participants").
 *
 * FOUR, then a count. A row is 68px of horizontal space shared with a title,
 * a date and a status, and a twelve-person meeting drawn in full is a strip
 * of circles that pushes all three out — so the stack shows the four at the
 * front and says how many it did not draw. The overlap (`-space-x-1`) is what
 * makes four marks read as one group rather than four separate facts.
 *
 * WHY THE OVERLAP IS 4px AND NOT 8px. The mark is 20px wide with its initial
 * on the centre line, so the letter's ink sits around x=10, and the circle in
 * front carries a 2px surface ring that eats 2px more of the one behind it.
 * At `-space-x-2` only 10px of the back circle survived — the boundary landed
 * exactly on its letter and every mark but the frontmost read as a half-cut
 * glyph lying across the next circle. 4px leaves 14px, which clears the
 * initial with room on both sides and still overlaps enough to read as a
 * group.
 *
 * The `title` carries EVERY name, including the ones behind the +N, because
 * the truncation must not be the only copy of the roster.
 *
 * `Avatar` draws the initial when there is no photo, which is every person
 * here: `MeetingAttendee` carries names and a `attended` flag and no
 * `avatar_url`. That is the wire's shape, not a stub — when the roster grows
 * a photo the mark picks it up through `src` with nothing else changing.
 */
function PeopleStack({ meeting, locale, photos }: {
  meeting: MeetingRecord;
  locale: string;
  /* user_id → photo, from the ORG ROSTER rather than from the meeting row.
     A meeting's attendee list names people; it does not carry their pictures,
     because an avatar is ~8 KB of `data:` URL and a list of a dozen meetings
     would send the same face back a dozen times. One roster read answers for
     every stack on the page. */
  photos: Map<string, string>;
}) {
  const t = useTranslations("meetings");
  const people = meetingPeople(meeting, locale);
  if (people.length === 0) return null;
  const SHOWN = 4;
  const front = people.slice(0, SHOWN);
  const hidden = people.length - front.length;
  return (
    <span
      className="hidden shrink-0 items-center sm:flex"
      title={people.map((person) => person.name).join("، ")}
      aria-label={t("peopleCount", { n: digits(people.length, locale) })}
    >
      <span className="flex -space-x-1 rtl:space-x-reverse">
        {front.map((person) => (
          <Avatar
            key={person.key}
            name={person.name}
            src={photos.get(person.key) ?? null}
            size="xs"
            ring="surface"
          />
        ))}
      </span>
      {hidden > 0 ? (
        <span className="badge-num ms-1.5 text-caption text-fg-subtle">
          {t("peopleMore", { n: digits(hidden, locale) })}
        </span>
      ) : null}
    </span>
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
          <li key={i} className="text-center text-micro text-fg-subtle">{day}</li>
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
                  className="block w-full truncate rounded-md bg-accent-soft px-1.5 py-0.5 text-start text-micro leading-4 text-accent">
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

/**
 * THE TWO LANES A NEW CALL CAN TAKE.
 *
 * `online` is gone from the PICKER, not from the product: meetings already
 * held that way carry `mode: "online"` for good, and their page still knows
 * what to do with the room and the share. Deleting the mode itself would
 * rewrite history to say those meetings were something they were not — what
 * the directive asks for is that nobody can choose it again.
 */
function ModePicker({ value, onChange }: { value: MeetingMode; onChange: (m: MeetingMode) => void }) {
  const t = useTranslations("meetings");
  return (
    <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("fieldMode")}>
      {(["upload", "in_person"] as const).map((mode) => (
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

/*
 * `InviteeInput` and `AgendaEditor` LEFT WITH THE PLAN (2026-09-08).
 *
 * They were the meeting page's «دعوت‌شدگان» and «دستور جلسه» editors, and
 * that page has no plan stage any more. Deleted rather than left exported:
 * a component
 * nobody renders is the next person's invitation to render it, and those
 * two were the only reason this file exported anything but the list.
 *
 * The DATA is untouched — `meeting.agenda` and `meeting.invitees` are still
 * on the wire and still written by the agents' own tools.
 */

/**
 * NAMING A FOLDER, IN A BOX OF ITS OWN.
 *
 * `topic.id === null` is the NEW folder and anything else is a rename — one
 * component for the two jobs because they are the same interaction with a
 * different starting value, which is the reasoning the inline box it replaces
 * carried and the half of it worth keeping.
 *
 * The dialog's own anatomy is the new-meeting dialog's, deliberately: the
 * same header with its ×, the same `DIALOG_BODY` rhythm, the same footer pair
 * at the same heights. A second dialog shape for a one-field form is how a
 * product comes to have four.
 */
function TopicDialog({ topic, onClose, onDone, onRefused }: {
  topic: { id: string | null; name: string };
  onClose: () => void;
  onDone: () => void;
  onRefused: () => void;
}) {
  const t = useTranslations("meetings");
  const [name, setName] = useState(topic.name);
  const [busy, setBusy] = useState(false);
  const ready = name.trim() !== "" && !busy;

  const submit = () => {
    if (!ready) return;
    setBusy(true);
    const value = name.trim();
    void (topic.id !== null
      ? api.updateMeetingTopic(topic.id, { name: value })
      : api.createMeetingTopic(value).then(() => undefined))
      .then(onDone)
      .catch(() => { setBusy(false); onRefused(); onDone(); });
  };

  const title = topic.id === null ? t("addTopic") : t("renameTopic");
  return (
    <Overlay onClose={onClose} label={title} size="sm">
      <div className="mb-1 flex items-start justify-between gap-3">
        <h2 className="text-base font-bold text-fg">{title}</h2>
        <button type="button" aria-label={t("close")} onClick={onClose}
          className="btn btn-icon shrink-0 border border-border text-fg-subtle hover:text-fg">
          <IconClose width={14} height={14} />
        </button>
      </div>
      <div className={DIALOG_BODY}>
        <Field label={t("fieldTopicFolder")}>
          {/* ENTER COMMITS, the one habit the inline box taught that a dialog
              must not lose — a single-field form where the keyboard cannot
              finish is a form that asks for the mouse back */}
          <input
            autoFocus
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            placeholder={t("topicNamePlaceholder")}
            className="input"
          />
        </Field>
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
        <button type="button" onClick={onClose}
          className="btn border border-border text-fg">
          {t("cancel")}
        </button>
        <button type="button" onClick={submit} disabled={!ready}
          className="btn bg-accent text-on-accent shadow-accent">
          {t("save")}
        </button>
      </div>
    </Overlay>
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
 * THE NEW CALL, AND IT IS ALWAYS NOW.
 *
 * What went with the scheduling is everything that only existed to describe
 * a meeting that had not happened yet — the date, the time, the length and
 * the description. A call started this second HAS a time (this one) and gets
 * its length from the recording; asking for either was asking somebody to
 * restate a fact the product already holds. The description still exists and
 * is still editable, on the meeting's own «پیش از جلسه» card, which is where
 * a plan belongs.
 *
 * So the wizard is three questions — WHAT it is called, WHICH folder it goes
 * in, and HOW its audio arrives — and the mode decides the last step:
 *
 *   · upload    → a drop zone, and the file is sent BEFORE the meeting row
 *                 exists, so a refused file leaves nothing behind;
 *   · in person → «همین حالا ضبط کن», which lands in «حین جلسه» with the
 *                 take already starting.
 *
 * «پیش‌رو» stays on the list: the calendar import will put meetings there,
 * and the filter is how somebody will read them. THIS dialog is simply not
 * the way to write one — `ScheduleMeetingDialog`, behind the grey button
 * beside the green one, is. The directive above
 * held for one dialog, not for the product: what it refused was a date field
 * sitting under a primary that says «همین حالا ضبط کن», and that is still
 * refused here.
 */
/**
 * THE THREE REFUSALS A PERSON CAN ACT ON, answered with no network.
 *
 * `uploadAudioFile` judges the same three before it sends a byte — this is
 * that judgement moved forward, not a second opinion, and it reads the SAME
 * rules module so the two cannot come to different answers. Everything else
 * that can go wrong (a signed URL, a refused part, the connection) needs the
 * network to find out and is the page's to report.
 *
 * The size is asked FIRST: a 900MB file is refused without waiting on a
 * decode, which is `uploadAudioFile`'s own ordering and its own reason.
 */
async function refuseFile(file: File): Promise<"uploadNotAudio" | "uploadTooBig" | "uploadTooLong" | null> {
  if (audioContentType(file) === null) return "uploadNotAudio";
  const oversize = uploadRejection(file.size, null);
  if (oversize?.reason === "tooBig") return "uploadTooBig";
  const rejection = uploadRejection(file.size, await readDurationSeconds(file));
  if (rejection?.reason === "tooBig") return "uploadTooBig";
  if (rejection?.reason === "tooLong") return "uploadTooLong";
  return null;
}

function NewMeetingDialog({ topics, onClose, onCreated, onRefused }: {
  topics: Array<{ id: string; name: string }>;
  onClose: () => void;
  onCreated: (m: MeetingRecord) => void;
  onRefused: () => void;
}) {
  const t = useTranslations("meetings");
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("");
  /* IN PERSON is the default because «همین حالا ضبط کن» is what this dialog
     is for now: the upload lane is the one you arrive at with a file already
     in hand, and that person changes one tile on the way past. */
  const [mode, setMode] = useState<MeetingMode>("in_person");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  /* The upload's refusals used to be said HERE, on the reasoning that a
     toast on the list BEHIND this dialog is a sentence about a control the
     reader can no longer see. That reasoning is spent (2026-09-08): the
     stack rises in the middle of the screen, above the modal layer's
     content, so the sentence now lands on top of the very control it is
     about rather than behind it. */

  const ready = title.trim() !== "" && !busy && (mode !== "upload" || file !== null);

  /** the row, and the file that follows it to the meeting's own page */
  const create = (upload?: File) => {
    void api.createMeeting({
      title: title.trim(),
      /* NOW, read at the press rather than at the mount: a dialog left open
         while somebody found their file would otherwise stamp the call with
         the moment they opened it. */
      scheduled_at: new Date().toISOString(),
      mode,
      topic_id: topic === "" ? undefined : topic,
    })
      .then((m) => {
        /* the hand-off is set BEFORE the navigation, because the page reads
           it on its first render — see lib/pendingUpload for why a module
           variable is the right durability here */
        if (upload !== undefined) stashUpload(m.id, upload);
        onCreated(m);
      })
      .catch(() => { setBusy(false); onRefused(); });
  };

  const submit = () => {
    if (!ready) return;
    setBusy(true);
    if (mode !== "upload") { create(); return; }
    /*
     * THE FILE IS JUDGED HERE AND SENT THERE.
     *
     * The send used to happen in this dialog, which meant an hour of audio
     * held a modal open behind a disabled button. It happens on the
     * meeting's own page now, under the processing card.
     *
     * What stays is the JUDGEMENT, and it stays because it is free: the
     * kind, the size and the length are all answered locally, with no
     * network, so the three refusals that a person can actually fix are
     * still found before a meeting row exists. Only a genuine transport
     * failure can now leave a meeting with no record — and that one has a
     * page, a sentence and its own upload button, which is a better place
     * to meet it than a dialog that has already been waiting.
     */
    void refuseFile(file as File).then((refusal) => {
      if (refusal !== null) { setBusy(false); notifyError(t(refusal)); return; }
      create(file as File);
    }).catch(() => { setBusy(false); notifyError(t("uploadFailed")); });
  };

  return (
    <Overlay onClose={onClose} label={t("newMeeting")} size="md">
      <div className="mb-1 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-fg">{t("newMeeting")}</h2>
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
      <div className={DIALOG_BODY}>
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
          <ModePicker
            value={mode}
            onChange={(next) => {
              setMode(next);
              /* leaving the upload lane drops the file with it: a chosen file
                 that is no longer on screen is a thing the next press would
                 send without anybody having said so */
              if (next !== "upload") setFile(null);
            }}
          />
        </div>
        {/* THE DROP ZONE, only for the lane it belongs to. It is a LABEL over
            a hidden
            input rather than a div with a click handler, so the keyboard and
            the screen reader get the file picker for free — the same control
            a mouse gets, not a second one bolted on. */}
        {mode === "upload" ? (
          <DropZone file={file} onFile={setFile} />
        ) : null}
      </div>
      {/* audit finding, 2026-09-02: the pair was 40px tall with the 16px tile
          corner, while the «جلسه جدید» button that OPENED this dialog is the
          38px, 11px-cornered `.btn` — the primary action changed shape between
          the page and its own dialog. `.btn` owns height, corner, padding and
          the disabled state now (the local `disabled:opacity-50` restated what
          the class already does). This was the control guard's one worklist
          entry for this file; the entry is gone with it. */}
      <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
        <button type="button" onClick={onClose}
          className="btn border border-border text-fg">
          {t("cancel")}
        </button>
        {/*
          * THE PRIMARY SAYS WHAT WILL HAPPEN, and the two lanes do different
          * things. «ساختن جلسه» was true when this dialog only wrote
          * a row; now one press opens a microphone and the other sends a
          * file, and a button that names neither is the screen keeping a
          * secret about the more consequential of the two.
          */}
        <button type="button" onClick={submit} disabled={!ready}
          className="btn bg-accent text-on-accent shadow-accent">
          {mode === "upload"
            ? <>{MODE_ICON.upload}{busy ? t("uploading") : t("uploadAndProcess")}</>
            : <>{MODE_ICON.in_person}{t("recordNow")}</>}
        </button>
      </div>
    </Overlay>
  );
}

/**
 * THE MEETING THAT HAS NOT HAPPENED YET.
 *
 * This is the half that left `NewMeetingDialog` when that dialog became
 * «record this second» — the date and the time — given a door of its own
 * rather than put back beside a primary button that says «همین حالا ضبط
 * کن». The rule the two dialogs split on is simple and visible in their
 * primaries: one of them STARTS something and navigates, this one WRITES a
 * row and stays, so the list can show you where it landed.
 *
 * `mode` is `in_person` with no picker. The choice on the other dialog is
 * between a microphone and a FILE, and a file is not a thing a future
 * meeting can have; `online` is not offered anywhere any more (see
 * ModePicker). One reachable answer is a fact, not a question.
 *
 * The time is judged HERE, before the write: a "plan" in the past is
 * indistinguishable from a held meeting to the list's own filter, so it
 * would vanish out of «پیش‌رو» the moment it was made.
 */
function ScheduleMeetingDialog({ topics, onClose, onCreated, onRefused }: {
  topics: Array<{ id: string; name: string }>;
  onClose: () => void;
  onCreated: (m: MeetingRecord) => void;
  onRefused: () => void;
}) {
  const t = useTranslations("meetings");
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("");
  /* the NEXT round hour, today — the commonest thing a person means by
     "schedule a meeting" and one they can change in two presses */
  const [date, setDate] = useState(() => {
    const d = new Date();
    d.setHours(d.getHours() + 1, 0, 0, 0);
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${mm}-${dd}`;
  });
  const [time, setTime] = useState(() => {
    const d = new Date();
    d.setHours(d.getHours() + 1, 0, 0, 0);
    return `${String(d.getHours()).padStart(2, "0")}:00`;
  });
  const [busy, setBusy] = useState(false);

  const ready = title.trim() !== "" && date !== "" && time !== "" && !busy;

  const submit = () => {
    if (!ready) return;
    /* LOCAL time in, UTC on the wire. `new Date("2026-09-09T14:30")` with no
       zone is read in the browser's own — which is the zone the person just
       chose it in — and `toISOString` is what the server stores. */
    const at = new Date(`${date}T${time}`);
    if (Number.isNaN(at.getTime())) { notifyError(t("schedulePast")); return; }
    if (at.getTime() <= Date.now()) { notifyError(t("schedulePast")); return; }
    setBusy(true);
    void api.createMeeting({
      title: title.trim(),
      scheduled_at: at.toISOString(),
      mode: "in_person",
      topic_id: topic === "" ? undefined : topic,
    })
      .then(onCreated)
      .catch(() => { setBusy(false); onRefused(); });
  };

  return (
    <Overlay onClose={onClose} label={t("scheduleMeeting")} size="md">
      <div className="mb-1 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-fg">{t("scheduleMeeting")}</h2>
          <p className="mt-0.5 text-xs text-fg-muted">{t("scheduleMeetingSubtitle")}</p>
        </div>
        <button type="button" aria-label={t("close")} onClick={onClose}
          className="btn btn-icon shrink-0 border border-border text-fg-subtle hover:text-fg">
          <IconClose width={14} height={14} />
        </button>
      </div>
      <div className={DIALOG_BODY}>
        <Field label={t("fieldTitleRequired")}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="input"
            placeholder={t("titlePlaceholder")} />
        </Field>
        <Field label={t("fieldTopicFolder")}>
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
        {/* the platform's own pickers, not the browser's: `<input type="date">`
            draws a Gregorian popup on a Persian-first product — the whole
            reason components/DateTimeFields.tsx exists. */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <span className="mb-1 block text-xs font-medium text-fg-muted">{t("fieldDate")}</span>
            <DateField value={date} onChange={setDate} />
          </div>
          <div>
            <span className="mb-1 block text-xs font-medium text-fg-muted">{t("fieldTime")}</span>
            <TimeField value={time} onChange={setTime} />
          </div>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
        <button type="button" onClick={onClose}
          className="btn border border-border text-fg">
          {t("cancel")}
        </button>
        <button type="button" onClick={submit} disabled={!ready}
          className="btn bg-accent text-on-accent shadow-accent">
          <IconCalendar width={14} height={14} />
          {t("scheduleIt")}
        </button>
      </div>
    </Overlay>
  );
}

/**
 * THE FILE, DRAGGED OR CHOSEN.
 *
 * `dragDepth` is a counter, not a boolean: `dragleave` fires when the
 * pointer crosses into a CHILD of the zone, so a boolean flickers the
 * highlight off every time the cursor passes over the icon or the text
 * inside it. Counting enter and leave together is what makes the state
 * "the pointer is somewhere inside" rather than "the last event was enter".
 *
 * The zone accepts ONE file and never validates it: the kind, the size and
 * the length are `uploadAudioFile`'s to judge, and a second opinion here
 * would be a second set of limits to keep in step with the server's.
 */
function DropZone({ file, onFile }: { file: File | null; onFile: (f: File | null) => void }) {
  const t = useTranslations("meetings");
  const input = useRef<HTMLInputElement | null>(null);
  const [over, setOver] = useState(false);
  const depth = useRef(0);

  const take = (list: FileList | null) => {
    const picked = list?.[0];
    if (picked !== undefined) onFile(picked);
  };

  /* THE THEME'S OWN RECESSED ROW (R7): a chosen file is a row INSIDE the
     dialog's body, which is exactly what `.well` is — the hand-rolled recipe
     it replaced was the surface guard's one finding on this file.

     A plain block comment, above the return: a braced JSX comment in the
     first slot of a `return (` is a syntax error, and the note two hundred
     lines up in this file records the same lesson from the other direction. */
  if (file !== null) {
    return (
      <div className="well flex items-center gap-2">
        <IconUpload width={14} height={14} />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-fg">{file.name}</span>
        <button type="button" aria-label={t("removeFile")} onClick={() => onFile(null)}
          className="btn btn-icon shrink-0 border border-border text-fg-subtle hover:text-fg">
          <IconClose width={12} height={12} />
        </button>
      </div>
    );
  }

  return (
    <label
      onDragEnter={(e) => { e.preventDefault(); depth.current += 1; setOver(true); }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => { depth.current -= 1; if (depth.current <= 0) { depth.current = 0; setOver(false); } }}
      onDrop={(e) => {
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        take(e.dataTransfer.files);
      }}
      className={`flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border border-dashed px-4 py-6 text-center transition-colors ${
        over ? "border-accent bg-accent-soft text-accent" : "border-border bg-surface text-fg-muted hover:border-border-strong"
      }`}
    >
      <IconUpload width={18} height={18} />
      <span className="text-xs font-medium">{t("dropAudio")}</span>
      <span className="text-caption text-fg-subtle">{t("dropAudioBrowse")}</span>
      <input
        ref={input}
        type="file"
        accept="audio/*,video/mp4,video/webm"
        className="sr-only"
        onChange={(e) => { take(e.target.files); e.target.value = ""; }}
      />
    </label>
  );
}
