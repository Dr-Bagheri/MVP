import { clearSession } from "@/server/session";

/**
 * POST, not GET — signing out is a state change, and a GET would let any
 * page log the user out with an <img> tag.
 *
 * `Clear-Site-Data: "cache"` is the half a redirect cannot do: pressing Back
 * after sign-out restores the previous page from the browser's own caches
 * (bfcache included) without a single request reaching the middleware gate —
 * a signed-out person reading the signed-in screen. This header tells the
 * browser to evict this origin's cached pages, so Back has to renavigate and
 * meets the gate. Deliberately NOT `"storage"`: that would also wipe the
 * theme preference, which survives sign-out on purpose.
 */
export async function POST() {
  await clearSession();
  return Response.json(
    { ok: true },
    { headers: { "clear-site-data": '"cache"' } },
  );
}
