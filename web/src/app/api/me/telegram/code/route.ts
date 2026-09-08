import { coreFetch, errorResponse } from "@/server/core";

/**
 * Mint a link code (db/0212).
 *
 * The ONE response in this product that carries a secret the server cannot
 * repeat: the column holds a SHA-256, so this body is the only place the
 * plaintext will ever exist. It is not cached, not logged and not stored —
 * the screen shows it until the person leaves.
 */
export async function POST() {
  try {
    return Response.json(
      await coreFetch<{ code: string; expires_at: string }>("/v1/me/telegram/code", { method: "POST" }));
  } catch (error) {
    return errorResponse(error);
  }
}

/** Cancel a live code without linking. */
export async function DELETE() {
  try {
    await coreFetch<null>("/v1/me/telegram/code", { method: "DELETE" });
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
