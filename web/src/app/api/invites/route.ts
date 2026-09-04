/* 0189 — the invitation inbox and the way to fill it. Verbatim forwards; who
   may invite (an admin for a room, anybody for a meeting) is the schema's
   policy, never a check on this hop. */
import { coreFetch, errorResponse } from "@/server/core";

export async function GET() {
  try {
    return Response.json(await coreFetch("/v1/invites"));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json(
        { error: "unreadable body", kind: "validation", code: "bad_body" },
        { status: 400 },
      );
    }
    return Response.json(
      await coreFetch("/v1/invites", { method: "POST", body }),
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
