"use client";

import { SkeletonLines } from "@/components/scaffold";
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
import { dayKeyOf, digits, formatDayMonth, formatTime, hourInResolvedZone, monthGrid, weekRangeLabel, weekStrip } from "@/lib/format";
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

/**
 * Every tile's loading state. It was an ellipsis — one small grey «…» in the
 * middle of an otherwise empty card, which reads as "this tile is broken"
 * rather than "this tile is coming", and told the reader nothing about the
 * shape about to arrive.
 *
 * Skeleton lines instead, sized like the rows they stand in for, so the tile
 * is the same height before and after and the board does not resettle when
 * eight of them answer at eight different moments.
 */
function Waiting() {
  return <SkeletonLines lines={3} className="p-1" />;
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
      /*
       * A FIXED HEIGHT, and that is the whole fix (user directive,
       * 2026-09-02: "why this one still in the scroll mode — make them a
       * little less height so it fits the box and comes out of the scroll
       * mode; if it is getting too much edited just remove it and write it
       * from scratch").
       *
       * The previous versions let the card STRETCH to its grid row and then
       * argued with the container about overflow. That is the wrong way
       * round: a stretched card is as tall as whatever the board gives it,
       * so on a short tile its own contents no longer fit and something —
       * the card, the strip, or the tile — has to scroll. Pinning the card
       * at 56px makes the card the fixed thing and the slack the board's,
       * which is the only arrangement where "it fits" is true by
       * construction rather than by a measurement someone has to redo.
       */
      /*
       * `h-full` with a MINIMUM, not a fixed height (user directive,
       * 2026-09-02: "the size of the green area that shows the section limit
       * is not fit with the actual area that it fills — make them fit and
       * equal").
       *
       * A fixed 56px card in a 78px grid cell left 22px of the outlined area
       * empty, so the board's drop outline described a box the strip did not
       * fill. The previous version had the opposite fault — cards INTRINSICALLY
       * taller than the cell, which is what put the strip into scroll mode.
       * The min-height is what keeps the second fault from coming back: the
       * card stretches to the cell it is given and refuses to go below the
       * height its own contents need.
       */
      /*
       * Audit finding, 2026-09-02: the chrome was re-spelled by hand
       * (`rounded-2xl border border-border bg-surface`) — the same corner,
       * edge and ground as `.card`, minus its ambient shadow, so these four
       * sat as flat paper beside every card on the board (globals.css's own
       * words for a card without the shadow). It wears `.card` now. NOT
       * `.tile`: `.tile` is unlayered and sets `min-height: 0`, which beats
       * the layered `min-h-[56px]` utility whatever the order and would
       * silently drop the floor the comment above calls load-bearing; `.card`
       * lives in @layer components, so `px-3 py-0` and the min-height win
       * over its `p-4`, and the height decisions above stand unchanged.
       */
      className="card flex h-full min-h-[56px] min-w-0 items-center gap-2.5 overflow-hidden px-3 py-0 transition-colors hover:border-border-strong"
    >
      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${tint}`} aria-hidden>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-lg font-bold leading-tight text-fg tabular-nums">
          {typeof value === "number"
            ? percent
              /* the percent SIGN follows the language: «٪۵۰» in fa, "50%" in en */
              ? locale === "fa" ? `٪${digits(value, locale)}` : `${value}%`
              : digits(value, locale)
            : "—"}
        </span>
        <span className="block truncate text-[11px] leading-tight text-fg-muted">{label}</span>
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
    /*
     * `content-start` and NOT `h-full`: the cards keep their own 56px and the
     * strip simply starts at the top of whatever room the board gives it.
     * The previous version stretched the row to the tile and made the card's
     * height a function of the board, which is how a card came to be taller
     * than the box it lives in.
     *
     * `auto-fit` still asks the CONTAINER how wide it is rather than the
     * viewport — a half-width tile on a wide monitor is narrow, and a `md:`
     * breakpoint cannot know that.
     */
    <div className="grid h-full gap-2.5 overflow-hidden grid-cols-[repeat(auto-fit,minmax(7.5rem,1fr))]">
      <StatCard href="/meetings" icon={<IconCalendar width={16} height={16} />}
        tint="bg-surface-2 text-fg-muted" value={upcoming} label={t("statUpcoming")} locale={locale} />
      <StatCard href="/meetings" icon={<IconCalendar width={16} height={16} />}
        tint="bg-info/10 text-info" value={thisMonth} label={t("statMonth")} locale={locale} />
      <StatCard href="/tasks" icon={<IconCheck width={16} height={16} />}
        tint="bg-success/10 text-success" value={taskRate} label={t("statTaskRate")} locale={locale} percent />
      <StatCard href="/tasks" icon={<IconGavel width={16} height={16} />}
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
  /* the MODE and the STAGE are the meetings surface's words — one
     vocabulary for one thing, wherever it is read */
  const tMeetings = useTranslations("meetings");
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
          {/*
            THE REFERENCE'S ROW (user directive, 2026-09-02: "the item for
            future meeting and last meeting must look like these, with future
            with dates and time and mode and the status same as the image").
            A date BLOCK leads — day number over month, the shape a calendar
            row has — then the title, then the time and how it is held, then
            the stage. What stood here was a time chip and a title: the two
            facts a person scanning "what is coming" needs least, because the
            time alone does not say WHICH DAY and nothing said whether they
            had to be in a room.
          */}
          {ahead.map((m) => (
            <li key={m.id}>
              <Link
                href={`/meetings/${m.id}`}
                className="flex items-center gap-2.5 py-1.5 hover:text-accent"
              >
                <span className="date-block">
                  <span className="badge-num block text-base font-bold leading-5 text-fg">
                    {formatDayMonth(m.scheduled_at, locale).day}
                  </span>
                  <span className="block text-[10px] leading-3 text-fg-subtle">
                    {formatDayMonth(m.scheduled_at, locale).month}
                  </span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-fg" title={m.title}>{m.title}</span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-fg-subtle">
                    <span className="badge-num">{formatTime(m.scheduled_at, locale)}</span>
                    <span aria-hidden>·</span>
                    <span>{tMeetings(`mode_${m.mode}`)}</span>
                  </span>
                </span>
                <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-medium text-accent">
                  {tMeetings("stage_pre")}
                </span>
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
/* no `size`: the panel shows THE last meeting, so a bigger tile shows the
   same one row with more air rather than a longer list */
export function LatestMeetingsWidget() {
  const t = useTranslations("dashboard");
  /* the MODE and the STAGE are the meetings surface's words */
  const tMeetings = useTranslations("meetings");
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

  /*
   * THE LAST MEETING — one, and one that has actually HAPPENED (user
   * directive, 2026-09-02: "last meeting must be for the one that already
   * done, and just put one last item in it").
   *
   * It listed the newest meetings by date, which on a board that also shows
   * «جلسات پیش‌رو» meant the same future meeting appeared in both panels — the
   * card headed "latest" was showing something that had not occurred. A
   * meeting has happened when it produced a record (`call_id`) or when its
   * time has passed; either is enough, and requiring both would hide a
   * meeting somebody simply did not record.
   */
  const now = Date.now();
  const latest = [...meetings]
    .filter((m) => m.call_id !== null || new Date(m.scheduled_at).getTime() < now)
    .sort((a, b) => b.scheduled_at.localeCompare(a.scheduled_at))
    /* TWO (user directive, 2026-09-02: "make the last meetings two option
       the box in dashboard as well, it set to one now") */
    .slice(0, 2);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ul className="min-h-0 flex-1 divide-y divide-border/60 overflow-y-auto">
        {/* THE UPCOMING ROW'S SHAPE, exactly (user directive: "with date and
            status as the upcoming meetings") — the two panels sit one above
            the other, and two spellings of one row is the first thing an eye
            notices when they do */}
        {latest.map((m) => (
          <li key={m.id}>
            <Link href={`/meetings/${m.id}`} className="flex items-center gap-2.5 py-1.5 hover:text-accent">
              <span className="date-block">
                <span className="badge-num block text-base font-bold leading-5 text-fg">
                  {formatDayMonth(m.scheduled_at, locale).day}
                </span>
                <span className="block text-[10px] leading-3 text-fg-subtle">
                  {formatDayMonth(m.scheduled_at, locale).month}
                </span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-fg" title={m.title}>{m.title}</span>
                <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-fg-subtle">
                  <span className="badge-num">{formatTime(m.scheduled_at, locale)}</span>
                  <span aria-hidden>·</span>
                  <span>{tMeetings(`mode_${m.mode}`)}</span>
                </span>
              </span>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                m.call_id !== null ? "bg-accent-soft text-accent" : "bg-surface-2 text-fg-subtle"
              }`}>
                {m.call_id !== null ? t("latestReviewChip") : tMeetings("stage_post")}
              </span>
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
/**
 * A REAL HEIGHT PER HOUR, not a share of whatever height the tile happens to
 * have (user directive: "the calendar timeline is all not right").
 *
 * The percentage version made every row as tall as the tile allowed, so on a
 * band-sized card thirteen hours shared about 350px — 26px each, with the
 * hour rules closer together than the text between them and chips overlapping
 * their own labels. The reference gives an hour about 44px and lets the grid
 * scroll, which is the only way a row can be legible at more than one tile
 * size.
 */
const HOUR_ROW = 44;

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
        {/*
          Audit finding, 2026-09-02: these two hand-rolled a 28px square with
          a 12px corner (`grid h-7 w-7 rounded-lg`) — the exact size
          `.btn-icon` exists for, at the wrong radius, and without `.btn`'s
          hover transition. Beside the meetings page's week nav (the same
          two chevrons in `btn btn-icon`) they read as a different button
          family. The control guard could not see it: it keys on
          `flex`+`items-center`, and `grid place-items-center` slips past.
        */}
        <span className="flex items-center gap-1">
          <button type="button" aria-label={t("weekPrev")} onClick={() => setOffset((v) => v - 1)}
            className="btn btn-icon border border-border text-fg-muted hover:text-fg">
            {/* BACK points against the reading direction */}
            <IconChevronRight width={12} height={12} className="rotate-180 rtl:rotate-0" />
          </button>
          <button type="button" aria-label={t("weekNext")} onClick={() => setOffset((v) => v + 1)}
            className="btn btn-icon border border-border text-fg-muted hover:text-fg">
            <IconChevronRight width={12} height={12} className="rtl:rotate-180" />
          </button>
        </span>
      </div>

      {meetings === "failed" ? (
        <p className="mb-1 text-xs text-fg-subtle">{t("readFailed")}</p>
      ) : null}

      {/* ── the grid: [hour rail | seven day columns] ─────────────────── */}
      {/*
        THE HOUR COLUMN IS A COLUMN (user directive, 2026-09-02: "there is an
        extra without-title column just for the time"). It was `auto`-width,
        so it shrank to the label and the day columns crowded straight up
        against the numbers; the reference gives the time its own lane, with
        an empty box where the day headers are. A fixed width also stops the
        lane changing width between locales, which moved the whole grid
        sideways when the digits did.
      */}
      <div className="scroll-quiet grid min-h-0 flex-1 grid-cols-[2.75rem_1fr] gap-1.5 overflow-y-auto">
        {/* day headers + columns share one grid so the tints run full height */}
        <div className="flex flex-col pe-1.5 text-end text-[10px] leading-none text-fg-subtle">
          {/* the SAME header spacer the day columns carry, so label k and
              line k compute their offsets inside identical boxes */}
          <div className="mb-1 h-10 shrink-0" aria-hidden />
          <div className="relative" style={{ height: hours.length * HOUR_ROW }}>
            {hours.map((h, i) => (
              /* `end-0` PINS the label to the lane's inner edge — the side
                 the day columns are on, in either direction. Without an
                 inline anchor an absolutely positioned box falls to its
                 static position, which is the opposite edge in RTL, so the
                 numbers sat away from the grid they label. */
              <span key={h} className="badge-num absolute end-0 -translate-y-1/2 whitespace-nowrap"
                style={{ top: i * HOUR_ROW }}>
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
                <div className={`mb-1 h-10 shrink-0 rounded-lg px-1 py-1 text-center ${
                  cell.today ? "bg-accent text-on-accent" : cell.weekend ? "bg-danger/10 text-danger" : "bg-surface-2/70 text-fg-muted"
                }`}>
                  <span className="block truncate text-[10px] leading-3">
                    {cell.weekday}{cell.today ? ` · ${t("weekToday")}` : ""}
                  </span>
                  <span className="badge-num block text-xs font-bold leading-4">{cell.label}</span>
                </div>
                <div
                  className={`relative overflow-hidden rounded-lg ${
                    cell.today ? "bg-accent-soft/60" : cell.weekend ? "bg-danger/5" : "bg-surface-2/40"
                  }`}
                  style={{ height: hours.length * HOUR_ROW }}
                >
                  {/* hour lines */}
                  {hours.map((h, i) => (
                    <span key={h} aria-hidden className="absolute inset-x-0 border-t border-border/40"
                      style={{ top: i * HOUR_ROW }} />
                  ))}
                  {dayMeetings.map((m) => {
                    /* the RESOLVED zone, not the browser's — the chip's row
                       must agree with the day bucketing and the printed
                       time, which both honor the timezone preference */
                    const hour = hourInResolvedZone(m.scheduled_at);
                    const clamped = Math.min(Math.max(hour, GRID_START_HOUR), GRID_END_HOUR - 0.75);
                    /* the SAME row height as the lines and the rail — one
                       geometry, three renderings */
                    const top = (clamped - GRID_START_HOUR) * HOUR_ROW;
                    return (
                      <Link
                        key={m.id}
                        href={`/meetings/${m.id}`}
                        title={m.title}
                        className="absolute inset-x-0.5 z-10 rounded-md bg-surface px-1 py-0.5 shadow-card transition-colors hover:bg-accent-soft"
                        style={{ top }}
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
