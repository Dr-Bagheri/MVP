"use client";

import { use, useState } from "react";
import { useTranslations } from "next-intl";
import { EchoAppShell } from "@/components/echo/EchoAppShell";
import { CallsSection } from "@/components/echo/CallsSection";
import { Recorder } from "@/components/echo/Recorder";
import { SpeakersDirectory } from "@/components/echo/SpeakersDirectory";
import { UploadPanel } from "@/components/echo/UploadPanel";
import { SectionMenu, PageContainer, PageHeader } from "@/components/scaffold";

/**
 * **Echo on the platform anatomy** (Part 5, user directive): the same
 * two-pane skeleton as Settings — Record in browser, Upload a file and
 * Calls as SECTIONS in a side menu — with Echo's assistant still docked at
 * inline-end, because M22 puts the assistant with the app.
 *
 * This replaces the single stacked Record-on-top/Calls-below screen. The
 * merge's original argument ("record, then see what you recorded, one
 * screen") is preserved by navigation rather than stacking: finishing a
 * recording offers the Calls section as its next step, and the menu keeps
 * every sibling one click away.
 *
 * `/echo` with no section is the recorder — the app's first verb. `/calls`
 * and `/capture` still redirect here, unchanged.
 */

type Slug = "record" | "upload" | "calls" | "archive" | "speakers";

const SECTIONS: readonly { slug: Slug; group: "capture" | "review" }[] = [
  { slug: "record", group: "capture" },
  { slug: "upload", group: "capture" },
  { slug: "calls", group: "review" },
  /* archived calls are a PLACE, not a toggle (user directive): same table,
     same actions — reached from the menu instead of a mode button */
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
  const { section } = use(params);
  const slug: Slug = (SECTIONS.find((s) => s.slug === section?.[0])?.slug ?? "record") as Slug;
  /**
   * Bumped when a recording/upload finishes so an already-mounted calls
   * list refetches — the "see what I started" half of the old merged
   * screen, kept through remount-by-key.
   */
  const [callsEpoch, setCallsEpoch] = useState(0);

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
      page={t("echo")}
      menu={
        <SectionMenu
          navLabel={t("echo")}
          heading={t("echo")}
          groups={groups}
          activeSlug={slug}
        />
      }
    >
      <PageContainer width={slug === "calls" || slug === "archive" ? "wide" : "default"}>
        <PageHeader title={tEcho(`section.${slug}`)} subtitle={tEcho(`desc.${slug}`)} />
        {slug === "record" ? (
          <Recorder onFinished={() => setCallsEpoch((n) => n + 1)} />
        ) : null}
        {slug === "upload" ? (
          <UploadPanel onFinished={() => setCallsEpoch((n) => n + 1)} />
        ) : null}
        {slug === "calls" ? <CallsSection key={callsEpoch} /> : null}
        {slug === "archive" ? <CallsSection view="archive" /> : null}
        {slug === "speakers" ? <SpeakersDirectory /> : null}
      </PageContainer>
    </EchoAppShell>
  );
}
