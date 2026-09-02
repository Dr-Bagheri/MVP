import { coreFetch, errorResponse } from "@/server/core";

/**
 * The guest door's BFF leg. Unlike every other route here it carries no
 * session — a guest has none, and the code in the path is the whole
 * authorisation. Core decides; this forwards.
 */
export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  try {
    return Response.json(await coreFetch<{ title: string; token: string; url: string }>(
      `/v1/join/${encodeURIComponent(code)}`,
      { method: "POST", body: await request.json(), anonymous: true },
    ));
  } catch (error) {
    return errorResponse(error);
  }
}
