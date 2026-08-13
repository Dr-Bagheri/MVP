"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { Skill, SkillLevel } from "@/api/types";
import { ManagementPane } from "@/components/platform/ManagementPane";
import { Card, Chip, PageHeader } from "@/components/ui";

const LEVEL_ORDER: SkillLevel[] = ["user", "org", "system"];

export default function SkillsPage() {
  const t = useTranslations("skills");
  const [skills, setSkills] = useState<Skill[]>([]);

  useEffect(() => {
    void api.skills().then(setSkills);
  }, []);

  return (
    <ManagementPane activeSlug="skills">
      <div>
      <PageHeader
        title={t("title")}
        subtitle={t("levelNote")}
        actions={<button className="btn-primary h-10 min-h-0 px-4 text-sm">{t("newSkill")}</button>}
      />

      <div className="space-y-6">
        {LEVEL_ORDER.map((level) => {
          const group = skills.filter((s) => s.level === level);
          if (group.length === 0) return null;
          return (
            <section key={level}>
              <h2 className="mb-2 text-sm font-semibold text-fg">
                {t(level)}
                <span className="ms-2 text-xs font-normal text-fg-muted">
                  {group.length}
                </span>
              </h2>
              <div className="grid gap-3 md:grid-cols-2">
                {group.map((skill) => (
                  <Card key={skill.id}>
                    <div className="mb-1 flex items-start justify-between gap-2">
                      <h3 className="font-medium text-fg">{skill.name}</h3>
                      <Chip tone={level === "user" ? "accent" : level === "org" ? "info" : "neutral"}>
                        {t(level)}
                      </Chip>
                    </div>
                    <p className="text-sm text-fg-muted">{skill.description}</p>
                    <p className="mt-2 text-xs text-fg-muted ltr">
                      /{skill.slug}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      {/* core/'s list response may omit `tools` — see the
                          Skill type. Absent means "not told", which renders as
                          nothing rather than crashing on `.map`. */}
                      {(skill.tools ?? []).map((tool) => (
                        <span key={tool} className="chip bg-surface-2 text-fg-muted ltr">
                          {tool}
                        </span>
                      ))}
                    </div>
                    {skill.editable ? (
                      <button className="btn-secondary mt-3 h-9 min-h-0 px-3 text-xs">
                        {t("edit")}
                      </button>
                    ) : null}
                  </Card>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
    </ManagementPane>
  );
}
