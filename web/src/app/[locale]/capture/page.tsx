import { redirect } from "@/i18n/routing";

/**
 * `/capture` REDIRECTS TO `/meetings`.
 *
 * A redirect rather than a deletion: this was top-level nav for weeks, so
 * bookmarks and old links exist.
 *
 * The comment that stood here described `/capture` being absorbed by "the
 * merged Echo surface (M22)", with the recorder living in
 * `components/echo/RecordPanel.tsx`. Both statements were true for about a
 * week. The Echo surface was deleted on 2026-09-04 and that file has never
 * existed in this tree — a comment naming a path nobody can open costs the
 * next reader the same minute every time.
 *
 * A take belongs to a meeting now: `MeetingPage` calls `startRecording()`
 * itself, which is why the redirect lands on the list rather than on a
 * recorder.
 */
export default async function CaptureRedirect({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect({ href: "/meetings", locale });
}
