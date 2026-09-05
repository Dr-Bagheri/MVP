import { redirect } from "@/i18n/routing";

/**
 * A project's page is a PANEL now (R18, user ruling 2026-09-05: "when you
 * click on a project it should open a pop-up window, not change the page").
 * The address stays good — a link somebody sent yesterday lands on the same
 * project, opened over the list it belongs to — so the route redirects rather
 * than disappearing: a redirect is cheaper than a broken bookmark.
 */
export default async function ProjectPage({ params }: { params: Promise<{ id: string; locale: string }> }) {
  const { id, locale } = await params;
  redirect({ href: `/projects?project=${encodeURIComponent(id)}`, locale });
}
