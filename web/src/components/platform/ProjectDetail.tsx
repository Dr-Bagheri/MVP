"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { api } from "@/api/client";
import { useRefreshEpoch } from "@/lib/refreshBus";
import type {
  OrgPersonRecord, ProjectRecord, ProjectWorkloadRow,
  TaskCardRecord, TaskColumnRecord, TaskLabelRecord, TaskTopicRecord,
} from "@/api/types";
import { Overlay } from "./Overlay";
import { Avatar } from "@/components/Avatar";
import { ConfirmDialog, KebabMenu } from "@/components/rowActions";
import { DetailPanel } from "./DetailPanel";
import { TONE_DOT, PRIORITY_CHIP, NewTaskDialog } from "./tasks/TaskDialogs";
import { ProjectDialog } from "./ProjectDialog";
import {
  BODY_HEADING, BODY_TEXT, RAIL_LABEL, RAIL_VALUE, RAIL_EMPTY,
} from "./tasks/panelStyle";
import {
  IconArchive, IconCheck, IconClose, IconPencil, IconPeople3, IconPlus, IconRetry,
  IconTrash,
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
export function ProjectDetail({ id, meId, isAdmin, onClose }: {
  id: string;
  meId: string | null;
  isAdmin: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("projects");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const [project, setProject] = useState<ProjectRecord | null | "missing" | "failed">(null);
  const [people, setPeople] = useState<OrgPersonRecord[]>([]);
  const [board, setBoard] = useState<{ columns: TaskColumnRecord[]; tasks: TaskCardRecord[] } | null>(null);
  const [editing, setEditing] = useState(false);
  const [managing, setManaging] = useState(false);
  const [ordering, setOrdering] = useState(false);
  const [workload, setWorkload] = useState<ProjectWorkloadRow[] | null>(null);
  const [labels, setLabels] = useState<TaskLabelRecord[]>([]);
  const [topics, setTopics] = useState<TaskTopicRecord[]>([]);
  const [condemned, setCondemned] = useState(false);
  const [deleting, setDeleting] = useState(false);
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
      .then((b) => { setBoard({ columns: b.columns, tasks: b.tasks }); setTopics(b.topics); })
      .catch(() => { setBoard({ columns: [], tasks: [] }); setTopics([]); });
    void api.taskLabels().then(setLabels).catch(() => setLabels([]));
  }, [tasksEpoch]);

  /* the workload follows BOTH epochs: it counts tasks, and a project rename
     does not move it while a card being ticked does */
  useEffect(() => {
    void api.projectWorkload(id).then(setWorkload).catch(() => setWorkload([]));
  }, [id, tasksEpoch, epoch]);

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

  /* the frame opens at once and the answer arrives inside it — a panel that
     appears only after the network is a click that did nothing for a beat */
  if (project === null) {
    return (
      <DetailPanel label="" closeLabel={t("close")} onClose={onClose} rail={<SkeletonLines lines={5} />}>
        <SkeletonLines lines={4} />
      </DetailPanel>
    );
  }
  if (project === "missing" || project === "failed") {
    return (
      <DetailPanel label={t(project === "missing" ? "notFound" : "readFailed")} closeLabel={t("close")} onClose={onClose} rail={null}>
        <p className="text-sm text-fg-muted">{t(project === "missing" ? "notFound" : "readFailed")}</p>
      </DetailPanel>
    );
  }

  const members = project.member_ids
    .map((mid) => people.find((p) => p.id === mid))
    .filter((p): p is OrgPersonRecord => p !== undefined);
  const done = mine.filter((task) => task.done).length;

  const patch = (body: Parameters<typeof api.updateProject>[1]) => {
    void api.updateProject(project.id, body)
      .then(setProject)
      .catch(() => setError(t("writeFailed")));
  };

  /*
   * THE DETAIL PANEL, NOT A PAGE (R18, user ruling 2026-09-05: "when you click
   * on a project it should open a pop-up window, not change the page — this
   * problem is systematic"). The frame is DetailPanel's — the task detail's,
   * measured — and this file owns only what goes in its slots: the ⋯ menu and
   * the edit toggle beside the close, the way out to the board and the one
   * primary act (giving work) at the other end, and a rail carrying a
   * project's own facts — the folder it owns on the board, how far it has got,
   * its tone, its people, when it began. Same anatomy as a task, its own
   * contents.
   *
   * It keeps an address all the same: `/projects?project=<id>` is a link a
   * person can send, and the old `/projects/<id>` redirects there.
   */
  const start = isAdmin ? (
    <>
      <KebabMenu
        label={t("moreActions")}
        items={[
          project.archived_at === null
            ? {
                key: "archive",
                label: t("archive"),
                icon: <IconArchive width={14} height={14} />,
                onSelect: () => setCondemned(true),
              }
            : {
                key: "restore",
                label: t("restore"),
                icon: <IconCheck width={14} height={14} />,
                onSelect: () => patch({ archived: false }),
              },
          /* DELETE beside archive, not instead of it (user directive,
             2026-09-05): different acts under their own names — archiving
             keeps a readable project, deleting removes it. */
          {
            key: "delete",
            label: tCommon("delete"),
            icon: <IconTrash width={14} height={14} />,
            danger: true,
            onSelect: () => setDeleting(true),
          },
        ]}
      />
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="btn btn-sm border border-border font-medium text-fg hover:bg-border"
      >
        <IconPencil width={12} height={12} />
        {t("edit")}
      </button>
    </>
  ) : null;

  const end = (
    <>
      {/* the board, standing on this project's own folder. A link rather
          than a second board: one place cards are moved. */}
      <Link
        href={project.topic_id === null ? "/tasks" : `/tasks?topic=${encodeURIComponent(project.topic_id)}`}
        className="btn btn-sm bg-accent-soft font-medium text-accent"
      >
        {t("openBoard")}
      </Link>
      {/* GIVING WORK IS AN ADMIN'S (0186), the same wall the project itself
          is behind — for a member the button would be a refusal. Anybody may
          still create a card on the board; what is admin-walled is the
          surface for handing it to somebody. */}
      {isAdmin && project.topic_id !== null ? (
        <button
          type="button"
          onClick={() => setOrdering(true)}
          className="btn btn-sm bg-accent text-on-accent hover:opacity-90"
        >
          <IconPlus width={12} height={12} />
          {t("newOrder")}
        </button>
      ) : null}
    </>
  );

  /*
   * THE RAIL — the task detail's, row for row: an 11px/600 label above a
   * 12.5px/600 value, receded when the value is empty so the row still reads
   * as a row. What it CARRIES is a project's own facts.
   */
  const rail = (
    <>

          {/* the board folder this project owns (0181) — the one row that
              points somewhere, because the work itself lives there */}
          <div>
            <span className={RAIL_LABEL}>{t("fieldBoardFolder")}</span>
            {project.topic_id === null ? (
              <span className={RAIL_EMPTY}>{t("noBoardFolder")}</span>
            ) : (
              <Link href={`/tasks?topic=${project.topic_id}`} className={`${RAIL_VALUE} hover:text-accent`}>
                <bdi>{project.name}</bdi>
              </Link>
            )}
          </div>

          {/* PROGRESS, counted off the board on every read (0181) — never a
              stored number, so this row cannot disagree with the cards */}
          <div>
            <span className={RAIL_LABEL}>{t("fieldProgress")}</span>
            {project.task_total === 0 ? (
              <span className={RAIL_EMPTY}>{t("noWorkYet")}</span>
            ) : (
              <>
                <span className={RAIL_VALUE}>
                  {t("progress", {
                    done: digits(project.task_done, locale),
                    total: digits(project.task_total, locale),
                  })}
                </span>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="h-full rounded-full bg-accent"
                    style={{ width: `${Math.round((project.task_done / project.task_total) * 100)}%` }}
                  />
                </div>
              </>
            )}
          </div>

          <div>
            <span className={RAIL_LABEL}>{t("fieldTone")}</span>
            <span className="flex items-center gap-2">
              <span className={`h-3 w-3 rounded-md ${TONE_DOT[project.tone] ?? TONE_DOT.grey!}`} aria-hidden />
              <span className={RAIL_VALUE}>{t(`tone_${project.tone}`)}</span>
            </span>
          </div>

          <div>
            <div className="flex items-center justify-between gap-2">
              <span className={RAIL_LABEL}>{t("fieldMembers")}</span>
              {isAdmin ? (
                <button type="button" onClick={() => setManaging(true)}
                  className="btn btn-icon -mt-1 text-fg-muted hover:text-fg" aria-label={t("manageMembers")}>
                  <IconPlus width={12} height={12} />
                </button>
              ) : null}
            </div>
            {members.length === 0 ? (
              <span className={`flex items-center gap-1.5 ${RAIL_EMPTY}`}>
                <IconPeople3 width={12} height={12} />
                {t("noMembers")}
              </span>
            ) : (
              <ul className="space-y-1.5">
                {members.map((person) => (
                  <li key={person.id} className="flex items-center gap-2">
                    <Avatar name={personName(person, locale)} size="xs" />
                    <span className={`min-w-0 flex-1 truncate ${RAIL_VALUE}`}>
                      {personName(person, locale)}
                    </span>
                    {person.id === meId ? (
                      <span className="text-[10px] text-fg-subtle">{t("you")}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <span className={RAIL_LABEL}>{t("fieldCreated")}</span>
            <span className={RAIL_VALUE}>{formatDate(project.created_at, locale)}</span>
          </div>
    </>
  );

  return (
    <>
      <DetailPanel
        label={project.name}
        closeLabel={t("close")}
        onClose={onClose}
        start={start}
        end={end}
        notice={error !== null ? (
          <p role="alert" className="border-b border-border bg-danger/10 px-4 py-2 text-xs text-danger">
            {error}
          </p>
        ) : null}
        rail={rail}
      >
        {/* the title and its summary are ONE section of the divided body */}
        <div>
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 shrink-0 rounded-full ${TONE_DOT[project.tone] ?? TONE_DOT.grey!}`} aria-hidden />
          <h2 className={`truncate text-[17px] font-bold ${project.archived_at === null ? "text-fg" : "text-fg-subtle"}`}>
            {project.name}
          </h2>
          {project.archived_at !== null ? (
            <span className="badge-num rounded-md bg-surface-2 px-1.5 text-[10px] text-fg-muted">
              {t("archived")}
            </span>
          ) : null}
        </div>
        <p className={`${BODY_TEXT} mt-2`}>{project.summary === "" ? t("noSummary") : project.summary}</p>
        </div>

        {/* ── the work: the cards filed under this project's folder ──── */}
        <section aria-label={t("work")}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className={BODY_HEADING}>{t("work")}</h3>
            <span className="badge-num text-[11px] text-fg-muted">
              {mine.length === 0
                ? "—"
                : t("progress", { done: digits(done, locale), total: digits(mine.length, locale) })}
            </span>
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
                      {task.recurrence_id !== null ? (
                        <IconRetry width={12} height={12} className="shrink-0 text-fg-subtle"
                          aria-label={t("repeats")} />
                      ) : null}
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

        {/* who did what, and who didn't (0186) */}
        <Workload
          rows={workload}
          people={people}
          members={project.member_ids}
          locale={locale}
          meId={meId}
        />
      </DetailPanel>


      {editing ? (
        /* THE PROJECT DIALOG — the same form the projects page and the board
           create with, pre-filled: name, description, colour, icon and the
           roster (user, 2026-09-05: the edit door offered three of the five
           things a project has in it). It re-reads the record after its
           writes, so what lands here is the server's project. */
        <ProjectDialog
          mode="edit"
          project={project}
          people={people}
          meId={meId}
          onClose={() => setEditing(false)}
          onSaved={(p) => { setEditing(false); setProject(p); }}
          onFailed={() => { setEditing(false); setError(t("writeFailed")); }}
        />
      ) : null}

      {ordering && project.topic_id !== null ? (
        /* THE BOARD'S OWN NEW-TASK DIALOG, with this project's category
           already chosen and the schedule fields switched on. Not a second
           dialog: "all the details of the task" is eight fields that already
           exist, and a project-shaped copy of them is the pair that stops
           matching the first time either gains a rule. */
        <NewTaskDialog
          columns={board?.columns ?? []}
          topics={topics}
          labels={labels}
          people={people}
          defaultColumnId={board?.columns[0]?.id ?? null}
          defaultTopicId={project.topic_id}
          allowSchedule
          onClose={() => setOrdering(false)}
          /* the api client announces "tasks" on every successful non-GET at
             one altitude, and both this page's reads are keyed on that epoch
             — so closing IS the refresh, and a second announce here would be
             the same fact spoken twice */
          onCreated={() => setOrdering(false)}
          onLabelsChanged={() => { void api.taskLabels().then(setLabels).catch(() => undefined); }}
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

      {deleting ? (
        <ConfirmDialog
          title={t("deleteTitle")}
          /* the body names what STAYS, because that is the part nobody can
             guess and the part that decides whether this press is safe: the
             cards keep their folder on the board and the room keeps its
             conversation. Both are the schema's doing (0191), not a promise
             this dialog makes. */
          body={t("deleteBody", { name: project.name })}
          confirmLabel={tCommon("delete")}
          cancelLabel={tCommon("cancel")}
          onCancel={() => setDeleting(false)}
          onConfirm={() => {
            setDeleting(false);
            void api.deleteProject(project.id)
              /* AWAY: there is no project left to show, so the panel closes
                 and the list behind it, keyed on the same epoch, has already
                 dropped the card. */
              .then(onClose)
              .catch(() => setError(t("writeFailed")));
          }}
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
    </>
  );
}

/**
 * WHO DID WHAT, AND WHO DIDN'T (0186).
 *
 * One row per person, and the two things that make it honest:
 *
 *   · EVERY MEMBER APPEARS, including the ones carrying nothing. A panel
 *     built only from rows the server returned answers "who has work" — the
 *     directive asked for "who didn't", and somebody with no cards at all is
 *     the sharpest case of that.
 *   · The UNASSIGNED bucket is a row, not a silence. Work nobody was given is
 *     the project's own gap, and it belongs where the eye is already looking.
 *
 * Counted from the board on every read, never stored: a project's numbers
 * change every time anybody ticks a box, and a stored tally is two screens
 * that disagree.
 */
function Workload({ rows, people, members, locale, meId }: {
  rows: ProjectWorkloadRow[] | null;
  people: OrgPersonRecord[];
  members: string[];
  locale: string;
  meId: string | null;
}) {
  const t = useTranslations("projects");
  const byUser = useMemo(() => {
    const map = new Map<string | null, ProjectWorkloadRow>();
    for (const row of rows ?? []) map.set(row.user_id, row);
    return map;
  }, [rows]);

  /* the project's members first, then anybody carrying work who is not one
     (somebody removed from the project still has their finished cards, and
     hiding them would make the totals disagree with the board) */
  const ids = useMemo(() => {
    const extra = (rows ?? [])
      .map((r) => r.user_id)
      .filter((id): id is string => id !== null && !members.includes(id));
    return [...members, ...extra];
  }, [rows, members]);

  const empty: ProjectWorkloadRow = { user_id: null, assigned: 0, done: 0, open: 0, overdue: 0 };
  const unassigned = byUser.get(null);

  return (
    <section aria-label={t("whoDidWhat")}>
      <h3 className={`${BODY_HEADING} mb-2`}>{t("whoDidWhat")}</h3>
      {rows === null ? (
        <SkeletonLines lines={3} />
      ) : ids.length === 0 && unassigned === undefined ? (
        <p className="py-3 text-xs text-fg-subtle">{t("noMembers")}</p>
      ) : (
        <ul className="space-y-2.5">
          {ids.map((userId) => {
            const person = people.find((p) => p.id === userId) ?? null;
            const row = byUser.get(userId) ?? empty;
            return (
              <li key={userId}>
                <div className="mb-1 flex items-center gap-2">
                  <Avatar name={person === null ? "?" : personName(person, locale)} size="xs" />
                  <span className="min-w-0 flex-1 truncate text-xs text-fg">
                    {person === null ? t("unknownPerson") : personName(person, locale)}
                  </span>
                  {userId === meId ? (
                    <span className="text-[10px] text-fg-subtle">{t("you")}</span>
                  ) : null}
                  <span className="badge-num shrink-0 text-[11px] text-fg-muted">
                    {row.assigned === 0
                      ? t("carriesNothing")
                      : t("progress", {
                          done: digits(row.done, locale),
                          total: digits(row.assigned, locale),
                        })}
                  </span>
                </div>
                <Bar row={row} />
              </li>
            );
          })}
          {unassigned !== undefined ? (
            <li className="border-t border-border pt-2.5">
              <div className="mb-1 flex items-center gap-2">
                <span aria-hidden className="flex h-5 w-5 items-center justify-center rounded-full bg-warning/10 text-[10px] text-warning">
                  ?
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-warning">{t("nobodyAssigned")}</span>
                <span className="badge-num shrink-0 text-[11px] text-warning">
                  {digits(unassigned.assigned, locale)}
                </span>
              </div>
              <Bar row={unassigned} />
            </li>
          ) : null}
        </ul>
      )}
    </section>
  );
}

/** done / open / overdue as one bar, with the overdue slice its own colour */
function Bar({ row }: { row: ProjectWorkloadRow }) {
  const t = useTranslations("projects");
  if (row.assigned === 0) {
    return <div className="h-1.5 rounded-full bg-surface-2" aria-hidden />;
  }
  const pct = (n: number) => `${Math.round((n / row.assigned) * 100)}%`;
  const onTime = row.open - row.overdue;
  return (
    <div className="flex h-1.5 overflow-hidden rounded-full bg-surface-2"
      role="img" aria-label={t("workloadBar")}>
      <div className="bg-success" style={{ width: pct(row.done) }} />
      <div className="bg-info" style={{ width: pct(onTime > 0 ? onTime : 0) }} />
      <div className="bg-danger" style={{ width: pct(row.overdue) }} />
    </div>
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
