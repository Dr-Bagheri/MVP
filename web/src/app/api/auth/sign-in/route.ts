import { AuthError, signInWithPassword } from "@/server/supabase";
import { writeSession } from "@/server/session";

/**
 * Password sign-in. The token set is exchanged server-side and written into
 * the httpOnly cookie — **the response body never contains a token** (M1: the
 * browser never holds one). The client gets `{ ok: true }` and nothing else.
 */
export async function POST(request: Request) {
  const { email, password } = (await request.json()) as { email?: string; password?: string };
  if (!email || !password) {
    return Response.json({ error: "email and password are required", kind: "invalid" }, { status: 400 });
  }

  try {
    const tokens = await signInWithPassword(email, password);
    await writeSession({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
    });
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthError) {
      /*
       * 401 here means "those credentials are wrong" — it is NOT the same as
       * core/'s 401 ("this token is not accepted"), and it is not `pending`.
       * A person who signs in correctly but is awaiting approval gets a
       * SUCCESSFUL sign-in and then a 403 kind:"pending" from core/ on their
       * first data call. Collapsing the two would tell an approved-but-
       * waiting user their password is wrong.
       */
      return Response.json({ error: error.message, kind: "invalid" }, { status: error.status });
    }
    return Response.json({ error: "unexpected", kind: "upstream" }, { status: 500 });
  }
}
