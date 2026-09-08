"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { api } from "@/api/client";
import { useRefreshEpoch } from "@/lib/refreshBus";
/* the VALUES come from `@echo/core/vocabulary` — `wire` is types-only by
   design (its own header), so a value import from it resolves under
   typecheck and fails in the bundler */
import { PROJECT_STAGES, PROJECT_PRIORITIES } from "@echo/core/vocabulary";
import type {
  OrgPersonRecord, ProjectRecord, ProjectStage, ProjectWorkloadRow,
  TaskCardRecord, TaskColumnRecord, TaskLabelRecord, TaskTopicRecord,
} from "@/api/types";
import { Avatar } from "@/components/Avatar";
import { Select } from "@/components/Select";
import { ConfirmDialog, KebabMenu } from "@/components/rowActions";
import { DetailPanel } from "./DetailPanel";
import {
  AssigneePicker, DueField, PRIORITY_DOT, TONE_DOT, PRIORITY_CHIP, NewTaskDialog,
} from "./tasks/TaskDialogs";
import { TonePicker, PROJECT_ICONS } from "./ProjectDialog";
import {
  BODY_HEADING, BODY_TEXT, PANEL_INPUT, PANEL_TEXTAREA,
  RAIL_LABEL, RAIL_VALUE, RAIL_EMPTY, SECTION_EMPTY,
} from "./tasks/panelStyle";
import {
  IconArchive, IconCheck, IconPencil, IconPeople3, IconPlus, IconRetry, IconTrash,
} from "@/components/icons";
import { SkeletonLines } from "@/components/scaffold";
import { digits, formatDate, personName } from "@/lib/format";

/**
 * ONE PROJECT (0181), and since 2026-09-08 THE PLACE A PROJECT IS EDITED.
 *
 * The user's directive was two sentences: "in projects edit mode it should
 * edit the existing page the same way in tasks edit, not popping up another
 * window — remove the second pop up window", and "give projects more related
 * options". They are one change, because the second is only bearable inside
 * the first: five more fields in a modal-over-a-modal is a form; five more
 * fields in the rail is where a task already keeps its own.
 *
 * SO THE SHAPE IS THE TASK DETAIL'S, exactly:
 *
 *   · «ویرایش» toggles the TITLE and the SUMMARY in place — the same
 *     input-over-text the task's own header uses, saving on blur, with the
 *     button reading «تمام» while it is on.
 *   · EVERY OTHER FIELD IS A LIVE CONTROL IN THE RAIL, with no edit mode at
 *     all. That is the reference's own reasoning and the task screen's: the
 *     rail is where a card is actually changed, so a mode in front of it
 *     would be a door in front of a door.
 *   · `ProjectDialog` keeps ONE job — creating. Two shapes for one record is
 *     the pair that stops matching, but creating and editing are not one act:
 *     creating needs every field at once because the row does not exist yet,
 *     editing changes one field against a row that does. The board has had
 *     exactly this split since 0144 (NewTaskDialog to create, TaskDetail to
 *     edit) and a project now matches it.
 *
 * WHAT THE RAIL CARRIES (0208 for the five that needed columns): the stage,
 * the priority, the lead, the people, the two dates, the tone, the icon, the
 * folder it owns on the board, its room, how far it has got, when it began.
 *
 * It keeps an address: `/projects?project=<id>` is a link a person can send,
 * and the old `/projects/<id>` redirects there.
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
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
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

  /* the drafts adopt the record — keyed on the VALUES as well as the id, so a
     colleague's rename lands in the box rather than being overwritten by a
     draft nobody is typing into (the task detail's own effect) */
  const loadedName = typeof project === "object" && project !== null ? project.name : null;
  const loadedSummary = typeof project === "object" && project !== null ? project.summary : null;
  useEffect(() => {
    if (loadedName !== null) setName(loadedName);
    if (loadedSummary !== null) setSummary(loadedSummary);
  }, [id, loadedName, loadedSummary]);

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
  /* `find` answers undefined for a null lead all by itself — no person has a
     null id — so the ternary that stood here was a second way of asking one
     question */
  const lead = people.find((p) => p.id === project.lead_id) ?? null;

  const patch = (body: Parameters<typeof api.updateProject>[1]) => {
    setError(null);
    void api.updateProject(project.id, body)
      .then(setProject)
      .catch(() => setError(t("writeFailed")));
  };

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
      {/* THE TOGGLE, not a door (2026-09-08). It opened `ProjectDialog` over
          this panel — a modal on a modal, which is what the user called "the
          second pop up window". It now turns the two prose fields below into
          the boxes that write them, exactly as the task detail's does, and
          says «تمام» while it is on. */}
      <button
        type="button"
        onClick={() => setEditing((v) => !v)}
        className="btn btn-sm border border-border font-medium text-fg hover:bg-border"
      >
        <IconPencil width={12} height={12} />
        {editing ? tCommon("done") : t("edit")}
      </button>
    </>
  ) : null;

  /*
   * ONE ACT AT THIS END (user, 2026-09-08: "remove وظایف").
   *
   * «وظایف» was a second door to the board filtered to this project — and the
   * rail's «پوشهٔ برد» row is already that link, wearing the folder's own
   * name. Two doors to one place is what this panel was extracted to stop.
   *
   * What is left is «افزودن تسک», the board's own key: the button opens the
   * board's own dialog, so it says the board's own word.
   */
  const end = isAdmin && project.topic_id !== null ? (
    /* GIVING WORK IS AN ADMIN'S (0186), the same wall the project itself is
       behind — for a member the button would be a refusal. Anybody may still
       create a card on the board; what is admin-walled is the surface for
       handing it to somebody. */
    <button
      type="button"
      onClick={() => setOrdering(true)}
      className="btn btn-sm bg-accent text-on-accent hover:opacity-90"
    >
      <IconPlus width={12} height={12} />
      {tCommon("addTask")}
    </button>
  ) : null;

  /*
   * THE RAIL — the task detail's, row for row: an 11px/600 label over a
   * 12.5px/600 value, receded when empty so the row still reads as a row.
   *
   * Every writable row is a LIVE control for an admin and a READING for a
   * member. Not a disabled control: 0186's own rule is that a greyed button
   * is a promise the product will not keep, and a member reading a project's
   * stage is the ordinary case rather than a refusal.
   */
  const rail = (
    <>
      {/* ── WHERE THE WORK IS (0208) ──────────────────────────────────── */}
      <div>
        <span className={RAIL_LABEL}>{t("fieldStage")}</span>
        {isAdmin ? (
          <div className="flex flex-wrap gap-1">
            {PROJECT_STAGES.map((stage) => (
              <button
                key={stage}
                type="button"
                aria-pressed={project.stage === stage}
                onClick={() => patch({ stage })}
                className={`btn btn-sm ${
                  project.stage === stage
                    ? "bg-accent-soft text-accent"
                    : "text-fg-muted hover:text-fg"
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${STAGE_DOT[stage]}`} aria-hidden />
                {t(`stage_${stage}`)}
              </button>
            ))}
          </div>
        ) : (
          <span className="flex items-center gap-2">
            <span className={`h-1.5 w-1.5 rounded-full ${STAGE_DOT[project.stage]}`} aria-hidden />
            <span className={RAIL_VALUE}>{t(`stage_${project.stage}`)}</span>
          </span>
        )}
      </div>

      {/* ── HOW URGENT — the board's own four levels, drawn the board's way */}
      <div>
        <span className={RAIL_LABEL}>{t("fieldPriority")}</span>
        {isAdmin ? (
          <div className="flex flex-wrap gap-1">
            {PROJECT_PRIORITIES.map((level) => (
              <button
                key={level}
                type="button"
                aria-pressed={project.priority === level}
                onClick={() => patch({ priority: level })}
                className={`btn btn-sm ${
                  project.priority === level
                    ? "bg-warning/10 text-warning"
                    : "text-fg-muted hover:text-fg"
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${PRIORITY_DOT[level]}`} aria-hidden />
                {t(`priority_${level}`)}
              </button>
            ))}
          </div>
        ) : (
          <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${PRIORITY_CHIP[project.priority]}`}>
            {t(`priority_${project.priority}`)}
          </span>
        )}
      </div>

      {/* ── WHO IS ACCOUNTABLE (0208) ─────────────────────────────────────
          A SELECT over the project's own members, not the whole org: a lead
          who is not on the project is a state the roster would immediately
          contradict, and the fix is to add them first. */}
      <div>
        <span className={RAIL_LABEL}>{t("fieldLead")}</span>
        {isAdmin ? (
          <Select
            value={project.lead_id ?? ""}
            onChange={(v) => patch({ lead_id: v === "" ? null : v })}
            ariaLabel={t("fieldLead")}
            options={[
              { value: "", label: t("noLead") },
              ...members.map((person) => ({
                value: person.id,
                label: personName(person, locale),
              })),
            ]}
          />
        ) : lead === null ? (
          <span className={RAIL_EMPTY}>{t("noLead")}</span>
        ) : (
          <span className="flex items-center gap-2">
            <Avatar name={personName(lead, locale)} size="xs" />
            <span className={RAIL_VALUE}>{personName(lead, locale)}</span>
          </span>
        )}
      </div>

      {/* ── THE PEOPLE, edited where they are read ────────────────────────
          This was a «+» opening a THIRD dialog (`MembersDialog`), which is
          gone with it: the board's own picker draws this exactly, and the
          only thing it needed was the project's words rather than a task's. */}
      <div>
        <span className={RAIL_LABEL}>{t("fieldMembers")}</span>
        {isAdmin ? (
          <AssigneePicker
            people={people}
            selected={project.member_ids}
            copy={{
              remove: (personLabel) => t("removeMember", { name: personLabel }),
              add: t("addMember"),
              unnamed: t("unknownPerson"),
            }}
            onToggle={(userId) => {
              const on = !project.member_ids.includes(userId);
              setError(null);
              void api.setProjectMember(project.id, userId, on)
                .then(load)
                .catch(() => setError(t("writeFailed")));
            }}
          />
        ) : members.length === 0 ? (
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

      {/* ── THE TWO DAYS (0208) ───────────────────────────────────────────
          The board's own picker, through `DayField` — a project's dates are
          DAYS, so the instant the picker speaks is converted at this edge and
          nowhere else (see the helper's note). */}
      <div>
        <span className={RAIL_LABEL}>{t("fieldStarts")}</span>
        {isAdmin ? (
          <DayField value={project.starts_on} onPick={(day) => patch({ starts_on: day })} />
        ) : project.starts_on === null ? (
          <span className={RAIL_EMPTY}>{t("noDate")}</span>
        ) : (
          <span className={RAIL_VALUE}>{formatDate(dayToInstant(project.starts_on), locale)}</span>
        )}
      </div>

      <div>
        <span className={RAIL_LABEL}>{t("fieldDue")}</span>
        {isAdmin ? (
          <DayField value={project.due_on} onPick={(day) => patch({ due_on: day })} />
        ) : project.due_on === null ? (
          <span className={RAIL_EMPTY}>{t("noDate")}</span>
        ) : (
          <span className={RAIL_VALUE}>{formatDate(dayToInstant(project.due_on), locale)}</span>
        )}
      </div>

      {/* ── ITS COLOUR AND ITS MARK, live for an admin ────────────────────
          Both were fields of the dialog this panel replaced. The tone picker
          is the same component the create dialog draws, one import rather
          than a second row of swatches. */}
      {isAdmin ? (
        <TonePicker value={project.tone} onChange={(tone) => patch({ tone })} label={t("fieldTone")} />
      ) : (
        <div>
          <span className={RAIL_LABEL}>{t("fieldTone")}</span>
          <span className="flex items-center gap-2">
            <span className={`h-3 w-3 rounded-md ${TONE_DOT[project.tone] ?? TONE_DOT.grey!}`} aria-hidden />
            <span className={RAIL_VALUE}>{tCommon(`tone_${project.tone}`)}</span>
          </span>
        </div>
      )}

      {isAdmin ? (
        <div>
          <span className={RAIL_LABEL}>{t("fieldIcon")}</span>
          <div className="flex flex-wrap gap-1.5">
            {PROJECT_ICONS.map((choice) => (
              <button
                key={choice}
                type="button"
                aria-pressed={project.icon === choice}
                /* pressing the chosen one CLEARS it — the create dialog's own
                   behaviour, and the only way back to "no mark" without a
                   second control that would say so twice */
                onClick={() => patch({ icon: project.icon === choice ? null : choice })}
                className={`btn btn-icon hover:bg-surface-2 ${
                  project.icon === choice ? "bg-accent-soft ring-2 ring-accent" : ""
                }`}
              >
                <span className="text-base">{choice}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* the board folder this project owns (0181) — the one row that points
          somewhere, because the work itself lives there */}
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

      {/* ── THE ROOM (0184's `chat_channel.project_id`, published 0208) ────
          A project may have a conversation, and until now its own screen was
          the one place that could not reach it. Null is the ordinary state,
          not a gap — so the row says "no room" rather than offering to make
          one, which is the chat surface's act and not this panel's. */}
      <div>
        <span className={RAIL_LABEL}>{t("fieldRoom")}</span>
        {project.channel_id === null ? (
          <span className={RAIL_EMPTY}>{t("noRoom")}</span>
        ) : (
          <Link
            href={`/chat?room=${encodeURIComponent(project.channel_id)}`}
            className={`${RAIL_VALUE} hover:text-accent`}
          >
            {t("openRoom")}
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
        {/* the title and its summary are ONE section of the divided body, and
            the one place «ویرایش» changes: input over text, saved on blur,
            the task detail's own pattern */}
        <div>
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 shrink-0 rounded-full ${TONE_DOT[project.tone] ?? TONE_DOT.grey!}`} aria-hidden />
            {editing ? (
              <input
                value={name}
                maxLength={120}
                aria-label={t("fieldName")}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => { if (name.trim() !== "" && name.trim() !== project.name) patch({ name: name.trim() }); }}
                className={`${PANEL_INPUT} flex-1`}
              />
            ) : (
              <h2 className={`truncate text-[17px] font-bold ${project.archived_at === null ? "text-fg" : "text-fg-subtle"}`}>
                {project.name}
              </h2>
            )}
            {project.archived_at !== null ? (
              <span className="badge-num rounded-md bg-surface-2 px-1.5 text-[10px] text-fg-muted">
                {t("archived")}
              </span>
            ) : null}
          </div>

          {/* THE RENAME'S CONSEQUENCE, said while the box is open rather than
              discovered on the board — a project's name IS its folder's. It
              was a line in the dialog that is gone; it belongs beside the
              field that causes it. */}
          {editing && name.trim() !== project.name && name.trim() !== "" ? (
            <p className="well mt-2 text-[11px] text-fg-muted">{t("renameNote")}</p>
          ) : null}

          {editing ? (
            <textarea
              value={summary}
              maxLength={400}
              rows={3}
              aria-label={t("fieldSummary")}
              onChange={(e) => setSummary(e.target.value)}
              onBlur={() => { if (summary.trim() !== project.summary) patch({ summary: summary.trim() }); }}
              className={`${PANEL_TEXTAREA} mt-2`}
            />
          ) : project.summary.trim() === "" ? (
            <p className={`${SECTION_EMPTY} ${BODY_TEXT} mt-2`}>{t("noSummary")}</p>
          ) : (
            <p className={`${BODY_TEXT} mt-2`}>{project.summary}</p>
          )}
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
 * The stage's dot. Deliberately NOT the tone palette: a project's colour is
 * the reader's own choice and says nothing about where the work is, so a
 * stage drawn in it would be two facts wearing one swatch.
 */
const STAGE_DOT: Record<ProjectStage, string> = {
  planning: "bg-fg-subtle",
  active: "bg-info",
  paused: "bg-warning",
  done: "bg-success",
};

/**
 * A DAY FIELD, over the board's own picker.
 *
 * The picker speaks INSTANTS — it hands back local noon for the day somebody
 * pressed, and its own header says why ("midnight is the one hour of the day
 * that lands on the wrong side of a timezone"). A project's dates are `date`
 * columns: days, with no zone at all.
 *
 * So the conversion lives HERE, at the one edge where the two meet, rather
 * than in `formatDate` or in the picker — both of which are right about what
 * they already do. Out: local noon on that day. In: the local calendar day of
 * the instant the picker chose, which is the day the person pressed.
 */
function dayToInstant(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12).toISOString();
}

function instantToDay(iso: string): string {
  const at = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

function DayField({ value, onPick }: {
  value: string | null;
  onPick: (day: string | null) => void;
}) {
  return (
    <DueField
      value={value === null ? null : dayToInstant(value)}
      onPick={(iso) => onPick(iso === null ? null : instantToDay(iso))}
    />
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
