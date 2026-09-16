"use client";

import { useTranslations } from "next-intl";
import { ProductDemo } from "@/components/onboarding/ProductDemo";
import { DEMO_VIDEO_SRC } from "@/lib/demoVideo";

/** The public gate uses the same shipped films as the first-time flow. */
export function DemoPanel() {
  const t = useTranslations("auth");
  return (
    <section aria-label={t("demoVideoLabel")} className="relative h-full overflow-hidden rounded-2xl bg-surface-2/60">
      <div className="flex h-full flex-col justify-center p-4 sm:p-6">
        <h2 className="mb-5 text-center text-2xl font-bold leading-tight text-fg">{t("demoHeadline")}</h2>
        {/* a recording, when one is configured, plays by itself and loops —
            no player chrome on the gate (2026-09-16), same as the films */}
        {DEMO_VIDEO_SRC ? (
          <video className="w-full rounded-xl" src={DEMO_VIDEO_SRC} autoPlay muted loop playsInline preload="metadata" aria-label={t("demoVideoLabel")} />
        ) : <ProductDemo />}
      </div>
    </section>
  );
}
