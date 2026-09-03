"use client";

import dynamic from "next/dynamic";
import { ManagementPane } from "@/components/platform/ManagementPane";
import { SkeletonCards } from "@/components/scaffold";

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
const SpeakersDirectory = dynamic(
  () => import("@/components/echo/SpeakersDirectory").then((m) => m.SpeakersDirectory),
  { ssr: false, loading: () => <SkeletonCards count={4} height="h-16" /> },
);

export default function ManagementSpeakersPage() {
  return (
    <ManagementPane activeSlug="speakers">
      <SpeakersDirectory />
    </ManagementPane>
  );
}
