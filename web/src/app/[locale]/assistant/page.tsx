import { redirect } from "@/i18n/routing";

/**
 * `/assistant` IS `/` NOW.
 *
 * The assistant moved off `/` on 2026-08-25 when the dashboard took the
 * landing page, and it has moved back — so this address is a redirect rather
 * than a second screen. Two addresses rendering one conversation is two homes
 * for one feature: the composer's own reset, the history table's rows and the
 * workflow launcher would each have to pick one, and the ones that picked
 * differently are how a "new conversation" comes to land somewhere else.
 *
 * **THE QUERY TRAVELS.** `?c=<session>` is how a stored conversation is
 * opened, `?workflow=` how one is launched and `?agent=` whose persona
 * answers — dropping them here would turn every history row and every
 * agent-authored link into a blank composer, which looks exactly like a
 * conversation that failed to load. `searchParams` is read and re-emitted
 * whole, so an address this file has never heard of still arrives intact.
 *
 * The TRAIL entry stays (`/assistant`, label `platform.assistant`) for the
 * same reason `/management`'s does: a bookmark must resolve, and a route the
 * app serves owes the breadcrumb an answer.
 */
export default async function AssistantRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const query = await searchParams;
  const carried = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === "string") carried.set(key, value);
    /* a repeated param arrives as an array; every value is kept rather than
       the first, because which one a consumer wants is that consumer's rule
       and not this file's to decide */
    else if (Array.isArray(value)) for (const one of value) carried.append(key, one);
  }
  const suffix = carried.toString();
  redirect({ href: suffix === "" ? "/" : `/?${suffix}`, locale });
}
