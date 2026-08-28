"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { AgentCard, AgentWorkflowLink } from "@/api/types";
import { Link } from "@/i18n/routing";
import { Icon } from "@/components/icons";
import { Chip } from "@/components/ui";
import { agentColorClasses, agentIconName, agentLevelTone, toolDescription, useAgentCopy } from "./agentAppearance";

/**
 * M47 — the overview that comes up WITH a picked agent (the user's ask, from
 * Sana's Sales-agent screen): who the agent is, the workflows it carries,
 * and what it can reach — rendered in the hub beside the conversation the
 * agent will hold.
 *
 * Three rules shape it:
 *
 *  - **It sits in the flow, never over it.** The AssistantPane overlay
 *    taught what a covering layer does to the thing it duplicates; this
 *    panel takes column space above the thread and gives it back when
 *    collapsed. The workflow list scrolls in its own box.
 *
 *  - **Picking a workflow NAVIGATES.** Workflows run from their own page —
 *    the standing rule — so each row is a link to `/workflows/<handle>`,
 *    not a run button that would start spend from a briefing card.
 *
 *  - **The kinds of nothing stay distinct.** `null` = still loading (the
 *    panel claims nothing — a "no workflows" sentence during loading is the
 *    "—"-tile bug wearing new copy); `[]` = truly none; a failed fetch says
 *    it failed instead of impersonating an agent with no workflows.
 */
export function AgentOverviewPanel({
  agent,
  defaultCollapsed = false,
}: {
  agent: AgentCard;
  /** the active conversation starts it folded — the thread owns that screen */
  defaultCollapsed?: boolean;
}) {
  /* shipped agents localize; an org's own words render as written */
  const copy = useAgentCopy()(agent);
  const t = useTranslations("agents");
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [workflows, setWorkflows] = useState<AgentWorkflowLink[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setWorkflows(null);
    setFailed(false);
    /* try/catch AND .catch — a client without the method throws
       synchronously, and that must degrade the same way a rejection does */
    try {
      void api.agentWorkflows(agent.id)
        .then((rows) => { if (alive) setWorkflows(rows); })
        .catch(() => { if (alive) setFailed(true); });
    } catch {
      setFailed(true);
    }
    return () => { alive = false; };
  }, [agent.id]);

  const toolCopy = useMemo<Record<string, unknown>>(() => {
    try {
      const raw = t.raw("tool");
      return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }, [t]);

  return (
    <section
      aria-label={t("overviewLabel")}
      className="mx-auto mb-3 w-full max-w-content rounded-3xl border border-border bg-surface/80 text-start shadow-sm"
    >
      <div className="flex items-center gap-4 p-4">
        <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${agentColorClasses(agent.color)}`} aria-hidden>
          <Icon name={agentIconName(agent.icon)} size="xl" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold text-fg">{copy.name}</span>
            <Chip tone={agentLevelTone(agent.level)}>{t(agent.level)}</Chip>
          </span>
          {collapsed ? null : (
            <span className="mt-1 block text-sm leading-5 text-fg-muted">{copy.description}</span>
          )}
        </span>
        <button
          type="button"
          className="tap h-8 shrink-0 rounded-full border border-border px-3 text-xs text-fg-muted hover:border-border-strong hover:text-fg"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((current) => !current)}
        >
          {collapsed ? t("expand") : t("collapse")}
        </button>
      </div>

      {collapsed ? null : (
        <div className="grid gap-5 border-t border-border p-4 sm:grid-cols-2">
          <div>
            <h3 className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{t("overviewWorkflows")}</h3>
            {failed ? (
              <p className="mt-2 text-sm text-fg-muted">{t("overviewWorkflowsFailed")}</p>
            ) : workflows === null ? null : workflows.length === 0 ? (
              <p className="mt-2 text-sm text-fg-muted">{t("overviewNoWorkflows")}</p>
            ) : (
              <>
                <ul className="mt-2 max-h-44 space-y-1.5 overflow-y-auto">
                  {workflows.map((workflow) => (
                    <li key={workflow.id}>
                      <Link
                        href={`/workflows/${workflow.handle}`}
                        className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm text-fg transition-colors hover:border-accent hover:text-accent"
                      >
                        <span className="truncate">{workflow.name}</span>
                        <span className="shrink-0 text-xs text-fg-subtle" dir="ltr">{workflow.handle}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs leading-5 text-fg-subtle">{t("overviewHint")}</p>
              </>
            )}
          </div>
          <div>
            <h3 className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{t("overviewKnowledge")}</h3>
            <p className="mt-2 text-xs leading-5 text-fg-muted">{t("knowledgeIntro")}</p>
            {agent.tools.length > 0 ? (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {agent.tools.map((tool) => (
                  <li
                    key={tool}
                    className="chip border border-border text-xs text-fg-muted"
                    title={toolDescription(toolCopy, tool)}
                  >
                    {tool.replaceAll("_", " ")}
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="mt-2 text-xs text-fg-muted">{agent.web ? t("webOn") : t("webOff")}</p>
          </div>
        </div>
      )}
    </section>
  );
}
