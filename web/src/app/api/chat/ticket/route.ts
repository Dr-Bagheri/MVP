/* 0184 — mint the capability the browser opens the stream with.
   This route is the ONLY chat hop that keeps the BFF: it is a short request
   and it is where the session lives. The stream itself goes direct to core.

   `direct_url` is composed HERE, from Vercel's own `CORE_PUBLIC_URL` — the
   same variable and the same layer the live-transcription lane has used since
   M38. Core does not know its public address and must not pretend to: reading
   the name on the server too would be one variable meaning two things, with
   the server's copy always absent and the answer therefore always "no direct
   address" — a fallback that looks like a decision. */
import { coreFetch, errorResponse } from "@/server/core";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const minted = await coreFetch<{ ticket: string }>("/v1/chat/ticket", { method: "POST" });
    const base = process.env.CORE_PUBLIC_URL?.replace(/\/$/, "");
    return Response.json({
      ...minted,
      /* null is honest and the client acts on it: no address means POLLING,
         never a stream opened at a guessed URL */
      direct_url: base
        ? `${base}/v1/chat/stream?ticket=${encodeURIComponent(minted.ticket)}`
        : null,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
