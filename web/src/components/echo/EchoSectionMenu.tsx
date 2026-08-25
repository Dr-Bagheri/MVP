"use client";

import { type ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  IconArchive, IconMic, IconRows, IconSearch, IconVoice,
} from "@/components/icons";
import { SectionMenu } from "@/components/scaffold";

/**
 * Echo's section menu, extracted (2026-08-25) so the SEARCH page can wear
 * it too — search searches the records, so it lives with them (user
 * directive, moving it out of the assistant's menu).
 *
 * The 2026-08-25 shape: Summaries left the list (its page stays reachable
 * for bookmarks), and ARCHIVE became a small door at the END of the
 * Records row — an icon, not a row of its own.
 */
export type EchoMenuSlug = "new-meeting" | "records" | "archive" | "speakers" | "search";

export function EchoSectionMenu({ activeSlug }: { activeSlug: EchoMenuSlug }) {
  const t = useTranslations("platform");
  const tEcho = useTranslations("echo");

  const ICONS: Record<string, ReactNode> = {
    "new-meeting": <IconMic />,
    records: <IconRows />,
    speakers: <IconVoice />,
    search: <IconSearch />,
  };

  return (
    <SectionMenu
      navLabel={t("echo")}
      heading={t("echo")}
      /* the archive row highlights Records — it IS the records place */
      activeSlug={activeSlug === "archive" ? "records" : activeSlug}
      groups={[
        {
          key: "capture",
          title: tEcho("group.capture"),
          items: [{
            slug: "new-meeting",
            href: "/echo",
            label: tEcho("section.new-meeting"),
            icon: ICONS["new-meeting"],
          }],
        },
        {
          key: "review",
          title: tEcho("group.review"),
          items: [
            {
              slug: "records",
              href: "/echo/records",
              label: tEcho("section.records"),
              icon: ICONS.records,
              trailing: {
                href: "/echo/archive",
                label: tEcho("section.archive"),
                icon: <IconArchive width={15} height={15} />,
              },
            },
            {
              slug: "speakers",
              href: "/echo/speakers",
              label: tEcho("section.speakers"),
              icon: ICONS.speakers,
            },
            {
              slug: "search",
              href: "/search",
              label: t("search"),
              icon: ICONS.search,
            },
          ],
        },
      ]}
    />
  );
}
