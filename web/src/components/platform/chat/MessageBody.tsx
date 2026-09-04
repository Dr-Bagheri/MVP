"use client";

import { Fragment } from "react";
import { IconRobot } from "@/components/icons";
import type { OrgPersonRecord } from "@/api/types";
import { personName } from "@/lib/format";

/**
 * A message's words, with the @handles drawn as CHIPS (0189).
 *
 * User directive, 2026-09-04: "a @ option that can add agents to the chat by
 * putting the name of it before the text I want to type, with a fill
 * background and robot icon like Buzz."
 *
 * WHY A CHIP AND NOT A COLOUR. A mention is the whole authorization for an
 * agent to answer, so it is the one token in the sentence with a
 * CONSEQUENCE — and a person scanning a room needs to see at a glance that
 * this line summons somebody. Tinted text says "this word is different";
 * a filled chip with a robot in it says which kind of different.
 *
 * `<bdi>` on every chip, and that is not decoration: a Latin handle at the
 * head of a Persian sentence drags the following punctuation to the wrong end
 * of the line, and the fix a stylesheet offers can be overridden where this
 * element cannot.
 */

/** the handles that summon an agent — the same three the composer offers */
export const AGENT_HANDLES = ["echo", "roya", "ava"] as const;

type Token =
  | { kind: "text"; text: string }
  | { kind: "agent"; handle: string }
  | { kind: "person"; handle: string; label: string }
  /* a handle nobody holds stays PLAIN TEXT — chipping it would promise a
     person or an agent that does not exist, and the sentence somebody typed
     is the honest thing to render */
  | { kind: "unknown"; text: string };

/**
 * Split a body into words and mentions.
 *
 * The pattern is the SERVER'S (chat.ts `handlesIn`) — same boundary, same
 * ASCII rule. Two spellings of "what counts as a mention" would mean a chip
 * on screen for something that badged nobody, or the reverse, and the reverse
 * is the one nobody would report.
 */
export function tokenize(body: string, people: OrgPersonRecord[], locale: string): Token[] {
  const out: Token[] = [];
  const pattern = /(?<![\w.@-])@([a-z0-9][a-z0-9_-]{0,38})\b/gi;
  let last = 0;
  for (const match of body.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > last) out.push({ kind: "text", text: body.slice(last, at) });
    const handle = match[1]!.toLowerCase();
    if ((AGENT_HANDLES as readonly string[]).includes(handle)) {
      out.push({ kind: "agent", handle });
    } else {
      const person = people.find((p) => p.username?.toLowerCase() === handle) ?? null;
      out.push(person === null
        ? { kind: "unknown", text: match[0] }
        : { kind: "person", handle, label: personName(person, locale) });
    }
    last = at + match[0].length;
  }
  if (last < body.length) out.push({ kind: "text", text: body.slice(last) });
  return out;
}

export function MessageBody({ body, people, locale }: {
  body: string;
  people: OrgPersonRecord[];
  locale: string;
}) {
  const tokens = tokenize(body, people, locale);
  return (
    <>
      {tokens.map((token, i) => (
        <Fragment key={i}>
          {token.kind === "text" || token.kind === "unknown" ? (
            token.text
          ) : token.kind === "agent" ? (
            <span className="mx-0.5 inline-flex items-center gap-1 rounded-md bg-accent px-1.5 py-0.5 align-middle text-[11px] font-semibold text-on-accent">
              <IconRobot width={12} height={12} />
              <bdi>{token.handle}</bdi>
            </span>
          ) : (
            <span className="mx-0.5 inline-flex items-center rounded-md bg-accent-soft px-1.5 py-0.5 align-middle text-[11px] font-semibold text-accent">
              <bdi>{token.label}</bdi>
            </span>
          )}
        </Fragment>
      ))}
    </>
  );
}
