import { coreFetch, errorResponse } from "@/server/core";

/**
 * One member sends another a message (db/0167).
 *
 * A pass-through, and deliberately not more than one: the recipient's id, the
 * length, whether the sender may send at all and whether the two share an
 * organization are all decided by the definer door core calls. A check added
 * here would be a second spelling of a rule the database already enforces —
 * and the copy a reviewer reads is not the copy that runs.
 */
export async function POST(request: Request) {
  try {
    return Response.json(await coreFetch<{ id: string }>("/v1/members/message", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(await request.json()),
    }));
  } catch (error) {
    return errorResponse(error);
  }
}
