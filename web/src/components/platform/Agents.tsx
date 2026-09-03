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
import { useRouter } from "@/i18n/routing";
import { notify } from "@/lib/notify";
import {
  agentColorClasses, agentIconName, AGENT_COLOR_CHOICES, AGENT_ICON_CHOICES,
  useAgentCopy,
} from "./agentAppearance";

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
  const router = useRouter();
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
  /* one place the "Ask" button decides what it means: `?ask=` PREFILLS the
     composer with the mention and does not send — the person still has to say
     what they want, and a link that spends a model call is not a link. */
  const askIn = (handle: string) =>
    router.push(`/assistant?ask=${encodeURIComponent(`@${handle} `)}`);

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
      {agents === "failed"
        ? <p className="mt-4 text-sm text-fg-muted">{t("readFailed")}</p>
        : (
          <div className="mt-4 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {agents === null
              ? <SkeletonCards count={3} className="contents" height="h-[4.5rem]" />
              : ordered.map((agent) => (
                <AgentTile key={agent.id} agent={agent} copy={copy}
                  onAsk={() => askIn(agent.handle)}
                  onEdit={agent.editable ? () => setEditing(agent) : undefined} />
              ))}
          </div>
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
function AgentTile({ agent, copy, onAsk, onEdit }: {
  agent: AgentCard;
  copy: (a: AgentCard) => { name: string; description: string };
  onAsk: () => void;
  onEdit?: (() => void) | undefined;
}) {
  const t = useTranslations("agents");
  const { name, description } = copy(agent);
  const shipped = agent.level === "system";
  return (
    <div className="tile-row group flex items-center gap-2.5 p-2.5">
      <span
        data-agent-mark={shipped ? "platform" : "own"}
        className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl ${
          shipped
            ? `ring-1 ring-inset ring-accent/40 ${agentColorClasses(agent.color)}`
            : "bg-surface-2 text-fg-muted"
        }`}
      >
        <Icon name={agentIconName(agent.icon)} size="sm" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-1.5">
          <span className="truncate text-sm font-semibold text-fg">{name}</span>
          <code className="shrink-0 text-xs text-fg-subtle">@{agent.handle}</code>
        </span>
        <span className="mt-0.5 block truncate text-xs text-fg-muted">{description}</span>
      </span>
      {/* the actions do not take room until they are wanted — `opacity` rather
          than `hidden`, so the row does not change width when the pointer
          crosses it, and `focus-within` so a keyboard reaches them */}
      <span className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        {onEdit ? (
          <button type="button" className="btn btn-icon border border-border bg-surface text-fg-muted hover:text-fg"
            onClick={onEdit} aria-label={t("edit")} title={t("edit")}>
            <Icon name="pencil" size="sm" />
          </button>
        ) : null}
        <button type="button" className="btn btn-sm bg-accent text-on-accent" onClick={onAsk}>
          {t("ask")}
        </button>
      </span>
    </div>
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
