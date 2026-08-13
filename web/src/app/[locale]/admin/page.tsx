import { redirect } from "@/i18n/routing";

/**
 * `/admin` is RETIRED (M24/M25). Its contents moved to their real homes:
 *
 *   members + pending queue  → /management/users
 *   model allow-list         → /management/models
 *   org name + default scope → /settings/general
 *   deleted items + restore  → Echo (call-domain) — the card is extracted to
 *                              `components/echo/DeletedCallsCard.tsx` and lands
 *                              on the merged Record+Calls surface
 *
 * A redirect rather than a deletion: the route was linked from the old sidebar
 * for weeks, and a 404 for a bookmark is a worse answer than the new address.
 *
 * It resolves to Users because that was the screen's centre of gravity — the
 * member list and the pending queue were what anyone came here for.
 *
 * The retirement happened in ONE slice with the new homes, deliberately.
 * Leaving `/admin` rendering its member list beside `/management/users` would
 * have been two homes for one feature, which is two states that disagree —
 * and the disagreement is invisible because each looks correct alone.
 */
export default async function AdminRedirect({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect({ href: "/management/users", locale });
}
