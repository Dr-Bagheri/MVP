import { clearSession } from "@/server/session";

/**
 * POST, not GET — signing out is a state change, and a GET would let any
 * page log the user out with an <img> tag.
 */
export async function POST() {
  await clearSession();
  return Response.json({ ok: true });
}
