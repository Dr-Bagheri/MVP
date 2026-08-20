/**
 * Generative answer blocks (item 6; AI-native plan Phase D).
 *
 * The model is taught (core-side instruction) to emit structured islands
 * inside its prose as fenced blocks:
 *
 *   ```neurai-block
 *   { "kind": "table", "columns": ["نام", "وضعیت"], "rows": [["الف", "باز"]] }
 *   ```
 *
 * This module PARSES; rendering lives with the thread. Design rules:
 *  - The blocks ride ordinary text — no wire change, so every other client
 *    (gateway, older bundles) sees a legible fenced snippet, never garbage.
 *  - Model output is UNTRUSTED: a malformed block, unknown kind, or
 *    oversized payload degrades to plain text — the person sees what the
 *    model actually said, never a crash and never an empty hole.
 *  - The parser is pure so the degradation rules are TESTABLE — "invalid
 *    JSON renders as text" is an assertion, not a hope.
 */

export type AnswerBlock =
  | { kind: "table"; columns: string[]; rows: string[][] }
  | { kind: "checklist"; items: { text: string; done: boolean }[] }
  | { kind: "timeline"; items: { when: string; what: string }[] };

export type AnswerSegment =
  | { type: "text"; text: string }
  | { type: "block"; block: AnswerBlock };

const FENCE = /```neurai-block\s*\n([\s\S]*?)```/g;
const MAX_ITEMS = 50;

const str = (v: unknown): string => (typeof v === "string" ? v : String(v ?? ""));

function validate(raw: unknown): AnswerBlock | null {
  if (typeof raw !== "object" || raw === null) return null;
  const b = raw as Record<string, unknown>;
  if (b.kind === "table" && Array.isArray(b.columns) && Array.isArray(b.rows)) {
    const columns = b.columns.slice(0, 12).map(str);
    const rows = b.rows.slice(0, MAX_ITEMS)
      .filter(Array.isArray)
      .map((row: unknown[]) => row.slice(0, columns.length).map(str));
    if (columns.length === 0) return null;
    return { kind: "table", columns, rows };
  }
  if (b.kind === "checklist" && Array.isArray(b.items)) {
    const items = b.items.slice(0, MAX_ITEMS)
      .map((item) => (typeof item === "object" && item !== null
        ? { text: str((item as Record<string, unknown>).text), done: (item as Record<string, unknown>).done === true }
        : { text: str(item), done: false }))
      .filter((item) => item.text.trim() !== "");
    if (items.length === 0) return null;
    return { kind: "checklist", items };
  }
  if (b.kind === "timeline" && Array.isArray(b.items)) {
    const items = b.items.slice(0, MAX_ITEMS)
      .map((item) => (typeof item === "object" && item !== null
        ? { when: str((item as Record<string, unknown>).when), what: str((item as Record<string, unknown>).what) }
        : { when: "", what: str(item) }))
      .filter((item) => item.what.trim() !== "");
    if (items.length === 0) return null;
    return { kind: "timeline", items };
  }
  return null;
}

export function parseAnswerBlocks(text: string): AnswerSegment[] {
  const segments: AnswerSegment[] = [];
  let last = 0;
  FENCE.lastIndex = 0;
  for (let match = FENCE.exec(text); match !== null; match = FENCE.exec(text)) {
    const before = text.slice(last, match.index);
    if (before.trim() !== "") segments.push({ type: "text", text: before });
    let block: AnswerBlock | null = null;
    try {
      block = validate(JSON.parse(match[1]!));
    } catch {
      block = null;
    }
    // degradation: the model's actual words, fence and all, never a hole
    if (block) segments.push({ type: "block", block });
    else segments.push({ type: "text", text: match[0] });
    last = match.index + match[0].length;
  }
  const tail = text.slice(last);
  if (tail.trim() !== "" || segments.length === 0) {
    segments.push({ type: "text", text: tail });
  }
  return segments;
}
