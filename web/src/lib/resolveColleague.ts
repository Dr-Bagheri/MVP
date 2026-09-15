/**
 * A NAME to a colleague, EXACTLY (moved here from agentSurface on
 * 2026-09-08 so the meeting's action items can use the same rule the
 * assistant's tools use — one resolver, one refusal policy).
 *
 * Resolves through the org directory rather than the admin member list:
 * same people, no admin gate, and the fields a person actually types.
 * Using the admin list would have made this work perfectly for whoever
 * built it and fail with a 403 for everyone else — the shape that is
 * invisible from the developer's own account.
 */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ColleagueMatch =
  | { ok: true; id: string; name: string }
  | { ok: false; detail: string };

export async function resolveColleague(handle: string): Promise<ColleagueMatch> {
  const { api } = await import("@/api/client");
  const trimmed = handle.trim();
  /* an id is already an answer (the older tool descriptions asked for one) */
  if (UUID_RE.test(trimmed)) return { ok: true, id: trimmed, name: trimmed };
  const rows = await api.orgPeople();
  /* «@sina» and «sina» name the same colleague — the handle is what the
     chat's mention picker offers, so it is what a person will say */
  const lowered = trimmed.replace(/^@/, "").toLowerCase();
  const matches = (row: { display_name: string; display_name_en: string | null; username?: string | null }) =>
    row.display_name.toLowerCase() === lowered
    || (row.display_name_en ?? "").toLowerCase() === lowered
    || (row.username ?? "").toLowerCase() === lowered;
  const exact = rows.filter(matches);
  if (exact.length === 1) return { ok: true, id: exact[0]!.id, name: exact[0]!.display_name };
  /* the LOOSE matches are named and never chosen (2026-09-06): a lone
     substring hit used to be accepted, and a message «به سینا» went to the
     one colleague whose name CONTAINS سینا — with the consent card naming
     the handle, not the person. See resolveMember in agentSurface. */
  const loose = rows.filter((row) =>
    row.display_name.toLowerCase().includes(lowered)
    || (row.display_name_en ?? "").toLowerCase().includes(lowered));
  if (loose.length === 0) return { ok: false, detail: "no colleague matched that name" };
  const names = loose.slice(0, 5).map((r) => r.username ? `@${r.username}` : r.display_name).join("، ");
  return {
    ok: false,
    /* names them, because "3 matched" leaves the model with nothing to ask
       about and it will guess one */
    detail: loose.length === 1
      ? `no exact match — the closest is ${names}; confirm with the user`
      : `several colleagues matched: ${names} — ask the user which`,
  };
}
