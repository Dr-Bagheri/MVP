import { coreFetch, errorResponse } from "@/server/core";
import type { AuthSessionRow } from "@/api/types";

/**
 * db/0112 + 0125 — the caller's LIVE devices, with the current one marked.
 *
 * LOCATION is attached here and only for the CURRENT session: Vercel stamps
 * every incoming request with the caller's geo (x-vercel-ip-city/country),
 * so the one thing this hop truthfully knows is where THIS request came
 * from. The other rows get nothing — their IPs are historical and often the
 * hosting provider's egress, and deriving a city from them would need a
 * GeoIP processor the privacy policy does not name. "—" beats a guess.
 */
export async function GET(request: Request) {
  try {
    const answer = await coreFetch<{ sessions: AuthSessionRow[]; current: string | null }>(
      "/v1/me/sessions");
    const city = request.headers.get("x-vercel-ip-city");
    const country = request.headers.get("x-vercel-ip-country");
    const here = [city ? decodeURIComponent(city) : null, country]
      .filter(Boolean).join(", ") || null;
    return Response.json({
      ...answer,
      sessions: answer.sessions.map((session) =>
        session.handle === answer.current ? { ...session, location: here } : session),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/** 0126 — end one of the caller's own sessions. */
export async function DELETE(request: Request) {
  try {
    const { handle } = await request.json() as { handle?: string };
    await coreFetch<void>(
      `/v1/me/sessions/${encodeURIComponent(handle ?? "")}`, { method: "DELETE" });
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
