import { coreFetch, errorResponse } from "@/server/core";
import type { SkillVersion } from "@/api/types";

/**
 * Every wording a skill has had (item 16, db/0215).
 *
 * Read-only, and it adds no authority: a version's read policy is the skill's
 * own, so a caller who cannot see the skill gets an empty list — the same
 * nothing the skill itself gives them.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return Response.json(await coreFetch<{ versions: SkillVersion[] }>(`/v1/skills/${id}/versions`));
  } catch (error) {
    return errorResponse(error);
  }
}
