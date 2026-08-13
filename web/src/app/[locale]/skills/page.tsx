import { redirect } from "@/i18n/routing";

/**
 * `/skills` is RE-HOMED under Management (M25) — it now lives at
 * `/management/skills`.
 *
 * A redirect rather than a deletion: this route was top-level nav before the
 * platform pivot, so bookmarks and old links exist. The content moved
 * unchanged; only the address is new.
 */
export default async function SkillsRedirect({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect({ href: "/management/skills", locale });
}
