import { coreFetch, errorResponse } from "@/server/core";
import { readSession } from "@/server/session";
import type { User } from "@/api/types";

/**
 * The display name the TOKEN already knows, for when the form doesn't.
 *
 * An OAuth arrival (Google/GitHub → callback → org step) reaches the org
 * form without ever typing an email into it, so the client has nothing to
 * derive a name from and used to send an empty one — which core refuses
 * ("display_name is required" on a screen with no name field: the first
 * real Google sign-in hit exactly this). But the session's JWT carries what
 * the provider told us: a real full name in user_metadata, or at worst the
 * email whose local part names most people well enough. They rename
 * themselves on the profile screen either way.
 *
 * Decode-not-verify is correct here: core verifies the SAME token's
 * signature on the actual signup call; this only reads a default from it.
 */
function nameFromToken(accessToken: string): string | undefined {
  try {
    const payload = JSON.parse(
      Buffer.from(accessToken.split(".")[1] ?? "", "base64url").toString("utf8"),
    ) as { email?: string; user_metadata?: { full_name?: string; name?: string } };
    const metaName = payload.user_metadata?.full_name || payload.user_metadata?.name;
    if (metaName?.trim()) return metaName.trim();
    const local = payload.email?.split("@")[0];
    return local?.trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Register an ALREADY-AUTHENTICATED person into the product.
 *
 * This exists because sign-up has two halves and they can be separated in
 * time. If the Supabase project requires email confirmation, `/signup`
 * returns no session, so the sign-up handler never reaches `POST /v1/signup`
 * and no `app_user` row is created. The person then confirms, signs in
 * successfully, and hits core/ with a valid token for a subject that has no
 * membership: `401 unknown_actor`, forever, with no pending row for an admin
 * to accept.
 *
 * That is the M15 hole reached by a second path, and worse than the first —
 * because from the user's side everything worked: they signed up, got the
 * mail, clicked it, signed in. It is invisible from core/ too, since
 * `/v1/signup` is simply never called, and a route that is never called looks
 * exactly like one that is working.
 *
 * **The recovery must live here rather than in core/**: core/ sees only a
 * token, while the org choice that `register_account` needs is input we hold.
 *
 * Flow: `/api/me` → `401 kind:"unknown_actor"` means *authenticated but
 * unregistered* — which is precisely the fact that kind was built to make
 * legible — so the client routes to the org-choice step and posts here.
 */
export async function POST(request: Request) {
  let { display_name, org_name, join_org } = (await request.json()) as {
    display_name?: string;
    org_name?: string;
    join_org?: string;
  };

  if (!display_name?.trim()) {
    const session = await readSession();
    display_name = session ? nameFromToken(session.accessToken) : undefined;
  }
  if (!display_name) {
    return Response.json({ error: "display_name is required", kind: "invalid" }, { status: 400 });
  }
  if (org_name && join_org) {
    return Response.json(
      { error: "choose either a new organization or an existing one, not both", kind: "invalid" },
      { status: 400 },
    );
  }

  try {
    /*
     * No token in the body: core/ takes `id` and `email` from the session's
     * JWT. A 401 here means the cookie is missing or stale, which is a
     * different failure from "not registered" and must not be retried as one.
     */
    const member = await coreFetch<User>("/v1/signup", {
      method: "POST",
      body: { display_name, org_name, join_org },
    });
    return Response.json(member, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
