"use client";

import { use, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { EchoAppShell } from "@/components/echo/EchoAppShell";
import { EchoSectionMenu } from "@/components/echo/EchoSectionMenu";
import { PageContainer, PageHeader } from "@/components/scaffold";
import { useRouter } from "@/i18n/routing";

/**
 * **One section is rendered and one section is loaded.** The four section
 * bodies were imported statically, so `/echo` — the recorder, the app's first
 * verb — downloaded the records table, the speakers directory and the
 * summaries reader before drawing a single control. They are the heaviest
 * modules under `components/echo`, and no URL ever shows two of them.
 *
 * **SSR is left ON**, for the reason spelled out on the Settings page: an
 * unmounted dynamic component is not fetched whether or not it can render on
 * the server, so the flag buys nothing (this route measured 667,666 B with SSR
 * against 667,694 B without it) and only decides whether the ACTIVE section
 * appears in the HTML. These four were plain static imports in a client page a
 * moment ago, which means they were already being server-rendered — so leaving
 * SSR on is the change that alters nothing, and turning it off would have been
 * the one that did.
 */
const NewMeetingSection = dynamic(
  () => import("@/components/echo/NewMeetingSection").then((m) => m.NewMeetingSection),
);
const RecordsSection = dynamic(
  () => import("@/components/echo/RecordsSection").then((m) => m.RecordsSection),
);
const SummariesSection = dynamic(
  () => import("@/components/echo/SummariesSection").then((m) => m.SummariesSection),
);

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

export default function EchoPage({
  params,
}: {
  params: Promise<{ section?: string[] }>;
}) {
  const tEcho = useTranslations("echo");
  const router = useRouter();
  const { section } = use(params);
  const requested = section?.[0];
  /** old names keep resolving: calls→records; record/upload→new-meeting */
  const isLegacyCalls = requested === "calls";
  const isLegacyCapture = requested === "record" || requested === "upload";
  const effective = isLegacyCalls ? "records" : isLegacyCapture ? "new-meeting" : requested;
  const slug: Slug = (SECTIONS.find((s) => s.slug === effective)?.slug ?? "new-meeting") as Slug;

  useEffect(() => {
    if (isLegacyCalls) router.replace("/echo/records");
    /* SPEAKERS LIVES IN MANAGEMENT NOW (2026-09-02) — the page followed the
       menu entry there. This address redirects so a bookmark still lands;
       it renders nothing of its own any more. */
    if (slug === "speakers") router.replace("/management/speakers");
  }, [isLegacyCalls, slug, router]);

  /**
   * Bumped when a recording/upload finishes so an already-mounted records
   * list refetches — the "see what I started" half of the old merged
   * screen, kept through remount-by-key.
   */
  const [recordsEpoch, setRecordsEpoch] = useState(0);

  return (
    <EchoAppShell
      /*
       * Summaries stays reachable by URL but has no row of its own — the menu
       * highlights its parent place. (Speakers used to render here with the
       * menu suppressed; it redirects to Management now, see above.)
       */
      menu={<EchoSectionMenu activeSlug={slug === "summaries" ? "records" : slug} />}
    >
      {/* ONE width for every section (user directive, 2026-08-25: Records
          rendered wider than Summaries) — the narrow column is the rule */}
      {/* 2026-09-03: the platform has two page sizes and `small` is the
          default — this page said "default" when that meant 1240, and the
          word now means the reading column every other surface uses. */}
      <PageContainer>
        <PageHeader title={tEcho(`section.${slug}`)} subtitle={tEcho(`desc.${slug}`)} />
        {slug === "new-meeting" ? (
          <NewMeetingSection onFinished={() => setRecordsEpoch((n) => n + 1)} />
        ) : null}
        {slug === "records" ? <RecordsSection key={recordsEpoch} /> : null}
        {slug === "summaries" ? <SummariesSection /> : null}
        {slug === "archive" ? <RecordsSection view="archive" /> : null}
      </PageContainer>
    </EchoAppShell>
  );
}
