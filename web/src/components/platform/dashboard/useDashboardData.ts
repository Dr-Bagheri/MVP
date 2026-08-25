"use client";

import { useEffect, useState } from "react";
import { api } from "@/api/client";
import type { Call, Person } from "@/api/types";
import { useRefreshEpoch } from "@/lib/refreshBus";
import { summaryLanes } from "@/lib/summaryLanes";

/**
 * Everything the dashboard's widgets read, fetched once and shared.
 *
 * Two rules hold this together:
 *
 * 1. **Every number is derived from what the wire already serves.** No
 *    tile is a promise: `calls === null` means "not fetched", and the
 *    widgets render «—» for it rather than a confident zero (the
 *    history_since rule, applied to the whole page).
 * 2. **The deep reads are BOUNDED.** Commitments and decisions need each
 *    record's summary, and speakers need each record's roster — both are
 *    per-record requests, so the dashboard reads the newest DEPTH records
 *    and says so in the widget's own footnote. An unbounded fan-out on a
 *    landing page is how a dashboard becomes the reason the API is slow.
 */
const DEPTH = 6;

export interface LaneItem {
  text: string;
  callId: string;
  callTitle: string;
}

export interface DashboardData {
  /** null until the first fetch resolves */
  calls: Call[] | null;
  directory: Person[];
  /** action items / decisions across the newest DEPTH ready records */
  actions: LaneItem[];
  decisions: LaneItem[];
  /** how many records those lanes were read from (the honest footnote) */
  laneDepth: number;
  /** person id → how many of the read records they appear in */
  appearances: { person: Person; records: number }[];
  /** tag → count, this month and the month before it */
  topics: { tag: string; now: number; before: number }[];
  /** ABSENT tags column (pre-0086 deployment) = the widget says so */
  tagsAvailable: boolean;
}

export function useDashboardData(): DashboardData {
  const [calls, setCalls] = useState<Call[] | null>(null);
  const [directory, setDirectory] = useState<Person[]>([]);
  const [actions, setActions] = useState<LaneItem[]>([]);
  const [decisions, setDecisions] = useState<LaneItem[]>([]);
  const [laneDepth, setLaneDepth] = useState(0);
  const [appearances, setAppearances] = useState<{ person: Person; records: number }[]>([]);
  const callsEpoch = useRefreshEpoch("calls");

  useEffect(() => {
    void api.listCalls({ includeArchived: false })
      .then((rows) => setCalls(rows.filter((c) => c.deleted_at === null)))
      .catch(() => setCalls([]));
    void api.directory().then(setDirectory).catch(() => setDirectory([]));
  }, [callsEpoch]);

  /** the bounded deep read — newest ready records only */
  useEffect(() => {
    if (calls === null) return;
    let live = true;
    const deep = calls
      .filter((c) => c.status === "ready")
      .slice()
      .sort((a, b) => b.started_at.localeCompare(a.started_at))
      .slice(0, DEPTH);
    setLaneDepth(deep.length);
    if (deep.length === 0) {
      setActions([]);
      setDecisions([]);
      setAppearances([]);
      return;
    }
    void Promise.all(deep.map(async (call) => {
      const [summaries, speakers] = await Promise.all([
        api.getSummaries(call.id).catch(() => []),
        api.getSpeakers(call.id).catch(() => []),
      ]);
      const current = summaries.at(-1);
      const lanes = current ? summaryLanes(current.body) : { actions: [], decisions: [] };
      return { call, lanes, speakers };
    })).then((read) => {
      if (!live) return;
      const nextActions: LaneItem[] = [];
      const nextDecisions: LaneItem[] = [];
      const seen = new Map<string, number>();
      for (const { call, lanes, speakers } of read) {
        for (const text of lanes.actions) {
          nextActions.push({ text, callId: call.id, callTitle: call.title });
        }
        for (const text of lanes.decisions) {
          nextDecisions.push({ text, callId: call.id, callTitle: call.title });
        }
        // one record counts a person ONCE however often they spoke
        const people = new Set(
          speakers.map((s) => s.person_id).filter((id): id is string => id !== null));
        for (const id of people) seen.set(id, (seen.get(id) ?? 0) + 1);
      }
      setActions(nextActions);
      setDecisions(nextDecisions);
      setAppearances(
        [...seen.entries()]
          .map(([id, records]) => ({ person: directory.find((p) => p.id === id), records }))
          .filter((row): row is { person: Person; records: number } => row.person !== undefined)
          .sort((a, b) => b.records - a.records),
      );
    });
    return () => { live = false; };
  }, [calls, directory]);

  /* TAGS: absent column = absent field on every row (the capability shape) */
  const tagsAvailable = (calls ?? []).some((c) => c.tags !== undefined);
  const monthAgo = Date.now() - 30 * 24 * 3600 * 1000;
  const twoMonthsAgo = Date.now() - 60 * 24 * 3600 * 1000;
  const counts = new Map<string, { now: number; before: number }>();
  for (const call of calls ?? []) {
    const at = new Date(call.started_at).getTime();
    const bucket = at >= monthAgo ? "now" : at >= twoMonthsAgo ? "before" : null;
    if (bucket === null) continue;
    for (const tag of call.tags ?? []) {
      const row = counts.get(tag) ?? { now: 0, before: 0 };
      row[bucket] += 1;
      counts.set(tag, row);
    }
  }
  const topics = [...counts.entries()]
    .map(([tag, row]) => ({ tag, ...row }))
    .sort((a, b) => b.now - a.now || b.before - a.before)
    .slice(0, 8);

  return {
    calls, directory, actions, decisions, laneDepth, appearances, topics, tagsAvailable,
  };
}
