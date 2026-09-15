import { redirect } from "@/i18n/routing";

/**
 * SIGNING UP IS SIGNING IN (M54, 2026-09-15).
 *
 * The gate is one email field: the code mail creates the identity when the
 * address is new and the product registers the person on their first
 * successful verify — into a workspace of their own (db/0223). A second form
 * beside that one would be a second set of things to keep in step with it,
 * and the only thing it could add is a password nobody needs on day one.
 *
 * A redirect rather than a deletion: every "no account? sign up" link in the
 * world points here, and the address must keep answering. The two-step
 * password sign-up this route used to render — Supabase identity then core's
 * `/v1/signup`, the form that once registered nobody — lives in git.
 */
export default async function SignUpRedirect({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect({ href: "/sign-in", locale });
}
