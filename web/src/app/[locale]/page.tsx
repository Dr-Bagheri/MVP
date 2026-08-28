import { redirect } from "@/i18n/routing";

/**
 * The landing page is the ASSISTANT (user directive, 2026-08-27:
 * "deactivate dashboard for now, we will use it later").
 *
 * The dashboard is PARKED, not deleted: `components/platform/Dashboard.tsx`,
 * its widget registry and every card it renders are untouched, and bringing
 * the board back is this file plus one entry in `nav.ts`. Deleting a screen
 * somebody intends to use again is how a week of work becomes a rebuild.
 *
 * A redirect rather than rendering the hub here: the assistant already lives
 * at `/assistant` and owns its own `?c=` resume, its Suspense boundary and
 * its crumb. Mounting it a second time at `/` would be two addresses for one
 * room — the exact seam that made picking an email land on a briefing screen
 * (2026-08-27, the workflow launcher). One room, one address.
 *
 * The route's history in one line: `/` redirected to `/calls` while Echo was
 * the product, became the assistant hub when Echo became an app inside a
 * platform, became the dashboard on 2026-08-25, and is the assistant's door
 * again now.
 */
export default async function RootRedirect({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect({ href: "/assistant", locale });
}
