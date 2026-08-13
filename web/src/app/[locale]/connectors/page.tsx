import { redirect } from "@/i18n/routing";

/**
 * `/connectors` is RE-HOMED under Management (M25) — it now lives at
 * `/management/connectors`.
 *
 * A redirect rather than a deletion: this route was top-level nav before the
 * platform pivot, so bookmarks and old links exist. The content moved
 * unchanged; only the address is new.
 */
export default async function ConnectorsRedirect({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect({ href: "/management/connectors", locale });
}
