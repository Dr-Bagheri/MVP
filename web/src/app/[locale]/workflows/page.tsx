import { redirect } from "@/i18n/routing";

/**
 * WORKFLOWS OPENS IN HOME'S VIEW PANE NOW.
 *
 * So this address is a redirect rather than a second screen. The list itself
 * did not move — `components/platform/Workflows.tsx` renders it, and the pane
 * is its host — but two addresses rendering one list is two homes for one
 * feature, which is how the rail entry and the pane come to disagree about
 * which one is current.
 *
 * **THE QUERY TRAVELS**, and here that is load-bearing rather than tidy:
 * `?new=1` is how "create workflow" arrives with the builder already opening,
 * and dropping it would turn that button into a link to a list. Read and
 * re-emitted whole, so a param this file has never heard of still arrives.
 *
 * The TRAIL entry stays (`/workflows`, and `/workflows/[handle]` hangs under
 * it): a bookmark must resolve, and a route the app serves owes the breadcrumb
 * an answer.
 */
export default async function WorkflowsRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const query = await searchParams;
  const carried = new URLSearchParams({ view: "workflows" });
  for (const [key, value] of Object.entries(query)) {
    /* `view` is this redirect's own answer — a caller supplying one would
       otherwise send /workflows somewhere that is not workflows */
    if (key === "view") continue;
    if (typeof value === "string") carried.set(key, value);
    else if (Array.isArray(value)) for (const one of value) carried.append(key, one);
  }
  redirect({ href: `/?${carried.toString()}`, locale });
}
