"use client";

import { use, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { EchoAppShell } from "@/components/echo/EchoAppShell";
import { RecordsSection } from "@/components/echo/RecordsSection";
import { Recorder } from "@/components/echo/Recorder";
import { SpeakersDirectory } from "@/components/echo/SpeakersDirectory";
import { SummariesSection } from "@/components/echo/SummariesSection";
import { UploadPanel } from "@/components/echo/UploadPanel";
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

type Slug = "record" | "upload" | "records" | "summaries" | "archive" | "speakers";

const SECTIONS: readonly { slug: Slug; group: "capture" | "review" }[] = [
  { slug: "record", group: "capture" },
  { slug: "upload", group: "capture" },
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
  /** the old name keeps resolving: /echo/calls IS /echo/records now */
  const isLegacyCalls = requested === "calls";
  const effective = isLegacyCalls ? "records" : requested;
  const slug: Slug = (SECTIONS.find((s) => s.slug === effective)?.slug ?? "record") as Slug;

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
      href: s.slug === "record" ? "/echo" : `/echo/${s.slug}`,
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
      <PageContainer width={slug === "records" || slug === "archive" ? "wide" : "default"}>
        <PageHeader title={tEcho(`section.${slug}`)} subtitle={tEcho(`desc.${slug}`)} />
        {slug === "record" ? (
          <Recorder onFinished={() => setRecordsEpoch((n) => n + 1)} />
        ) : null}
        {slug === "upload" ? (
          <UploadPanel onFinished={() => setRecordsEpoch((n) => n + 1)} />
        ) : null}
        {slug === "records" ? <RecordsSection key={recordsEpoch} /> : null}
        {slug === "summaries" ? <SummariesSection /> : null}
        {slug === "archive" ? <RecordsSection view="archive" /> : null}
        {slug === "speakers" ? <SpeakersDirectory /> : null}
      </PageContainer>
    </EchoAppShell>
  );
}
