"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { api } from "@/api/client";
import type { AgentCard } from "@/api/types";
import { agentAvatarTone, useAgentCopy } from "./agentAppearance";

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
 * ── ECHO IS A HANDLE LIKE ANY OTHER ────────────────────────────────────────
 *
 * It was not, until 2026-09-04: an assistant turn drew no mark at all, on the
 * reasoning that Echo is the voice of the surface rather than a participant in
 * it. The user asked for the opposite and they are right — with two colleagues
 * answering in the same thread, the turns WITHOUT a face were the ones you had
 * to work out. `handle="echo"` resolves to no roster row, and that is the
 * point: the letter comes from the handle and the tone is named `echo`, so it
 * needs no seat in a table it will never have.
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
/**
 * THE PORTRAITS (user directive, 2026-09-04: "use these three for the avatars,
 * first is for ava, second is for echo and third is for roya").
 *
 * Three PNGs under `public/agents/`, keyed by handle. They replace the letter
 * discs that stood here for one day — a stand-in built from what the code
 * already knew (a handle's first character) while there was no artwork, which
 * is what a placeholder is for.
 *
 * WHY A MAP AND NOT `/agents/${handle}.png`. An interpolated path would turn
 * every future agent into a request for a file nobody drew: a broken image on
 * a card, which renders as an empty box and reads as a bug in the avatar
 * rather than as an agent without a portrait. The map says exactly who has a
 * face, and everyone else falls to the initial — which is a real answer, not a
 * failure, and is how an organisation's own agents will look.
 *
 * NO RING, NO DISC. The artwork has its own silhouette — an antenna above the
 * head, shoulders below — and a circular mask would clip both. What made the
 * lettered version need a ring was that a bare letter has no edge; a portrait
 * does.
 */
/** Echo's handle, which is deliberately not a row in the agents table. */
export const ECHO = "echo";

const PORTRAIT: Readonly<Record<string, string>> = {
  echo: "/agents/echo.png",
  roya: "/agents/roya.png",
  ava: "/agents/ava.png",
};

const SIZES = {
  sm: { box: "h-5 w-5", text: "text-[10px]" },
  md: { box: "h-6 w-6", text: "text-[11px]" },
  lg: { box: "h-8 w-8", text: "text-sm" },
  /* the roster's big card and the detail page's header — the two places an
     agent is the SUBJECT rather than the author of a line */
  xl: { box: "h-14 w-14", text: "text-xl" },
} as const;

export function AgentAvatar({ handle, size = "md" }: {
  handle: string;
  size?: keyof typeof SIZES;
}) {
  const agent = useAgent(handle);
  const copy = useAgentCopy();
  const t = useTranslations("platform");
  const { box, text } = SIZES[size];

  const name = handle === ECHO ? t("echo") : agent === null ? `@${handle}` : copy(agent).name;
  const portrait = PORTRAIT[handle];

  if (portrait !== undefined) {
    return (
      /*
       * `alt=""` and `aria-hidden`: the name is written beside it in every
       * place this renders, so a described image would have a screen reader
       * say the name twice. The `title` stays for a pointer.
       */
      <img
        src={portrait}
        alt=""
        aria-hidden
        data-agent-avatar={handle}
        title={name}
        className={`${box} shrink-0 select-none object-contain`}
        /* the file is 192px square; the largest use is 56px, so it is sharp on
           a 2× screen and still small enough to sit in a thread of twenty
           turns without being a download */
        width={192}
        height={192}
      />
    );
  }

  /*
   * THE FALLBACK: an initial on a lit disc, for an agent this organisation
   * made and for a handle that names nobody at all.
   *
   * The letter comes from the HANDLE rather than the display name, because a
   * handle is ASCII by rule (db/0037) and stays stable when somebody renames
   * an agent in one language. `Array.from` because a handle could begin with a
   * surrogate pair and `[0]` would take half of it.
   */
  const letter = (Array.from(handle.trim())[0] ?? "?").toUpperCase();
  const tone = agent === null ? "slate" : agent.color;

  return (
    <span
      data-agent-avatar={handle}
      className={`relative grid ${box} shrink-0 place-items-center rounded-full ${agentAvatarTone(tone)}`}
      title={name}
      aria-hidden
    >
      <span
        className="pointer-events-none absolute -inset-1 rounded-full opacity-40 blur-[6px] [background:radial-gradient(circle,currentColor_0%,transparent_70%)]"
        aria-hidden
      />
      <span
        className="pointer-events-none absolute inset-0 rounded-full [background:linear-gradient(to_bottom,rgb(255_255_255/0.28),transparent_45%)]"
        aria-hidden
      />
      <span className={`relative font-bold leading-none ${text}`} dir="ltr">{letter}</span>
    </span>
  );
}

/** The name on its own — for the line above a colleague's message. */
export function AgentName({ handle }: { handle: string }) {
  const agent = useAgent(handle);
  const copy = useAgentCopy();
  const t = useTranslations("platform");
  if (handle === ECHO) return <>{t("echo")}</>;
  /* the handle while the roster is in flight: it is what the person typed to
     summon them, so it is never a stranger */
  return <>{agent === null ? `@${handle}` : copy(agent).name}</>;
}
