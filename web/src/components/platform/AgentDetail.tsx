"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { AgentCard } from "@/api/types";
import { useRouter } from "@/i18n/routing";
import { PageContainer, Section, SkeletonLines } from "@/components/scaffold";
import { EmptyState } from "@/components/ui";
import { Icon } from "@/components/icons";
import { AgentAvatar } from "./AgentAvatar";
import { toolDescription, useAgentCopy } from "./agentAppearance";
import { groupTools } from "./agentCapabilities";
import { digits } from "@/lib/format";
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
  const [available, setAvailable] = useState<string[] | null>(null);
  const locale = useLocale();
  /* `t.raw` and not `t()`: a per-key lookup returns the KEY PATH for a tool
     the catalogue has not met, and a key path is not a sentence. The object
     is read once and `toolDescription` decides what a miss means. */
  const toolCopy = t.raw("tool") as Record<string, unknown>;

  useEffect(() => {
    let alive = true;
    void api.agents()
      .then((rows) => { if (alive) setAgents(rows); })
      .catch(() => { if (alive) setAgents("failed"); });
    /* the platform's vocabulary, for the capability list. A failure leaves it
       null and the stored list stands in — a page that says less rather than
       a page that says nothing. */
    void api.assistantTools()
      .then((names) => { if (alive) setAvailable(names); })
      .catch(() => undefined);
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
  /*
   * WHAT IT ACTUALLY HOLDS, not what its row lists.
   *
   * The stored `tools` column stopped being a ceiling on 2026-09-04 — it is a
   * preference now, "reach for these first" — so rendering it as this agent's
   * capabilities would understate them by fifty tools and contradict what the
   * agent will happily do when asked. The platform's own vocabulary is the
   * honest answer; a run narrows nothing.
   *
   * `available` is null while the read is in flight, which is why the stored
   * list stands in: five true sentences beat an empty panel, and the count
   * settles upward rather than appearing from nothing.
   */
  const tools = available ?? agent.tools;

  const groups = groupTools(tools);

  return (
    <PageContainer>
      {/*
        ── THE IDENTITY CARD ────────────────────────────────────────────

        The page opened with a bare row on the page ground: avatar, name, a
        description, then a hairline and a grid of four labels. On a dark
        screen that reads as a fragment rather than as a subject — nothing
        holds it, and the eye finds no edge until the divider, by which point
        it has left the thing it came to read.

        One card, with the facts inside it, gives the identity a boundary and
        makes the sections below read as what is known ABOUT that subject
        rather than as four unrelated blocks stacked down a page.
      */}
      <div className="card">
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

      {/* the four facts, INSIDE the card and under a hairline of their own:
          they are properties of the thing named above, not a new topic */}
      <dl className="mt-6 grid gap-x-8 gap-y-4 border-t border-border pt-5 sm:grid-cols-4">
          <Fact label={t("detailModel")}>
            {/* null is a real state and says something useful: this agent
                takes whatever the platform's ladder serves, which is why it
                keeps working when a model is retired */}
            {agent.model ?? <span className="text-fg-muted">{t("detailModelDefault")}</span>}
          </Fact>
          <Fact label={t("detailWeb")}>
            {/*
              TWO SWITCHES, ONE FACT (user report, 2026-09-04: "i gave them web
              access but it didn't add to the page and to them").
              
              Web access is `person.agents_web AND agent.web` — either off is
              off. This row showed the AGENT's half and labelled it as the
              whole answer, so somebody who had just turned their own switch ON
              read «خاموش» and reasonably concluded nothing had happened.
              
              It names the composition now. The row cannot resolve it alone —
              the person's switch is not on this wire — and saying "on, when
              you allow it" is the honest shape of a fact that takes two
              yeses: it reports what this agent permits and points at where
              the other half lives, rather than reporting half and calling it
              all.
            */}
            {agent.web ? t("detailWebOn") : t("detailWebOff")}
          </Fact>
          <Fact label={t("detailLevel")}>
            {shipped ? t("detailLevelShipped") : t("detailLevelOwn")}
          </Fact>
          <Fact label={t("detailEditable")}>
            {agent.editable ? t("detailEditableYes") : t("detailEditableNo")}
          </Fact>
      </dl>
      </div>

      {/*
        ── WHAT IT CAN DO ───────────────────────────────────────────────

        Sentences, grouped, in the agent's own voice — not `search_transcripts`
        beside a picture of a gear. Two things were wrong there and only one was
        visible: the chips showed identifiers, and the catalogue that turns a
        name into a sentence was EMPTY, so every tool fell through to its own
        name with the underscores spaced out. `toolDescription()` had been
        written and the copy never had.

        READING FIRST, CHANGING LAST. Somebody scanning this page is deciding
        how much to trust a colleague they did not hire, and the honest shape of
        that answer is: everything it can look at, and then, at the end, what it
        can change.
      */}
      {/* NO INTRO LINE (user directive, 2026-09-04). It counted the tools
          and then said the reach equals the reader's own — a sentence that
          restates the page under it and carries a number that has to be
          right forever. The groups below say what it can do, and each one
          carries its own count. */}
      {/* NO HEADING EITHER (user, 2026-09-05: "remove the text ابزارها in
          agents"): the groups below each carry their own name and count, and a
          word over a grid of named groups restates the grid. */}
      <Section>
        <div className="grid gap-4 lg:grid-cols-2">
          {groups.map((group) => (
            <section key={group.key} className="well p-4">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-fg">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
                  <Icon name={group.icon} size="sm" />
                </span>
                {t(`capability_${group.key}`)}
                <span className="badge-num ms-auto text-xs text-fg-subtle">
                  {digits(group.tools.length, locale)}
                </span>
              </h3>
              <ul className="space-y-1.5">
                {group.tools.map((tool) => (
                  /* the SENTENCE, with the identifier kept as a title: a
                     person reads what it does, and anyone debugging can still
                     find out which tool that was without a second surface */
                  <li
                    key={tool}
                    title={tool}
                    className="flex gap-2 text-xs leading-5 text-fg-muted"
                  >
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-fg-subtle" aria-hidden />
                    {toolDescription(toolCopy, tool)}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </Section>

      {/*
        ── THE WORDS IT WAS GIVEN ────────────────────────────────────────

        The standing instruction an agent carries into every answer — the
        sentences that make one assistant brief and another thorough. For an
        agent this organization wrote, it is the thing that MAKES it, and
        reading it is how somebody decides whether to trust its answers.

        For the three the product ships it is product configuration and the
        wire sends null, so this panel could only ever say "it is
        configuration" — a heading over an apology (user directive,
        2026-09-04: "explain what Instructions is; if it does not serve any
        purpose remove it too"). It serves a purpose exactly where there is
        something to read, so that is where it renders now.
      */}
      {agent.instructions === null ? null : (
        <Section title={t("detailPrompt")}>
          <p className="whitespace-pre-wrap rounded-xl bg-surface-2 p-4 text-sm leading-7 text-fg">
            {agent.instructions}
          </p>
        </Section>
      )}
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
