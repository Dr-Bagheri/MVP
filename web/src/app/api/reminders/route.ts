/* 0231 — the alarms' BFF: verbatim forwards, the session attached
   server-side. No filtering and no reshaping on this hop — the server owns
   the windows, the keys and the wall. */
import { coreFetch, errorResponse, readJson } from "@/server/core";

export async function GET() {
  try {
    return Response.json(await coreFetch("/v1/reminders"));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    return Response.json(
      await coreFetch("/v1/reminders", { method: "POST", body: await readJson(request) }),
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
