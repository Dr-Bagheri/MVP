"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { AgentCard } from "@/api/types";
import { Field } from "@/components/ui";
import { Overlay } from "@/components/platform/Overlay";
import { Select } from "@/components/Select";
import { Switch } from "@/components/Switch";
import { PageContainer, SkeletonCards } from "@/components/scaffold";
import { Icon } from "@/components/icons";
import { Link } from "@/i18n/routing";
import { AgentAvatar } from "./AgentAvatar";
import { notify } from "@/lib/notify";
import { AGENT_COLOR_CHOICES, AGENT_ICON_CHOICES, useAgentCopy } from "./agentAppearance";

/**
 * THE AGENTS SCREEN (user directive, 2026-09-03: "forget about the room and
 * delete it from the agents just put the 2 agents that we have there plus a
 * option to create new agent").
 *
 * What this replaces is a ROOM LIST — a place you opened, invited agents into,
 * and talked to them in. It lasted a day. The argument against it is a product
 * one and worth keeping: a separate room is a second inbox. Somebody who wants
 * Roya is already in a conversation with the assistant, on the page their
 * question is about, and sending them elsewhere costs them the context they
 * were standing in. So the whole platform is the room now — `@roya` in the
 * thread you already have — and this screen is the ROSTER rather than a door
 * into somewhere else.
 *
 * Which is why every card's primary action opens the assistant with the
 * mention already typed. The screen tells you who exists and what they are
 * for; the answering happens where you were.
 */
export function Agents() {
  const t = useTranslations("agents");
  const copy = useAgentCopy();
  const [agents, setAgents] = useState<AgentCard[] | "failed" | null>(null);
  const [editing, setEditing] = useState<AgentCard | "new" | null>(null);

  const load = () => {
    void api.agents()
      .then((rows) => setAgents(rows))
      .catch(() => setAgents("failed"));
  };
  useEffect(load, []);

  const rows = Array.isArray(agents) ? agents : [];
  /* the pair the product ships first, then anything this organization made.
     Not alphabetical: Roya and Ava are the answer to "who can I ask", and a
     custom agent named «آبان» sorting above them would bury it. */
  /* the Ask button moved to the agent's own page with the rest of its
     actions — `?ask=` PREFILLS the composer with the mention and does not
     send, there as here: the person still has to say what they want, and a
     link that spends a model call is not a link. */

  /* the pair the product ships first, then anything this organization made.
     Not alphabetical: Roya and Ava are the answer to "who can I ask", and a
     custom agent named «آبان» sorting above them would bury it. With the
     headings gone this ordering is the ONLY thing left saying which is which
     at list level — the rest is on the card. */
  const ordered = [
    ...rows.filter((a) => a.level === "system"),
    ...rows.filter((a) => a.level !== "system"),
  ];

  return (
    <PageContainer>
      <div className="flex items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-fg-muted">{t("intro")}</p>
        <button type="button" className="btn btn-sm bg-accent text-on-accent"
          onClick={() => setEditing("new")}>
          <Icon name="plus" size="sm" />
          {t("newAgent")}
        </button>
      </div>

      {/*
        ONE GRID, NO HEADINGS (user directive, 2026-09-03: "remove the text
        that separate the agent, platform agent and your agent").

        Two labelled sections over two and four cards was a table of contents
        for a list you can see all of at once. The distinction they carried is
        real and did not go with them — it moved ONTO the card, where a
        platform agent wears the accent ring and a home-made one wears a plain
        one. That is the better place for it anyway: a heading tells you which
        group you are in only while you are reading the heading; the mark is on
        the thing itself.

        The frame still comes first — the grid renders with skeletons in it, so
        the layout does not jump when the roster lands and "loading" never
        draws the same picture as "you have no agents".
      */}
      {/*
        THE WORKFLOW PAGE'S SHAPE (user directive, 2026-09-04: "make it look
        like the workflow page with two big buttons and their avatars — when
        clicked, inside it must have all the options and details").
        
        Two grids, exactly as /workflows has: the pair the product ships as
        BIG cards, and anything this organization wrote at half that height
        underneath. It reads the way the directive describes because it is the
        same layout, not a lookalike — a person who has used one page has used
        this one.
        
        The card is a LINK now. It used to be a row with an inline Ask button
        and a pencil, which meant an agent had no page of its own: everything
        knowable about Roya was whatever fitted on one line. The actions moved
        to the detail page, where there is room to say what they do.
      */}
      {agents === "failed"
        ? <p className="mt-4 text-sm text-fg-muted">{t("readFailed")}</p>
        : agents === null
          ? <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <SkeletonCards count={2} className="contents" height="h-40" />
            </div>
          : (
            <>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                {ordered.filter((a) => a.level === "system").map((agent) => (
                  <AgentTile key={agent.id} agent={agent} copy={copy} big />
                ))}
              </div>
              {ordered.some((a) => a.level !== "system") ? (
                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  {ordered.filter((a) => a.level !== "system").map((agent) => (
                    <AgentTile key={agent.id} agent={agent} copy={copy} />
                  ))}
                </div>
              ) : null}
            </>
          )}

      {editing === null ? null : (
        <AgentEditor agent={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }} />
      )}
    </PageContainer>
  );
}

/**
 * One agent, at list size.
 *
 * SMALLER (user directive, 2026-09-03: "their place and size that they fill be
 * fitting will be smaller and their logo is different"). The old card was a
 * two-line description, a handle chip and two buttons — a profile page for
 * something you scan. It is a row now: mark, name, one line, and the actions
 * appear on hover or focus, which is the pattern the task board and the
 * meetings list already use.
 *
 * THE MARK CARRIES WHAT THE HEADINGS CARRIED. A platform agent is drawn in the
 * accent with a ring; one this organization made is drawn plain. That is the
 * whole of "their logo is different" and it is doing real work — with the two
 * section titles gone it is the only per-card statement of which is which, so
 * it is asserted rather than left to look right.
 *
 * The handle is still on the row and still `@`-prefixed: it is how you call
 * them, and a person who reads it here can type it in the assistant without
 * being told how.
 */
function AgentTile({ agent, copy, big = false }: {
  agent: AgentCard;
  copy: (a: AgentCard) => { name: string; description: string };
  /** the shipped pair, at template size — the workflow page's own two cards */
  big?: boolean;
}) {
  const { name, description } = copy(agent);
  const shipped = agent.level === "system";
  return (
    <Link
      href={`/agents/${agent.handle}`}
      /* ONE element, so there is no dead margin inside the card and no second
         focus stop competing with the first — the workflow card's rule, and
         the reason its actions live on the page it opens rather than on it */
      className={`group flex flex-col rounded-2xl border border-border bg-surface p-7 transition-colors hover:border-border-strong hover:bg-surface-2 ${
        big ? "min-h-40" : "min-h-28 justify-center"
      }`}
    >
      <span className="flex items-center gap-4">
        {/*
          THE AVATAR, not the stored glyph. A sparkle and a chart said what
          Roya and Ava DO; a letter says who they are, which is what a card
          with their name on it is for — and it is the same face that appears
          beside their turns in the thread, so the roster and the conversation
          agree about what Ava looks like.
        */}
        <AgentAvatar handle={agent.handle} size={big ? "xl" : "lg"} />
        <span className="min-w-0">
          {/* NO HANDLE ON THE CARD (user directive, 2026-09-04: "remove the
              @roya and @ava text from the buttons"). It is an ADDRESS — how you
              summon them in a message — and a card is where you meet them by
              name. It stays on the agent's own page, where somebody has gone
              looking for exactly that kind of detail. */}
          <span className="flex items-baseline gap-1.5">
            <span className={`truncate font-semibold text-fg group-hover:text-accent ${
              big ? "text-base" : "text-sm"
            }`}>{name}</span>
          </span>
          {/* the small card truncates its one line here; the big one gives
              the sentence a line of its own below, unclipped */}
          {big ? null : (
            <span className="mt-0.5 block truncate text-xs text-fg-subtle">{description}</span>
          )}
        </span>
      </span>
      {/* the shipped pair say a second line — they are the two the product
          promises, and the card has the room a row never had */}
      {big ? (
        <span
          data-agent-mark={shipped ? "platform" : "own"}
          className="mt-auto pt-5 text-xs text-fg-muted"
        >
          {description}
        </span>
      ) : null}
    </Link>
  );
}


/**
 * Make one, or change one.
 *
 * The prompt field is the reason `instructions` joined the wire in 0166: PATCH
 * has accepted it since M47 and the read never returned it, so this form could
 * be written and could not be filled — an edit that started from an empty box
 * would blank the persona on save. For the two shipped agents the field is
 * absent entirely (their prompts are product configuration and `editable` is
 * false), which is why the whole editor is only reachable from a card that
 * says so.
 */
function AgentEditor({ agent, onClose, onSaved }: {
  agent: AgentCard | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("agents");
  const [name, setName] = useState(agent?.name ?? "");
  const [description, setDescription] = useState(agent?.description ?? "");
  const [instructions, setInstructions] = useState(agent?.instructions ?? "");
  const [icon, setIcon] = useState(agent?.icon ?? "sparkles");
  const [color, setColor] = useState(agent?.color ?? "violet");
  const [web, setWeb] = useState(agent?.web ?? false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const canSave = name.trim() !== "" && instructions.trim() !== "" && !busy;

  const save = () => {
    if (!canSave) return;
    setBusy(true);
    setFailed(null);
    const body = {
      name: name.trim(), description: description.trim(),
      instructions: instructions.trim(), icon, color, web,
    };
    void (agent === null
      /* `level: "user"` — a personal agent, always. An org-wide one is an
         admin's to make and needs a choice this form does not yet ask for;
         offering the option and having the server refuse it is worse than not
         offering it, so the narrower thing is what ships. */
      ? api.createAgent({ level: "user", ...body })
      : api.updateAgent(agent.id, body))
      .then(() => { notify(t("saved")); onSaved(); })
      .catch((cause: { detail?: string }) => {
        setFailed(cause?.detail ?? t("saveFailed"));
        setBusy(false);
      });
  };

  return (
    <Overlay onClose={onClose} label={agent === null ? t("newAgent") : t("editAgent")}>
      <div className="space-y-3">
        <Field label={t("fieldName")}>
          <input className="input w-full" value={name} maxLength={80}
            onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t("fieldDescription")} hint={t("fieldDescriptionHint")}>
          <input className="input w-full" value={description} maxLength={200}
            onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label={t("fieldInstructions")} hint={t("fieldInstructionsHint")}>
          <textarea className="input min-h-32 w-full py-2 leading-7" value={instructions}
            maxLength={4000} onChange={(e) => setInstructions(e.target.value)} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("fieldIcon")}>
            <Select value={icon} onChange={setIcon}
              options={AGENT_ICON_CHOICES.map((choice) => ({ value: choice, label: choice }))} />
          </Field>
          <Field label={t("fieldColor")}>
            <Select value={color} onChange={setColor}
              options={AGENT_COLOR_CHOICES.map((choice) => ({ value: choice, label: choice }))} />
          </Field>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
          <span className="text-sm text-fg">{t("fieldWeb")}</span>
          <Switch checked={web} onChange={() => setWeb((v) => !v)} label={t("fieldWeb")} />
        </div>

        {failed === null ? null : <p className="text-sm text-danger">{failed}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn btn-sm border border-border bg-surface text-fg" onClick={onClose}>
            {t("cancel")}
          </button>
          <button type="button" className="btn btn-sm bg-accent text-on-accent"
            disabled={!canSave} onClick={save}>
            {t("save")}
          </button>
        </div>
      </div>
    </Overlay>
  );
}
