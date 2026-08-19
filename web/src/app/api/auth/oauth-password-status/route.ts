import { AuthError, oauthPasswordEnrollmentRequired } from "@/server/supabase";
import { readSession } from "@/server/session";

/**
 * The OAuth completion screen asks this server-side question before routing a
 * person into NeurAI Platform. The browser receives only the setup boolean;
 * it never receives a provider token or the user profile used to decide it.
 */
export async function GET() {
  const session = await readSession();
  if (!session) {
    return Response.json({ error: "no session", kind: "unauthenticated" }, { status: 401 });
  }

  try {
    return Response.json({ required: await oauthPasswordEnrollmentRequired(session.accessToken) });
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: error.message, kind: "auth" }, { status: error.status });
    }
    return Response.json({ error: "unexpected", kind: "upstream" }, { status: 500 });
  }
}
