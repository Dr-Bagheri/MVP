"use client";

import type { ReactNode } from "react";
import type { StepId } from "./steps";
import { EntryTopBar } from "./EntryTopBar";
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
 * It shares the public entry bar's platform chrome, but is NOT the full
 * platform shell (no app navigation or assistant): the person is
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
  return (
    <div className={`flex min-h-dvh flex-col ${layout === "reveal" ? "bg-fg text-bg" : "bg-bg text-fg"}`}>
      <EntryTopBar step={step} />

      {layout === "split" ? (
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <section className="flex w-full flex-col px-6 py-8 md:w-1/2 md:px-14 md:py-12 lg:w-[46%]">
            {children}
          </section>
          <aside className="relative flex flex-1 items-center justify-center overflow-hidden bg-surface-2/60 p-6 lg:p-10">
            <div className="w-full max-w-xl text-fg">{picture}</div>
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
