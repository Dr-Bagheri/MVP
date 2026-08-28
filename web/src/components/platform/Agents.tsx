"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/api/client";
import { useRefreshEpoch } from "@/lib/refreshBus";
import type { AgentCard, User } from "@/api/types";
import { Link } from "@/i18n/routing";
import { AssistantMenu } from "./AssistantMenu";
import { PlatformShell } from "./PlatformShell";
import { MenuLayout, PageContainer, PageHeader, Section } from "@/components/scaffold";
import { Card, Chip } from "@/components/ui";
import { Icon } from "@/components/icons";
import { AgentEditor } from "./AgentEditor";
import { agentColorClasses, agentIconName, agentLevelTone } from "./agentAppearance";

/**
 * M47 — the agents surface: browse, and EDIT (Sana's shape, our wire).
 *
 * A card press opens the editor; starting a conversation is the card's
 * explicit second act, linking the agent's handle into the hub — at
 * `/assistant`, the hub's real address. The old link went to `/`, which
 * stopped being the hub when the dashboard took the landing page, and the
 * locale redirect drops the query — the picked agent silently never arrived
 * (M42's stale-address family; the route resolves, so every reachability
 * check stays green).
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

  const agentsEpoch = useRefreshEpoch("agents");
  useEffect(() => {
    void api.agents().then(setAgents).catch(() => setAgents([]));
  }, [agentsEpoch]);
  useEffect(() => {
    void api.me().then(setMe).catch(() => setMe(null));
  }, []);

  return (
    <PlatformShell>
      <MenuLayout menu={<AssistantMenu activeSlug="agents" />}>
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
                {agents === null ? null : agents.length === 0 ? (
                  <Card><p className="text-sm text-fg-muted">{t("empty")}</p></Card>
                ) : (
                  <div className="grid gap-x-8 gap-y-5 lg:grid-cols-2">
                    {agents.map((agent) => (
                      <div
                        key={agent.id}
                        className="flex min-h-36 items-start gap-5 rounded-2xl border border-transparent p-3 transition-colors hover:border-border hover:bg-surface"
                      >
                        <button
                          type="button"
                          className="group flex min-w-0 flex-1 items-start gap-5 text-start"
                          onClick={() => setEditing(agent)}
                          aria-label={`${t("edit")}: ${agent.name}`}
                        >
                          <span className={`grid h-20 w-20 shrink-0 place-items-center rounded-3xl ${agentColorClasses(agent.color)}`} aria-hidden>
                            <Icon name={agentIconName(agent.icon)} size="hero" />
                          </span>
                          <span className="min-w-0 pt-1">
                            <span className="block text-base font-semibold text-fg group-hover:text-accent">{agent.name}</span>
                            <span className="mt-2 block text-sm leading-6 text-fg-muted">{agent.description}</span>
                            <span className="mt-3 flex items-center gap-2">
                              <Chip tone={agentLevelTone(agent.level)}>{t(agent.level)}</Chip>
                              <span className="text-xs text-fg-subtle">{t("toolCount", { count: agent.tools.length })}</span>
                            </span>
                          </span>
                        </button>
                        <Link
                          href={{ pathname: "/assistant", query: { agent: agent.handle } }}
                          className="tap mt-1 shrink-0 rounded-full border border-border px-3 py-1.5 text-xs text-fg-muted transition-colors hover:border-accent hover:text-accent"
                        >
                          {t("startConversation")}
                        </Link>
                      </div>
                    ))}
                  </div>
                )}
              </Section>
            </>
          )}
        </PageContainer>
      </MenuLayout>
    </PlatformShell>
  );
}
