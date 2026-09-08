"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { ManagementPane } from "@/components/platform/ManagementPane";
import { Skeleton } from "@/components/scaffold";
import { IconPlus } from "@/components/icons";

/**
 * MANAGEMENT · SPEAKERS — the voice-print directory, at its own Management
 * address (user directive, 2026-09-02: "for speakers it written echo /
 * speakers, it should be management / speakers … and also the sub top menu
 * will disappear, fix it").
 *
 * The menu entry moved to Management on 2026-09-02 but the PAGE stayed under
 * /echo, inside Echo's shell — so pressing «Speakers» in the Management
 * toolbar landed on a screen with Echo's breadcrumb and no Management
 * toolbar at all: the one section whose door led out of the room. A voice
 * print is a fact about a COLLEAGUE, which is why the entry moved; the page
 * follows it here, and /echo/speakers redirects so a bookmark still works.
 *
 * `dynamic` with a skeleton rather than a spinner: the directory pulls the
 * chart library, and the platform's loading rule is a frame in the shape of
 * the content, never a blank or a wheel.
 */

/**
 * The placeholder is the shape of what ARRIVES (2026-09-03).
 *
 * It was `SkeletonCards`, which draws a two-column grid of tall bordered
 * cards — and what lands here is the directory's default view: a
 * single-column stack of `.table-cards` rows. So the page moved twice, once
 * when the chunk resolved and again when the rows replaced a grid that was
 * never coming, which is the exact jump a skeleton exists to prevent. A
 * placeholder in the wrong shape reserves space and still lies about it.
 *
 * The numbers are the table's own, not decoration: `rounded-xl` is the 16px
 * the scaffold names for list rows and `.table-cards` paints, `space-y-2` is
 * that table's 8px row gap, and `px-3 py-3` around an `h-4` bar is the cell
 * padding DataTable's own skeleton rows use — so the bands stand where the
 * rows will, at the height the rows will have.
 */
function DirectoryFrame() {
  return (
    <div className="space-y-2" aria-hidden>
      {Array.from({ length: 5 }, (_, i) => (
        <div
          key={i}
          className="card-row flex items-center gap-4 px-3 py-3"
        >
          {/* the first cell wide, the rest narrower — a row of equal bars
              reads as a rendering fault rather than as a table on its way */}
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-24" />
        </div>
      ))}
    </div>
  );
}

const SpeakersDirectory = dynamic(
  () => import("@/components/echo/SpeakersDirectory").then((m) => m.SpeakersDirectory),
  { ssr: false, loading: () => <DirectoryFrame /> },
);

export default function ManagementSpeakersPage() {
  const t = useTranslations("speakersDir");
  /**
   * THE ＋ IS THE TOOLBAR'S, THE ROW IT OPENS IS THE DIRECTORY'S (user
   * directive, 2026-09-08: "just keep the first sub-menu on top, and in the
   * same row the add button, and the table").
   *
   * A counter rather than a boolean, because two presses in a row are two
   * openings and a boolean cannot say that; and `canAdd` comes UP from the
   * directory rather than being decided again here, so there is one answer to
   * "may this person add somebody" instead of a second `me()` that could
   * disagree with the one the table is drawn from.
   */
  const [addAt, setAddAt] = useState(0);
  const [canAdd, setCanAdd] = useState(false);
  return (
    <ManagementPane
      activeSlug="speakers"
      actions={canAdd ? (
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setAddAt((n) => n + 1)}
        >
          <IconPlus width={14} height={14} />
          {t("add")}
        </button>
      ) : null}
    >
      <SpeakersDirectory addSignal={addAt} onCanAdd={setCanAdd} />
    </ManagementPane>
  );
}
