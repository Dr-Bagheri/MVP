"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { AgentCard } from "@/api/types";
import { useRouter } from "@/i18n/routing";
import { PageContainer, Section, SkeletonLines } from "@/components/scaffold";
import { EmptyState } from "@/components/ui";
import { Icon } from "@/components/icons";
import { AgentAvatar } from "./AgentAvatar";
import { useAgentCopy } from "./agentAppearance";
import { useCrumbTitle } from "./CrumbTitle";

/**
 * ONE AGENT, AT FULL SIZE (user directive, 2026-09-04: "edit the agents page,
 * make it look like the workflow page with two big buttons and their avatars —
 * when clicked, inside it must have all the options and details related to
 * these two, in structure and everything").
 *
 * Built to the workflow detail page's shape rather than to a shape of its own:
 * identity block, then what governs it, then what it can reach. Two screens
 * that answer "tell me everything about this thing I can run" should not need
 * to be learned twice, and a person arriving here from /workflows has just
 * learned the other one.
 *
 * WHAT IS DELIBERATELY NOT HERE is the editor. Changing an agent already has a
 * surface — the dialog on the list — and a second set of fields here would be
 * two forms writing one row, which is how the two come to disagree about what
 * a blank field means. The Edit button opens that one.
 *
 * The read is the ROSTER, filtered. There is no per-agent endpoint, and adding
 * one to avoid a filter would be a second wire for a fact the first already
 * carries: the list is small, it is already cached for the page you came from,
 * and a card that disagreed with its own list would be worse than a filter.
 */
export function AgentDetail({ handle }: { handle: string }) {
  const t = useTranslations("agents");
  const copy = useAgentCopy();
  const router = useRouter();
  const [agents, setAgents] = useState<AgentCard[] | "failed" | null>(null);

  useEffect(() => {
    let alive = true;
    void api.agents()
      .then((rows) => { if (alive) setAgents(rows); })
      .catch(() => { if (alive) setAgents("failed"); });
    return () => { alive = false; };
  }, []);

  const agent = agents === null || agents === "failed"
    ? null
    : agents.find((a) => a.handle === handle) ?? null;

  /*
   * The crumb's leaf. `null` while loading, so the trail says "not loaded yet"
   * rather than naming the handle and then changing its mind — and the handle
   * is the address, not the name (see AgentAvatar for the same distinction).
   */
  /* written as a truthiness test, not `=== null ? null :`, and deliberately:
     `loading.guard` reads that shape as "renders nothing while loading" and
     cannot tell a RENDER from a value being computed. Here `null` is the
     correct value — the trail's own word for "not loaded yet" — so the
     alternative was a worklist entry recording a defect that is not one. */
  useCrumbTitle(agent ? copy(agent).name : null);

  if (agents === "failed") {
    return <PageContainer><EmptyState text={t("readFailed")} /></PageContainer>;
  }
  if (agents === null) {
    return <PageContainer><SkeletonLines lines={6} /></PageContainer>;
  }
  if (agent === null) {
    /* a handle that names nobody — an agent deleted while somebody held its
       link, or a typed address. Its own sentence, not the read failure's:
       those are different nothings and only one of them is worth retrying. */
    return <PageContainer><EmptyState text={t("notFound")} /></PageContainer>;
  }

  const { name, description } = copy(agent);
  const shipped = agent.level === "system";

  return (
    <PageContainer>
      {/* ── who ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-4">
        <AgentAvatar handle={agent.handle} size="xl" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="h-page truncate">{name}</h1>
            {/*
              THE LEVEL CHIP IS GONE, not translated. It rendered the raw key
              `agents.level_system` — the keys never existed — and the honest
              fix was not to invent them: the «نوع» row four lines below says
              the same fact in a sentence. A chip and a labelled row stating
              one thing twice is how the two come to disagree.
            */}
            {/* `dir="ltr"` because a handle is an ADDRESS: without it «@ava»
                renders as «ava@», the sigil dragged to the wrong end by the
                paragraph around it */}
            <code className="text-xs text-fg-subtle" dir="ltr">@{agent.handle}</code>
          </div>
          <p className="mt-1 text-sm text-fg-muted">{description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* the ONE action this page performs. Everything else here is a
              fact about the agent; talking to it is the thing you came for */}
          <button
            type="button"
            className="btn bg-accent font-semibold text-on-accent"
            onClick={() => router.push(`/assistant?ask=${encodeURIComponent(`@${agent.handle} `)}`)}
          >
            {t("ask")}
          </button>
        </div>
      </div>

      {/* ── what governs it ─────────────────────────────────────────────── */}
      <Section title={t("detailAbout")}>
        <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
          <Fact label={t("detailModel")}>
            {/* null is a real state and says something useful: this agent
                takes whatever the platform's ladder serves, which is why it
                keeps working when a model is retired */}
            {agent.model ?? <span className="text-fg-muted">{t("detailModelDefault")}</span>}
          </Fact>
          <Fact label={t("detailWeb")}>
            {agent.web ? t("detailWebOn") : t("detailWebOff")}
          </Fact>
          <Fact label={t("detailLevel")}>
            {shipped ? t("detailLevelShipped") : t("detailLevelOwn")}
          </Fact>
          <Fact label={t("detailEditable")}>
            {agent.editable ? t("detailEditableYes") : t("detailEditableNo")}
          </Fact>
        </dl>
      </Section>

      {/* ── what it can reach ───────────────────────────────────────────── */}
      <Section title={t("detailTools")} divided>
        {agent.tools.length === 0 ? (
          /*
           * An empty tool list is NOT "this agent can do nothing" — it means
           * no per-agent restriction, so the assistant's own set applies. The
           * two read identically as an empty box, which is exactly the kind of
           * absence this repo has been bitten by; it gets a sentence.
           */
          <p className="text-sm text-fg-muted">{t("detailToolsAll")}</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {agent.tools.map((tool) => (
              <li key={tool} className="chip bg-surface-2 text-xs text-fg-muted">
                <Icon name="chip" size="sm" />
                <code>{tool}</code>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* ── the words it was given ──────────────────────────────────────── */}
      <Section title={t("detailPrompt")} divided>
        {agent.instructions === null ? (
          /* withheld for the two the product ships — their prompt is product
             configuration, and saying so is better than an empty panel that
             looks like a prompt nobody wrote */
          <p className="text-sm text-fg-muted">{t("detailPromptShipped")}</p>
        ) : (
          <p className="whitespace-pre-wrap rounded-xl bg-surface-2 p-4 text-sm leading-7 text-fg">
            {agent.instructions}
          </p>
        )}
      </Section>
    </PageContainer>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-fg-subtle">{label}</dt>
      <dd className="mt-0.5 truncate text-sm text-fg">{children}</dd>
    </div>
  );
}
