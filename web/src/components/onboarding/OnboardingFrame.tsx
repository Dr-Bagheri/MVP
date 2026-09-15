"use client";

import type { ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/routing";
import { IconChevronEnd } from "@/components/icons";
import { STAGES, STEP_STAGE, progress, type StepId } from "./steps";
import { Watermark } from "./Illustrations";

/**
 * THE FLOW'S CHROME: the five-stage rail across the top, a progress bar
 * under it, the language pair at its end, and one of three stages below.
 *
 *   split     a question on the START side, a picture on the END side —
 *             the reference's default screen
 *   centred   one card in the middle of a washed ground (the microphone, the
 *             languages, the key, the message lesson)
 *   reveal    the dark stage for the two «look what you get» moments
 *
 * It is NOT the platform shell (no rail, no bar, no assistant): the person is
 * signed in, but every shell door would lead out of a flow whose point is
 * that it is walked once, in order. The trail table and the assistant's
 * silence list both name this route for that reason.
 *
 * The stage labels are plain words in both scripts. The reference tracks
 * them out in small caps; Persian is a joined script and `letter-spacing`
 * breaks it at the joins (persianType.guard), so the emphasis here is the
 * weight and the ink, which read the same in both.
 */
export type Layout = "split" | "centred" | "reveal";

export function OnboardingFrame({
  step,
  layout,
  picture,
  children,
}: {
  step: StepId;
  layout: Layout;
  /** the END-side illustration on a split screen */
  picture?: ReactNode;
  children: ReactNode;
}) {
  const t = useTranslations("onboarding");
  const locale = useLocale();
  const pathname = usePathname();
  const stage = STEP_STAGE[step];
  const reached = STAGES.indexOf(stage);
  const done = progress(step);

  return (
    <div className={`flex min-h-dvh flex-col ${layout === "reveal" ? "bg-fg text-bg" : "bg-bg text-fg"}`}>
      <header className="glass-chrome relative z-10 shrink-0 text-fg">
        <div className="flex items-center gap-3 px-4 py-2 md:px-6">
          {/* the rail: each stage is a step-list item, the current one in
              full ink, the ones behind it too, the ones ahead receding */}
          <ol className="scroll-quiet flex min-w-0 flex-1 items-center justify-center gap-1 overflow-x-auto text-xs font-semibold md:gap-3" aria-label={t("progress")}>
            {STAGES.map((s, i) => (
              <li key={s} className="flex shrink-0 items-center gap-1 md:gap-3">
                <span
                  aria-current={s === stage ? "step" : undefined}
                  className={`px-1 py-2 ${i <= reached ? "text-fg" : "text-fg-subtle"}`}
                >
                  {t(`stage_${s}`)}
                </span>
                {i < STAGES.length - 1 ? (
                  <span className={`flex items-center ${i < reached ? "text-fg" : "text-fg-subtle"}`} aria-hidden>
                    <IconChevronEnd width={14} height={14} />
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
          {/* the language pair, the top bar's own device: two links to the
              same page under the other locale */}
          <div className="flex shrink-0 items-center gap-1 text-xs font-semibold" aria-label={t("language")}>
            {(["fa", "en"] as const).map((l) => (
              <Link
                key={l}
                href={pathname}
                locale={l}
                className={`btn btn-sm px-2 ${l === locale ? "bg-surface text-fg shadow-card" : "text-fg-muted hover:text-fg"}`}
                aria-current={l === locale ? "true" : undefined}
              >
                {l === "fa" ? "فارسی" : "English"}
              </Link>
            ))}
          </div>
        </div>
        {/* the bar: the share of steps already answered */}
        <div className="h-0.5 w-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(done * 100)} aria-label={t("progress")}>
          <div className="h-full bg-accent transition-[width] duration-500" style={{ width: `${done * 100}%` }} />
        </div>
      </header>

      {layout === "split" ? (
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <section className="flex w-full flex-col px-6 py-8 md:w-1/2 md:px-14 md:py-12 lg:w-[46%]">
            {children}
          </section>
          <aside className="relative hidden flex-1 items-center justify-center overflow-hidden bg-surface-2/60 p-12 md:flex" aria-hidden>
            <div className="w-full max-w-lg text-fg">{picture}</div>
          </aside>
        </div>
      ) : layout === "centred" ? (
        <div className="relative flex min-h-0 flex-1 flex-col items-center overflow-hidden px-6 py-8 md:py-12">
          <Watermark />
          <div className="relative w-full max-w-2xl">{children}</div>
        </div>
      ) : (
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden px-6 py-8 md:px-14 md:py-12">
          <Watermark className="text-bg" />
          <div className="relative flex min-h-0 flex-1 flex-col">{children}</div>
        </div>
      )}
    </div>
  );
}
