"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/api/client";
import { useRefreshEpoch } from "@/lib/refreshBus";
import type { AgentCard, User } from "@/api/types";
import { Link } from "@/i18n/routing";
import { PlatformShell } from "./PlatformShell";
import { PageContainer, PageHeader, Section, SkeletonCards } from "@/components/scaffold";
import { Card } from "@/components/ui";
import { Icon, IconPencil } from "@/components/icons";
import { AgentEditor } from "./AgentEditor";
import { KebabMenu } from "@/components/rowActions";
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
              <PageHeader
                title={t("title")}
                subtitle={t("subtitle")}
                actions={
                  <button type="button" className="btn-primary h-10 min-h-0 px-4 text-sm" onClick={() => setEditing(null)}>
                    + {t("create")}
                  </button>
                }
              />
              <Section title={t("myAgents")}>
                {agents === null ? (
                  <SkeletonCards count={4} className="grid gap-x-8 gap-y-5 lg:grid-cols-2" height="h-36" />
                ) : agents.length === 0 ? (
                  <Card><p className="text-sm text-fg-muted">{t("empty")}</p></Card>
                ) : (
                  <div className="grid gap-x-8 gap-y-5 lg:grid-cols-2">
                    {agents.map((agent) => {
                      const copy = agentCopy(agent);
                      /* the affordance mirrors the wall: yours, or the org's
                         if you govern it. A system agent's editor would be a
                         form whose save can only 404. */
                      const editable = agent.level === "user"
                        || (agent.level === "org" && isAdmin);
                      return (
                        <div
                          key={agent.id}
                          className="relative flex min-h-36 items-start gap-3 rounded-2xl border border-transparent p-3 transition-colors hover:border-border hover:bg-surface"
                        >
                          <Link
                            href={{ pathname: "/assistant", query: { agent: agent.handle } }}
                            className="group flex min-w-0 flex-1 items-start gap-5 text-start"
                            aria-label={t("openWith", { name: copy.name })}
                          >
                            <span className={`grid h-20 w-20 shrink-0 place-items-center rounded-3xl ${agentColorClasses(agent.color)}`} aria-hidden>
                              <Icon name={agentIconName(agent.icon)} size="hero" />
                            </span>
                            <span className="min-w-0 pt-1">
                              <span className="block text-base font-semibold text-fg group-hover:text-accent">{copy.name}</span>
                              <span className="mt-2 block text-sm leading-6 text-fg-muted">{copy.description}</span>
                              <span className="mt-3 flex items-center gap-2">
                                {/* the level chip is gone (user directive, 2026-08-29): it named where
    an agent came from, which is a fact about our catalogue rather than
    about what the agent does — and every shipped one said the same word */}
                                <span className="text-xs text-fg-subtle">{t("toolCount", { count: agent.tools.length })}</span>
                              </span>
                            </span>
                          </Link>
                          {editable ? (
                            <span className="shrink-0">
                              <KebabMenu
                                label={t("cardMenu", { name: copy.name })}
                                items={[{
                                  key: "edit",
                                  label: t("edit"),
                                  icon: <IconPencil width={14} height={14} />,
                                  onSelect: () => setEditing(agent),
                                }]}
                              />
                            </span>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </Section>
            </>
          )}
        </PageContainer>
    </PlatformShell>
  );
}
