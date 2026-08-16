import { coreFetch, errorResponse } from "@/server/core";
import type { AuthoredSkill } from "@/api/types";

/**
 * Archive / unarchive — the product's whole "delete" for skills (db/0018):
 * archiving frees the slug while the definition stays attached to its runs.
 * `{archived}` in the body picks the direction; unarchive can 409 if the
 * slug was re-used by a successor, and core names that.
 */
export async function POST(request: Request, { params }: { params: Promise<{ skillId: string }> }) {
  const { skillId } = await params;
  const body = (await request.json()) as { archived?: boolean };
  const path = body.archived === false
    ? `/v1/skills/${skillId}/unarchive`
    : `/v1/skills/${skillId}/archive`;
  try {
    return Response.json(await coreFetch<AuthoredSkill>(path, { method: "POST", body: {} }));
  } catch (error) {
    return errorResponse(error);
  }
}
