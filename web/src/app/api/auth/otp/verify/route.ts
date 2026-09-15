import { AuthError, verifyEmailCode } from "@/server/supabase";
import { writeSession } from "@/server/session";
import { errorResponse, readJson } from "@/server/core";

/**
 * The six-digit code from the email becomes a session — exchanged here,
 * written into the httpOnly cookie, never shown to the browser (M1). The
 * client gets `{ ok: true }` and then asks `identityState()` who it is, which
 * is what decides where it lands (a brand-new person registers into their own
 * workspace and goes to /onboarding; a member goes in).
 *
 * A wrong or expired code is GoTrue's 403; it is folded to `401 invalid` so
 * the gate has ONE word for a refused credential, the same one the password
 * path uses. Everything else is the call failing, not the code.
 */
export async function POST(request: Request) {
  let body: { email?: string; code?: string };
  try {
    body = await readJson(request);
  } catch (error) {
    return errorResponse(error);
  }
  const email = body.email?.trim();
  /* digits only, whatever keyboard typed them: a Persian keyboard writes
     ۱۲۳۴۵۶ and GoTrue compares ASCII */
  const code = (body.code ?? "")
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/\D/g, "");
  if (!email || code.length < 6) {
    return Response.json({ error: "email and a six-digit code are required", kind: "invalid" }, { status: 400 });
  }

  try {
    const tokens = await verifyEmailCode(email, code);
    await writeSession({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
    });
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthError && error.status >= 400 && error.status < 500) {
      return Response.json({ error: error.message, kind: "invalid" }, { status: 401 });
    }
    return Response.json({ error: "unexpected", kind: "upstream" }, { status: 500 });
  }
}
