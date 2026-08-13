"use client";

import { useTranslations } from "next-intl";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { Card } from "@/components/ui";

/**
 * Help — a real route, because the rail links to it.
 *
 * **This page exists because the rail's Help entry was pointing at nothing.**
 * `/help` 404'd: a producer-with-no-consumer seam inverted — a *consumer* with
 * no producer. The shell rendered a link the route tree could not answer, which
 * is the fourth instance of that class in this project and the second a check
 * caught rather than a user.
 *
 * **What Help opens in v1 is an open user question** (docs page / support
 * contact / placeholder), so this does not invent one. It names the state and
 * stops. The alternatives were both worse: a fabricated support address is a
 * channel nobody is reading, and leaving the 404 is a dead link in permanent
 * chrome.
 *
 * The one real path that exists today is the suspended-organization copy, which
 * already tells users to contact Echo support — when that address is decided,
 * it lands here and this page becomes the answer rather than the
 * acknowledgement.
 */
export default function HelpPage() {
  const t = useTranslations("platform");

  return (
    <PlatformShell>
      <div className="mx-auto w-full max-w-2xl p-5">
        <h1 className="mb-1 text-xl font-bold text-fg">{t("help")}</h1>
        <Card className="mt-4">
          <p className="text-sm font-semibold text-fg">{t("helpPendingTitle")}</p>
          <p className="mt-1 text-sm leading-7 text-fg-muted">{t("helpPendingBody")}</p>
        </Card>
      </div>
    </PlatformShell>
  );
}
