"use client";

import { useEffect, useState } from "react";

/**
 * The table-refresh bus (user directive, 2026-08-21: "if you do an action
 * the table refreshes itself — if the user does it or the AI does it").
 *
 * The announcement lives at ONE altitude: the api client's own request
 * helper announces after every successful non-GET, deriving the topic
 * from the path it actually called. That is what makes "user or AI" a
 * non-question — the agent's hands press the same client methods the
 * buttons do, so both flow through the same announcer, and a mutation
 * added next month announces without anyone remembering to say so.
 *
 * Tables subscribe by topic via useRefreshEpoch and put the epoch in
 * their fetch effect's deps: a bump = a refetch. A page that also updates
 * its own state after its own action simply refetches once more — an
 * idempotent GET, and the price of never being stale.
 */

export type RefreshTopic =
  | "members"
  | "invitations"
  | "calls"
  | "sessions"
  | "workflows"
  | "skills"
  | "speakers"
  | "agents"
  | "models"
  | "org"
  | "gateway"
  | "platform";

const counters = new Map<RefreshTopic, number>();
const listeners = new Map<RefreshTopic, Set<() => void>>();

export function announceChange(topic: RefreshTopic): void {
  counters.set(topic, (counters.get(topic) ?? 0) + 1);
  for (const listener of listeners.get(topic) ?? []) listener();
}

export function subscribeChanges(topic: RefreshTopic, listener: () => void): () => void {
  const set = listeners.get(topic) ?? new Set();
  set.add(listener);
  listeners.set(topic, set);
  return () => { set.delete(listener); };
}

export function refreshEpoch(topic: RefreshTopic): number {
  return counters.get(topic) ?? 0;
}

/** put the returned number in a fetch effect's deps; a bump = a refetch */
export function useRefreshEpoch(topic: RefreshTopic): number {
  const [epoch, setEpoch] = useState(() => refreshEpoch(topic));
  useEffect(() => {
    // re-read on subscribe: an announcement between render and effect
    // must not be lost (the temporal-vacuum family)
    setEpoch(refreshEpoch(topic));
    return subscribeChanges(topic, () => setEpoch(refreshEpoch(topic)));
  }, [topic]);
  return epoch;
}

/**
 * Which topics a WRITE to this path touches — derived from the path the
 * client actually called, never a per-method list someone forgets to
 * extend. Invitations touch members too: redeeming/accepting changes the
 * member roster.
 */
const TOPIC_RULES: readonly [RegExp, readonly RefreshTopic[]][] = [
  // patterns match the paths the client REALLY calls (checked against the
  // client's own bff() call sites — a rule for a path nobody calls is a
  // subscription that never fires)
  [/^\/api\/admin\/members/, ["members"]],
  [/^\/api\/admin\/invitations/, ["invitations", "members"]],
  [/^\/api\/calls/, ["calls"]],
  [/^\/api\/assistant\/sessions/, ["sessions"]],
  [/^\/api\/workflows/, ["workflows"]],
  [/^\/api\/skills/, ["skills"]],
  [/^\/api\/directory/, ["speakers"]],
  [/^\/api\/agents/, ["agents"]],
  [/^\/api\/(admin\/)?models/, ["models"]],
  [/^\/api\/admin\/org/, ["org"]],
  [/^\/api\/gateway\//, ["gateway"]],
  [/^\/api\/platform/, ["platform"]],
];

export function announceWrite(path: string): void {
  for (const [pattern, topics] of TOPIC_RULES) {
    if (pattern.test(path)) {
      for (const topic of topics) announceChange(topic);
      return;
    }
  }
}

/** test seam — the counters are module state and tests share the module */
export function resetRefreshBus(): void {
  counters.clear();
  listeners.clear();
}
