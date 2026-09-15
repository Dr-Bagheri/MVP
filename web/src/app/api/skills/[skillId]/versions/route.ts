import { coreFetch, errorResponse } from "@/server/core";
import type { SkillVersion } from "@/api/types";

/**
 * Every wording a skill has had (item 16, db/0215).
 *
 * THE SLUG IS `[skillId]`, NOT `[id]`. Next refuses two different slug names
 * for the same dynamic path, and `[skillId]` is what the sibling routes
 * (`route.ts`, `archive/route.ts`) already use — so this folder arrived as
 * `[id]` and stopped the dev server from booting at all. Renaming the other
 * two would have been the larger change and broken their callers.
 *
 * Read-only, and it adds no authority: a version's read policy is the skill's
 * own, so a caller who cannot see the skill gets an empty list — the same
 * nothing the skill itself gives them.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ skillId: string }> }) {
  try {
    const { skillId } = await params;
    return Response.json(await coreFetch<{ versions: SkillVersion[] }>(`/v1/skills/${skillId}/versions`));
  } catch (error) {
    return errorResponse(error);
  }
}
