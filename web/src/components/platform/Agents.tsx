"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/api/client";
import { useRefreshEpoch } from "@/lib/refreshBus";
import type { AgentCard, User } from "@/api/types";
import { Link } from "@/i18n/routing";
import { PlatformShell } from "./PlatformShell";
import { PageContainer, SkeletonCards } from "@/components/scaffold";
import { Card } from "@/components/ui";
import { Icon, IconPencil, IconPlus } from "@/components/icons";
import { AgentEditor } from "./AgentEditor";
import { useAgentCopy } from "./agentAppearance";
import { agentColorClasses, agentIconName } from "./agentAppearance";

/**
 * M47 — the agents surface: browse, and EDIT (Sana's shape, our wire).
 *
 * A card press GOES — to the assistant, with the agent picked, where its
 * workflows and knowledge come up beside the greeting (user directive,
 * 2026-08-28: "when clicked it must go to ai assistant page with their
 * workflow and file that they can use. not the edit part"). Editing moved
 * into the card's ⋯ menu, offered only where the wall would let the save
 * land. The address is `/assistant`, the hub's real one — the old link went
 * to `/`, whose locale redirect drops the query, so the picked agent
 * silently never arrived (M42's stale-address family).
 *
 * Creation gates like Workflows: user-level for everyone, org-level for
 * admins only — the affordance mirrors the wall (RLS + core's admin gate),
 * never widens it. Instructions never come back over this wire; the editor
 * carries that fact instead of hiding it.
 */
export function Agents() {
  const t = useTranslations("agents");
  const [agents, setAgents] = useState<AgentCard[] | null>(null);
  const [me, setMe] = useState<User | null>(null);
  /** `undefined` = the list; `null` = creating; a card = editing it */
  const [editing, setEditing] = useState<AgentCard | null | undefined>(undefined);

  const isAdmin = me?.role === "admin" || me?.role === "owner";
  const agentCopy = useAgentCopy();

  const agentsEpoch = useRefreshEpoch("agents");
  useEffect(() => {
    void api.agents().then(setAgents).catch(() => setAgents([]));
  }, [agentsEpoch]);
  useEffect(() => {
    void api.me().then(setMe).catch(() => setMe(null));
  }, []);

  return (
    <PlatformShell>
      {/* NO SECTION MENU (user directive, 2026-09-02). These three left the
          assistant's sub-menu for the main rail, and a page that still opens
          that menu beside itself is the door it was moved out of, shown
          twice — the rail says where you are, and this pane said it again in
          another vocabulary. */}
        <PageContainer>
          {editing !== undefined ? (
            <AgentEditor
              agent={editing}
              isAdmin={isAdmin}
              onClose={() => setEditing(undefined)}
              onSaved={(card) => {
                /* the editor stays open on the SAVED card (a create becomes
                   an edit); the list adopts the server's returned row */
                setEditing(card);
                setAgents((current) => {
                  if (current === null) return [card];
                  return current.some((entry) => entry.id === card.id)
                    ? current.map((entry) => (entry.id === card.id ? card : entry))
                    : [...current, card];
                });
              }}
            />
          ) : (
            <>
              {/*
                THE REFERENCE'S AGENT CARD (user directive, 2026-09-02:
                "redesign the whole platform like the tasks and meetings pages
                with same structure, buttons, fonts, tables"). What was here:
                a borderless 144px block with an 80px mark, a page title and
                subtitle above it, and a section heading over the only list
                on the page — three headings before the first agent. What is
                here: no headings (the breadcrumb has the name), the create
                button on the page's top row like every other list, and a
                bordered 20px card with a 40px mark, the name at 14, two lines
                of description, and the two things a person does with an
                agent as buttons in its footer — talk to it, or edit it. The
                kebab that held a single "edit" item is gone; a menu with one
                entry is a button wearing a hat. Shape ported from Lovable's
                build of the same brief.
              */}
              <div className="flex flex-wrap items-center justify-end gap-3">
                <button
                  type="button"
                  className="btn gap-1.5 bg-accent font-semibold text-on-accent"
                  onClick={() => setEditing(null)}
                >
                  <IconPlus width={14} height={14} />
                  {t("create")}
                </button>
              </div>
              <div className="mt-4">
                {agents === null ? (
                  <SkeletonCards count={4} className="grid gap-3 md:grid-cols-2" height="h-44" />
                ) : agents.length === 0 ? (
                  <Card><p className="text-sm text-fg-muted">{t("empty")}</p></Card>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">
                    {agents.map((agent) => {
                      const copy = agentCopy(agent);
                      /* the affordance mirrors the wall: yours, or the org's
                         if you govern it. A system agent's editor would be a
                         form whose save can only 404. */
                      const editable = agent.level === "user"
                        || (agent.level === "org" && isAdmin);
                      return (
                        <article
                          key={agent.id}
                          className="tile flex flex-col p-5 transition-colors hover:border-border-strong"
                        >
                          <div className="flex items-center gap-3">
                            <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${agentColorClasses(agent.color)}`} aria-hidden>
                              <Icon name={agentIconName(agent.icon)} size="lg" />
                            </span>
                            <h3 className="min-w-0 truncate text-pane-title font-semibold text-fg">{copy.name}</h3>
                          </div>
                          <p className="mt-3 line-clamp-2 text-[12.5px] leading-6 text-fg-muted">{copy.description}</p>
                          {/* the level chip stays gone (2026-08-29): it named where an
                              agent came from, a fact about our catalogue rather than
                              about what the agent does */}
                          <p className="mt-2 text-[11px] text-fg-subtle">{t("toolCount", { count: agent.tools.length })}</p>
                          <div className="mt-4 flex gap-2">
                            <Link
                              href={{ pathname: "/assistant", query: { agent: agent.handle } }}
                              className="btn btn-sm bg-accent font-medium text-on-accent"
                              aria-label={t("openWith", { name: copy.name })}
                            >
                              {t("talk")}
                            </Link>
                            {editable ? (
                              <button
                                type="button"
                                className="btn btn-sm border border-border font-medium text-fg-muted hover:text-fg"
                                onClick={() => setEditing(agent)}
                              >
                                <IconPencil width={12} height={12} />
                                {t("edit")}
                              </button>
                            ) : null}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </PageContainer>
    </PlatformShell>
  );
}
