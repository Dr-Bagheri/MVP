"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { playTestChime } from "@/lib/deviceTest";

/**
 * SPEAKER CHECK + RECORDING BOOST. The mic half moved INTO the mic
 * dropdown (user directive, 2026-08-26): the menu that picks the device
 * carries its own live meter and sensitivity slider — a separate "test"
 * ritual asked the person to prove what the picker now simply shows.
 * What stays here is what has no menu to live in: the speaker chime at a
 * chosen volume, and the loudness enhance that changes the RECORDING
 * itself (the meter's multipliers preview it; BOOST_GAIN applies in the
 * engine at start).
 */
export function DeviceCheck({
  speakerId,
  boost,
  onBoostChange,
}: {
  speakerId: string;
  boost: boolean;
  onBoostChange: (next: boolean) => void;
}) {
  const t = useTranslations("capture");
  const [volume, setVolume] = useState(0.7);

  return (
    <div className="rounded-xl border border-border bg-surface-2/40 p-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn-secondary h-9 min-h-0 px-3 text-xs"
          onClick={() => void playTestChime(speakerId, volume)}
        >
          {t("speakerTest")}
        </button>
        <input
          type="range"
          dir="ltr"
          className="flex-1 accent-accent"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          aria-label={t("speakerVolume")}
          onChange={(e) => setVolume(Number(e.target.value))}
        />
      </div>

      <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs leading-6 text-fg">
        <input
          type="checkbox"
          className="mt-1.5"
          checked={boost}
          onChange={(e) => onBoostChange(e.target.checked)}
        />
        <span>
          {t("boostOption")}
          <span className="block text-fg-muted">{t("boostHint")}</span>
        </span>
      </label>
    </div>
  );
}
