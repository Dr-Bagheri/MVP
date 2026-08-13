import { AuthError, signUpWithPassword } from "@/server/supabase";
import { writeSession } from "@/server/session";
import { coreFetch, errorResponse } from "@/server/core";
import type { User } from "@/api/types";

/**
 * Sign-up is TWO steps, and skipping the second is what made M15 unreachable
 * end to end: Supabase creates the auth identity, and core/'s `POST /v1/signup`
 * creates the `app_user` row that makes the person exist to the product.
 * With only the first, someone holds a perfectly valid token, 401s forever,
 * and never appears in an admin's pending queue — every layer individually
 * correct, the chain simply stopping.
 *
 * `id` and `email` are taken by core/ from the TOKEN, never from our body —
 * otherwise anyone holding any valid token could register against someone
 * else's uuid. We send only what the token cannot carry.
 *
 * A successful sign-up returns `status: "pending"` (M15: nothing is visible
 * until an admin accepts). That is the expected outcome, not a failure, and
 * the caller routes to the waiting screen on it.
 */
export async function POST(request: Request) {
  const { email, password, display_name, org_name, join_org } = (await request.json()) as {
    email?: string;
    password?: string;
    display_name?: string;
    org_name?: string;
    join_org?: string;
  };

  if (!email || !password || !display_name) {
    return Response.json(
      { error: "email, password and display_name are required", kind: "invalid" },
      { status: 400 },
    );
  }
  if (org_name && join_org) {
    // core/ 400s on this too; refusing here keeps the message specific
    return Response.json(
      { error: "choose either a new organization or an existing one, not both", kind: "invalid" },
      { status: 400 },
    );
  }

  try {
    const tokens = await signUpWithPassword(email, password);
    if (!tokens) {
      /*
       * Identity created, but the project requires email confirmation, so
       * there is no session to register with yet. Distinct from a failure:
       * the account exists and the product row does not.
       *
       * **This path does NOT complete registration**, and the person is not
       * finished — they are authenticated-but-unregistered until they come
       * back and `/api/auth/register` runs. Without that second step they
       * would sign in successfully and then hit `401 unknown_actor` forever,
       * with no pending row for an admin to accept: the M15 hole reached by
       * a second path, and harder to see because everything visibly worked.
       *
       * The recovery is driven by `/api/me` returning `kind:"unknown_actor"`
       * on first sign-in — see the register route.
       */
      return Response.json({ ok: true, confirmationRequired: true }, { status: 202 });
    }

    // the cookie must exist before the core/ hop — coreFetch reads the session
    await writeSession({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
    });

    const member = await coreFetch<User>("/v1/signup", {
      method: "POST",
      body: { display_name, org_name, join_org },
    });
    return Response.json(member, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: error.message, kind: "invalid" }, { status: error.status });
    }
    // a core/ refusal (409 already registered, 400 no such org) keeps its kind
    return errorResponse(error);
  }
}
