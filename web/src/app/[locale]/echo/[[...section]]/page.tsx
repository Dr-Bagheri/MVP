"use client";

import { use, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { EchoAppShell } from "@/components/echo/EchoAppShell";
import { RecordsSection } from "@/components/echo/RecordsSection";
import { SpeakersDirectory } from "@/components/echo/SpeakersDirectory";
import { SummariesSection } from "@/components/echo/SummariesSection";
import { NewMeetingSection } from "@/components/echo/NewMeetingSection";
import { SectionMenu, PageContainer, PageHeader } from "@/components/scaffold";
import { useRouter } from "@/i18n/routing";

/**
 * **Echo on the platform anatomy** (Part 5, user directive): the same
 * two-pane skeleton as Settings — Record in browser, Upload a file,
 * Records, Summaries, Archive and Speakers as SECTIONS in a side menu.
 *
 * "Calls" became "Records" (user directive, 2026-08-21 — the section, its
 * label, its route and its code identifiers; the DOMAIN object stays
 * `call` end to end: renaming the wire/db vocabulary would touch every
 * layer for a word the user never sees). `/echo/calls` redirects to
 * `/echo/records` — a redirect is cheaper than a broken bookmark.
 *
 * `/echo` with no section is the recorder — the app's first verb. `/calls`
 * and `/capture` still redirect here, unchanged.
 */

type Slug = "new-meeting" | "records" | "summaries" | "archive" | "speakers";

const SECTIONS: readonly { slug: Slug; group: "capture" | "review" }[] = [
  /* Record-in-browser and Upload merged into ONE section with two tabs
     (user directive, 2026-08-22) — /echo/record and /echo/upload alias
     here and pick the opening tab */
  { slug: "new-meeting", group: "capture" },
  { slug: "records", group: "review" },
  /* summaries as a place of their own (user directive, 2026-08-21): the
     same stored versions the record's page shows, gathered for reading */
  { slug: "summaries", group: "review" },
  /* archived records are a PLACE, not a toggle (user directive): same
     table, same actions — reached from the menu instead of a mode button */
  { slug: "archive", group: "review" },
  { slug: "speakers", group: "review" },
];

const GROUPS = ["capture", "review"] as const;

export default function EchoPage({
  params,
}: {
  params: Promise<{ section?: string[] }>;
}) {
  const t = useTranslations("platform");
  const tEcho = useTranslations("echo");
  const router = useRouter();
  const { section } = use(params);
  const requested = section?.[0];
  /** old names keep resolving: calls→records; record/upload→new-meeting */
  const isLegacyCalls = requested === "calls";
  const isLegacyCapture = requested === "record" || requested === "upload";
  const effective = isLegacyCalls ? "records" : isLegacyCapture ? "new-meeting" : requested;
  const slug: Slug = (SECTIONS.find((s) => s.slug === effective)?.slug ?? "new-meeting") as Slug;
  /** which tab the merged section opens on — the alias carries the intent
      (the agent's start_recording lands on /echo/record → the recorder) */
  const captureTab: "record" | "upload" = requested === "upload" ? "upload" : "record";

  useEffect(() => {
    if (isLegacyCalls) router.replace("/echo/records");
  }, [isLegacyCalls, router]);

  /**
   * Bumped when a recording/upload finishes so an already-mounted records
   * list refetches — the "see what I started" half of the old merged
   * screen, kept through remount-by-key.
   */
  const [recordsEpoch, setRecordsEpoch] = useState(0);

  const groups = GROUPS.map((group) => ({
    key: group,
    title: tEcho(`group.${group}`),
    items: SECTIONS.filter((s) => s.group === group).map((s) => ({
      slug: s.slug,
      href: s.slug === "new-meeting" ? "/echo" : `/echo/${s.slug}`,
      label: tEcho(`section.${s.slug}`),
    })),
  }));

  return (
    <EchoAppShell
      menu={
        <SectionMenu
          navLabel={t("echo")}
          heading={t("echo")}
          groups={groups}
          activeSlug={slug}
        />
      }
    >
      <PageContainer width={slug === "records" || slug === "archive" || slug === "new-meeting" ? "wide" : "default"}>
        <PageHeader title={tEcho(`section.${slug}`)} subtitle={tEcho(`desc.${slug}`)} />
        {slug === "new-meeting" ? (
          <NewMeetingSection
            key={captureTab}
            initialTab={captureTab}
            onFinished={() => setRecordsEpoch((n) => n + 1)}
          />
        ) : null}
        {slug === "records" ? <RecordsSection key={recordsEpoch} /> : null}
        {slug === "summaries" ? <SummariesSection /> : null}
        {slug === "archive" ? <RecordsSection view="archive" /> : null}
        {slug === "speakers" ? <SpeakersDirectory /> : null}
      </PageContainer>
    </EchoAppShell>
  );
}
