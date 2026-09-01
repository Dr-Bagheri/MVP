"use client";

import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";

import { api, BffError } from "@/api/client";
import { Link } from "@/i18n/routing";
import { KebabMenu, SelectMenu } from "@/components/rowActions";
import { StatusDot } from "@/components/DataTable";
import {
  Icon, IconCalendar, IconCheck, IconChevronRight, IconGavel, IconGlobe, IconMic, IconPause,
  IconPlay, IconPulse, IconSettings,
} from "@/components/icons";
import { EchoMark } from "@/components/platform/icons";
import { dayKeyOf, digits, formatDate, formatTime, hourInResolvedZone, monthGrid, weekRangeLabel, weekStrip } from "@/lib/format";
import { useCalendarPreference, useTimezonePreference } from "@/lib/usePreferences";
import { useAgentCopy } from "@/components/platform/agentAppearance";
import {
  INTEGRATIONS, useIntegrationCopy,
} from "@/components/platform/integrationsCatalogue";
import {
  finish, pause, recorderSnapshot, resume, startRecording, subscribeRecorder,
} from "@/lib/recordingEngine";
import { rowsFor, type TileSize } from "@/lib/dashboardLayout";
import type {
  AgentCard, Call, ConnectorItem, ConnectorStatus, MeetingRecord,
} from "@/api/types";

/**
 * THE MINI WIDGETS — the platform's functions in small (user directive,
 * 2026-08-29: "the functions we have in the platform in mini version").
 *
 * The board that came back keeps its grid, its sizes and its drag; what
 * changed is what sits in the tiles. Each of these shows ONE list at a
 * glance and gets out of the way — the full surface is one click along, and
 * a tile that tried to be the full surface would be a worse copy of it.
 *
 * ── each fetches its own ─────────────────────────────────────────────────
 * The old board shared one `useDashboardData` read across every tile, which
 * meant a board showing two cards paid for all fifteen. These need members,
 * connectors, agents, workflows and a calendar — five more reads — so each
 * widget asks for what IT needs, the way the agent panel does. A tile nobody
 * put on their board costs nothing at all.
 *
 * ── the shared shape ────────────────────────────────────────────────────
 * `null` is "not answered yet" and renders an ellipsis; `[]` is "answered,
 * and there is nothing" and renders a sentence; `"failed"` says the read did
 * not land. Keeping the three apart is why an empty organization does not
 * look like a broken tile, and why a broken tile does not sit there looking
 * patient.
 */

/**
 * The states a tile can be in, and they are not interchangeable:
 *
 *   null          still asking
 *   T[]           answered — possibly with nothing in it, which is a fact
 *                 about the ORGANIZATION
 *   "forbidden"   a 403: this person may not see this list. Not an outage,
 *                 and not an empty company — a permission
 *   "absent"      a 404: there is no such thing to read. For the calendar
 *                 that is the ordinary state of "nobody connected Google"
 *   "failed"      anything else — a real fault, and the only one worth an
 *                 apology
 *
 * Flattening the middle two into "failed" is the bug this repo keeps
 * finding: a member would read "we could not load your colleagues" about a
 * list they are simply not entitled to, and an unconnected calendar would
 * apologise instead of offering the way to connect one.
 */
type MiniState<T> = T[] | null | "forbidden" | "absent" | "failed";

function useMini<T>(read: () => Promise<T[]>): MiniState<T> {
  const [state, setState] = useState<MiniState<T>>(null);
  useEffect(() => {
    let alive = true;
    void read()
      .then((rows) => { if (alive) setState(rows); })
      .catch((error: unknown) => {
        if (!alive) return;
        const status = error instanceof BffError ? error.status : 0;
        setState(status === 403 ? "forbidden" : status === 404 ? "absent" : "failed");
      });
    return () => { alive = false; };
    // the reader is defined at the call site and stable for this tile's life
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return state;
}

/**
 * A read that did not land says SO. A dash means "we have not counted yet"
 * and resolves on its own; a failure never will, so a tile that kept showing
 * the dash would be lying by waiting.
 */
export function Unreadable({ children }: { children?: ReactNode }) {
  const t = useTranslations("dashboard");
  return (
    <p className="ink-muted flex items-center gap-2 text-sm leading-7">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" aria-hidden />
      {children ?? t("readFailed")}
    </p>
  );
}

/** a list this person is not entitled to — a permission, not a fault */
function Refused() {
  const t = useTranslations("dashboard");
  return <p className="text-sm leading-7 ink-muted">{t("miniNoAccess")}</p>;
}

function Empty({ children }: { children: string }) {
  return <p className="text-sm leading-7 ink-muted">{children}</p>;
}

function Waiting() {
  return <p className="text-sm ink-muted">…</p>;
}

/** every tile's list: one scroller, hairlines between rows */
function Rows({ children }: { children: ReactNode }) {
  return <ul className="h-full divide-y divide-border overflow-y-auto">{children}</ul>;
}

/** 2 — the records, titles only. */
export function RecordsMiniWidget({ size }: { size: TileSize }) {
  const t = useTranslations("dashboard");
  const tCalls = useTranslations("calls");
  const rows = useMini<Call>(() => api.listCalls());

  if (rows === null) return <Waiting />;
  if (rows === "forbidden") return <Refused />;
  if (rows === "failed" || rows === "absent") return <Unreadable />;
  if (rows.length === 0) return <Empty>{t("noRecords")}</Empty>;

  return (
    <Rows>
      {rows.slice(0, rowsFor(size)).map((call) => (
        <li key={call.id} className="py-1.5 first:pt-0">
          <Link
            href={`/calls/${call.id}`}
            className="block min-w-0 truncate text-sm text-fg hover:text-accent"
          >
            {call.title.trim() === "" ? tCalls("untitled") : call.title}
          </Link>
        </li>
      ))}
    </Rows>
  );
}

/**
 * 3 — THE RECORD BAR: the recorder's own transport, on the board.
 *
 * User directive, 2026-08-29: "add the exact buttons like in the image into
 * the record bar" — the image being the recorder's control row. So this is
 * the same five controls in the same order, driving the SAME engine
 * (`recordingEngine`), not a second recorder: settings, pause/resume, the
 * record button, the microphone, the source.
 *
 * Nothing here keeps its own recording state. The engine is a module-level
 * store that survives navigation, which is why a take started from this tile
 * is the take the mini recorder shows in the top bar and the take the
 * recorder screen picks up — one recording, three views of it. A tile with
 * its own state would be a second recorder that agrees with the first until
 * it doesn't.
 *
 * The one control that is NOT reproduced is the recorder's stop-and-ask
 * (save it or delete it). Stop here FINISHES, exactly as the mini recorder's
 * own stop does: a question with two answers belongs on the screen that can
 * show what is being thrown away.
 */
export function StartRecordWidget() {
  const t = useTranslations("dashboard");
  const tCapture = useTranslations("capture");
  const locale = useLocale();
  const snapshot = useSyncExternalStore(subscribeRecorder, recorderSnapshot, recorderSnapshot);
  const [mics, setMics] = useState<{ id: string; label: string }[]>([]);
  const [micId, setMicId] = useState("");
  const [source, setSource] = useState<"mic" | "system">("mic");
  const [language, setLanguage] = useState<"fa" | "en" | "mixed">(locale === "en" ? "en" : "fa");

  /* the browser withholds device LABELS until a grant exists, so an
     unconnected list is named generically rather than left blank */
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      const all = await navigator.mediaDevices.enumerateDevices();
      if (!alive) return;
      setMics(all.filter((d) => d.kind === "audioinput").map((d, i) => ({
        id: d.deviceId, label: d.label || `${tCapture("micFallback")} ${i + 1}`,
      })));
    };
    void refresh();
    navigator.mediaDevices?.addEventListener?.("devicechange", refresh);
    return () => {
      alive = false;
      navigator.mediaDevices?.removeEventListener?.("devicechange", refresh);
    };
  }, [tCapture]);

  const phase = snapshot.phase;
  const live = phase === "recording" || phase === "paused" || phase === "finishing";

  return (
    /*
     * `container-type: size` so the controls can measure themselves against
     * THIS TILE (user directive, 2026-08-29: "make the button inside this
     * dashboard section for record to adjust to the size, they must get
     * bigger"). The row is sized in container units with a cap, so it fills
     * a short tile and grows to a designed maximum in a taller one rather
     * than sitting at one hard-coded size in both.
     *
     * NO CLOCK (same directive: "when the record start it does not need to
     * show the time in it. remove the counter as well"). The elapsed time is
     * on the mini recorder in the top bar, which is visible from every screen
     * — a second copy here is a second thing that can disagree, and it was
     * costing the transport the height it needed.
     */
    <div className="grid h-full place-items-center" style={{ containerType: "size" }}>
      {/* dir="ltr" so the transport keeps ONE order in both locales — a row
          of controls is an instrument panel, not a sentence */}
      <div className="rec-row flex items-center justify-center gap-3" dir="ltr">
        <KebabMenu
          label={tCapture("settingsMenu")}
          trigger={<IconSettings width={18} height={18} />}
          triggerClassName="rec-btn grid place-items-center rounded-full border border-border bg-surface text-fg-muted hover:border-border-strong hover:bg-surface-2 hover:text-fg"
          items={[{
            key: "language",
            label: tCapture("languageField"),
            icon: <IconGlobe width={16} height={16} />,
            sub: (["fa", "en", "mixed"] as const).map((value) => ({
              key: value,
              label: tCapture(value === "fa" ? "languageFa" : value === "en" ? "languageEn" : "languageMixed"),
              icon: language === value ? <IconCheck width={14} height={14} /> : null,
              onSelect: () => setLanguage(value),
            })),
          }]}
        />
        <button
          type="button"
          title={phase === "recording" ? tCapture("pause") : tCapture("resume")}
          aria-label={phase === "recording" ? tCapture("pause") : tCapture("resume")}
          disabled={!live}
          className="rec-btn tap grid place-items-center rounded-full border border-border bg-surface text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-40"
          onClick={phase === "recording" ? pause : resume}
        >
          {phase === "recording"
            ? <IconPause width={18} height={18} />
            : <IconPlay width={18} height={18} />}
        </button>
        {live ? (
          <button
            type="button"
            title={tCapture("stopButton")}
            aria-label={tCapture("stopButton")}
            className="rec-main tap grid place-items-center rounded-full bg-fg shadow-lg transition-transform hover:scale-105 active:scale-95"
            onClick={() => { void finish(); }}
          >
            <span aria-hidden className="rec-stop block rounded-[5px] bg-record" />
          </button>
        ) : (
          <button
            type="button"
            title={t("miniStartRecording")}
            aria-label={t("miniStartRecording")}
            disabled={phase === "starting"}
            className="rec-main tap grid place-items-center rounded-full bg-record text-white shadow-lg transition-transform hover:scale-105 active:scale-95 disabled:opacity-60"
            onClick={() => {
              void startRecording({
                micId, language, source, title: "", locale,
                resume: null, boost: false, noiseSuppression: true,
              });
            }}
          >
            {/* the Echo mark IS a ring and a dot, which is what a record
                button draws anyway — the brand and the affordance are one
                shape (the recorder's own reasoning, kept) */}
            <EchoMark size={28} tone="current" />
          </button>
        )}
        <SelectMenu
          variant="round"
          ariaLabel={tCapture("micField")}
          panelHeading={tCapture("micField")}
          icon={<IconMic width={18} height={18} />}
          value={micId}
          onChange={setMicId}
          disabled={live}
          options={mics.length === 0
            ? [{ value: "", label: tCapture("micDefault") }]
            : mics.map((d) => ({ value: d.id, label: d.label }))}
        />
        <SelectMenu
          variant="round"
          ariaLabel={tCapture("sourceField")}
          panelHeading={tCapture("sourceField")}
          icon={<IconPulse width={18} height={18} />}
          value={source}
          onChange={(v) => setSource(v as "mic" | "system")}
          disabled={live}
          options={[
            { value: "mic", label: tCapture("sourceMic") },
            { value: "system", label: tCapture("sourceSystem") },
          ]}
        />
      </div>
    </div>
  );
}

/**
 * 4 — THE CONNECTIONS, big (user directive, 2026-08-29: "add integration a
 * bigger section with big connected of the four connection it has").
 *
 * Four cards rather than four rows, because the question this tile answers
 * is "is my Google actually connected", and a row of small text answers it
 * with the same emphasis it gives everything else. Each card is the source's
 * own mark, its name, and one word about its state — and the card IS the
 * link, so the fix for a red one is where the diagnosis is.
 *
 * The catalogue is the subject, not the grants: an organization that has
 * connected nothing must still see what there is to connect, or the tile
 * renders blank on exactly the account that needs it most.
 */
export function IntegrationsWidget() {
  /*
   * `tConnect`, not a second `t`: the locale guard binds ONE namespace per
   * name per file, so a second `t` here would re-point every other widget's
   * `t` in this module at the integrations namespace — and the guard would
   * then check the wrong catalogue while looking green.
   */
  const t = useTranslations("dashboard");
  const tConnect = useTranslations("integrations");
  const copy = useIntegrationCopy();
  const rows = useMini<ConnectorStatus>(() => api.connectors());

  if (rows === null) return <Waiting />;
  if (rows === "forbidden") return <Refused />;
  if (rows === "failed" || rows === "absent") return <Unreadable />;

  return (
    <ul className="grid h-full grid-cols-2 gap-2 overflow-y-auto">
      {INTEGRATIONS.map((entry) => {
        const status = rows.find((row) => row.provider === entry.provider)?.status ?? "not_connected";
        const connected = status === "connected";
        return (
          <li key={entry.slug}>
            <Link
              href={`/integrations/${entry.slug}`}
              className={`flex h-full min-h-14 items-center gap-2.5 rounded-xl border px-2.5 py-2 transition-colors ${
                connected
                  ? "border-border bg-surface-2 hover:border-accent"
                  : "border-dashed border-border hover:border-accent"
              }`}
            >
              {/*
                A 32px box holding an 18px glyph. It was 40 holding 16 — the
                icon read as a dot in a large empty square, which is what
                "the icons are kinda not at the rights sizes inside the
                boxes" is about. The box is what shrank; the glyph grew.
              */}
              <span
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${
                  connected ? "bg-accent-soft text-accent" : "bg-surface-2 text-fg-subtle"
                }`}
                aria-hidden
              >
                <Icon name={entry.icon} size="lg" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-medium leading-tight text-fg">
                  {copy[entry.key].name}
                </span>
                {/* the state in a word, in the theme's own dot, so
                    "connected" reads the same here as on the full table */}
                {connected ? (
                  <StatusDot label={tConnect("statusActive")} />
                ) : status === "expired" ? (
                  <StatusDot label={tConnect("statusExpired")} tone="warning" />
                ) : status === "revoked" ? (
                  <StatusDot label={tConnect("statusRevoked")} tone="danger" />
                ) : (
                  <StatusDot label={t("miniNotConnected")} tone="muted" />
                )}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The four agents whose subject is the recordings (user directive: "4 of the
 * agents related to the records").
 *
 * Named rather than "the first four the list returns": naming them means the
 * tile keeps its subject the day somebody adds an agent about something
 * else, and a handle that stops existing drops out of the tile instead of
 * pushing an unrelated agent into it.
 */
const RECORD_AGENTS = ["recorder", "meetings", "commitments", "prep"];

/** 5 — those four, each opening its own conversation. */
export function AgentsWidget() {
  const t = useTranslations("dashboard");
  const agentCopy = useAgentCopy();
  const rows = useMini<AgentCard>(() => api.agents());

  if (rows === null) return <Waiting />;
  if (rows === "forbidden") return <Refused />;
  if (rows === "failed" || rows === "absent") return <Unreadable />;

  const shown = RECORD_AGENTS
    .map((handle) => rows.find((agent) => agent.handle === handle))
    .filter((agent): agent is AgentCard => agent !== undefined);

  if (shown.length === 0) return <Empty>{t("miniNoAgents")}</Empty>;

  return (
    <Rows>
      {shown.map((agent) => (
        <li key={agent.id} className="py-1.5 first:pt-0">
          <Link
            href={`/assistant?agent=${encodeURIComponent(agent.handle)}`}
            className="block min-w-0 truncate text-sm text-fg hover:text-accent"
          >
            {agentCopy(agent).name}
          </Link>
        </li>
      ))}
    </Rows>
  );
}

/**
 * 5 — THE CALENDAR: a real month, in squares (user directive, 2026-08-29:
 * "the calender must show the real calender with dates and everything in
 * squar shape if it get any related information from the user it will show
 * in that date").
 *
 * The month comes from `monthGrid`, which reads the viewer's own calendar
 * preference — so a Persian reader gets Shahrivar starting on a Saturday and
 * an English one gets August starting on a Sunday, from the same code and
 * the same conversion every other date on screen goes through.
 *
 * The events are the person's OWN Google calendar, read live through the
 * grant they gave: there is no copy of it here to fall out of step, and it is
 * the same read the meeting-prep workflow makes. A day with something on it
 * carries a dot and its title in the tooltip; the events for the day are
 * matched by DAY KEY, which both sides get from `dayKeyOf` rather than by
 * either of them deciding for itself where a day begins.
 *
 * Square cells come from an aspect ratio on the grid rather than a fixed
 * size: the block keeps its 7:6 shape and shrinks to whichever of the tile's
 * two dimensions runs out first, so the squares stay square at every tier
 * instead of turning into rectangles when the tile is resized.
 */
export function CalendarWidget() {
  const t = useTranslations("dashboard");
  const locale = useLocale();
  const rows = useMini<ConnectorItem>(() => api.connectorItems("google", "calendar"));
  /* the preferences are STORES, and a grid that only read them once would
     keep showing a Jalali month after somebody switched to Gregorian — the
     control that reads as wired and does nothing */
  const calendar = useCalendarPreference();
  const timezone = useTimezonePreference();
  const grid = useMemo(
    () => monthGrid(new Date(), locale),
    // the grid is derived from both preferences THROUGH `format`, which reads
    // them itself — so they belong in the dependency list even though this
    // call does not name them
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale, calendar, timezone],
  );

  /** day key → the events on it, so a square never re-derives a date */
  const byDay = new Map<number, ConnectorItem[]>();
  if (Array.isArray(rows)) {
    for (const item of rows) {
      if (!item.occurred_at) continue;
      const key = dayKeyOf(item.occurred_at);
      const bucket = byDay.get(key);
      if (bucket) bucket.push(item);
      else byDay.set(key, [item]);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-fg">{grid.title}</span>
        {/*
          The connection's state, said HERE rather than in place of the
          calendar. A month with no events is still a month worth showing —
          replacing it with an invitation would hide the thing the tile is
          for, and the person would have no idea what they were being offered
          instead.
        */}
        {rows === "absent" ? (
          <Link href="/integrations" className="text-xs text-accent hover:underline">
            {t("miniCalendarConnectLink")}
          </Link>
        ) : rows === "failed" || rows === "forbidden" ? (
          <span className="text-xs text-fg-subtle">{t("readFailed")}</span>
        ) : null}
      </div>

      {/* `container-type: size` is what lets the block below measure itself
          against this box's HEIGHT as well as its width */}
      <div className="grid min-h-0 flex-1 place-items-center" style={{ containerType: "size" }}>
        {/*
          FIT INSIDE BOTH DIMENSIONS, ratio intact.

          Two earlier versions each got one direction right and the other
          wrong, and both looked plausible in the markup: `w-full` with an
          aspect ratio means the browser satisfies the width and drops the
          ratio (squares flattened in any tile wider than it is tall);
          `h-full` with `max-w-full` is the same failure mirrored, and it
          arrived the moment the calendar moved to a narrow tier.

          `min(100%, 100cqh * ratio)` asks for the smaller of the two
          constraints — the container's width, or the width its height allows
          — so the block shrinks to whichever runs out first and the squares
          stay square. Measured in a browser at both tiers this widget
          offers: 48.9×48.5 at `tall`, 27.2×25.4 at `column`, neither
          overflowing.
        */}
        <div
          className="grid grid-rows-[auto_1fr] gap-1"
          style={{
            aspectRatio: `7 / ${grid.cells.length / 7 + 0.35}`,
            width: `min(100%, calc(100cqh * 7 / ${grid.cells.length / 7 + 0.35}))`,
          }}
        >
          <ul className="grid grid-cols-7 gap-1">
            {grid.weekdays.map((day, i) => (
              <li key={i} className="text-center text-[10px] leading-4 text-fg-subtle">{day}</li>
            ))}
          </ul>
          {/* the row count is COMPUTED — `auto-fit` in the block axis is not
              the same thing it is in the inline axis, and a month is five
              weeks or six depending on where it starts */}
          <ul
            className="grid grid-cols-7 gap-1"
            style={{ gridTemplateRows: `repeat(${grid.cells.length / 7}, minmax(0, 1fr))` }}
          >
            {grid.cells.map((cell) => {
              const events = byDay.get(cell.key) ?? [];
              return (
                <li
                  key={cell.key}
                  title={events.length > 0 ? events.map((e) => e.title).join(" · ") : undefined}
                  className={`relative grid place-items-center rounded-md border text-xs tabular-nums ${
                    cell.today
                      ? "border-accent bg-accent-soft font-semibold text-accent"
                      : cell.inMonth
                        ? "border-border bg-surface-2 text-fg"
                        : "border-transparent text-fg-subtle/50"
                  }`}
                >
                  {cell.label}
                  {events.length > 0 ? (
                    <span
                      aria-hidden
                      className="absolute bottom-0.5 h-1 w-1 rounded-full bg-accent"
                    />
                  ) : null}
                  {events.length > 0 ? (
                    <span className="sr-only">
                      {t("miniDayEvents", { count: events.length })}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}

/**
 * 6 — THE STAT STRIP, the reference's four figures (big-milestone round):
 * upcoming meetings / meetings this month / task completion rate / tasks
 * recorded. Two reads (meetings, task board), four cards, and every count
 * obeys dash-never-zero: a read that has not answered (or cannot) renders
 * «—» — a fabricated 0 is a claim about the organization, a dash is a
 * claim about the read. The two reads fail INDEPENDENTLY.
 */
function StatCard({ href, icon, tint, value, label, locale, percent = false }: {
  href: string;
  icon: ReactNode;
  tint: string;
  value: number | null | "unreadable";
  label: string;
  locale: string;
  percent?: boolean;
}) {
  return (
    <Link
      href={href}
      className="flex min-w-0 items-center gap-3 rounded-2xl border border-border bg-surface px-3.5 py-3 transition-colors hover:border-border-strong"
    >
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${tint}`} aria-hidden>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-xl font-bold leading-6 text-fg tabular-nums">
          {typeof value === "number"
            ? percent
              /* the percent SIGN follows the language: «٪۵۰» in fa, "50%" in en */
              ? locale === "fa" ? `٪${digits(value, locale)}` : `${value}%`
              : digits(value, locale)
            : "—"}
        </span>
        <span className="block truncate text-xs text-fg-muted">{label}</span>
      </span>
    </Link>
  );
}

export function StatsWidget() {
  const t = useTranslations("dashboard");
  const locale = useLocale();
  const [meetings, setMeetings] = useState<MeetingRecord[] | null | "unreadable">(null);
  const [tasks, setTasks] = useState<{ done: number; total: number } | null | "unreadable">(null);

  useEffect(() => {
    let alive = true;
    void api.meetings()
      .then((rows) => { if (alive) setMeetings(rows); })
      .catch(() => { if (alive) setMeetings("unreadable"); });
    void api.taskBoard()
      .then((b) => {
        if (!alive) return;
        const live = b.tasks.filter((task) => !task.archived);
        setTasks({ done: live.filter((task) => task.done).length, total: live.length });
      })
      .catch(() => { if (alive) setTasks("unreadable"); });
    return () => { alive = false; };
  }, []);

  const now = Date.now();
  const upcoming = Array.isArray(meetings)
    ? meetings.filter((m) => new Date(m.scheduled_at).getTime() >= now && m.call_id === null).length
    : meetings === null ? null : "unreadable" as const;
  const thisMonth = Array.isArray(meetings)
    ? meetings.filter((m) => {
        const d = new Date(m.scheduled_at);
        const t0 = new Date();
        return d.getFullYear() === t0.getFullYear() && d.getMonth() === t0.getMonth();
      }).length
    : meetings === null ? null : "unreadable" as const;
  const taskRate = tasks === null ? null
    : tasks === "unreadable" ? "unreadable" as const
      : tasks.total === 0 ? 0 : Math.round((tasks.done / tasks.total) * 100);
  const taskTotal = tasks === null ? null : tasks === "unreadable" ? "unreadable" as const : tasks.total;

  return (
    <div className="grid h-full grid-cols-2 content-center gap-2.5 md:grid-cols-4">
      <StatCard href="/meetings" icon={<IconCalendar width={18} height={18} />}
        tint="bg-surface-2 text-fg-muted" value={upcoming} label={t("statUpcoming")} locale={locale} />
      <StatCard href="/meetings" icon={<IconCalendar width={18} height={18} />}
        tint="bg-info/10 text-info" value={thisMonth} label={t("statMonth")} locale={locale} />
      <StatCard href="/tasks" icon={<IconCheck width={18} height={18} />}
        tint="bg-success/10 text-success" value={taskRate} label={t("statTaskRate")} locale={locale} percent />
      <StatCard href="/tasks" icon={<IconGavel width={18} height={18} />}
        tint="bg-warning/10 text-warning" value={taskTotal} label={t("statTasksTotal")} locale={locale} />
    </div>
  );
}

/**
 * 7 — جلسات پیش‌رو: the PRODUCT's own upcoming meetings, nearest first,
 * with the door to the full list. The empty state is the reference's own
 * copy; a failed read never wears it.
 */
export function UpcomingWidget({ size }: { size: TileSize }) {
  const t = useTranslations("dashboard");
  const locale = useLocale();
  const [meetings, setMeetings] = useState<MeetingRecord[] | null | "failed">(null);

  useEffect(() => {
    let alive = true;
    void api.meetings()
      .then((rows) => { if (alive) setMeetings(rows); })
      .catch(() => { if (alive) setMeetings("failed"); });
    return () => { alive = false; };
  }, []);

  if (meetings === null) return <Waiting />;
  if (meetings === "failed") return <Unreadable />;

  const now = Date.now();
  const ahead = meetings
    .filter((m) => new Date(m.scheduled_at).getTime() >= now && m.call_id === null)
    .slice(0, rowsFor(size));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-1.5 text-start">
        <Link href="/meetings" className="text-xs text-accent hover:underline">{t("upcomingAll")}</Link>
      </div>
      {ahead.length === 0 ? (
        <div className="grid min-h-0 flex-1 place-items-center text-center">
          <div>
            <span className="mx-auto mb-1.5 grid h-9 w-9 place-items-center rounded-xl bg-surface-2 text-fg-muted" aria-hidden>
              <IconCalendar width={16} height={16} />
            </span>
            <p className="text-sm text-fg-muted">{t("noUpcomingMeetings")}</p>
          </div>
        </div>
      ) : (
        <ul className="min-h-0 flex-1 divide-y divide-border/60 overflow-y-auto">
          {ahead.map((m) => (
            <li key={m.id}>
              <Link href={`/meetings/${m.id}`} className="flex items-baseline gap-2.5 py-1.5 hover:text-accent">
                <span className="badge-num shrink-0 rounded-md bg-accent-soft px-1.5 py-0.5 text-[11px] font-medium text-accent">
                  {formatTime(m.scheduled_at, locale)}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-fg" title={m.title}>{m.title}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * 7b — آخرین جلسات: newest first, each with its stage chip (بازبینی once a
 * record exists — the reference's own chip), each a door to its page.
 */
export function LatestMeetingsWidget({ size }: { size: TileSize }) {
  const t = useTranslations("dashboard");
  const locale = useLocale();
  const [meetings, setMeetings] = useState<MeetingRecord[] | null | "failed">(null);

  useEffect(() => {
    let alive = true;
    void api.meetings()
      .then((rows) => { if (alive) setMeetings(rows); })
      .catch(() => { if (alive) setMeetings("failed"); });
    return () => { alive = false; };
  }, []);

  if (meetings === null) return <Waiting />;
  if (meetings === "failed") return <Unreadable />;
  if (meetings.length === 0) return <Empty>{t("noMeetingsYet")}</Empty>;

  const latest = [...meetings]
    .sort((a, b) => b.scheduled_at.localeCompare(a.scheduled_at))
    .slice(0, rowsFor(size));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-1.5 text-start">
        <Link href="/meetings" className="text-xs text-accent hover:underline">{t("upcomingAll")}</Link>
      </div>
      <ul className="min-h-0 flex-1 divide-y divide-border/60 overflow-y-auto">
        {latest.map((m) => (
          <li key={m.id}>
            <Link href={`/meetings/${m.id}`} className="flex items-center gap-2 py-1.5 hover:text-accent">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-fg" title={m.title}>{m.title}</span>
                <span className="block text-[11px] text-fg-subtle">{formatDate(m.scheduled_at, locale)}</span>
              </span>
              {m.call_id !== null ? (
                <span className="shrink-0 rounded-md bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent">
                  {t("latestReviewChip")}
                </span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * 8 — THE WEEK as the reference's HOUR GRID: seven full-height day columns
 * (weekend tinted, today green with «امروز»), hour rows down the side, and
 * each meeting a chip at its hour in its day — a started meeting shows
 * here the moment it exists. Range + prev/next in the header.
 */
const GRID_START_HOUR = 8;
const GRID_END_HOUR = 20;

export function WeekWidget() {
  const t = useTranslations("dashboard");
  const locale = useLocale();
  const [meetings, setMeetings] = useState<MeetingRecord[] | null | "failed">(null);
  const [offset, setOffset] = useState(0);
  const calendar = useCalendarPreference();
  const timezone = useTimezonePreference();

  useEffect(() => {
    let alive = true;
    void api.meetings()
      .then((rows) => { if (alive) setMeetings(rows); })
      .catch(() => { if (alive) setMeetings("failed"); });
    return () => { alive = false; };
  }, []);

  const cells = useMemo(
    () => weekStrip(new Date(), locale, offset),
    // derived from both preferences THROUGH `format`, which reads them itself
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale, offset, calendar, timezone],
  );
  const byDay = new Map<number, MeetingRecord[]>();
  if (Array.isArray(meetings)) {
    for (const m of meetings) {
      const key = dayKeyOf(m.scheduled_at);
      if (!cells.some((c) => c.key === key)) continue;
      const bucket = byDay.get(key);
      if (bucket) bucket.push(m);
      else byDay.set(key, [m]);
    }
  }
  const weekCount = [...byDay.values()].reduce((sum, list) => sum + list.length, 0);
  const hours: number[] = [];
  for (let h = GRID_START_HOUR; h <= GRID_END_HOUR; h += 1) hours.push(h);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ── header ───────────────────────────────────────────────────── */}
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-baseline gap-2 text-sm">
          <span className="font-semibold text-fg">
            {offset === 0 ? t("weekCurrent") : weekRangeLabel(cells, locale)}
          </span>
          {offset === 0 ? (
            <span className="badge-num text-xs text-fg-muted">{weekRangeLabel(cells, locale)}</span>
          ) : null}
          <span className="text-xs text-fg-subtle">
            {meetings === null
              ? null
              : meetings === "failed"
                ? t("readFailed")
                : weekCount === 0
                  ? t("weekNoMeetingsShort")
                  : t("weekMeetingCount", { n: digits(weekCount, locale) })}
          </span>
        </div>
        <span className="flex items-center gap-1">
          <button type="button" aria-label={t("weekPrev")} onClick={() => setOffset((v) => v - 1)}
            className="tap grid h-7 w-7 place-items-center rounded-lg border border-border text-fg-muted hover:text-fg">
            {/* BACK points against the reading direction */}
            <IconChevronRight width={12} height={12} className="rotate-180 rtl:rotate-0" />
          </button>
          <button type="button" aria-label={t("weekNext")} onClick={() => setOffset((v) => v + 1)}
            className="tap grid h-7 w-7 place-items-center rounded-lg border border-border text-fg-muted hover:text-fg">
            <IconChevronRight width={12} height={12} className="rtl:rotate-180" />
          </button>
        </span>
      </div>

      {meetings === "failed" ? (
        <p className="mb-1 text-xs text-fg-subtle">{t("readFailed")}</p>
      ) : null}

      {/* ── the grid: [hour rail | seven day columns] ─────────────────── */}
      <div className="grid min-h-0 flex-1 grid-cols-[auto_1fr] gap-1.5">
        {/* day headers + columns share one grid so the tints run full height */}
        <div className="flex flex-col pe-1 text-[10px] leading-none text-fg-subtle">
          {/* the SAME header spacer the day columns carry, so label k and
              line k compute their offsets inside identical boxes */}
          <div className="mb-1 h-10" aria-hidden />
          <div className="relative min-h-0 flex-1">
            {hours.map((h, i) => (
              <span key={h} className="badge-num absolute -translate-y-1/2 whitespace-nowrap"
                style={{ top: `${(i / (hours.length - 1)) * 100}%` }}>
                {digits(String(h).padStart(2, "0"), locale)}:{digits("00", locale)}
              </span>
            ))}
          </div>
        </div>
        <div className="grid min-h-0 grid-cols-7 gap-1.5">
          {cells.map((cell) => {
            const dayMeetings = (byDay.get(cell.key) ?? [])
              .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
            return (
              <div key={cell.key} className="flex min-h-0 flex-col">
                <div className={`mb-1 h-10 rounded-lg px-1 py-1 text-center ${
                  cell.today ? "bg-accent text-on-accent" : cell.weekend ? "bg-danger/10 text-danger" : "bg-surface-2/70 text-fg-muted"
                }`}>
                  <span className="block truncate text-[10px] leading-3">
                    {cell.weekday}{cell.today ? ` · ${t("weekToday")}` : ""}
                  </span>
                  <span className="badge-num block text-xs font-bold leading-4">{cell.label}</span>
                </div>
                <div className={`relative min-h-0 flex-1 overflow-hidden rounded-lg ${
                  cell.today ? "bg-accent-soft/60" : cell.weekend ? "bg-danger/5" : "bg-surface-2/40"
                }`}>
                  {/* hour lines */}
                  {hours.map((h, i) => (
                    <span key={h} aria-hidden className="absolute inset-x-0 border-t border-border/40"
                      style={{ top: `${(i / (hours.length - 1)) * 100}%` }} />
                  ))}
                  {dayMeetings.map((m) => {
                    /* the RESOLVED zone, not the browser's — the chip's row
                       must agree with the day bucketing and the printed
                       time, which both honor the timezone preference */
                    const hour = hourInResolvedZone(m.scheduled_at);
                    const clamped = Math.min(Math.max(hour, GRID_START_HOUR), GRID_END_HOUR - 0.75);
                    const top = ((clamped - GRID_START_HOUR) / (GRID_END_HOUR - GRID_START_HOUR)) * 100;
                    /* same denominator as the lines and the rail — one
                       geometry, three renderings */
                    return (
                      <Link
                        key={m.id}
                        href={`/meetings/${m.id}`}
                        title={m.title}
                        className="absolute inset-x-0.5 z-10 rounded-md bg-surface px-1 py-0.5 shadow-card transition-colors hover:bg-accent-soft"
                        style={{ top: `${top}%` }}
                      >
                        <span className="block truncate text-[10px] font-medium leading-3.5 text-fg">{m.title}</span>
                        <span className="badge-num block text-[9px] leading-3 text-fg-subtle">
                          {formatTime(m.scheduled_at, locale)}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
