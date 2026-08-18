"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { Skill } from "@/api/types";
import { Link } from "@/i18n/routing";
import { useSkillName } from "@/lib/skillName";
import { AssistantMenu } from "./AssistantMenu";
import { PlatformShell } from "./PlatformShell";
import { MenuLayout, PageHeader, Section } from "@/components/scaffold";
import { Card, Chip } from "@/components/ui";

/**
 * Workflows are intentionally manual prompt launchers in v1. Selecting one
 * takes its real, server-resolved prompt into a new conversation; it does not
 * imply a scheduler, trigger, or background action that the product lacks.
 */
export function Workflows() {
  const t = useTranslations("workflows");
  const skillName = useSkillName();
  const [tab, setTab] = useState<"browse" | "mine">("browse");
  const [prompts, setPrompts] = useState<Skill[] | null>(null);

  useEffect(() => {
    void api.skills().then(setPrompts).catch(() => setPrompts([]));
  }, []);

  const visible = tab === "mine" ? (prompts ?? []).filter((prompt) => prompt.editable) : (prompts ?? []);

  return (
    <PlatformShell>
      <MenuLayout menu={<AssistantMenu activeSlug="workflows" />}>
        <div className="mx-auto w-full max-w-content px-5 pb-16 pt-5 md:px-10 md:pt-4">
          <PageHeader
            title={t("title")}
            subtitle={t("subtitle")}
            actions={
              <Link href="/management/skills?new=1" className="btn-primary h-10 min-h-0 shrink-0 px-4 text-sm">
                + {t("create")}
              </Link>
            }
          />

          <div role="tablist" aria-label={t("tabsLabel")} className="mb-8 flex gap-2">
            {(["browse", "mine"] as const).map((name) => (
              <button
                key={name}
                type="button"
                role="tab"
                aria-selected={tab === name}
                className={`tap rounded-full border px-4 py-2 text-sm transition-colors ${
                  tab === name
                    ? "border-accent bg-accent text-on-accent"
                    : "border-border bg-surface text-fg-muted hover:border-border-strong hover:text-fg"
                }`}
                onClick={() => setTab(name)}
              >
                {t(name)}
              </button>
            ))}
          </div>

          <Section title={tab === "browse" ? t("featured") : t("mineTitle")}>
            {prompts === null ? null : visible.length === 0 ? (
              <Card><p className="text-sm text-fg-muted">{tab === "mine" ? t("mineEmpty") : t("empty")}</p></Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {visible.map((prompt) => (
                  <Card key={prompt.id} className="flex min-h-56 flex-col">
                    <div className="mb-5 flex items-start justify-between gap-3">
                      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-accent-soft text-lg font-semibold text-accent" aria-hidden>
                        {skillName(prompt).slice(0, 1)}
                      </span>
                      <Chip tone={prompt.level === "user" ? "accent" : prompt.level === "org" ? "info" : "neutral"}>
                        {t(prompt.level)}
                      </Chip>
                    </div>
                    <h2 className="text-base font-semibold text-fg">{skillName(prompt)}</h2>
                    <p className="mt-2 line-clamp-3 text-sm leading-6 text-fg-muted">{prompt.description || t("noDescription")}</p>
                    <div className="mt-auto flex items-center justify-between gap-3 pt-5">
                      <span className="text-xs text-fg-subtle">{t("toolCount", { count: prompt.tools.length })}</span>
                      <Link href={{ pathname: "/", query: { prompt: prompt.slug } }} className="btn-secondary h-9 min-h-0 px-3 text-xs">
                        {t("use")}
                      </Link>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </Section>
        </div>
      </MenuLayout>
    </PlatformShell>
  );
}
