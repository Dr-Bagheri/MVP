import { coreFetch, errorResponse } from "@/server/core";
import type { Skill } from "@/api/types";

/**
 * Three levels resolved server-side (system / org / user, most specific
 * wins). Skills are DATA, so this is a plain read — no model involved.
 *
 * The body is core's WRAPPER, forwarded whole: `{skills, available_tools}`.
 * The first version typed this as a bare `Skill[]` while core sent the
 * wrapper — the client's `skills.length` read undefined, the picker
 * silently never rendered, and nothing anywhere said so. Two hand-written
 * beliefs about one wire (rule 10), caught only by reading the producer.
 */
export async function GET() {
  try {
    return Response.json(
      await coreFetch<{ skills: Skill[]; available_tools: string[] }>("/v1/skills"),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

/** Create a skill (M29). Level org needs an admin; core states the refusal. */
export async function POST(request: Request) {
  const body = (await request.json()) as Record<string, unknown>;
  try {
    return Response.json(await coreFetch("/v1/skills", { method: "POST", body }), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
