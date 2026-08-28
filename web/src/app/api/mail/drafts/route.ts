import { coreFetch, errorResponse } from "@/server/core";
import type { MailDraft } from "@/api/types";

/** M43 — the caller's own drafts. Owner-only at the wall, not here. */
export async function GET(request: Request) {
  try {
    const from = new URL(request.url).searchParams;
    const query = new URLSearchParams();
    for (const key of ["status", "session"]) {
      const value = from.get(key);
      if (value) query.set(key, value);
    }
    const suffix = query.toString();
    return Response.json(
      await coreFetch<{ drafts: MailDraft[] }>(`/v1/mail/drafts${suffix ? `?${suffix}` : ""}`));
  } catch (error) {
    return errorResponse(error);
  }
}
