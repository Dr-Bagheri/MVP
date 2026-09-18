/* 0231 — "I have seen that one". ONE route for all three kinds: the server
   composed the key, so the server decides whether it means a row to dismiss
   or an acknowledgement to record. */
import { coreFetch, errorResponse, readJson } from "@/server/core";

export async function POST(request: Request) {
  try {
    return Response.json(
      await coreFetch("/v1/reminders/ack", { method: "POST", body: await readJson(request) }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
