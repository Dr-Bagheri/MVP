import { describe, expect, it } from "vitest";
import { prepInstruction, startingSoon } from "../src/worker/meeting-prep.ts";
import type { ConnectorItem } from "../src/api/connectors.ts";

/**
 * M44 — the pre-read's window.
 *
 * The poller's plumbing is the mail poller's, tested there. What is new and
 * gettable wrong here is WHICH events count as "starting soon" — a window
 * that is too generous prepares people for meetings they are already in, and
 * one that admits all-day entries wakes them at midnight for a marker.
 */

const NOW = Date.parse("2026-08-27T10:00:00.000Z");

function event(id: string, minutesFromNow: number | null, allDay = false): ConnectorItem {
  return {
    id,
    title: `meeting ${id}`,
    subtitle: "",
    occurred_at: minutesFromNow === null
      ? null
      : allDay
        ? "2026-08-27"
        : new Date(NOW + minutesFromNow * 60_000).toISOString(),
  };
}

describe("startingSoon", () => {
  it("takes what starts inside the window", () => {
    const soon = startingSoon([event("a", 10), event("b", 25)], NOW, 30);
    expect(soon.map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("leaves out what is further off than the window", () => {
    expect(startingSoon([event("c", 45)], NOW, 30)).toEqual([]);
  });

  it("leaves out a meeting already under way", () => {
    /* thirty minutes before is the promise; a brief delivered mid-meeting is
       worse than none, because it arrives looking useful */
    expect(startingSoon([event("d", -5)], NOW, 30)).toEqual([]);
  });

  it("ignores all-day entries and events with no time at all", () => {
    /* "today" is not a moment you can be thirty minutes before */
    expect(startingSoon([event("e", 10, true), event("f", null)], NOW, 30)).toEqual([]);
  });
});

describe("prepInstruction", () => {
  it("fences the invitation and names who wrote it", () => {
    const instruction = prepInstruction("EVENT-BODY", "Budget review");
    expect(instruction).toContain("<event>\nEVENT-BODY\n</event>");
    /* an invitation's title and description are written by whoever sent it,
       which makes them exactly as untrusted as an email body */
    expect(instruction).toContain("written by whoever sent the");
    expect(instruction).toContain("Budget review");
  });

  it("asks for an honest empty answer rather than a filled one", () => {
    expect(prepInstruction("x", "y")).toContain("say so plainly rather than filling the space");
  });
});
