import { coreFetch, errorResponse, readJson } from "@/server/core";

/**
 * WHO IS COMING (db/0202). Core adds the rows AND mints the invitations in
 * one act, so nothing here has to remember to do the second half — which is
 * exactly how a person came to be on a meeting nobody told them about.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return Response.json(await coreFetch(
      `/v1/meetings/${encodeURIComponent(id)}/attendees`,
      { method: "POST", body: await readJson(request) },
    ));
  } catch (error) {
    return errorResponse(error);
  }
}
