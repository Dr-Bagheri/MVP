"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/routing";
import { api } from "@/api/client";
import { useRefreshEpoch } from "@/lib/refreshBus";
import type { OrgPersonRecord, ProjectRecord, ProjectTone } from "@/api/types";
import { Overlay } from "./Overlay";
import { Avatar } from "@/components/Avatar";
import { TONE_DOT } from "./tasks/TaskDialogs";
import { IconCheck, IconClose, IconFolder, IconPeople3, IconPlus } from "@/components/icons";
import { SkeletonCards } from "@/components/scaffold";
import { digits, formatDate, personName } from "@/lib/format";

/**
 * PROJECTS (0181) — user directive, 2026-09-04: "in the menu also add a new
 * section with the platform theme design, with a sub menu on top — two of
 * them for filter, sort and add. The name for the new item in the menu is
 * projects, and add these in it."
 *
 * The list is the reference's: cards carrying an icon, a name, a line of
 * summary, the people on it, and how far its work has got. What it does NOT
 * carry is a second copy of anything — a project's progress is counted off
 * the tasks filed under its own category (0181), so a card that says «۳ از ۷»
 * is reading the board rather than a number somebody remembered to update.
 *
 * TWO ROWS, because the directive asked for two: filters and the add button
 * on the first, sorting on the second. The pattern is the meetings toolbar's,
 * deliberately — a person who has learned one toolbar in this product has
 * learned all of them.
 */

export const PROJECT_TONES: ProjectTone[] = [
  "grey", "blue", "green", "amber", "red", "purple", "teal", "pink",
];

/* the eight the reference offers. A closed set for the same reason the tone
   is closed: a free emoji field is a text input somebody pastes a sentence
   into, and the card draws it at 20px. */
const ICON_CHOICES = ["📁", "🚀", "🎯", "🧩", "📈", "🛠️", "💡", "🌱"];

type Filter = "all" | "mine" | "archived";
type Sort = "recent" | "name" | "progress";

/** how far the work has got, as a fraction — null when there is no work yet,
    which renders as a dash rather than as a confident 0% */
function progressOf(p: ProjectRecord): number | null {
  return p.task_total === 0 ? null : p.task_done / p.task_total;
}

export function Projects({ meId, isAdmin }: { meId: string | null; isAdmin: boolean }) {
  const t = useTranslations("projects");
  const locale = useLocale();
  const router = useRouter();
  const [rows, setRows] = useState<ProjectRecord[] | null | "failed">(null);
  const [people, setPeople] = useState<OrgPersonRecord[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("recent");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    void api.projects({ archived: filter === "archived" })
      .then(setRows)
      .catch(() => setRows("failed"));
  }, [filter]);
  /* the same subscription every list takes: a project the assistant creates
     lands here without a reload */
  const epoch = useRefreshEpoch("projects");
  useEffect(load, [load, epoch]);

  useEffect(() => {
    void api.orgPeople().then(setPeople).catch(() => setPeople([]));
  }, []);

  const shown = useMemo(() => {
    if (!Array.isArray(rows)) return [];
    const list = rows.filter((p) => {
      if (filter === "mine") return meId !== null && p.member_ids.includes(meId);
      return true;
    });
    return [...list].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name, locale);
      if (sort === "progress") {
        /* a project with no tasks sorts LAST rather than first: zero-of-zero
           is not "nothing done", it is "nothing to do yet", and putting it
           at the head of a progress sort answers a question nobody asked */
        const pa = progressOf(a), pb = progressOf(b);
        if (pa === null && pb === null) return 0;
        if (pa === null) return 1;
        if (pb === null) return -1;
        return pb - pa;
      }
      return b.created_at.localeCompare(a.created_at);
    });
  }, [rows, filter, sort, meId, locale]);

  const chip = (active: boolean, label: string, onClick: () => void) => (
    <button
      key={label}
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`btn btn-sm gap-1.5 font-medium ${
        active ? "bg-accent text-on-accent" : "text-fg-muted hover:bg-surface-2 hover:text-fg"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* ── row one: the filters and the way in ──────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1">
          {chip(filter === "all", t("filterAll"), () => setFilter("all"))}
          {chip(filter === "mine", t("filterMine"), () => setFilter("mine"))}
          {chip(filter === "archived", t("filterArchived"), () => setFilter("archived"))}
        </div>
        {/* ADMIN ONLY (0186, user directive: "the admins only can make
            projects and they will add members"). Absent rather than disabled:
            a greyed button is a promise the product has no intention of
            keeping for this person, and it invites the press that explains
            nothing. The wall itself is the policy — this is the button
            agreeing with it. */}
        {isAdmin ? (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="btn bg-accent text-on-accent shadow-accent hover:opacity-90"
          >
            <IconPlus width={14} height={14} />
            {t("newProject")}
          </button>
        ) : null}
      </div>

      {/* ── row two: the order, as a SUB-MENU and not a dropdown (user
             directive, 2026-09-04: "make the sort dropdown become the second
             sub menu top").

             A select for three mutually-exclusive values costs two presses to
             see what the options even are, and it rendered as a full-width
             panel under a toolbar of chips — the one control on the page with
             a different silhouette. Chips show the choices and the current
             answer at once, which is what the row above it already does. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1">
          <span className="me-1 text-xs text-fg-muted">{t("sortBy")}</span>
          {chip(sort === "recent", t("sortRecent"), () => setSort("recent"))}
          {chip(sort === "name", t("sortName"), () => setSort("name"))}
          {chip(sort === "progress", t("sortProgress"), () => setSort("progress"))}
        </div>
        <span className="text-xs text-fg-subtle">
          {t("count", { n: digits(shown.length, locale) })}
        </span>
      </div>

      {error !== null ? (
        <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </p>
      ) : null}

      {/* ── the cards ────────────────────────────────────────────────── */}
      {rows === null ? (
        <SkeletonCards count={3} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" height="h-36" />
      ) : rows === "failed" ? (
        <p className="text-sm text-fg-muted">{t("readFailed")}</p>
      ) : shown.length === 0 ? (
        /* the two nothings said apart: an organisation with no projects is
           not the same as a filter that matched none of them */
        <div className="tile flex flex-col items-center gap-2 p-8 text-center">
          <IconFolder width={24} height={24} />
          <p className="text-sm font-medium text-fg">
            {filter === "all" ? t("emptyTitle") : t("emptyFiltered")}
          </p>
          {filter === "all" ? (
            <p className="max-w-sm text-xs text-fg-muted">
              {isAdmin ? t("emptyBody") : t("emptyBodyMember")}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((p) => (
            <ProjectCard key={p.id} project={p} people={people} locale={locale} />
          ))}
        </div>
      )}

      {creating ? (
        <NewProjectDialog
          people={people}
          meId={meId}
          onClose={() => setCreating(false)}
          onCreated={(p) => {
            setCreating(false);
            router.push(`/projects/${p.id}`);
          }}
          onFailed={() => { setCreating(false); setError(t("writeFailed")); }}
        />
      ) : null}
    </div>
  );
}

/**
 * The colour swatches, ONE component — the create dialog and the edit dialog
 * ask the same question, and a second copy is the one that stops matching the
 * first the day either gains a rule.
 *
 * The box is the BOARD'S (its 2026-09-03 note: the 16px colour inside is the
 * picture, `.btn-icon` is the 28px box a person presses — which was `h-7
 * rounded-lg` spelled by hand until the control guard said so). Only the
 * selected ring belongs to this picker.
 */
export function TonePicker({ value, onChange, label }: {
  value: ProjectTone;
  onChange: (tone: ProjectTone) => void;
  label: string;
}) {
  return (
    <div>
      <span className="mb-1.5 block text-xs font-medium text-fg-muted">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {PROJECT_TONES.map((tone) => (
          <button
            key={tone}
            type="button"
            aria-label={tone}
            aria-pressed={value === tone}
            onClick={() => onChange(tone)}
            className={`btn btn-icon hover:bg-surface-2 ${value === tone ? "ring-2 ring-accent" : ""}`}
          >
            <span className={`h-4 w-4 rounded-md ${TONE_DOT[tone] ?? TONE_DOT.grey!}`} />
          </button>
        ))}
      </div>
    </div>
  );
}

function ProjectCard({ project, people, locale }: {
  project: ProjectRecord;
  people: OrgPersonRecord[];
  locale: string;
}) {
  const t = useTranslations("projects");
  const ratio = progressOf(project);
  const members = project.member_ids
    .map((id) => people.find((p) => p.id === id))
    .filter((p): p is OrgPersonRecord => p !== undefined);

  return (
    <Link
      href={`/projects/${project.id}`}
      className="tile flex flex-col gap-3 p-4 transition-colors hover:border-accent/40"
    >
      <div className="flex items-start gap-3">
        {/* the icon, or the first letter — the same fallback a person's
            avatar takes, so an unnamed swatch never renders as an empty box */}
        <span
          aria-hidden
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg ${
            project.icon === null ? "bg-surface-2 text-sm font-bold text-fg-muted" : "bg-surface-2"
          }`}
        >
          {project.icon ?? [...project.name][0] ?? "?"}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TONE_DOT[project.tone] ?? TONE_DOT.grey!}`} aria-hidden />
            <h3 className="truncate text-sm font-semibold text-fg">{project.name}</h3>
            {project.archived_at !== null ? (
              <span className="badge-num shrink-0 rounded-md bg-surface-2 px-1.5 text-[10px] text-fg-muted">
                {t("archived")}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 line-clamp-2 text-xs text-fg-muted">
            {project.summary === "" ? t("noSummary") : project.summary}
          </p>
        </div>
      </div>

      {/* progress: the bar and the numbers, or a dash. A zero-width bar under
          a project with no tasks reads as "nothing done" — which is a claim
          about the work rather than about the board being empty. */}
      <div className="flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
          {ratio === null ? null : (
            <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(ratio * 100)}%` }} />
          )}
        </div>
        <span className="badge-num shrink-0 text-[11px] text-fg-muted">
          {ratio === null
            ? "—"
            : t("progress", {
                done: digits(project.task_done, locale),
                total: digits(project.task_total, locale),
              })}
        </span>
      </div>

      <div className="flex items-center justify-between gap-2">
        {/* the roster, overlapped the way a shared thing reads — a
            negative logical margin on every avatar but the first, so the
            stack leans the right way in both directions */}
        <div className="flex items-center gap-0 [&>*+*]:-ms-1.5">
          {members.slice(0, 4).map((m) => (
            <Avatar key={m.id} name={personName(m, locale)} size="xs" className="ring-2 ring-surface" />
          ))}
          {members.length > 4 ? (
            <span className="badge-num ms-1 text-[11px] text-fg-muted">
              +{digits(members.length - 4, locale)}
            </span>
          ) : null}
          {members.length === 0 ? (
            <span className="flex items-center gap-1 text-[11px] text-fg-subtle">
              <IconPeople3 width={12} height={12} />
              {t("noMembers")}
            </span>
          ) : null}
        </div>
        <span className="badge-num text-[11px] text-fg-subtle">
          {formatDate(project.created_at, locale)}
        </span>
      </div>
    </Link>
  );
}

/**
 * THE CREATE DIALOG, field for field from the reference: a name, a line of
 * description, a colour, an icon, and who is on it.
 *
 * The people picker is a LIST OF TOGGLES rather than a search box, and that
 * is a size judgement rather than a preference: these are colleagues in one
 * organisation, so the list is short enough to read. When an org outgrows
 * that, the box arrives — and it arrives with a reason, not because a search
 * field looks more finished.
 */
function NewProjectDialog({ people, meId, onClose, onCreated, onFailed }: {
  people: OrgPersonRecord[];
  meId: string | null;
  onClose: () => void;
  onCreated: (project: ProjectRecord) => void;
  onFailed: () => void;
}) {
  const t = useTranslations("projects");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [tone, setTone] = useState<ProjectTone>("blue");
  const [icon, setIcon] = useState<string | null>("📁");
  const [members, setMembers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const submit = () => {
    if (name.trim() === "" || busy) return;
    setBusy(true);
    void api.createProject({
      name: name.trim(),
      summary: summary.trim(),
      tone,
      icon,
      member_ids: members,
    })
      .then(onCreated)
      .catch(() => { setBusy(false); onFailed(); });
  };

  return (
    <Overlay onClose={onClose} label={t("newProject")} size="md">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold text-fg">{t("newProject")}</h2>
        <button type="button" onClick={onClose} className="btn btn-icon text-fg-muted hover:text-fg" aria-label={t("close")}>
          <IconClose width={14} height={14} />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-fg-muted">{t("fieldName")}</span>
          <input
            autoFocus
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            placeholder={t("namePlaceholder")}
            className="input w-full"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-fg-muted">{t("fieldSummary")}</span>
          <textarea
            value={summary}
            maxLength={400}
            rows={2}
            onChange={(e) => setSummary(e.target.value)}
            placeholder={t("summaryPlaceholder")}
            className="input w-full resize-none py-2"
          />
        </label>

        <TonePicker value={tone} onChange={setTone} label={t("fieldTone")} />

        <div>
          <span className="mb-1.5 block text-xs font-medium text-fg-muted">{t("fieldIcon")}</span>
          <div className="flex flex-wrap gap-1.5">
            {ICON_CHOICES.map((choice) => (
              <button
                key={choice}
                type="button"
                aria-pressed={icon === choice}
                onClick={() => setIcon((cur) => (cur === choice ? null : choice))}
                /* the same box as the colour swatch beside it — a picker
                   whose two rows are different sizes reads as two features */
                className={`btn btn-icon text-base hover:bg-surface-2 ${
                  icon === choice ? "bg-accent-soft ring-2 ring-accent" : ""
                }`}
              >
                {choice}
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className="mb-1.5 block text-xs font-medium text-fg-muted">{t("fieldMembers")}</span>
          <div className="max-h-44 space-y-1 overflow-y-auto rounded-xl border border-border p-1.5">
            {people.length === 0 ? (
              <p className="px-1 py-2 text-xs text-fg-subtle">{t("noColleagues")}</p>
            ) : people.map((person) => {
              /* THE CREATOR IS ALREADY ON IT and the row says so rather than
                 offering a toggle that changes nothing: the server adds them
                 unconditionally (a project you made and are not on reads as
                 somebody else's), so a switch here would be a control whose
                 off position the server ignores. */
              const isMe = person.id === meId;
              const on = isMe || members.includes(person.id);
              return (
                <button
                  key={person.id}
                  type="button"
                  disabled={isMe}
                  aria-pressed={on}
                  onClick={() => setMembers((cur) =>
                    cur.includes(person.id) ? cur.filter((id) => id !== person.id) : [...cur, person.id])}
                  className={`tap flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start text-xs ${
                    on ? "bg-accent-soft text-accent" : "text-fg-muted hover:bg-surface-2"
                  } ${isMe ? "cursor-default" : ""}`}
                >
                  <Avatar name={personName(person, locale)} size="xs" />
                  <span className="min-w-0 flex-1 truncate">{personName(person, locale)}</span>
                  {isMe ? <span className="text-[10px]">{t("you")}</span> : null}
                  {on ? <IconCheck width={12} height={12} /> : null}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-end gap-2 border-t border-border pt-3">
        <button type="button" onClick={onClose} className="btn text-fg-muted hover:text-fg">
          {tCommon("cancel")}
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={name.trim() === "" || busy}
          className="btn bg-accent text-on-accent shadow-accent hover:opacity-90 disabled:opacity-50"
        >
          <IconPlus width={14} height={14} />
          {busy ? t("creating") : t("create")}
        </button>
      </div>
    </Overlay>
  );
}

