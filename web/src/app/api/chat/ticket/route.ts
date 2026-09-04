/* 0184 — mint the capability the browser opens the stream with.
   This route is the ONLY chat hop that keeps the BFF: it is a short request
   and it is where the session lives. The stream itself goes direct to core. */
import { coreFetch, errorResponse } from "@/server/core";

export async function POST() {
  try {
    return Response.json(await coreFetch("/v1/chat/ticket", { method: "POST" }));
  } catch (error) {
    return errorResponse(error);
  }
}
