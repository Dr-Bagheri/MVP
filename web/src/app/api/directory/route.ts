import { coreFetch, errorResponse } from "@/server/core";
import type { Person } from "@/api/types";

/** The people directory (0062): names + org-chart titles. RLS scopes. */
export async function GET() {
  try {
    const { people } = await coreFetch<{ people: Person[] }>("/v1/directory");
    return Response.json(people);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { display_name?: string; title?: string };
    return Response.json(
      await coreFetch("/v1/directory", {
        method: "POST",
        body: { display_name: body.display_name, title: body.title },
      }),
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
