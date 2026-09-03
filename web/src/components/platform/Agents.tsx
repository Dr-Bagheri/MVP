"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { AgentCard } from "@/api/types";
import { Card, EmptyState, Field } from "@/components/ui";
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

  const system = rows.filter((a) => a.level === "system");
  const own = rows.filter((a) => a.level !== "system");

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
        THE FRAME COMES FIRST. Both sections render their heading whatever the
        network is doing, and the skeleton sits INSIDE them — so the layout
        does not jump when the rows land, and "loading" never looks like
        "there are no agents", which on this screen would be a lie about the
        product rather than about the request.
      */}
      <div className="mt-4 space-y-6">
        <section>
          <h2 className="text-sm font-semibold text-fg">{t("shipped")}</h2>
          {agents === null
            ? <SkeletonCards count={2} className="mt-2 grid gap-3 sm:grid-cols-2" height="h-28" />
            : agents === "failed"
              ? <p className="mt-2 text-sm text-fg-muted">{t("readFailed")}</p>
              : (
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  {system.map((agent) => (
                    <AgentTile key={agent.id} agent={agent} copy={copy}
                      onAsk={() => askIn(agent.handle)}
                      onEdit={agent.editable ? () => setEditing(agent) : undefined} />
                  ))}
                </div>
              )}
        </section>

        <section>
          <h2 className="text-sm font-semibold text-fg">{t("yours")}</h2>
          {agents === null
            ? <SkeletonCards count={1} className="mt-2 grid gap-3 sm:grid-cols-2" height="h-28" />
            : agents === "failed"
              ? <p className="mt-2 text-sm text-fg-muted">{t("readFailed")}</p>
              : own.length === 0
                ? (
                  <div className="mt-2">
                    <EmptyState text={t("noneYet")} action={
                      <button type="button" className="btn btn-sm border border-border bg-surface text-fg"
                        onClick={() => setEditing("new")}>{t("newAgent")}</button>
                    } />
                  </div>
                )
                : (
                  <div className="mt-2 grid gap-3 sm:grid-cols-2">
                    {own.map((agent) => (
                      <AgentTile key={agent.id} agent={agent} copy={copy}
                        onAsk={() => askIn(agent.handle)}
                        onEdit={agent.editable ? () => setEditing(agent) : undefined} />
                    ))}
                  </div>
                )}
        </section>
      </div>

      {editing === null ? null : (
        <AgentEditor agent={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }} />
      )}
    </PageContainer>
  );
}

function AgentTile({ agent, copy, onAsk, onEdit }: {
  agent: AgentCard;
  copy: (a: AgentCard) => { name: string; description: string };
  onAsk: () => void;
  onEdit?: (() => void) | undefined;
}) {
  const t = useTranslations("agents");
  const { name, description } = copy(agent);
  return (
    <Card>
      <div className="flex items-start gap-3">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${agentColorClasses(agent.color)}`}>
          <Icon name={agentIconName(agent.icon)} size="sm" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-fg">{name}</h3>
            {/* the handle IS the way to call them, so it is on the card rather
                than in a tooltip: a person who reads «@roya» here can type it
                in the assistant without being told how */}
            <code className="shrink-0 rounded-md bg-surface-2 px-1.5 py-0.5 text-xs text-fg-muted">@{agent.handle}</code>
          </div>
          <p className="mt-1 line-clamp-2 text-sm text-fg-muted">{description}</p>
          <div className="mt-2.5 flex items-center gap-2">
            <button type="button" className="btn btn-sm bg-accent text-on-accent" onClick={onAsk}>
              {t("ask")}
            </button>
            {onEdit ? (
              <button type="button" className="btn btn-sm border border-border bg-surface text-fg" onClick={onEdit}>
                {t("edit")}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </Card>
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
