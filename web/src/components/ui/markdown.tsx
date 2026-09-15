"use client";

import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

/**
 * MARKDOWN, RENDERED — the assistant's answers stop showing their syntax.
 *
 * Ported from 21st.dev's `@21st/markdown` (Agent Elements; MIT), which is a
 * self-contained `react-markdown` + `remark-gfm` renderer standing in for that
 * project's `streamdown` pair. The port is the styling: every element below is
 * written in THIS theme's tokens and THIS repo's logical properties, because
 * the upstream file is `text-neutral-500` and `text-left` throughout and both
 * halves of that are wrong here — a hard-coded neutral ignores the two themes
 * `verify-pairs` holds to a contrast floor, and a physical `left` ignores the
 * Persian half of the product.
 *
 * ---
 *
 * **Why the assistant needed this at all.** The thread rendered answers as
 * `whitespace-pre-wrap` text, so a model that emitted `**سه نکته**` or a
 * numbered list or a fenced snippet showed the reader its asterisks, its
 * backticks and its pipes. The structure was already in the answer; only the
 * rendering was missing. (`neurai-block` islands are a different mechanism and
 * still parse first — see `lib/answerBlocks.ts`. This handles the ORDINARY
 * markdown the model writes without being asked to.)
 *
 * **State-friendly, which is the whole point during a stream.** This is a pure
 * function of `content`: it holds nothing across renders, so a half-written
 * document renders as far as it parses and the next delta simply renders
 * further. An unterminated fence is a code block from its OPENING line (that
 * is CommonMark's rule, and it is asserted rather than assumed — see the test,
 * which corrected the opposite belief), so a snippet does not flicker into
 * existence three lines late. `memo` is the cost control: a delta re-renders the one
 * message being written and never the settled answers above it (the thread's
 * `MessageRow` memo is the other half of that; this one keeps a parent
 * re-render for an unrelated reason from re-parsing anything at all).
 *
 * **Raw HTML never renders.** No `rehype-raw`, deliberately: model output is
 * untrusted, and an assistant that can be talked into emitting a `<script>` or
 * a form is an injection surface reachable by anyone who can type into the
 * composer. `react-markdown` also runs its URL transform over every link, so
 * `javascript:` never reaches an `href`.
 *
 * **Remote images are not fetched.** An `![](https://…)` in an answer would
 * make the reader's browser call a third party the moment the message paints —
 * a beacon reporting who read what and when, planted by whoever influenced the
 * model's output. The alt text and the address are shown instead, as a link the
 * reader chooses to follow.
 */
export const Markdown = memo(function Markdown({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  return (
    <div className={cn(className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_ELEMENTS}>
        {content}
      </ReactMarkdown>
    </div>
  );
});

/*
 * `ps-*`/`border-s`/`text-start` throughout, and `ltr` on the two things that
 * are not prose. A code fence and a table of latin identifiers read
 * left-to-right whatever the surrounding paragraph does, and letting them
 * inherit an RTL direction drags brackets and digits to the wrong end of the
 * line — the same call `TraceBlock` already makes for a model name.
 */
/*
 * EXPORTED so a surface that needs one MORE element can compose rather than
 * copy: the chat room renders an agent's markdown with its own `span`
 * override for the @mention chips, and a second styling table is the pair
 * that stops matching the first time either gains a rule.
 */
export const MARKDOWN_ELEMENTS: Components = {
  /*
   * HEADINGS START AT `text-base` AND STOP. An answer is a message inside a
   * thread, not a document with a title, so `#` may not outrank the page — and
   * the element is stepped down with it (`h1` renders `<h2>`) because a
   * screen-reader's outline of the platform should not gain a new top-level
   * heading every time a model writes a hash.
   */
  h1: ({ children }) => (
    <h2 className="mb-1.5 mt-4 text-base font-semibold text-fg first:mt-0">{children}</h2>
  ),
  h2: ({ children }) => (
    <h3 className="mb-1.5 mt-4 text-sm font-semibold text-fg first:mt-0">{children}</h3>
  ),
  h3: ({ children }) => (
    <h4 className="mb-1 mt-3 text-sm font-semibold text-fg first:mt-0">{children}</h4>
  ),
  /* h4–h6 are already at body size, so weight is the only signal left; three
     more sizes below `text-sm` would make a heading smaller than the answer it
     heads */
  h4: ({ children }) => (
    <h5 className="mb-1 mt-3 text-sm font-semibold text-fg first:mt-0">{children}</h5>
  ),
  h5: ({ children }) => (
    <h6 className="mb-1 mt-3 text-sm font-semibold text-fg first:mt-0">{children}</h6>
  ),
  h6: ({ children }) => (
    <p className="mb-1 mt-3 text-sm font-semibold text-fg first:mt-0">{children}</p>
  ),

  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,

  /* `ps-5`, not `list-inside`: a wrapped item hangs under its own text rather
     than under its bullet */
  ul: ({ children }) => <ul className="mb-2 list-disc space-y-0.5 ps-5 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 list-decimal space-y-0.5 ps-5 last:mb-0">{children}</ol>,
  li: ({ children }) => <li className="[&>p]:mb-0">{children}</li>,

  /*
   * GFM task lists, disabled on purpose. This is the record of what the
   * assistant wrote; a checkbox a reader can tick changes nothing anywhere
   * while looking exactly like one that would.
   */
  input: ({ type, checked }) =>
    type === "checkbox" ? (
      <input
        type="checkbox"
        checked={checked === true}
        readOnly
        disabled
        className="me-1.5 align-middle accent-accent"
      />
    ) : null,

  strong: ({ children }) => <strong className="font-semibold text-fg">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  del: ({ children }) => <del className="text-fg-subtle line-through">{children}</del>,

  /*
   * EXTERNAL BY DEFAULT, AND SAFE. Every link in an answer came from a model,
   * so it opens in its own tab (a thread mid-stream is not a page to navigate
   * away from) and carries `noopener noreferrer` — the opened page gets no
   * handle back to this one and no referrer naming where it was opened from.
   */
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-accent underline underline-offset-2 hover:no-underline"
    >
      {children}
    </a>
  ),

  img: ({ src, alt }) =>
    typeof src === "string" ? (
      <a
        href={src}
        target="_blank"
        rel="noopener noreferrer"
        className="text-accent underline underline-offset-2 hover:no-underline"
      >
        {alt !== undefined && alt !== "" ? alt : src}
      </a>
    ) : null,

  blockquote: ({ children }) => (
    <blockquote className="my-2 border-s-2 border-border-strong ps-3 text-fg-subtle">
      {children}
    </blockquote>
  ),

  code: ({ children }) => (
    <code className="ltr rounded bg-surface-2 px-1 py-0.5 font-mono text-[0.9em]">{children}</code>
  ),
  /*
   * The fence is the container, and it UNDOES the inline pill above — one
   * `code` override has to serve both positions, so the block case strips the
   * ground and padding its child would otherwise wear twice.
   *
   * `rounded-lg`, not `rounded-xl`: R7 reads a card corner plus a border plus a
   * surface ground as a hand-drawn card, and a code fence is neither a card nor
   * an exception worth listing. Same corner the thread's own block views use.
   */
  pre: ({ children }) => (
    <pre className="ltr my-2 overflow-x-auto rounded-lg border border-border bg-surface-2/50 p-3 font-mono text-xs leading-6 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-inherit">
      {children}
    </pre>
  ),

  /* the scroller is the wrapper, not the table: a wide table scrolls inside the
     answer instead of widening the whole thread */
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-max text-xs">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="border-b border-border bg-surface-2/60">{children}</thead>
  ),
  tr: ({ children }) => <tr className="border-b border-border last:border-b-0">{children}</tr>,
  th: ({ children }) => <th className="px-3 py-1.5 text-start font-semibold text-fg">{children}</th>,
  td: ({ children }) => <td className="px-3 py-1.5 text-fg-muted">{children}</td>,

  hr: () => <hr className="my-3 border-border" />,
};
