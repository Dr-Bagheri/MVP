"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { api } from "@/api/client";
import { useRefreshEpoch } from "@/lib/refreshBus";
import { useCrumbTitle } from "./CrumbTitle";
import type {
  OrgPersonRecord, ProjectRecord, ProjectTone, TaskCardRecord, TaskColumnRecord,
} from "@/api/types";
import { Overlay } from "./Overlay";
import { Avatar } from "@/components/Avatar";
import { ConfirmDialog } from "@/components/rowActions";
import { TONE_DOT, PRIORITY_CHIP } from "./tasks/TaskDialogs";
import { TonePicker } from "./Projects";
import {
  IconArchive, IconCheck, IconClose, IconPencil, IconPeople3, IconPlus,
} from "@/components/icons";
import { SkeletonLines } from "@/components/scaffold";
import { digits, formatDate, personName } from "@/lib/format";

/**
 * ONE PROJECT (0181).
 *
 * The reference's project screen has tabs — conversation, tasks, board,
 * calendar. Two of those are surfaces this product already has and one is not
 * built yet, so this page shows what is TRUE rather than the full row with
 * two of them empty:
 *
 *   · its people, which is the one thing a project owns.
 *   · its work — the tasks filed under the project's own category, read
 *     from the board (0181: the category IS the project on the board), with
 *     a door into the board itself filtered to it.
 *
 * The conversation tab arrives with the chat room. A tab that opens onto
 * «به‌زودی» is a promise the product has to keep on a schedule nobody set.
 */
export function ProjectDetail({ id, meId }: { id: string; meId: string | null }) {
  const t = useTranslations("projects");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const [project, setProject] = useState<ProjectRecord | null | "missing" | "failed">(null);
  const [people, setPeople] = useState<OrgPersonRecord[]>([]);
  const [board, setBoard] = useState<{ columns: TaskColumnRecord[]; tasks: TaskCardRecord[] } | null>(null);
  const [editing, setEditing] = useState(false);
  const [managing, setManaging] = useState(false);
  const [condemned, setCondemned] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const epoch = useRefreshEpoch("projects");
  const load = useCallback(() => {
    void api.project(id)
      .then(setProject)
      .catch((e: unknown) =>
        setProject((e as { status?: number }).status === 404 ? "missing" : "failed"));
  }, [id]);
  useEffect(load, [load, epoch]);

  useEffect(() => {
    void api.orgPeople().then(setPeople).catch(() => setPeople([]));
  }, []);

  const tasksEpoch = useRefreshEpoch("tasks");
  useEffect(() => {
    void api.taskBoard()
      .then((b) => setBoard({ columns: b.columns, tasks: b.tasks }))
      .catch(() => setBoard({ columns: [], tasks: [] }));
  }, [tasksEpoch]);

  /* the deepest crumb is this project's name — data, so it is fed rather
     than declared (null = untitled, undefined = not loaded) */
  useCrumbTitle(typeof project === "object" && project !== null ? project.name : undefined);

  const mine = useMemo(() => {
    if (typeof project !== "object" || project === null || board === null) return [];
    /* NO `topic_id === null` EARLY RETURN. It stood here and read as the
       guard against showing the whole board to a project whose category is
       gone — and deleting it left the suite green, because the equality
       below is already false for every card when `topic_id` is null. A
       second check that cannot change an answer reads as rigour and is a
       line the next person has to reason about. The property is still
       asserted (Projects.test.tsx), against the mistake that IS possible:
       spelling this as "no topic means no filter". */
    return board.tasks.filter((task) => task.topic_id === project.topic_id);
  }, [project, board]);

  if (project === null) return <SkeletonLines lines={4} />;
  if (project === "missing") return <p className="text-sm text-fg-muted">{t("notFound")}</p>;
  if (project === "failed") return <p className="text-sm text-fg-muted">{t("readFailed")}</p>;

  const members = project.member_ids
    .map((mid) => people.find((p) => p.id === mid))
    .filter((p): p is OrgPersonRecord => p !== undefined);
  const done = mine.filter((task) => task.done).length;

  const patch = (body: Parameters<typeof api.updateProject>[1]) => {
    void api.updateProject(project.id, body)
      .then(setProject)
      .catch(() => setError(t("writeFailed")));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {/* ── the identity tile ────────────────────────────────────────── */}
      <section className="tile flex flex-wrap items-start gap-3 p-4">
        <span
          aria-hidden
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-surface-2 ${
            project.icon === null ? "text-base font-bold text-fg-muted" : "text-2xl"
          }`}
        >
          {project.icon ?? [...project.name][0] ?? "?"}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 shrink-0 rounded-full ${TONE_DOT[project.tone] ?? TONE_DOT.grey!}`} aria-hidden />
            <h1 className="truncate text-base font-semibold text-fg">{project.name}</h1>
            {project.archived_at !== null ? (
              <span className="badge-num rounded-md bg-surface-2 px-1.5 text-[10px] text-fg-muted">
                {t("archived")}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-xs leading-6 text-fg-muted">
            {project.summary === "" ? t("noSummary") : project.summary}
          </p>
          <p className="mt-1 text-[11px] text-fg-subtle">
            {t("createdOn", { date: formatDate(project.created_at, locale) })}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => setEditing(true)} className="btn btn-sm gap-1.5 border border-border text-fg-muted hover:text-fg">
            <IconPencil width={12} height={12} />
            {t("edit")}
          </button>
          {project.archived_at === null ? (
            <button type="button" onClick={() => setCondemned(true)} className="btn btn-sm gap-1.5 border border-border text-fg-muted hover:text-fg">
              <IconArchive width={12} height={12} />
              {t("archive")}
            </button>
          ) : (
            <button type="button" onClick={() => patch({ archived: false })} className="btn btn-sm gap-1.5 border border-border text-fg-muted hover:text-fg">
              <IconCheck width={12} height={12} />
              {t("restore")}
            </button>
          )}
        </div>
      </section>

      {error !== null ? (
        <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        {/* ── the work ───────────────────────────────────────────────── */}
        <section className="tile p-4" aria-label={t("work")}>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-fg">{t("work")}</h2>
            <div className="flex items-center gap-2">
              <span className="badge-num text-[11px] text-fg-muted">
                {mine.length === 0
                  ? "—"
                  : t("progress", { done: digits(done, locale), total: digits(mine.length, locale) })}
              </span>
              {/* the board, standing on this project's own folder. A link
                  rather than a second board: one place cards are moved. */}
              <Link
                href={project.topic_id === null ? "/tasks" : `/tasks?topic=${encodeURIComponent(project.topic_id)}`}
                className="btn btn-sm gap-1.5 border border-border text-fg-muted hover:text-fg"
              >
                <IconPlus width={12} height={12} />
                {t("openBoard")}
              </Link>
            </div>
          </div>
          {board === null ? (
            <SkeletonLines lines={3} />
          ) : mine.length === 0 ? (
            <p className="py-6 text-center text-xs text-fg-subtle">{t("noWork")}</p>
          ) : (
            <ul className="space-y-1.5">
              {mine.slice(0, 12).map((task) => {
                const column = board.columns.find((c) => c.id === task.column_id);
                return (
                  <li key={task.id}>
                    <Link
                      href={`/tasks?task=${encodeURIComponent(task.id)}`}
                      className="flex items-center gap-2 rounded-xl border border-border px-3 py-2 hover:border-accent/40"
                    >
                      <span
                        aria-hidden
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                          task.done ? "bg-success" : TONE_DOT[column?.tone ?? "grey"] ?? TONE_DOT.grey!
                        }`}
                      />
                      <span className={`min-w-0 flex-1 truncate text-xs ${task.done ? "text-fg-subtle line-through" : "text-fg"}`}>
                        {task.title}
                      </span>
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${PRIORITY_CHIP[task.priority]}`}>
                        {t(`priority_${task.priority}`)}
                      </span>
                      {column !== undefined ? (
                        <span className="shrink-0 text-[10px] text-fg-subtle">{column.name}</span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
              {mine.length > 12 ? (
                <li className="pt-1 text-center text-[11px] text-fg-subtle">
                  {t("andMore", { n: digits(mine.length - 12, locale) })}
                </li>
              ) : null}
            </ul>
          )}
        </section>

        {/* ── the people ─────────────────────────────────────────────── */}
        <section className="tile self-start p-4" aria-label={t("fieldMembers")}>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-fg">{t("fieldMembers")}</h2>
            <button type="button" onClick={() => setManaging(true)} className="btn btn-icon text-fg-muted hover:text-fg" aria-label={t("manageMembers")}>
              <IconPlus width={12} height={12} />
            </button>
          </div>
          {members.length === 0 ? (
            <p className="flex items-center gap-1.5 py-3 text-xs text-fg-subtle">
              <IconPeople3 width={12} height={12} />
              {t("noMembers")}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {members.map((person) => (
                <li key={person.id} className="flex items-center gap-2">
                  <Avatar name={personName(person, locale)} size="xs" />
                  <span className="min-w-0 flex-1 truncate text-xs text-fg">{personName(person, locale)}</span>
                  {person.id === meId ? (
                    <span className="text-[10px] text-fg-subtle">{t("you")}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {editing ? (
        <EditProjectDialog
          project={project}
          onClose={() => setEditing(false)}
          onSaved={(p) => { setEditing(false); setProject(p); }}
          onFailed={() => { setEditing(false); setError(t("writeFailed")); }}
        />
      ) : null}

      {managing ? (
        <MembersDialog
          project={project}
          people={people}
          meId={meId}
          onClose={() => setManaging(false)}
          onChanged={load}
        />
      ) : null}

      {condemned ? (
        <ConfirmDialog
          title={t("archiveTitle")}
          body={t("archiveBody", { name: project.name })}
          confirmLabel={t("archive")}
          cancelLabel={tCommon("cancel")}
          onCancel={() => setCondemned(false)}
          onConfirm={() => {
            setCondemned(false);
            /* ARCHIVED, and the page says so instead of navigating away: an
               archived project is still readable, and bouncing to the list
               would look like a delete. */
            patch({ archived: true });
          }}
        />
      ) : null}
    </div>
  );
}

function EditProjectDialog({ project, onClose, onSaved, onFailed }: {
  project: ProjectRecord;
  onClose: () => void;
  onSaved: (p: ProjectRecord) => void;
  onFailed: () => void;
}) {
  const t = useTranslations("projects");
  const tCommon = useTranslations("common");
  const [name, setName] = useState(project.name);
  const [summary, setSummary] = useState(project.summary);
  const [tone, setTone] = useState<ProjectTone>(project.tone);
  const [busy, setBusy] = useState(false);

  /* DIFF-BASED, like every other form in this product: typing into a field
     and putting it back sends nothing, so a no-op edit writes no row and a
     stale page cannot clobber a colleague's change to a field it never
     touched. */
  const patch = useMemo(() => {
    const body: Record<string, unknown> = {};
    if (name.trim() !== project.name) body.name = name.trim();
    if (summary.trim() !== project.summary) body.summary = summary.trim();
    if (tone !== project.tone) body.tone = tone;
    return body;
  }, [name, summary, tone, project]);
  const dirty = Object.keys(patch).length > 0;

  return (
    <Overlay onClose={onClose} label={t("edit")} size="md">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold text-fg">{t("edit")}</h2>
        <button type="button" onClick={onClose} className="btn btn-icon text-fg-muted hover:text-fg" aria-label={t("close")}>
          <IconClose width={14} height={14} />
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-fg-muted">{t("fieldName")}</span>
          <input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} className="input w-full" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-fg-muted">{t("fieldSummary")}</span>
          <textarea value={summary} maxLength={400} rows={2} onChange={(e) => setSummary(e.target.value)} className="input w-full resize-none py-2" />
        </label>
        <TonePicker value={tone} onChange={setTone} label={t("fieldTone")} />
        {/* the rename's consequence, said before it happens rather than
            discovered on the board */}
        {"name" in patch ? (
          <p className="rounded-xl border border-border bg-surface-2 px-3 py-2 text-[11px] text-fg-muted">
            {t("renameNote")}
          </p>
        ) : null}
      </div>
      <div className="mt-3 flex items-center justify-end gap-2 border-t border-border pt-3">
        <button type="button" onClick={onClose} className="btn text-fg-muted hover:text-fg">{tCommon("cancel")}</button>
        <button
          type="button"
          disabled={!dirty || busy || name.trim() === ""}
          onClick={() => {
            setBusy(true);
            void api.updateProject(project.id, patch)
              .then(onSaved)
              .catch(() => { setBusy(false); onFailed(); });
          }}
          className="btn bg-accent text-on-accent shadow-accent hover:opacity-90 disabled:opacity-50"
        >
          {tCommon("save")}
        </button>
      </div>
    </Overlay>
  );
}

function MembersDialog({ project, people, meId, onClose, onChanged }: {
  project: ProjectRecord;
  people: OrgPersonRecord[];
  meId: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const t = useTranslations("projects");
  const locale = useLocale();
  /* the live set, so a toggle shows immediately and the list is re-read on
     close — the write is one call per person and each one is idempotent */
  const [on, setOn] = useState<string[]>(project.member_ids);
  const [failed, setFailed] = useState(false);

  const toggle = (userId: string) => {
    const next = !on.includes(userId);
    setOn((cur) => (next ? [...cur, userId] : cur.filter((v) => v !== userId)));
    void api.setProjectMember(project.id, userId, next).catch(() => {
      /* put it back: a roster that shows somebody who was never added is
         the screen disagreeing with the record */
      setOn((cur) => (next ? cur.filter((v) => v !== userId) : [...cur, userId]));
      setFailed(true);
    });
  };

  return (
    <Overlay onClose={() => { onChanged(); onClose(); }} label={t("manageMembers")} size="sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold text-fg">{t("manageMembers")}</h2>
        <button type="button" onClick={() => { onChanged(); onClose(); }} className="btn btn-icon text-fg-muted hover:text-fg" aria-label={t("close")}>
          <IconClose width={14} height={14} />
        </button>
      </div>
      {failed ? (
        <p role="alert" className="mb-2 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {t("writeFailed")}
        </p>
      ) : null}
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {people.length === 0 ? (
          <p className="px-1 py-2 text-xs text-fg-subtle">{t("noColleagues")}</p>
        ) : people.map((person) => (
          <button
            key={person.id}
            type="button"
            aria-pressed={on.includes(person.id)}
            onClick={() => toggle(person.id)}
            className={`tap flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start text-xs ${
              on.includes(person.id) ? "bg-accent-soft text-accent" : "text-fg-muted hover:bg-surface-2"
            }`}
          >
            <Avatar name={personName(person, locale)} size="xs" />
            <span className="min-w-0 flex-1 truncate">{personName(person, locale)}</span>
            {person.id === meId ? <span className="text-[10px]">{t("you")}</span> : null}
            {on.includes(person.id) ? <IconCheck width={12} height={12} /> : null}
          </button>
        ))}
      </div>
    </Overlay>
  );
}
