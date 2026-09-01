"use client";

import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";

import { api, BffError } from "@/api/client";
import { Link } from "@/i18n/routing";
import { KebabMenu, SelectMenu } from "@/components/rowActions";
import { StatusDot } from "@/components/DataTable";
import {
  Icon, IconCalendar, IconCheck, IconChevronRight, IconGlobe, IconMic, IconPause, IconPlay,
  IconPlus, IconPulse, IconSettings,
} from "@/components/icons";
import { EchoMark } from "@/components/platform/icons";
import { dayKeyOf, digits, formatTime, monthGrid, weekRangeLabel, weekStrip } from "@/lib/format";
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
 * 6 — THE STAT STRIP (the reference adoption, 2026-08-31): four figure
 * cards — today's meetings, open tasks, records, connections. Each is a
 * tinted icon square, a big number, and a label; each is also the DOOR to
 * its surface.
 *
 * Every count obeys dash-never-zero: a read that has not answered (or
 * cannot) renders «—», because a fabricated 0 is a claim about the
 * organization and a dash is a claim about the read. The four reads are
 * independent — one refused count must not blank the other three.
 */
function useCount(read: () => Promise<number>): number | null | "unreadable" {
  const [state, setState] = useState<number | null | "unreadable">(null);
  useEffect(() => {
    let alive = true;
    void read()
      .then((n) => { if (alive) setState(n); })
      .catch(() => { if (alive) setState("unreadable"); });
    return () => { alive = false; };
    // the reader is defined at the call site and stable for this tile's life
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return state;
}

function StatCard({ href, icon, tint, value, label, locale }: {
  href: string;
  icon: ReactNode;
  /** the icon square's tint classes — bg + text, from the theme's own set */
  tint: string;
  value: number | null | "unreadable";
  label: string;
  locale: string;
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
          {typeof value === "number" ? digits(value, locale) : "—"}
        </span>
        <span className="block truncate text-xs text-fg-muted">{label}</span>
      </span>
    </Link>
  );
}

export function StatsWidget() {
  const t = useTranslations("dashboard");
  const locale = useLocale();
  const meetings = useCount(async () => {
    const items = await api.connectorItems("google", "calendar");
    const today = dayKeyOf(new Date());
    return items.filter((i) => i.occurred_at !== null && dayKeyOf(i.occurred_at) === today).length;
  });
  const tasks = useCount(async () => {
    const board = await api.taskBoard();
    return board.tasks.filter((task) => !task.done && !task.archived).length;
  });
  const records = useCount(async () => (await api.listCalls()).length);
  const connections = useCount(async () => {
    const rows = await api.connectors();
    return rows.filter((c) => c.status === "connected").length;
  });

  return (
    <div className="grid h-full grid-cols-2 content-center gap-2.5 md:grid-cols-4">
      <StatCard href="/echo" icon={<IconCalendar width={18} height={18} />}
        tint="bg-accent-soft text-accent" value={meetings} label={t("statMeetingsToday")} locale={locale} />
      <StatCard href="/tasks" icon={<IconCheck width={18} height={18} />}
        tint="bg-info/10 text-info" value={tasks} label={t("statOpenTasks")} locale={locale} />
      <StatCard href="/echo" icon={<IconMic width={18} height={18} />}
        tint="bg-warning/10 text-warning" value={records} label={t("statRecords")} locale={locale} />
      <StatCard href="/integrations" icon={<IconGlobe width={18} height={18} />}
        tint="bg-success/10 text-success" value={connections} label={t("statConnections")} locale={locale} />
    </div>
  );
}

/**
 * 7 — UPCOMING: what is ahead, nearest first — time and title per row, the
 * reference's upcoming-meetings card. The connection's absence offers the
 * way to connect, exactly as the month calendar does; it never apologises.
 */
export function UpcomingWidget({ size }: { size: TileSize }) {
  const t = useTranslations("dashboard");
  const locale = useLocale();
  const rows = useMini<ConnectorItem>(() => api.connectorItems("google", "calendar"));

  if (rows === null) return <Waiting />;
  if (rows === "forbidden") return <Refused />;
  if (rows === "absent") {
    /* not an emptiness and not a fault: the way to connect, offered */
    return (
      <p className="text-sm leading-7">
        <Link href="/integrations" className="text-accent hover:underline">
          {t("miniCalendarConnectLink")}
        </Link>
      </p>
    );
  }
  if (rows === "failed") return <Unreadable />;

  const now = Date.now();
  const ahead = rows
    .filter((item) => item.occurred_at !== null && new Date(item.occurred_at).getTime() >= now)
    .sort((a, b) => new Date(a.occurred_at!).getTime() - new Date(b.occurred_at!).getTime())
    .slice(0, rowsFor(size));
  if (ahead.length === 0) return <Empty>{t("noUpcoming")}</Empty>;

  return (
    <Rows>
      {ahead.map((item) => (
        <li key={item.id} className="flex items-baseline gap-2.5 py-1.5 first:pt-0">
          <span className="badge-num shrink-0 rounded-md bg-accent-soft px-1.5 py-0.5 text-[11px] font-medium text-accent">
            {formatTime(item.occurred_at!, locale)}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm text-fg" title={item.title}>
            {item.title}
          </span>
        </li>
      ))}
    </Rows>
  );
}

/**
 * 8 — THE WEEK, rebuilt to the reference's week panel (2026-09-01 round):
 * a header with the week's range and prev/next arrows, seven pill day
 * cells with the FULL short weekday names, and the week's own MEETINGS
 * (0145 — the product's data, not the connector's) listed under the strip.
 * Today wears the accent; the rest day is tinted apart. An empty week is a
 * NAMED state with the door to scheduling, exactly as the reference draws
 * it.
 */
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
  const keys = new Set(cells.map((c) => c.key));
  const weekMeetings = Array.isArray(meetings)
    ? meetings.filter((m) => keys.has(dayKeyOf(m.scheduled_at)))
    : [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ── header: the range, the arrows, the count ─────────────────── */}
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
              ? null /* still asking — "no meetings" is a claim not yet earned */
              : meetings === "failed"
                ? t("readFailed")
                : weekMeetings.length === 0
                  ? t("weekNoMeetingsShort")
                  : t("weekMeetingCount", { n: digits(weekMeetings.length, locale) })}
          </span>
        </div>
        <span className="flex items-center gap-1">
          <button
            type="button"
            aria-label={t("weekPrev")}
            onClick={() => setOffset((v) => v - 1)}
            className="tap grid h-7 w-7 place-items-center rounded-lg border border-border text-fg-muted hover:text-fg"
          >
            {/* BACK points against the reading direction: left in LTR,
                right in RTL — the base chevron points right, so LTR is the
                rotated case */}
            <IconChevronRight width={12} height={12} className="rotate-180 rtl:rotate-0" />
          </button>
          <button
            type="button"
            aria-label={t("weekNext")}
            onClick={() => setOffset((v) => v + 1)}
            className="tap grid h-7 w-7 place-items-center rounded-lg border border-border text-fg-muted hover:text-fg"
          >
            {/* FORWARD points with the reading direction */}
            <IconChevronRight width={12} height={12} className="rtl:rotate-180" />
          </button>
        </span>
      </div>

      {/* ── the strip: seven pills, full short names ─────────────────── */}
      <ul className="grid grid-cols-7 gap-1.5">
        {cells.map((cell) => (
          <li
            key={cell.key}
            className={`flex flex-col items-center gap-0.5 rounded-xl border px-1 py-1.5 ${
              cell.today
                ? "border-accent/40 bg-accent-soft"
                : cell.weekend
                  ? "border-transparent bg-danger/5"
                  : "border-transparent bg-surface-2/70"
            }`}
          >
            <span className={`max-w-full truncate text-[10px] leading-4 ${cell.today ? "text-accent" : "text-fg-muted"}`}>
              {cell.weekday}
            </span>
            <span
              className={`grid h-6 w-6 place-items-center rounded-full text-xs tabular-nums ${
                cell.today
                  ? "bg-accent font-bold text-on-accent"
                  : cell.weekend ? "text-danger" : "text-fg"
              }`}
            >
              {cell.label}
            </span>
          </li>
        ))}
      </ul>

      {/* ── the week's meetings, or the named empty state ────────────── */}
      <div className="scroll-quiet mt-2 min-h-0 flex-1 overflow-y-auto">
        {meetings === null ? null : meetings === "failed" ? (
          <p className="p-2 text-sm text-fg-subtle">{t("readFailed")}</p>
        ) : weekMeetings.length === 0 ? (
          <div className="grid h-full min-h-24 place-items-center text-center">
            <div>
              <span className="mx-auto mb-1.5 grid h-9 w-9 place-items-center rounded-xl bg-surface-2 text-fg-muted" aria-hidden>
                <IconCalendar width={16} height={16} />
              </span>
              <p className="text-sm text-fg-muted">{t("weekNoMeetings")}</p>
              <Link
                href="/meetings"
                className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-fg hover:border-border-strong"
              >
                <IconPlus width={12} height={12} />
                {t("weekNewMeeting")}
              </Link>
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-border/60">
            {weekMeetings.map((m) => (
              <li key={m.id}>
                <Link href={`/meetings/${m.id}`} className="flex items-baseline gap-2.5 py-1.5 hover:text-accent">
                  <span className="badge-num shrink-0 rounded-md bg-accent-soft px-1.5 py-0.5 text-[11px] font-medium text-accent">
                    {formatTime(m.scheduled_at, locale)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-fg" title={m.title}>{m.title}</span>
                  <span className="shrink-0 text-[10px] text-fg-subtle">{cells.find((c) => c.key === dayKeyOf(m.scheduled_at))?.weekday}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
