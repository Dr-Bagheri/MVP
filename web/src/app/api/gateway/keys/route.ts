import { coreFetch, errorResponse } from "@/server/core";
import type { GatewayKey, GatewayKeyCreated } from "@/api/types";

/** List. `token_prefix` only — the token itself is unrecoverable by design. */
export async function GET() {
  try {
    return Response.json(await coreFetch<{ keys: GatewayKey[] }>("/v1/gateway/keys"));
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Mint. The response carries `token` and **this is the only time it ever
 * exists** — core/ stores a sha256 and a display prefix, so there is no
 * reveal endpoint to fall back on.
 *
 * Consequences this layer must respect: the token is passed straight to the
 * caller and never logged, never cached, never written anywhere. The UI that
 * consumes it has to be a one-way door.
 */
export async function POST(request: Request) {
  const { name, expires_at } = (await request.json()) as {
    name: string;
    expires_at?: string | null;
  };
  try {
    return Response.json(
      await coreFetch<GatewayKeyCreated>("/v1/gateway/keys", {
        method: "POST",
        body: { name, expires_at },
      }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
