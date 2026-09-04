import { redirect } from "@/i18n/routing";

/**
 * `/capture` is ABSORBED by the merged Echo surface (M22) — recording now
 * sits on top of `/echo`, above the calls list.
 *
 * A redirect rather than a deletion: this was top-level nav for weeks and is
 * linked from the calls list's own "new recording" button, so bookmarks and
 * old links exist. The recorder itself moved intact into
 * `components/echo/RecordPanel.tsx` — one implementation, now shown in one
 * place, rather than a second copy left behind here to drift.
 */
export default async function CaptureRedirect({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect({ href: "/meetings", locale });
}
