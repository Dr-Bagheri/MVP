import { redirect } from "@/i18n/routing";

/**
 * THE ROSTER OPENS IN HOME'S VIEW PANE NOW.
 *
 * The address has not moved through three changes of what lives behind it —
 * the Ctrl+Shift+A shortcut, the breadcrumb table, the agents' own navigate
 * tool and anyone's bookmark all point at it, and a rename would be an IA
 * change wearing a URL change, which is the lesson `/calls` taught this repo.
 * What changed is that it now RESOLVES to the pane instead of drawing a second
 * copy of the roster at its own address.
 *
 * The query travels for the same reason it does on `/workflows`: a param this
 * file has never heard of still arrives.
 */
export default async function AgentsRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const query = await searchParams;
  const carried = new URLSearchParams({ view: "agents" });
  for (const [key, value] of Object.entries(query)) {
    /* `view` is this redirect's own answer — a caller supplying one would
       otherwise send /agents somewhere that is not the agents */
    if (key === "view") continue;
    if (typeof value === "string") carried.set(key, value);
    else if (Array.isArray(value)) for (const one of value) carried.append(key, one);
  }
  redirect({ href: `/?${carried.toString()}`, locale });
}
