import type { ProjectRecord } from "@/api/types";

/**
 * WHO MAY EDIT A PROJECT, and what «mine» means — one file, because two
 * screens (the page and the panel) and three views draw the same controls
 * and the same toggle, and a rule spelled in each is the rule that drifts.
 *
 * The WALL is the database's (db/0227): an admin edits the projects they
 * made, or ones whose author their role strictly outranks (0077 — the owner
 * edits any admin's). This mirror decides only whether a CONTROL is drawn;
 * a control the server would refuse is worse than none, and the server
 * stays the one that decides. The mirror is deliberately a step narrower
 * than the wall where it cannot know: the wire carries the author's id and
 * not the author's role, so an admin is shown the edits on projects they
 * made and the owner on all of them — the case the mirror cannot see (an
 * admin outranking a MEMBER author) never arises, since 0186 lets only
 * admins create.
 */
export interface ProjectReader {
  meId: string | null;
  isAdmin: boolean;
  /** the org's owner — the seat that outranks every author */
  isOwner: boolean;
}

export function canEditProject(project: Pick<ProjectRecord, "created_by">, reader: ProjectReader): boolean {
  if (!reader.isAdmin || reader.meId === null) return false;
  return reader.isOwner || project.created_by === reader.meId;
}

/**
 * «پروژه‌های من» (user report, 2026-09-16: "my projects only is not working
 * for admins"). It was membership alone — and an admin who MAKES projects
 * is on none of them, so from their seat the toggle emptied the page and
 * read as broken. Mine is what I am on, what I lead, or what I made.
 *
 * NOT the board's rule any more, and on purpose. The board's «فقط تسک‌های
 * من» was narrowed to ASSIGNED ONLY on 2026-09-19 (the user: even an admin
 * should see only the tasks assigned to them), and this one was left as it
 * is: a task is a thing handed to somebody, so "mine" is whose hands it is
 * in; a project is a thing you are ON — and its maker is on it in the sense
 * that matters, since the page exists to hand its work out. Two toggles,
 * two questions, each rule written where it is read rather than one copied
 * from the other and quietly wrong for one of them.
 */
export function isMyProject(
  project: Pick<ProjectRecord, "created_by" | "lead_id" | "member_ids">,
  meId: string | null,
): boolean {
  if (meId === null) return false;
  return project.member_ids.includes(meId) || project.lead_id === meId || project.created_by === meId;
}
