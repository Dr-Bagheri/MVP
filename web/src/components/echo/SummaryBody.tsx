/**
 * The summary as a DOCUMENT (user directive, 2026-08-24: "make it look
 * like a word file — chapters with bigger bold font, paragraphs smaller").
 *
 * The models write markdown-ish Persian; rendering it verbatim put raw
 * asterisks on the product's most important page. This parses the SMALL
 * dialect they actually produce — headings, bullets, numbered lists,
 * inline bold/italic — into typographic blocks, and refuses to guess
 * beyond it: an unrecognized line is a paragraph, never dropped.
 *
 * Sizes are in em on purpose: the page's font-size control scales the
 * whole document by styling ONE container.
 */
import type { ReactNode } from "react";

export type SummaryBlock =
  | { kind: "heading"; text: string }
  | { kind: "para"; text: string }
  | { kind: "bullets"; items: string[] }
  | { kind: "numbered"; items: string[] };

const HEADING_MD = /^#{1,6}\s+(.+)$/;
const HEADING_BOLD = /^\*\*(.+?)\*\*[:：]?\s*$/;
const BULLET = /^[-*•]\s+(.+)$/;
const NUMBERED = /^(?:\d+|[۰-۹]+)[.)،-]\s+(.+)$/;

export function parseSummary(text: string): SummaryBlock[] {
  const blocks: SummaryBlock[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line === "") continue;
    const md = HEADING_MD.exec(line);
    const bold = HEADING_BOLD.exec(line);
    if (md || bold) {
      // the colon may live INSIDE the bold («**خلاصه:**») — strip either way
      const heading = (md?.[1] ?? bold?.[1] ?? "").trim().replace(/[:：]$/, "").trim();
      blocks.push({ kind: "heading", text: heading });
      continue;
    }
    // a short line ending with a colon is a chapter title in the models'
    // own house style («تصمیم‌ها:») — long lines with colons are prose
    if (line.length <= 60 && /[:：]$/.test(line) && !/[.؟?!]/.test(line)) {
      blocks.push({ kind: "heading", text: line.replace(/[:：]$/, "").trim() });
      continue;
    }
    const bullet = BULLET.exec(line);
    if (bullet) {
      const prev = blocks.at(-1);
      if (prev?.kind === "bullets") prev.items.push(bullet[1]!.trim());
      else blocks.push({ kind: "bullets", items: [bullet[1]!.trim()] });
      continue;
    }
    const numbered = NUMBERED.exec(line);
    if (numbered) {
      const prev = blocks.at(-1);
      if (prev?.kind === "numbered") prev.items.push(numbered[1]!.trim());
      else blocks.push({ kind: "numbered", items: [numbered[1]!.trim()] });
      continue;
    }
    blocks.push({ kind: "para", text: line });
  }
  return blocks;
}

/** Inline **bold** and *italic* — split, never dangerous HTML. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\*[^*\n]+\*)/g).filter(Boolean).map((piece, i) => {
    if (piece.startsWith("**") && piece.endsWith("**")) {
      return <strong key={i}>{piece.slice(2, -2)}</strong>;
    }
    if (piece.startsWith("*") && piece.endsWith("*") && piece.length > 2) {
      return <em key={i} className="text-fg-muted">{piece.slice(1, -1)}</em>;
    }
    return <span key={i}>{piece}</span>;
  });
}

export function SummaryBody({ text }: { text: string }) {
  const blocks = parseSummary(text);
  return (
    <div className="space-y-[0.6em]">
      {blocks.map((block, i) => {
        switch (block.kind) {
          case "heading":
            return (
              <h3 key={i} className="mt-[1.1em] text-[1.18em] font-bold leading-snug text-fg first:mt-0">
                {inline(block.text)}
              </h3>
            );
          case "bullets":
            return (
              <ul key={i} className="list-disc space-y-[0.25em] ps-[1.6em] text-[1em] leading-[1.9]">
                {block.items.map((item, j) => <li key={j}>{inline(item)}</li>)}
              </ul>
            );
          case "numbered":
            return (
              <ol key={i} className="list-decimal space-y-[0.25em] ps-[1.6em] text-[1em] leading-[1.9]">
                {block.items.map((item, j) => <li key={j}>{inline(item)}</li>)}
              </ol>
            );
          default:
            return (
              <p key={i} className="text-[1em] leading-[1.9] text-fg">
                {inline(block.text)}
              </p>
            );
        }
      })}
    </div>
  );
}
