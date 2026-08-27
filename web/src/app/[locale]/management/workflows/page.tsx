import { redirect } from "@/i18n/routing";

/**
 * `/management/workflows` is ABSORBED by the Workflows page (user directive,
 * 2026-08-27: "remove the section in the settings and add everything in the
 * workflow section") — the builder now renders as an admin section on
 * `/workflows`, beside the engine catalogue and the run ledger it publishes
 * into.
 *
 * A redirect rather than a deletion: the address shipped in the Settings
 * menu for a day, and a broken bookmark is worse than a cheap 307. The
 * builder moved intact into `components/platform/WorkflowBuilder.tsx`, so
 * this is a re-home and not a re-implementation.
 */
export default async function WorkflowBuilderRedirect({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect({ href: "/workflows", locale });
}
