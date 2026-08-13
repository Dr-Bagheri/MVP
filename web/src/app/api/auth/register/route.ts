import { coreFetch, errorResponse } from "@/server/core";
import type { User } from "@/api/types";

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
  const { display_name, org_name, join_org } = (await request.json()) as {
    display_name?: string;
    org_name?: string;
    join_org?: string;
  };

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
