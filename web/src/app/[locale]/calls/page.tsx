import { redirect } from "@/i18n/routing";

/**
 * `/calls` is ABSORBED by the merged Echo surface (M22) — the list now sits
 * below the recorder on `/echo`.
 *
 * A redirect rather than a deletion: this was the most-linked route in the
 * product. The table moved intact into `components/echo/RecordsSection.tsx`, so
 * this is a re-home and not a re-implementation — there is no second copy of
 * the list to fall out of step.
 *
 * **`/calls/[id]` is untouched.** The detail page is its own screen, not a
 * section of the merged one, and every link to a specific call keeps working
 * exactly as before. A blanket redirect of the whole `/calls` subtree would
 * have broken all of them — which is the kind of thing a redirect makes look
 * intentional.
 */
export default async function CallsRedirect({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect({ href: "/echo", locale });
}
