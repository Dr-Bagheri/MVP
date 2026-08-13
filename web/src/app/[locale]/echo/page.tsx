"use client";

import { useTranslations } from "next-intl";
import { EchoAppShell } from "@/components/echo/EchoAppShell";
import { CallsSection } from "@/components/echo/CallsSection";
import { RecordPanel } from "@/components/echo/RecordPanel";
import { PageHeader } from "@/components/ui";

/**
 * **Echo — Record on top, Calls below, one screen** (M22).
 *
 * This address held an interim redirect to `/calls`, put there because the
 * hub's centrepiece card and the rail's Echo tile both pointed at a route that
 * did not exist. The redirect said, in its own comment, that the real screen
 * would replace it *in place, at this address* — so it does, and there is no
 * leftover to clean up.
 *
 * **Why one screen rather than two routes.** Recording and reviewing are one
 * task with a pause in the middle: you record a meeting, and the thing you
 * want next is the meeting you just recorded, appearing in the list below the
 * recorder. Splitting them across `/capture` and `/calls` made "start" and
 * "see what I started" two navigations apart, and the new recording landed on
 * a screen the person had to go find.
 *
 * `/capture` and `/calls` now redirect here. They are redirects rather than
 * deletions for the same reason `/admin` was: both were in the nav for weeks,
 * and a bookmark deserves a better answer than a 404. `/calls/[id]` stays
 * exactly where it is — the detail page is a different screen, not a section
 * of this one.
 *
 * The two panels are separate components rather than inlined, so the merge did
 * not fork either implementation. There is one recorder and one calls table in
 * this codebase, and after this change there is one screen showing them.
 */
export default function EchoPage() {
  const t = useTranslations("platform");
  const tCapture = useTranslations("capture");

  return (
    <EchoAppShell page={t("echo")}>
      <PageHeader title={t("echo")} />

      <section className="mb-8 space-y-4">
        <h2 className="h-page">{tCapture("title")}</h2>
        <RecordPanel />
      </section>

      <CallsSection />
    </EchoAppShell>
  );
}
