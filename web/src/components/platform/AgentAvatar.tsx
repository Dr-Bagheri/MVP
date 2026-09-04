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
 * THE LETTER, on a lit disc (user directive, 2026-09-04: "for echo also add an
 * avatar with E sign like the one in the logo of the site and make something
 * more cinematic, also for roya with R and for ava A, and make it bigger in
 * the chatbox").
 *
 * Three decisions worth the words:
 *
 *   · A LETTER, not a glyph. Roya and Ava were drawn with the icon their row
 *     stores — a sparkle and a chart — which says what they DO and not who
 *     they are. An initial is a face: it is what the person's own avatar does
 *     three rows up, and it makes the three of them one family rather than an
 *     assistant and two tools.
 *
 *   · THE RING IS THE SITE'S MARK. `EchoMark` is a stroked circle around a
 *     filled core, and that is the shape here too — ring, glow, letter in the
 *     middle. The "cinematic" part is a soft radial bloom behind the disc and
 *     a hairline highlight along its top edge, so it reads as lit rather than
 *     printed. Both are CSS on tokens: no image to load, nothing to go stale
 *     in a second theme.
 *
 *   · ONE TONE PER AGENT, from the row's own `color`. Echo takes the accent —
 *     it is the platform's own voice — and the others keep the colour their
 *     row already carries, so renaming or recolouring an agent moves its face
 *     with it.
 */
const SIZES = {
  sm: { box: "h-5 w-5", text: "text-[10px]" },
  md: { box: "h-6 w-6", text: "text-[11px]" },
  lg: { box: "h-8 w-8", text: "text-sm" },
  /* the roster's big card and the detail page's header — the two places an
     agent is the SUBJECT rather than the author of a line */
  xl: { box: "h-14 w-14", text: "text-xl" },
} as const;

/** Echo's handle, which is deliberately not a row in the agents table. */
export const ECHO = "echo";

export function AgentAvatar({ handle, size = "md" }: {
  handle: string;
  size?: keyof typeof SIZES;
}) {
  const agent = useAgent(handle);
  const copy = useAgentCopy();
  const t = useTranslations("platform");
  const { box, text } = SIZES[size];

  /*
   * THE LETTER COMES FROM THE HANDLE, not from the display name.
   *
   * «رؤیا» begins with a Persian letter, and the directive asks for R and A —
   * the Latin initials, which are what the handles are and what stays stable
   * when somebody renames an agent in one language. `Array.from` because a
   * handle could begin with a surrogate pair and `[0]` would take half of it.
   */
  const letter = (Array.from(handle.trim())[0] ?? "?").toUpperCase();
  /* Echo's tone is named rather than stored — it has no row to read it from,
     and the accent is the platform's own colour, which is the point */
  const tone = handle === ECHO ? ECHO : agent === null ? "slate" : agent.color;
  const name = handle === ECHO ? t("echo") : agent === null ? `@${handle}` : copy(agent).name;

  return (
    <span
      data-agent-avatar={handle}
      className={`relative grid ${box} shrink-0 place-items-center rounded-full ${agentAvatarTone(tone)}`}
      title={name}
      aria-hidden
    >
      {/* the bloom: a soft light behind the disc, so it sits IN the surface
          rather than on it. `blur` on a sibling rather than a shadow, because
          a shadow the same colour as the ring reads as a smudge in dark. */}
      <span
        className="pointer-events-none absolute -inset-1 rounded-full opacity-40 blur-[6px] [background:radial-gradient(circle,currentColor_0%,transparent_70%)]"
        aria-hidden
      />
      {/* the highlight along the top edge — one hairline, the difference
          between a printed circle and a lit one */}
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
