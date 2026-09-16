import { redirect } from "@/i18n/routing";

/**
 * INTEGRATIONS OPENS IN HOME'S VIEW PANE NOW (user directive, 2026-09-16:
 * "put integrations out of the main menu and in the sub menu in home under
 * the agents").
 *
 * The address has not moved — the breadcrumb table, the agents' navigate
 * tool, the connector detail's parent crumb and anyone's bookmark all point
 * at it, and a rename would be an IA change wearing a URL change (the `/calls`
 * lesson). What changed is that it RESOLVES to the pane beside the
 * conversations, exactly as `/agents` and `/workflows` do, instead of
 * drawing the shelf under the rail at its own address. A connector's own page
 * (`/integrations/[slug]`) keeps the shell: it is a detail, reached from the
 * shelf, and a person on it is going somewhere.
 *
 * The query travels for the reason it does on `/agents`: a param this file
 * has never heard of still arrives.
 */
export default async function IntegrationsRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const query = await searchParams;
  const carried = new URLSearchParams({ view: "integrations" });
  for (const [key, value] of Object.entries(query)) {
    if (key === "view") continue;
    if (typeof value === "string") carried.set(key, value);
    else if (Array.isArray(value)) for (const one of value) carried.append(key, one);
  }
  redirect({ href: `/?${carried.toString()}`, locale });
}
