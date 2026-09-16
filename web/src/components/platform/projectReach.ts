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
 * read as broken. Mine is what I am on, what I lead, or what I made: the
 * board's own definition for «فقط تسک‌های من» (assigned or created), so
 * the two toggles cannot mean two things.
 */
export function isMyProject(
  project: Pick<ProjectRecord, "created_by" | "lead_id" | "member_ids">,
  meId: string | null,
): boolean {
  if (meId === null) return false;
  return project.member_ids.includes(meId) || project.lead_id === meId || project.created_by === meId;
}
