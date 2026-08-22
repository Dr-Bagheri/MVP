import { CORE_URL } from "@/server/core";

/**
 * GET /api/auth-methods — which external sign-in methods are enabled (0078).
 *
 * PUBLIC and identity-free by nature: the sign-in page asks this before
 * anyone exists, so this goes straight to core's public endpoint rather
 * than through coreFetch (which attaches a session that isn't there yet).
 * Failure degrades to "offer both": the toggles exist to remove buttons,
 * and an unreachable API must not lock every door (M21 — the forfeit is
 * the setting, never the sign-in).
 */
export async function GET() {
  try {
    const upstream = await fetch(`${CORE_URL}/v1/auth-methods`, {
      cache: "no-store",
    });
    if (!upstream.ok) throw new Error(String(upstream.status));
    const body = (await upstream.json()) as {
      methods: { provider: string; enabled: boolean }[];
    };
    return Response.json(body.methods);
  } catch {
    return Response.json([
      { provider: "google", enabled: true },
      { provider: "github", enabled: true },
    ]);
  }
}
