"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useSkillName } from "@/lib/skillName";
import { api, BffError } from "@/api/client";
import type { AuthoredSkill, ModelInfo, Skill, User } from "@/api/types";
import { ManagementPane } from "@/components/platform/ManagementPane";
import { FormPanel, FormRow, PageHeader, PanelFooter, Section } from "@/components/scaffold";
import { Card, Chip } from "@/components/ui";

/**
 * Skills management (M29, Part 2) — the Onyx-personas surface on our
 * resolver ladder. Two views of one table, deliberately separate:
 *
 *  - the RESOLVED view (top): what actually runs, one skill per slug after
 *    the ladder collapses system < org < user. Read-only context.
 *  - the AUTHORING view: the rows the caller may edit, full definitions,
 *    including disabled/shadowed/archived rows — the resolver's collapse is
 *    exactly what an author needs to see through.
 *
 * The editor never re-derives a rule: slugs, tool names, question limits
 * and level permissions are all validated by core (which derives the tool
 * vocabulary from the registries), and its refusal sentence is rendered
 * verbatim. `editable` is an affordance hint; db/0013's policies decide.
 */

interface Draft {
  id?: string;
  level: "org" | "user";
  slug: string;
  name: string;
  description: string;
  prompt: string;
  model: string;
  tools: string[];
  starters: string;
  maxToolCalls: string;
  enabled: boolean;
}

const EMPTY: Draft = {
  level: "user", slug: "", name: "", description: "", prompt: "",
  model: "", tools: [], starters: "", maxToolCalls: "", enabled: true,
};

const fromAuthored = (s: AuthoredSkill): Draft => ({
  id: s.id,
  level: s.level,
  slug: s.slug,
  name: s.name,
  description: s.description,
  prompt: s.prompt,
  model: s.model ?? "",
  tools: s.tools,
  starters: s.starter_questions.join("\n"),
  maxToolCalls: s.max_tool_calls === null ? "" : String(s.max_tool_calls),
  enabled: s.enabled,
});

export default function SkillsPage() {
  return (
    <Suspense fallback={<SkillsPageFallback />}>
      <SkillsPageContent />
    </Suspense>
  );
}

function SkillsPageFallback() {
  return <div className="min-h-40" aria-busy="true" />;
}

function SkillsPageContent() {
  const t = useTranslations("skills");
  const searchParams = useSearchParams();
  /* system skills localize (shipped product content); authored names never do */
  const skillName = useSkillName();
  const [me, setMe] = useState<User | null>(null);
  const [resolved, setResolved] = useState<Skill[]>([]);
  const [authored, setAuthored] = useState<AuthoredSkill[]>([]);
  const [vocabulary, setVocabulary] = useState<string[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const consumedCreateRequest = useRef(false);

  const isAdmin = me?.role === "admin" || me?.role === "owner";
  const createRequested = searchParams.get("new") === "1";

  async function load() {
    const [picker, manage] = await Promise.all([api.skills(), api.manageSkills()]);
    setResolved(picker);
    setAuthored(manage.skills);
    setVocabulary(manage.available_tools);
  }

  useEffect(() => {
    void api.me().then(setMe);
    void api.models().then((res) => setModels(res.models));
    void load();
  }, []);

  /* The Workflows launcher delegates creation to this real prompt editor.
     Wait for identity: otherwise an admin who followed the link could be
     given a personal draft before their organization-writing ability arrives. */
  useEffect(() => {
    if (createRequested && me && !consumedCreateRequest.current) {
      consumedCreateRequest.current = true;
      setError(null);
      setDraft({ ...EMPTY, level: isAdmin ? "org" : "user" });
    }
  }, [createRequested, isAdmin, me]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => (d ? { ...d, [key]: value } : d));

  async function save() {
    if (!draft || busy) return;
    setBusy(true);
    setError(null);
    const starters = draft.starters.split("\n").map((q) => q.trim()).filter(Boolean);
    const maxCalls = draft.maxToolCalls.trim() === "" ? null : Number(draft.maxToolCalls);
    try {
      if (draft.id) {
        await api.updateSkill(draft.id, {
          name: draft.name,
          description: draft.description,
          prompt: draft.prompt,
          model: draft.model === "" ? null : draft.model,
          tools: draft.tools,
          starter_questions: starters,
          enabled: draft.enabled,
          max_tool_calls: maxCalls,
        });
      } else {
        await api.createSkill({
          level: draft.level,
          slug: draft.slug,
          name: draft.name,
          prompt: draft.prompt,
          description: draft.description,
          model: draft.model === "" ? null : draft.model,
          tools: draft.tools,
          starter_questions: starters,
          max_tool_calls: maxCalls,
        });
      }
      setDraft(null);
      await load();
    } catch (cause) {
      // core's sentence verbatim — it owns the slug rule, the tool
      // vocabulary and the level permissions, and its refusals carry them
      setError(cause instanceof BffError ? (cause.detail ?? t("saveFailed")) : t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function setArchived(row: AuthoredSkill, archived: boolean) {
    setBusy(true);
    setError(null);
    try {
      await api.archiveSkill(row.id, archived);
      await load();
    } catch (cause) {
      setError(cause instanceof BffError ? (cause.detail ?? t("saveFailed")) : t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  const active = authored.filter((s) => s.archived_at === null);
  const archived = authored.filter((s) => s.archived_at !== null);

  return (
    <ManagementPane activeSlug="skills">
      <div>
        <PageHeader
          title={t("title")}
          subtitle={t("levelNote")}
          actions={<button
            className="btn-primary h-10 min-h-0 shrink-0 px-4 text-sm"
            onClick={() => {
              setError(null);
              setDraft({ ...EMPTY, level: isAdmin ? "org" : "user" });
            }}
          >
            {t("newSkill")}
          </button>}
        />

        {error ? (
          <p role="alert" className="mb-4 text-sm text-danger">
            {error}
          </p>
        ) : null}

        {draft ? (
          <Section title={draft.id ? t("editorEdit") : t("editorNew")}>
            <FormPanel>
              {!draft.id ? (
                <>
                  <FormRow label={t("level")} description={t("levelHint")} htmlFor="sk-level">
                    <select
                      id="sk-level"
                      className="input min-h-0 h-11 md:h-control"
                      value={draft.level}
                      onChange={(e) => set("level", e.target.value as "org" | "user")}
                    >
                      <option value="user">{t("user")}</option>
                      {/* offered only where the wall would allow it — the
                          hint pattern, never the authority */}
                      {isAdmin ? <option value="org">{t("org")}</option> : null}
                    </select>
                  </FormRow>
                  <FormRow label={t("slug")} description={t("slugHint")} htmlFor="sk-slug">
                    <input
                      id="sk-slug"
                      className="input"
                      dir="ltr"
                      value={draft.slug}
                      onChange={(e) => set("slug", e.target.value)}
                      placeholder="weekly-recap"
                    />
                  </FormRow>
                </>
              ) : null}
              <FormRow label={t("name")} htmlFor="sk-name">
                <input
                  id="sk-name"
                  className="input"
                  value={draft.name}
                  onChange={(e) => set("name", e.target.value)}
                />
              </FormRow>
              <FormRow label={t("descriptionLabel")} htmlFor="sk-desc">
                <input
                  id="sk-desc"
                  className="input"
                  value={draft.description}
                  onChange={(e) => set("description", e.target.value)}
                />
              </FormRow>
              <FormRow label={t("prompt")} description={t("promptHint")} htmlFor="sk-prompt">
                <textarea
                  id="sk-prompt"
                  className="input min-h-[8rem] py-2 leading-7"
                  value={draft.prompt}
                  onChange={(e) => set("prompt", e.target.value)}
                />
              </FormRow>
              <FormRow label={t("model")} description={t("modelHint")} htmlFor="sk-model">
                <select
                  id="sk-model"
                  className="input min-h-0 h-11 md:h-control"
                  value={draft.model}
                  onChange={(e) => set("model", e.target.value)}
                >
                  <option value="">{t("modelDefault")}</option>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </FormRow>
              <FormRow label={t("tools")} description={t("toolsHint")}>
                <div className="flex flex-wrap gap-2">
                  {vocabulary.map((tool) => {
                    const on = draft.tools.includes(tool);
                    return (
                      <button
                        key={tool}
                        type="button"
                        aria-pressed={on}
                        className={`chip ltr ${on ? "bg-accent-soft text-accent" : "bg-surface-2 text-fg-muted"}`}
                        onClick={() =>
                          set("tools", on ? draft.tools.filter((x) => x !== tool) : [...draft.tools, tool])
                        }
                      >
                        {tool}
                      </button>
                    );
                  })}
                </div>
              </FormRow>
              <FormRow label={t("starterQuestions")} description={t("starterHint")} htmlFor="sk-starters">
                <textarea
                  id="sk-starters"
                  className="input min-h-[5rem] py-2 leading-7"
                  value={draft.starters}
                  onChange={(e) => set("starters", e.target.value)}
                />
              </FormRow>
              <FormRow label={t("maxToolCalls")} description={t("maxToolCallsHint")} htmlFor="sk-max">
                <input
                  id="sk-max"
                  className="input"
                  dir="ltr"
                  inputMode="numeric"
                  value={draft.maxToolCalls}
                  onChange={(e) => set("maxToolCalls", e.target.value.replace(/[^0-9]/g, ""))}
                />
              </FormRow>
              {draft.id ? (
                <FormRow label={t("enabled")} description={t("enabledHint")} htmlFor="sk-enabled">
                  <input
                    id="sk-enabled"
                    type="checkbox"
                    className="h-5 w-5 accent-[var(--accent)]"
                    checked={draft.enabled}
                    onChange={(e) => set("enabled", e.target.checked)}
                  />
                </FormRow>
              ) : null}
              <PanelFooter>
                <button
                  className="btn-secondary h-10 min-h-0 px-4 text-sm"
                  disabled={busy}
                  onClick={() => setDraft(null)}
                >
                  {t("cancel")}
                </button>
                <button className="btn-primary" disabled={busy} onClick={() => void save()}>
                  {busy ? t("saving") : draft.id ? t("save") : t("create")}
                </button>
              </PanelFooter>
            </FormPanel>
          </Section>
        ) : null}

        <Section title={t("authoredTitle")} description={t("authoredNote")}>
          {active.length === 0 ? (
            <Card>
              <p className="text-sm text-fg-muted">{t("noAuthored")}</p>
            </Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {active.map((s) => (
                <Card key={s.id}>
                  <div className="mb-1 flex items-start justify-between gap-2">
                    <h3 className="font-medium text-fg">{skillName(s)}</h3>
                    <div className="flex gap-1.5">
                      {!s.enabled ? <Chip tone="warning">{t("disabled")}</Chip> : null}
                      <Chip tone={s.level === "user" ? "accent" : "info"}>{t(s.level)}</Chip>
                    </div>
                  </div>
                  {s.description ? <p className="text-sm text-fg-muted">{s.description}</p> : null}
                  <p className="mt-2 text-xs text-fg-muted ltr">/{s.slug}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {s.tools.map((tool) => (
                      <span key={tool} className="chip bg-surface-2 text-[11px] text-fg-muted ltr">
                        {tool}
                      </span>
                    ))}
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button
                      className="btn-secondary h-9 min-h-0 px-3 text-xs"
                      disabled={busy}
                      onClick={() => {
                        setError(null);
                        setDraft(fromAuthored(s));
                      }}
                    >
                      {t("edit")}
                    </button>
                    <button
                      className="text-xs text-fg-muted underline-offset-2 hover:underline"
                      disabled={busy}
                      onClick={() => void setArchived(s, true)}
                    >
                      {t("archive")}
                    </button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </Section>

        {archived.length > 0 ? (
          <Section title={t("archivedTitle")} description={t("archivedNote")} divided>
            <div className="grid gap-3 md:grid-cols-2">
              {archived.map((s) => (
                <Card key={s.id}>
                  <div className="mb-1 flex items-start justify-between gap-2">
                    <h3 className="font-medium text-fg-muted">{skillName(s)}</h3>
                    <Chip tone="neutral">{t(s.level)}</Chip>
                  </div>
                  <p className="text-xs text-fg-muted ltr">/{s.slug}</p>
                  <button
                    className="btn-secondary mt-3 h-9 min-h-0 px-3 text-xs"
                    disabled={busy}
                    onClick={() => void setArchived(s, false)}
                  >
                    {t("unarchive")}
                  </button>
                </Card>
              ))}
            </div>
          </Section>
        ) : null}

        <Section title={t("resolvedTitle")} description={t("resolvedNote")} divided>
          <div className="grid gap-3 md:grid-cols-2">
            {resolved.map((skill) => (
              <Card key={skill.id}>
                <div className="mb-1 flex items-start justify-between gap-2">
                  <h3 className="font-medium text-fg">{skillName(skill)}</h3>
                  <Chip tone={skill.level === "user" ? "accent" : skill.level === "org" ? "info" : "neutral"}>
                    {t(skill.level)}
                  </Chip>
                </div>
                {skill.description ? <p className="text-sm text-fg-muted">{skill.description}</p> : null}
                <p className="mt-2 text-xs text-fg-muted ltr">/{skill.slug}</p>
              </Card>
            ))}
          </div>
        </Section>
      </div>
    </ManagementPane>
  );
}
