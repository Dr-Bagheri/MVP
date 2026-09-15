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
 *
 * ---
 *
 * **The widget vocabulary is CLOSED, and that is the security model.**
 * `stats` and `chart` let the assistant compose a small dashboard inside an
 * answer, and it is tempting to let it ship markup instead. It may not: the
 * renderer already refuses raw HTML (see `ui/markdown`) precisely because
 * anyone who can type into the composer can influence what the model emits.
 * A widget is therefore DATA the model fills in, drawn by components we
 * wrote — never a template it authors. Adding a widget means adding a case
 * here and a case in the renderer, on purpose.
 *
 * **`refs` is the citation lane.** The assistant reads calls, meetings, tasks
 * and projects through its tools and then describes them in prose, where the
 * thing it read is unreachable — the reader is told about a call and left to
 * go find it. A `refs` block turns those into chips that open the record.
 * The ids are model-authored, so an id that is not a well-formed id renders
 * as a chip WITHOUT a link rather than as a link into nowhere.
 */

export type RefKind = "call" | "meeting" | "task" | "project";

export type AnswerRef = {
  kind: RefKind;
  /** null when the model gave no well-formed id — the chip is then inert. */
  id: string | null;
  title: string;
  when: string;
};

export type AnswerBlock =
  | { kind: "table"; columns: string[]; rows: string[][] }
  | { kind: "checklist"; items: { text: string; done: boolean }[] }
  | { kind: "timeline"; items: { when: string; what: string }[] }
  | { kind: "stats"; title: string; items: { label: string; value: string; hint: string }[] }
  | { kind: "chart"; title: string; unit: string; series: { label: string; value: number }[] }
  | { kind: "refs"; items: AnswerRef[] };

export type AnswerSegment =
  | { type: "text"; text: string }
  | { type: "block"; block: AnswerBlock };

/*
 * THE SEPARATOR IS WHITESPACE, NOT SPECIFICALLY A NEWLINE. The instruction
 * shows the model ```` ```neurai-block\n{JSON}\n``` ```` — where `\n` is two
 * characters inside a prompt string, read as an escape and as likely to come
 * back as a space as as a break. Requiring the break made a well-formed island
 * miss by one character and put the JSON in front of the reader, which is a
 * failure this parser exists to prevent, not to cause.
 *
 * The closing fence is what makes the relaxation safe, and it is why the lazy
 * quantifier stays: a half-written island has no `` ``` `` after it yet, so it
 * remains prose until it is complete rather than flickering into a component
 * in the middle of a stream.
 */
const FENCE = /```neurai-block\s*([\s\S]*?)```/g;
const MAX_ITEMS = 50;
/* Tiles and bars are LOOKED AT, not scrolled: a nine-tile row is a wall and a
   forty-bar chart is a texture. The cap is the design, not a safety margin. */
const MAX_TILES = 8;
const MAX_BARS = 12;
const MAX_REFS = 12;

const REF_KINDS: readonly string[] = ["call", "meeting", "task", "project"];
/* the same shape the surface's own tools validate ids against */
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A MODEL-WRITTEN CELL OF TEXT, or `null` when the value is not text at all.
 *
 * This replaces a `String(v ?? "")`, and the coercion is the defect it was
 * written for: asked for the day's tasks, the model emitted a table whose
 * `columns` were OBJECTS — `[{"header":"Task"},{"header":"Priority"}]` — and
 * `String({})` is `"[object Object]"`, so every header cell on the reader's
 * screen read those seventeen characters while the body rows below them were
 * perfect. `String` cannot fail, which is exactly what made it wrong here: a
 * coercion that always succeeds turns a shape we do not understand into a
 * shape we render, and the reader is the first thing that finds out.
 *
 * So the two readable shapes are read and everything else is refused:
 *
 *  - a string is the cell; a number or a boolean is the cell's text (a model
 *    writes `12` as readily as `"12"`, and `stats` already relies on that);
 *  - an object carrying ONE of the obvious label fields hands over that
 *    field. This is recovery, not tolerance-for-its-own-sake: the shape the
 *    model produced is unambiguous, `{"header":"Task"}` means the column is
 *    called Task, and refusing it would put raw JSON in front of a reader
 *    over a header we can read perfectly. The parser already accepts two
 *    shapes for one slot elsewhere — a `checklist` item is `{text, done}` OR
 *    a bare string — so this is that rule, not a new kind of leniency;
 *  - absent is the empty cell. `null` is what a model writes for a task with
 *    no deadline, and an empty cell is the honest rendering of it;
 *  - ANYTHING ELSE IS `null` — an array, an object with no label field, a
 *    nested table. The caller decides what to do with a cell it cannot read,
 *    and neither caller renders it.
 *
 * REFUSED ALTERNATIVE: keeping `String(v)` and stripping `"[object Object]"`
 * at the renderer. It would have removed the seventeen characters from the
 * screen and left a blank header, which is the same defect wearing a quieter
 * face — a column with no name is not better than a column named wrongly, and
 * nothing downstream could still tell that anything had gone missing.
 */
const CELL_LABEL_KEYS = ["header", "label", "title", "name", "text", "value"] as const;

function cell(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && !Array.isArray(v)) {
    for (const key of CELL_LABEL_KEYS) {
      const inner = (v as Record<string, unknown>)[key];
      if (typeof inner === "string") return inner;
      if (typeof inner === "number" || typeof inner === "boolean") return String(inner);
    }
  }
  return null;
}

/**
 * The item kinds' reader: unreadable reads as ABSENT, because every one of
 * them already drops an item with no text and gives its reason for doing so.
 * The table is the exception and it is a real one — see the `table` branch:
 * its cells are POSITIONAL, so a dropped cell is not a hole, it is every
 * cell after it filed under the wrong heading.
 */
const str = (v: unknown): string => cell(v) ?? "";
/** Optional strings collapse to "" — one absent-shape for every renderer. */
const opt = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** A number, or null. A model writes "12" as often as 12; a "twelve" is null. */
function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.trim()) : NaN;
  return Number.isFinite(n) ? n : null;
}

const rec = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;

function validate(raw: unknown): AnswerBlock | null {
  const b = rec(raw);
  if (b === null) return null;
  if (b.kind === "table" && Array.isArray(b.columns) && Array.isArray(b.rows)) {
    /*
     * A CELL THIS PARSER CANNOT READ REFUSES THE WHOLE BLOCK, and the reader
     * gets the model's own words (the same degradation malformed JSON takes,
     * two functions down). A table's cells are POSITIONAL: dropping the one
     * we could not read would slide every cell after it under the wrong
     * heading, and a table whose columns have quietly shifted by one is read
     * as fact and is wrong — worse than a fence nobody parsed, which at
     * least looks like what it is.
     */
    const columns = b.columns.slice(0, 12).map(cell);
    if (columns.length === 0 || columns.includes(null)) return null;
    const rows: string[][] = [];
    for (const row of b.rows.slice(0, MAX_ITEMS)) {
      if (!Array.isArray(row)) continue;
      const cells = row.slice(0, columns.length).map(cell);
      if (cells.includes(null)) return null;
      rows.push(cells as string[]);
    }
    return { kind: "table", columns: columns as string[], rows };
  }
  if (b.kind === "checklist" && Array.isArray(b.items)) {
    const items = b.items.slice(0, MAX_ITEMS)
      .map((item) => {
        const it = rec(item);
        return it !== null
          ? { text: str(it.text), done: it.done === true }
          : { text: str(item), done: false };
      })
      .filter((item) => item.text.trim() !== "");
    if (items.length === 0) return null;
    return { kind: "checklist", items };
  }
  if (b.kind === "timeline" && Array.isArray(b.items)) {
    const items = b.items.slice(0, MAX_ITEMS)
      .map((item) => {
        const it = rec(item);
        return it !== null
          ? { when: str(it.when), what: str(it.what) }
          : { when: "", what: str(item) };
      })
      .filter((item) => item.what.trim() !== "");
    if (items.length === 0) return null;
    return { kind: "timeline", items };
  }
  /*
   * STATS — the tiles. `value` stays a STRING on purpose: a figure the
   * assistant reports is «۱۲ تسک» or "3 of 7" or "۸۲٪" as often as it is a
   * bare number, and coercing it to a number would either drop the unit or
   * reject the tile. Formatting is the model's; the tile is ours.
   */
  if (b.kind === "stats" && Array.isArray(b.items)) {
    const items = b.items.slice(0, MAX_TILES)
      .map((item) => {
        const it = rec(item);
        if (it === null) return { label: "", value: "", hint: "" };
        return { label: opt(it.label), value: str(it.value).trim(), hint: opt(it.hint) };
      })
      /* a tile with no figure is an empty box wearing a label */
      .filter((item) => item.label !== "" && item.value !== "");
    if (items.length === 0) return null;
    return { kind: "stats", title: opt(b.title), items };
  }
  /*
   * CHART — labelled bars, and only bars. A bar chart is the one form that
   * survives a 30%-wide sidebar, an RTL page and a screen reader (it is a
   * list of label/value pairs underneath), so the model picks the DATA and
   * never the chart type.
   */
  if (b.kind === "chart" && Array.isArray(b.series)) {
    const series = b.series.slice(0, MAX_BARS)
      .map((point) => {
        const p = rec(point);
        if (p === null) return null;
        const value = num(p.value);
        const label = opt(p.label);
        return value === null || label === "" ? null : { label, value };
      })
      .filter((point): point is { label: string; value: number } => point !== null);
    if (series.length === 0) return null;
    return { kind: "chart", title: opt(b.title), unit: opt(b.unit), series };
  }
  /*
   * REFS — what the answer was drawn FROM. An unknown kind is dropped rather
   * than rendered as a generic chip: the icon and the route are the whole
   * value of the chip, and neither exists for a kind we have never heard of.
   */
  if (b.kind === "refs" && Array.isArray(b.items)) {
    const items = b.items.slice(0, MAX_REFS)
      .map((item) => {
        const it = rec(item);
        if (it === null) return null;
        const kind = str(it.kind).trim().toLowerCase();
        if (!REF_KINDS.includes(kind)) return null;
        const id = str(it.id).trim();
        const title = str(it.title).trim();
        if (title === "") return null;
        return {
          kind: kind as RefKind,
          id: ID_RE.test(id) ? id : null,
          title,
          when: opt(it.when),
        };
      })
      .filter((item): item is AnswerRef => item !== null);
    if (items.length === 0) return null;
    return { kind: "refs", items };
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

/**
 * Where a reference opens. Kept beside the parser rather than in the chip so
 * the route table is one exported fact a test can hold — a chip that links to
 * `/call/…` instead of `/calls/…` looks identical until it is clicked.
 */
export function refHref(ref: AnswerRef): string | null {
  if (ref.id === null) return null;
  const id = encodeURIComponent(ref.id);
  switch (ref.kind) {
    case "call": return `/calls/${id}`;
    case "meeting": return `/meetings/${id}`;
    /* the board IS the task's page; `?task=` is its deep link (R18) */
    case "task": return `/tasks?task=${id}`;
    case "project": return `/projects/${id}`;
  }
}

/**
 * The prose, with every island removed — what a screen reader's "speak" and
 * the panel's voice lane should read. A table read cell-by-cell as JSON is
 * noise, and the sentence around it is the answer.
 */
export function stripAnswerBlocks(text: string): string {
  return text.replace(/```neurai-block[\s\S]*?```/g, " ").replace(/\s{2,}/g, " ").trim();
}
