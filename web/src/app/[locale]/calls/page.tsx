import { redirect } from "@/i18n/routing";

/**
 * `/calls` points at MEETINGS now (user directive, 2026-09-04: "remove the
 * Echo page completely").
 *
 * It used to land on the merged Echo surface, which held the records list. A
 * recording belongs to the meeting it came from, so that is where somebody
 * following an old link should arrive; the search box in the top bar is the
 * other door and still finds records by their words.
 *
 * A redirect rather than a deletion: this was the most-linked route in the
 * product.
 *
 * **`/calls/[id]` is untouched.** The record document is its own screen and
 * every link to a specific recording keeps working. A blanket redirect of the
 * whole `/calls` subtree would have broken all of them — which is the kind of
 * thing a redirect makes look intentional.
 */
export default async function CallsRedirect({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect({ href: "/meetings", locale });
}
