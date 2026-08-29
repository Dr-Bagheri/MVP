"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";

import { api, BffError } from "@/api/client";
import { Link, useRouter } from "@/i18n/routing";
import { KebabMenu } from "@/components/rowActions";
import { StatusDot } from "@/components/DataTable";
import { Icon, IconPencil } from "@/components/icons";
import { EchoMark } from "@/components/platform/icons";
import { personName, formatTime } from "@/lib/format";
import { useWorkflowCopy } from "@/lib/workflowName";
import { useAgentCopy } from "@/components/platform/agentAppearance";
import {
  INTEGRATIONS, useIntegrationCopy,
} from "@/components/platform/integrationsCatalogue";
import { rowsFor, type TileSize } from "@/lib/dashboardLayout";
import type {
  AgentCard, Call, ConnectorItem, ConnectorStatus, User, WorkflowCard,
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

/** 1 — the people, name and the row menu. */
export function MembersWidget({ size }: { size: TileSize }) {
  const t = useTranslations("dashboard");
  const tManage = useTranslations("management");
  const locale = useLocale();
  const router = useRouter();
  const rows = useMini<User>(() => api.members());

  if (rows === null) return <Waiting />;
  /* the list is Management's, and Management is admin-gated: a member's 403
     is a permission, not an outage, and telling them the read failed would
     send them looking for a fault that is not there */
  if (rows === "forbidden") return <Empty>{t("miniMembersAdminOnly")}</Empty>;
  if (rows === "failed" || rows === "absent") return <Unreadable />;
  if (rows.length === 0) return <Empty>{t("miniNoMembers")}</Empty>;

  return (
    <Rows>
      {rows.slice(0, rowsFor(size)).map((member) => (
        <li key={member.id} className="flex items-center justify-between gap-2 py-1.5 first:pt-0">
          <span className="min-w-0 truncate text-sm text-fg">{personName(member, locale)}</span>
          {/*
            The kebab is here because the person asked for it — and it opens
            the member in Management rather than carrying that screen's
            actions. Disabling a colleague or setting their password needs
            the confirm dialogs and the busy state that live there; a copy of
            those on a glance tile is a second place for a destructive action
            to go wrong, and the two copies would drift.
          */}
          <KebabMenu
            label={t("miniMemberMenu", { name: personName(member, locale) })}
            items={[{
              key: "open",
              label: tManage("memberEdit"),
              icon: <IconPencil />,
              onSelect: () => router.push("/management/users"),
            }]}
          />
        </li>
      ))}
    </Rows>
  );
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

/** 3 — start a recording. The button, and nothing else. */
export function StartRecordWidget() {
  const t = useTranslations("dashboard");
  return (
    <div className="grid h-full place-items-center">
      {/*
        A LINK to the recorder rather than the in-place start the assistant's
        composer chip makes. The difference is deliberate: the chip starts a
        take because you are already in a conversation it should join. From
        the board you are going somewhere, and the recorder is where a take
        gets its title, its language and its template.
      */}
      <Link
        href="/echo/record"
        className="tap inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-on-accent hover:opacity-90"
      >
        <EchoMark size={16} tone="current" />
        {t("miniStartRecording")}
      </Link>
    </div>
  );
}

/** 4 — the integrations, name and status. */
export function IntegrationsWidget({ size }: { size: TileSize }) {
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

  /*
   * A row per integration the product OFFERS, not per grant the person has —
   * so the tile answers "what can I connect, and what is connected" in one
   * read. Showing only the connected ones would make an unconnected
   * platform render as an empty tile, which says "nothing here" about a
   * screen whose whole subject is what is available.
   */
  const listed = INTEGRATIONS.slice(0, rowsFor(size)).map((entry) => {
    const state = rows.find((row) => row.provider === entry.provider);
    return { entry, status: state?.status ?? "not_connected" };
  });

  return (
    <Rows>
      {listed.map(({ entry, status }) => (
        <li key={entry.slug} className="flex items-center justify-between gap-3 py-1.5 first:pt-0">
          <Link
            href={`/integrations/${entry.slug}`}
            className="flex min-w-0 items-center gap-2 text-sm text-fg hover:text-accent"
          >
            <Icon name={entry.icon} size="sm" />
            <span className="truncate">{copy[entry.key].name}</span>
          </Link>
          {/* the theme's own StatusDot, so "connected" looks the same here
              as it does on the integrations table itself */}
          {status === "connected" ? (
            <StatusDot label={tConnect("statusActive")} />
          ) : status === "expired" ? (
            <StatusDot label={tConnect("statusExpired")} tone="warning" />
          ) : status === "revoked" ? (
            <StatusDot label={tConnect("statusRevoked")} tone="danger" />
          ) : (
            /* the integrations table's own sentence is a SENTENCE ("this
               source is not connected yet"); a status dot holds a word */
            <StatusDot label={t("miniNotConnected")} tone="muted" />
          )}
        </li>
      ))}
    </Rows>
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

/** 6 — the workflows, each opening where it can be run. */
export function WorkflowsWidget({ size }: { size: TileSize }) {
  const t = useTranslations("dashboard");
  const workflowCopy = useWorkflowCopy();
  const rows = useMini<WorkflowCard>(() => api.workflows());

  if (rows === null) return <Waiting />;
  if (rows === "forbidden") return <Refused />;
  if (rows === "failed" || rows === "absent") return <Unreadable />;
  if (rows.length === 0) return <Empty>{t("miniNoWorkflows")}</Empty>;

  return (
    <Rows>
      {rows.slice(0, rowsFor(size)).map((card) => (
        <li key={card.id} className="py-1.5 first:pt-0">
          {/* to the ASSISTANT — the same address Run now uses, so a workflow
              opened from the board lands where it can actually be run */}
          <Link
            href={`/assistant?workflow=${encodeURIComponent(card.slug)}`}
            className="block min-w-0 truncate text-sm text-fg hover:text-accent"
          >
            {workflowCopy({ handle: card.slug, name: card.name, description: card.description }).name}
          </Link>
        </li>
      ))}
    </Rows>
  );
}

/** 7 — the calendar the workflows read, from the connected Google account. */
export function CalendarWidget({ size }: { size: TileSize }) {
  const t = useTranslations("dashboard");
  const locale = useLocale();
  /*
   * The provider's OWN calendar, read live through the grant this person
   * gave — not a copy of it in our database. There is nothing here to fall
   * out of step with Google, because there is no second copy: the tile shows
   * what the connector returns, under that person's own authority, which is
   * the same read the meeting-prep workflow makes.
   */
  const rows = useMini<ConnectorItem>(() => api.connectorItems("google", "calendar"));

  if (rows === null) return <Waiting />;
  if (rows === "forbidden") return <Refused />;
  /*
   * ABSENT is the invitation, and it is a different sentence from a fault.
   * `connection()` throws NotFoundError when nobody has connected Google —
   * a 404 — which is the ORDINARY state of this tile on a fresh account, and
   * an apology there would leave the reader waiting for something that is
   * never going to arrive on its own. A real fault still apologises.
   */
  if (rows === "absent") {
    return (
      <p className="text-sm leading-7 ink-muted">
        {t("miniCalendarConnect")}{" "}
        <Link href="/integrations" className="text-accent hover:underline">
          {t("miniCalendarConnectLink")}
        </Link>
      </p>
    );
  }
  if (rows === "failed") return <Unreadable />;
  if (rows.length === 0) return <Empty>{t("miniNoMeetings")}</Empty>;

  return (
    <Rows>
      {rows.slice(0, rowsFor(size)).map((item) => (
        <li key={item.id} className="flex items-baseline justify-between gap-3 py-1.5 first:pt-0">
          <span className="min-w-0 truncate text-sm text-fg">{item.title}</span>
          {item.occurred_at ? (
            <time className="shrink-0 text-xs text-fg-subtle" dateTime={item.occurred_at}>
              {formatTime(item.occurred_at, locale)}
            </time>
          ) : null}
        </li>
      ))}
    </Rows>
  );
}
