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
  const { name, expires_at, allow_assistant, actor_id } = (await request.json()) as {
    name: string;
    expires_at?: string | null;
    allow_assistant?: boolean;
    /*
     * MUST travel: core accepts it (defaulting to the creating admin), and
     * this handler dropping it made the UI's acts-as picker a control that
     * reads as wired and does nothing — the key would silently mint in the
     * ADMIN's name whatever the picker showed. Same shape as the
     * allow_assistant drop below, pointed at authority instead of capability.
     */
    actor_id?: string;
  };
  try {
    /*
     * `allow_assistant` MUST be forwarded. Dropping it (as this handler did)
     * is worse than it looks: core/ defaults the grant closed, so every key
     * would mint without assistant access while the UI reported the opt-in
     * succeeded — a silent disagreement between what the user chose and what
     * exists, with no error anywhere. Rule 12: something helpful absorbed the
     * absence and reported success.
     *
     * Forwarded verbatim, including `false`, rather than defaulted here — a
     * capability grant is core/'s decision to make, not this layer's.
     *
     * **Why this was only an inconvenience: core/ defaults the grant CLOSED.**
     * The dropped field produced keys with too LITTLE access and a lying UI.
     * The identical bug against a default-open grant is a silent privilege
     * leak — keys that can spend a model budget while the UI shows the opt-in
     * switched off. That asymmetry is the whole argument for default-closed,
     * and it is the reason never to flip it.
     */
    return Response.json(
      await coreFetch<GatewayKeyCreated>("/v1/gateway/keys", {
        method: "POST",
        body: { name, expires_at, allow_assistant, actor_id },
      }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
