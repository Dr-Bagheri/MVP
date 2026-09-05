"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { Select } from "@/components/Select";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useSkillName } from "@/lib/skillName";
import { api, BffError } from "@/api/client";
import { useRefreshEpoch } from "@/lib/refreshBus";
import type { AuthoredSkill, ModelInfo, Skill, User } from "@/api/types";
import { SettingsPane } from "@/components/platform/SettingsPane";
import { FormPanel, FormRow, PageHeader, PanelFooter, Section, Skeleton, SkeletonCards } from "@/components/scaffold";
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

/* the card grids' one geometry — the placeholders reserve the same columns
   the cards will take, so nothing moves when they land */
const CARD_GRID = "grid gap-3 md:grid-cols-2";

/*
 * What the page is waiting on, in three answers rather than a boolean
 * (audit finding, 2026-09-02). `authored` and `resolved` start as [], and
 * the page used to read that as "no prompts yet" on every load: the empty
 * sentence and the loading state were one picture, and the card grids
 * dropped in afterwards and pushed the page down. A `loaded` boolean would
 * have fixed the jump and kept the lie for the other case — a fetch that
 * FAILS also leaves [] behind, and «هنوز پرامپتی نساخته‌اید» is not what
 * happened. Pending renders the cards' shape; ok renders the cards or the
 * sentence; failed renders neither and says so in the alert.
 */
type Answer = "pending" | "ok" | "failed";

export default function SkillsPage() {
  return (
    /*
     * The pane stands OUTSIDE the boundary (audit finding, 2026-09-02). The
     * Suspense exists for useSearchParams, and it used to wrap the whole
     * page — menu included — behind a blank 160px box, so while the boundary
     * suspended the screen had no toolbar and no frame: a white gap where
     * every sibling shows its menu. Only the consumer of the query suspends
     * now; the frame is structure and structure is known before anything
     * loads, and what waits inside it is the shape of the cards to come.
     */
    <SettingsPane activeSlug="skills">
      <Suspense fallback={<SkeletonCards count={4} className={CARD_GRID} height="h-32" />}>
        <SkillsPageContent />
      </Suspense>
    </SettingsPane>
  );
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
  const [answer, setAnswer] = useState<Answer>("pending");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const consumedCreateRequest = useRef(false);

  const isAdmin = me?.role === "admin" || me?.role === "owner";
  const createRequested = searchParams.get("new") === "1";

  async function load() {
    try {
      const [picker, manage] = await Promise.all([api.skills(), api.manageSkills()]);
      setResolved(picker);
      setAuthored(manage.skills);
      setVocabulary(manage.available_tools);
      setAnswer("ok");
    } catch {
      /* a refresh after a save keeps whatever cards are already up — the
         sentence in the alert is the honest part, not a fresh empty state */
      setAnswer("failed");
      setError(t("loadFailed"));
    }
  }

  const skillsEpoch = useRefreshEpoch("skills");
  useEffect(() => {
    void api.me().then(setMe);
    void api.models().then((res) => setModels(res.models));
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load is stable per mount
  }, [skillsEpoch]);

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
    <div>
      <PageHeader
        title={t("title")}
        subtitle={t("levelNote")}
        /* audit finding, 2026-09-02: this button re-stated .btn's height
           and type by hand (h-10 text-sm), one of four sizes on the page for
           one kind of control; the class already answers both */
        actions={<button
          className="btn-primary shrink-0"
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
                  {/* audit finding, 2026-09-02: both selects were pinned to
                      h-control (38px) beside .input's 40px text fields — a
                      two-pixel step inside one form; `select.input` is the
                      platform's dropdown template and owns the height */}
                  {/* offered only where the wall would allow it — the hint
                      pattern, never the authority */}
                  <Select
                    id="sk-level"
                    value={draft.level}
                    onChange={(next) => set("level", next as "org" | "user")}
                    options={[
                      { value: "user", label: t("user") },
                      ...(isAdmin ? [{ value: "org", label: t("org") }] : []),
                    ]}
                  />
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
              {/* audit finding, 2026-09-02: same as the level select above */}
              <Select
                id="sk-model"
                value={draft.model}
                placeholder={t("modelDefault")}
                onChange={(next) => set("model", next)}
                options={[
                  { value: "", label: t("modelDefault") },
                  ...models.map((m) => ({ value: m.id, label: m.name })),
                ]}
              />
            </FormRow>
            <FormRow label={t("tools")} description={t("toolsHint")}>
              {/* 2026-09-03: the frame before the data — the last of this
                  page's []-means-nothing conflations, and the one the two
                  card grids' fix left behind (rule 9: fixing one instance
                  does not fix its siblings). `vocabulary` arrives with the
                  same `load()` the grids wait on, and the editor can be open
                  before it lands — `?new=1` waits on IDENTITY, a different
                  fetch — so this row rendered as an empty box under the label
                  «ابزارها»: not "the vocabulary has not arrived" but "this
                  prompt may use no tools", which is a claim about the product
                  and false. Seven placeholders because seven tools ship (four
                  domain + three write, both registries derived in core's
                  availableTools), widths varied the way the real names are. */}
              {answer === "pending" ? (
                <div className="flex flex-wrap gap-2" aria-busy="true">
                  {["w-32", "w-24", "w-20", "w-28", "w-36", "w-32", "w-28"].map((w, i) => (
                    <Skeleton key={i} className={`h-5 ${w} rounded-full`} />
                  ))}
                </div>
              ) : (
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
              )}
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
              <FormRow label={t("enabled")} description={t("enabledHint")} htmlFor="sk-enabled" controlAtEnd>
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
              {/* audit finding, 2026-09-02: the footer pair were two heights
                  (a hand-sized 40px cancel beside a 38px .btn primary); both
                  wear the class now */}
              <button
                className="btn-secondary"
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

      <Section title={t("authoredTitle")}>
        {answer === "pending" ? (
          /* audit finding, 2026-09-02: the grid is structure and renders
             with the page; only the cards wait — and the "no prompts yet"
             sentence is an answer, so it appears only once there is one */
          <SkeletonCards count={2} className={CARD_GRID} height="h-32" />
        ) : active.length > 0 ? (
          <div className={CARD_GRID}>
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
                  {/* audit finding, 2026-09-02: a hand-sized 36px control
                      (h-9 text-xs) — a height the theme does not have; the
                      compact size is .btn-sm */}
                  <button
                    className="btn-secondary btn-sm"
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
        ) : answer === "ok" ? (
          <Card>
            <p className="text-sm text-fg-muted">{t("noAuthored")}</p>
          </Card>
        ) : /* failed with nothing to show: the alert above already said
               why, and a fabricated "no prompts yet" would be worse than
               the gap */ null}
      </Section>

      {archived.length > 0 ? (
        <Section title={t("archivedTitle")} divided>
          <div className={CARD_GRID}>
            {archived.map((s) => (
              <Card key={s.id}>
                <div className="mb-1 flex items-start justify-between gap-2">
                  <h3 className="font-medium text-fg-muted">{skillName(s)}</h3>
                  <Chip tone="neutral">{t(s.level)}</Chip>
                </div>
                <p className="text-xs text-fg-muted ltr">/{s.slug}</p>
                {/* audit finding, 2026-09-02: same hand-sized 36px control
                    as the edit button; .btn-sm */}
                <button
                  className="btn-secondary btn-sm mt-3"
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

      <Section title={t("resolvedTitle")} divided>
        {answer === "pending" ? (
          /* audit finding, 2026-09-02: this grid rendered EMPTY until the
             fetch landed, then grew. Five placeholders because five system
             skills ship (db/0015, 0061, 0063) and the ladder resolves to at
             least those; a resolved card is a title, a sentence and a slug
             inside p-4, which is the height reserved here */
          <SkeletonCards count={5} className={CARD_GRID} height="h-24" />
        ) : (
          <div className={CARD_GRID}>
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
        )}
      </Section>
    </div>
  );
}
