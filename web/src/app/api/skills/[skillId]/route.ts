import { coreFetch, errorResponse, readJson } from "@/server/core";
import type { AuthoredSkill } from "@/api/types";

/** One authored skill, full definition — 404 unless the caller may edit it. */
export async function GET(_request: Request, { params }: { params: Promise<{ skillId: string }> }) {
  const { skillId } = await params;
  try {
    return Response.json(await coreFetch<AuthoredSkill>(`/v1/skills/manage/${skillId}`));
  } catch (error) {
    return errorResponse(error);
  }
}

/** Edit (M29): supplied-flag semantics travel as-is; `model: null` clears the pin. */
export async function PATCH(request: Request, { params }: { params: Promise<{ skillId: string }> }) {
  const { skillId } = await params;
  try {
    const body = (await readJson(request)) as Record<string, unknown>;
    return Response.json(
      await coreFetch<AuthoredSkill>(`/v1/skills/${skillId}`, { method: "PATCH", body }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
