import { redirect } from "@/i18n/routing";

/**
 * Management's home IS Users now (user directive, 2026-08-22: "make the
 * first page of the management to be the users, remove this boxes").
 *
 * The card grid this page used to render was the sidebar repeated with
 * descriptions — one navigation surface too many once the two-pane menu
 * existed. A redirect rather than rendering Users here: two addresses
 * rendering one screen is two homes for one feature, and the breadcrumb
 * ancestor "Management" landing on Users is exactly the intent — the
 * area's first page is its people.
 *
 * (`desc.server` stays in the messages — the Server page uses it as its
 * subtitle. The other card descriptions left with the cards.)
 *
 * SUPERSEDES the 2026-08-13 "landing-not-redirect" decision (which kept a
 * refusal card from being Management's first face to a member): the user
 * ruled Users the landing; a member reaching here by direct URL now sees
 * the Users page's own refusal inside the pane — the pane stays, per the
 * refusal-keeps-pane half of that ruling, which still stands.
 */
export default async function ManagementHome({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect({ href: "/management/users", locale });
}
