"use client";

import { useEffect, useState } from "react";
import { api } from "@/api/client";
import type { AgentCard } from "@/api/types";
import { Icon } from "@/components/icons";
import { agentColorClasses, agentIconName, useAgentCopy } from "./agentAppearance";

/**
 * WHOSE WORDS THESE ARE (user directive, 2026-09-03: "each of them when they
 * come to the AI assistant page or on the side bar menu have to have their
 * avatar next to the messages they write").
 *
 * One component, both surfaces. The alternative — each thread drawing its own
 * mark — is how the sidebar and the assistant page come to disagree about what
 * Ava looks like, which is the exact confusion an avatar exists to prevent.
 *
 * ── THE ROSTER IS READ, NOT ASSUMED ────────────────────────────────────────
 *
 * A message carries a HANDLE, not a name and not a colour. Everything drawn
 * here is resolved from the agents list at render time, so renaming an agent
 * renames it on every turn it ever took, including the ones already in the
 * thread. Storing the appearance on the message would leave old turns wearing
 * an old face — the same argument that keeps `personName` a resolver rather
 * than a column.
 *
 * The roster is fetched ONCE per page and shared through a module-level
 * promise: a thread with twenty of Roya's turns must not make twenty requests,
 * and a hook per message would do exactly that.
 *
 * ── ECHO HAS NO AVATAR HERE ────────────────────────────────────────────────
 *
 * `author` absent means Echo, and Echo's turns render as they always have —
 * plain text, no mark. That is deliberate: the assistant is the voice of the
 * surface you are in, and giving it a face beside every paragraph would make
 * the ordinary case noisier to buy consistency nobody asked for. The mark
 * appears exactly when it answers a question the reader would otherwise have:
 * somebody OTHER than Echo is speaking.
 */

let rosterPromise: Promise<AgentCard[]> | null = null;

function roster(): Promise<AgentCard[]> {
  /* one read per page load, shared. A failed read resolves to an empty roster
     rather than rejecting: the fallback is a handle in place of a name, which
     is legible, and a thread that throws because it could not draw a face is
     not. */
  rosterPromise ??= api.agents().catch(() => [] as AgentCard[]);
  return rosterPromise;
}

/** Test seam: forget the shared read, so a suite can change the roster. */
export function resetAgentRosterForTest(): void {
  rosterPromise = null;
}

export function useAgent(handle: string | null | undefined): AgentCard | null {
  const [agents, setAgents] = useState<AgentCard[] | null>(null);
  useEffect(() => {
    if (!handle) return;
    let alive = true;
    void roster().then((rows) => { if (alive) setAgents(rows); });
    return () => { alive = false; };
  }, [handle]);
  if (!handle || agents === null) return null;
  return agents.find((a) => a.handle === handle) ?? null;
}

/**
 * The mark, and the name beside it.
 *
 * `size` is the message-row size everywhere it is used; the prop exists so the
 * sidebar's narrower column can go one step down without inventing a second
 * component.
 */
export function AgentAvatar({ handle, size = "md" }: {
  handle: string;
  size?: "sm" | "md";
}) {
  const agent = useAgent(handle);
  const copy = useAgentCopy();
  const box = size === "sm" ? "h-5 w-5" : "h-6 w-6";

  /* BEFORE THE ROSTER LANDS, the mark is drawn in its neutral form rather
     than omitted. A face that appears a beat after the words is a layout that
     moves under the reader — and the handle is enough to say somebody other
     than Echo is speaking, which is the whole job. */
  if (agent === null) {
    return (
      <span className={`grid ${box} shrink-0 place-items-center rounded-lg bg-surface-2 text-fg-muted`}
        title={`@${handle}`} aria-hidden>
        <Icon name="robot" size="sm" />
      </span>
    );
  }

  const { name } = copy(agent);
  return (
    <span
      className={`grid ${box} shrink-0 place-items-center rounded-lg ${agentColorClasses(agent.color)}`}
      title={name}
      aria-hidden
    >
      <Icon name={agentIconName(agent.icon)} size="sm" />
    </span>
  );
}

/** The name on its own — for the line above a colleague's message. */
export function AgentName({ handle }: { handle: string }) {
  const agent = useAgent(handle);
  const copy = useAgentCopy();
  /* the handle while the roster is in flight: it is what the person typed to
     summon them, so it is never a stranger */
  return <>{agent === null ? `@${handle}` : copy(agent).name}</>;
}
