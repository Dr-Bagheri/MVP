"use client";

import { Fragment, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { IconRobot } from "@/components/icons";
import type { OrgPersonRecord } from "@/api/types";
import { personName } from "@/lib/format";
import { MARKDOWN_ELEMENTS } from "@/components/ui/markdown";

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

/** The agent chip — a filled pill with a robot in it. */
function AgentChip({ handle }: { handle: string }) {
  return (
    <span className="mx-0.5 inline-flex items-center gap-1 rounded-md bg-accent px-1.5 py-0.5 align-middle text-[11px] font-semibold text-on-accent">
      <IconRobot width={12} height={12} />
      <bdi>{handle}</bdi>
    </span>
  );
}

/** The colleague chip — the same shape, the soft ground, no glyph. */
function PersonChip({ label }: { label: string }) {
  return (
    <span className="mx-0.5 inline-flex items-center rounded-md bg-accent-soft px-1.5 py-0.5 align-middle text-[11px] font-semibold text-accent">
      <bdi>{label}</bdi>
    </span>
  );
}

/*
 * ── MARKDOWN, ON AN AGENT'S TURNS ONLY ────────────────────────────────────
 *
 * A room is a place people TYPE in, so a colleague's asterisks are
 * asterisks and their line breaks are line breaks — rendering a member's
 * «۱. شیر بخر» as an ordered list rewrites what somebody wrote. An agent
 * AUTHORS: it emits headings, lists and tables because that is how a model
 * writes, and unrendered they are the punctuation the reader has to look
 * past. So `markdown` follows `author_kind`, and the two paths share one
 * tokenizer so a mention is the same thing in both.
 *
 * The mentions survive because they are put into the HAST rather than run
 * over the output: a rehype pass splits every TEXT node the parse produced,
 * so a handle inside a list item or a table cell still chips, and one inside
 * a code fence or a link deliberately does not — a fence is quoted text, and
 * chipping a handle inside it would claim somebody was summoned by an
 * example.
 */
const MENTION_OPAQUE = new Set(["code", "pre", "a"]);

interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

function rehypeMentions(people: OrgPersonRecord[], locale: string) {
  return (tree: HastNode): void => {
    const walk = (node: HastNode): void => {
      if (node.children === undefined) return;
      const next: HastNode[] = [];
      for (const child of node.children) {
        if (child.type === "text") {
          const tokens = tokenize(child.value ?? "", people, locale);
          /* the common case is one text token and the same node back —
             a room of ordinary sentences must not rebuild its whole tree */
          if (tokens.every((token) => token.kind === "text" || token.kind === "unknown")) {
            next.push(child);
            continue;
          }
          for (const token of tokens) {
            if (token.kind === "text" || token.kind === "unknown") {
              next.push({ type: "text", value: token.text });
            } else {
              next.push({
                type: "element",
                tagName: "span",
                properties: {
                  "data-mention": token.kind,
                  "data-label": token.kind === "agent" ? token.handle : token.label,
                },
                children: [],
              });
            }
          }
          continue;
        }
        if (child.type === "element" && !MENTION_OPAQUE.has(child.tagName ?? "")) walk(child);
        next.push(child);
      }
      node.children = next;
    };
    walk(tree);
  };
}

/*
 * The room's ONE extra element, layered over the shared table so the
 * headings, lists, fences and tables here are the ones the assistant's own
 * thread draws. A `span` carrying no mention marker is an ordinary span and
 * is rendered as one — the override must not swallow emphasis the parser
 * produced.
 */
const ROOM_ELEMENTS: Components = {
  ...MARKDOWN_ELEMENTS,
  span: ({ children, ...rest }) => {
    const props = rest as Record<string, unknown>;
    const mention = props["data-mention"];
    const label = String(props["data-label"] ?? "");
    if (mention === "agent") return <AgentChip handle={label} />;
    if (mention === "person") return <PersonChip label={label} />;
    return <span className={props["className"] as string | undefined}>{children as ReactNode}</span>;
  },
};

export function MessageBody({ body, people, locale, markdown }: {
  body: string;
  people: OrgPersonRecord[];
  locale: string;
  /** True on an agent's turn — see the block above for why it is not everyone's. */
  markdown?: boolean;
}) {
  if (markdown === true) {
    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeMentions, people, locale]]}
        components={ROOM_ELEMENTS}
      >
        {body}
      </ReactMarkdown>
    );
  }

  const tokens = tokenize(body, people, locale);
  return (
    <>
      {tokens.map((token, i) => (
        <Fragment key={i}>
          {token.kind === "text" || token.kind === "unknown" ? (
            token.text
          ) : token.kind === "agent" ? (
            <AgentChip handle={token.handle} />
          ) : (
            <PersonChip label={token.label} />
          )}
        </Fragment>
      ))}
    </>
  );
}
