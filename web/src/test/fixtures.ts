import type { MeetingRecord } from "@/api/types";

/**
 * ONE meeting fixture, shared.
 *
 * It was written inside `MeetingPage.test.tsx` and stayed there until a second
 * suite needed it — at which point the choice was to copy it or to move it,
 * and a copied fixture is how two tests come to hold different beliefs about
 * the same wire. The specific failure that prompted the move: a hand-written
 * stand-in omitted `minutes_closed_at`, so `undefined !== null` read as
 * "closed" and the component crashed formatting a date that was never there —
 * a state the real wire cannot produce.
 *
 * Every field is present and explicit for exactly that reason. Missing keys in
 * a test fixture do not fail loudly; they quietly choose a branch.
 */
export function meetingFixture(over: Partial<MeetingRecord> = {}): MeetingRecord {
  return {
    id: "m-1", title: "جلسهٔ محصول", scheduled_at: "2020-01-01T09:00:00.000Z",
    duration_minutes: 60, mode: "online", topic_id: null, topic: null, location: null,
    description: "", invitees: [], agenda: [], call_id: null, call_title: null,
    archived: false, created_by: "u-1", created_at: "2026-08-31T08:00:00.000Z",
    /* the host's resolved name: the meeting knows who ran it, so the minutes
       can count them among the attendees and the plan card can stop drawing
       whoever happens to be looking */
    host_name: "سینا", host_name_en: null,
    video_url: null, video_provider: null,
    minutes_approved_at: null, minutes_closed_at: null, minutes_signatures: [],
    ...over,
  };
}
