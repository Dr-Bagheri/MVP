import { coreFetch, errorResponse, readJson } from "@/server/core";

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
    /* the PARSED body: coreFetch stringifies it once. This route handed it a
       string of JSON from 2026-08-29 to 2026-09-06, so core read every field
       as undefined and refused "a recipient is required" for every message
       the agents' send_member_message ever tried to send. */
    return Response.json(await coreFetch<{ id: string }>("/v1/members/message", {
      method: "POST",
      body: await readJson(request),
    }));
  } catch (error) {
    return errorResponse(error);
  }
}
