"use client";

import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import {
  assistantServerSnapshot, assistantSnapshot, releaseAssistantFloor, subscribeAssistant,
} from "@/lib/assistantSession";
import { AgentName } from "./AgentAvatar";

/**
 * WHO IS IN THE ROOM (user directive, 2026-09-06: a called colleague "should
 * not just leave … until you say someone else's name"; released "only by a
 * name or the × button").
 *
 * The floor is a fact the person cannot otherwise see: after «رؤیا بیا
 * اینجا», every later message goes to Roya, and a thread that looks like
 * Echo's and answers as Roya is the confusion this chip exists to end. It
 * reads the store's `floor` — set by the `floor` event on every turn and by
 * the thread read on a reload — and its × is the only release that is not a
 * name. Handles are drawn through `AgentName`, the roster the page already
 * holds; nothing here is a second copy of it.
 */
export function FloorChip({ className = "" }: { className?: string }) {
  const t = useTranslations("presence");
  const floor = useSyncExternalStore(
    subscribeAssistant,
    () => assistantSnapshot().floor,
    () => assistantServerSnapshot().floor,
  );
  if (floor.length === 0) return null;
  return (
    <div
      className={`flex items-center gap-1.5 text-detail text-fg-muted ${className}`}
      data-floor={floor.join(",")}
    >
      <span>{t("floorWith")}</span>
      <span className="font-semibold text-fg">
        {floor.map((handle, i) => (
          <span key={handle}>
            {/* the joiner in its own span, so each NAME is one element a
                reader — or a test — can find whole */}
            {i > 0 ? <span className="font-normal text-fg-muted">{` ${t("floorAnd")} `}</span> : null}
            <span><AgentName handle={handle} /></span>
          </span>
        ))}
      </span>
      <button
        type="button"
        className="btn btn-icon"
        aria-label={t("floorRelease")}
        title={t("floorRelease")}
        onClick={() => { void releaseAssistantFloor(); }}
      >
        <span aria-hidden>×</span>
      </button>
    </div>
  );
}
