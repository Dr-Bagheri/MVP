/**
 * The generative-blocks parser: the assertions that matter are the
 * DEGRADATIONS — model output is untrusted, and every malformed shape must
 * come back as the model's actual words rather than a crash or a hole.
 */
import { describe, expect, it } from "vitest";
import { parseAnswerBlocks, refHref, stripAnswerBlocks } from "./answerBlocks";

describe("parseAnswerBlocks", () => {
  it("splits prose around a valid table block", () => {
    const text = 'قبل\n```neurai-block\n{"kind":"table","columns":["نام"],"rows":[["الف"]]}\n```\nبعد';
    const segments = parseAnswerBlocks(text);
    expect(segments.map((s) => s.type)).toEqual(["text", "block", "text"]);
    const block = segments[1]!;
    if (block.type !== "block" || block.block.kind !== "table") throw new Error("not a table");
    expect(block.block.columns).toEqual(["نام"]);
    expect(block.block.rows).toEqual([["الف"]]);
  });

  it("parses an island written on ONE LINE — the break is not a byte we can demand", () => {
    /* the instruction draws the fence with `\n`, which is an escape inside a
       prompt string and comes back as a space as readily as a break; the old
       pattern required the break, so a well-formed island missed by one
       character and the reader got the JSON */
    const text =
      'Based on recent meetings: ```neurai-block {"kind":"checklist","items":'
      + '[{"text":"Warm the audit export","done":false}]}```';
    const segments = parseAnswerBlocks(text);
    expect(segments.map((s) => s.type)).toEqual(["text", "block"]);
    const seg = segments[1]!;
    if (seg.type !== "block" || seg.block.kind !== "checklist") throw new Error("not a checklist");
    expect(seg.block.items).toEqual([{ text: "Warm the audit export", done: false }]);
  });

  it("a half-written island stays prose until its closing fence arrives", () => {
    /* the stream's own guard: this renders on every delta, and a block that
       appeared before it was finished would flicker and re-flicker */
    const partial = '```neurai-block {"kind":"checklist","items":[{"text":"نیمه';
    expect(parseAnswerBlocks(partial).map((s) => s.type)).toEqual(["text"]);
  });

  it("invalid JSON degrades to the model's ACTUAL words — fence and all", () => {
    const text = '```neurai-block\n{not json}\n```';
    const segments = parseAnswerBlocks(text);
    expect(segments).toHaveLength(1);
    expect(segments[0]!.type).toBe("text");
    expect((segments[0] as { text: string }).text).toContain("{not json}");
  });

  it("an unknown kind degrades the same way — no invented rendering", () => {
    const text = '```neurai-block\n{"kind":"gantt","data":[1,2]}\n```';
    const segments = parseAnswerBlocks(text);
    expect(segments[0]!.type).toBe("text");
  });

  it("a KNOWN kind with the wrong shape degrades too — the vocabulary is not the check", () => {
    /* `chart` is a real kind now and `data` is not its field; a renderer
       handed this would draw an empty frame where the model wrote a sentence.
       (This case used to stand as the unknown-kind test, back when `chart`
       was the example of a word we had never heard of.) */
    const text = '```neurai-block\n{"kind":"chart","data":[1,2]}\n```';
    expect(parseAnswerBlocks(text)[0]!.type).toBe("text");
  });

  it("a checklist keeps done flags and drops empty items", () => {
    const text = '```neurai-block\n{"kind":"checklist","items":[{"text":"الف","done":true},{"text":"  "},{"text":"ب"}]}\n```';
    const [seg] = parseAnswerBlocks(text);
    if (seg?.type !== "block" || seg.block.kind !== "checklist") throw new Error("not a checklist");
    expect(seg.block.items).toEqual([
      { text: "الف", done: true },
      { text: "ب", done: false },
    ]);
  });

  /*
   * THE HEADERS THAT READ `[object Object]`.
   *
   * The payload below is TRANSCRIBED from a production answer (2026-09-09,
   * "What are the most important things I should do?"): the model wrote the
   * table's `columns` as objects and its rows as plain strings, which is why
   * the reader saw four `[object Object]` headings over four perfectly good
   * rows. A hand-written fixture would have had string columns, because that
   * is what the instruction shows and what a person writes — so the shape
   * that broke could only have come from the model.
   */
  const CAPTURED = '{"kind": "table", "columns": [{"header": "Task"}, {"header": "Priority"},'
    + ' {"header": "Due Date"}, {"header": "Assigned To"}], "rows": ['
    + '["Draft Q3 renewal terms", "critical", "2026-09-11", "Ryan Cooper"],'
    + ' ["Prepare the Harbor Bank demo environment", "high", null, "Alex Turner"]]}';

  it("reads a header the model wrote as {header: …} — never String(object)", () => {
    const [seg] = parseAnswerBlocks('```neurai-block\n' + CAPTURED + '\n```');
    if (seg?.type !== "block" || seg.block.kind !== "table") throw new Error("not a table");
    expect(seg.block.columns).toEqual(["Task", "Priority", "Due Date", "Assigned To"]);
    /* the reported symptom, asserted as an absence: the version that shipped
       renders four of these and passes every assertion about the rows */
    expect(JSON.stringify(seg.block)).not.toContain("[object Object]");
    /* `null` is a task with no deadline, and an empty cell is the honest
       rendering of it — the control against "refuse anything not a string",
       which would have thrown this whole table away */
    expect(seg.block.rows[1]).toEqual([
      "Prepare the Harbor Bank demo environment", "high", "", "Alex Turner",
    ]);
  });

  it("a header object with NO label field refuses the block — the negative control", () => {
    /* the discriminating case: recovering `{header:…}` must not become
       "coerce whatever arrives". Without this, a `String(v)` and a reader of
       label fields are indistinguishable — both make the test above pass. */
    const text = '```neurai-block\n{"kind":"table","columns":[{"width":3},"Priority"],"rows":[["a","b"]]}\n```';
    const segments = parseAnswerBlocks(text);
    expect(segments).toHaveLength(1);
    expect(segments[0]!.type).toBe("text");
    expect((segments[0] as { text: string }).text).toContain('"width"');
  });

  it("an unreadable BODY cell refuses the block too — a shifted column is read as fact", () => {
    /* dropping the cell would file "2026-09-11" under Priority, and a table
       whose columns have shifted by one is read as fact */
    const text = '```neurai-block\n{"kind":"table","columns":["Task","Priority","Due"],'
      + '"rows":[["Draft Q3 renewal terms",["a","b"],"2026-09-11"]]}\n```';
    expect(parseAnswerBlocks(text).map((s) => s.type)).toEqual(["text"]);
  });

  it("plain prose with no fences is one text segment, unchanged", () => {
    expect(parseAnswerBlocks("فقط متن")).toEqual([{ type: "text", text: "فقط متن" }]);
  });

  it("caps runaway payloads instead of rendering them", () => {
    const rows = JSON.stringify(Array.from({ length: 500 }, () => ["x"]));
    const text = `\`\`\`neurai-block\n{"kind":"table","columns":["c"],"rows":${rows}}\n\`\`\``;
    const [seg] = parseAnswerBlocks(text);
    if (seg?.type !== "block" || seg.block.kind !== "table") throw new Error("not a table");
    expect(seg.block.rows.length).toBeLessThanOrEqual(50);
  });
});

describe("the widget kinds", () => {
  const one = (json: string) => parseAnswerBlocks(`\`\`\`neurai-block\n${json}\n\`\`\``)[0]!;

  it("a stats tile keeps its figure as a STRING — «۱۲ تسک» is not a number", () => {
    const seg = one('{"kind":"stats","items":[{"label":"باز","value":"۱۲ تسک"},{"label":"بسته","value":3}]}');
    if (seg.type !== "block" || seg.block.kind !== "stats") throw new Error("not stats");
    expect(seg.block.items).toEqual([
      { label: "باز", value: "۱۲ تسک", hint: "" },
      { label: "بسته", value: "3", hint: "" },
    ]);
  });

  it("a tile with no figure is dropped — an empty box wearing a label", () => {
    const seg = one('{"kind":"stats","items":[{"label":"باز"},{"label":"بسته","value":"۲"}]}');
    if (seg.type !== "block" || seg.block.kind !== "stats") throw new Error("not stats");
    expect(seg.block.items.map((item) => item.label)).toEqual(["بسته"]);
  });

  it("a chart takes a numeric string and drops a word", () => {
    const seg = one('{"kind":"chart","series":[{"label":"الف","value":"7"},{"label":"ب","value":"seven"}]}');
    if (seg.type !== "block" || seg.block.kind !== "chart") throw new Error("not a chart");
    expect(seg.block.series).toEqual([{ label: "الف", value: 7 }]);
  });

  it("a chart with nothing plottable degrades to text, not to an empty frame", () => {
    expect(one('{"kind":"chart","series":[{"label":"الف","value":"many"}]}').type).toBe("text");
  });

  it("a ref keeps a well-formed id and NULLS one the model made up", () => {
    const id = "11111111-2222-3333-4444-555555555555";
    const seg = one(
      '{"kind":"refs","items":['
      + `{"kind":"call","id":"${id}","title":"جلسه","when":"سه‌شنبه"},`
      + '{"kind":"call","id":"call-12","title":"دیگر"},'
      + `{"kind":"planet","id":"${id}","title":"نه"},`
      + `{"kind":"task","id":"${id}","title":"  "}]}`,
    );
    if (seg.type !== "block" || seg.block.kind !== "refs") throw new Error("not refs");
    /* an unknown kind and a titleless item are DROPPED — neither has an icon
       or a route; an unaddressable one STAYS, to be rendered inert */
    expect(seg.block.items).toEqual([
      { kind: "call", id, title: "جلسه", when: "سه‌شنبه" },
      { kind: "call", id: null, title: "دیگر", when: "" },
    ]);
  });
});

describe("refHref", () => {
  const id = "11111111-2222-3333-4444-555555555555";
  const ref = (kind: "call" | "meeting" | "task" | "project") =>
    ({ kind, id, title: "", when: "" }) as const;

  it("routes each kind at its own address", () => {
    expect(refHref(ref("call"))).toBe(`/calls/${id}`);
    expect(refHref(ref("meeting"))).toBe(`/meetings/${id}`);
    /* the board IS the task's page; `?task=` is its deep link (R18) */
    expect(refHref(ref("task"))).toBe(`/tasks?task=${id}`);
    expect(refHref(ref("project"))).toBe(`/projects/${id}`);
  });

  it("an unaddressable ref has no destination", () => {
    expect(refHref({ kind: "call", id: null, title: "", when: "" })).toBeNull();
  });
});

describe("stripAnswerBlocks", () => {
  it("leaves the sentence and takes the island — a table read aloud as JSON is noise", () => {
    const text = `قبل\n\`\`\`neurai-block\n{"kind":"checklist","items":["الف"]}\n\`\`\`\nبعد`;
    expect(stripAnswerBlocks(text)).toBe("قبل بعد");
  });
});
