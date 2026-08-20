/**
 * The generative-blocks parser: the assertions that matter are the
 * DEGRADATIONS — model output is untrusted, and every malformed shape must
 * come back as the model's actual words rather than a crash or a hole.
 */
import { describe, expect, it } from "vitest";
import { parseAnswerBlocks } from "./answerBlocks";

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

  it("invalid JSON degrades to the model's ACTUAL words — fence and all", () => {
    const text = '```neurai-block\n{not json}\n```';
    const segments = parseAnswerBlocks(text);
    expect(segments).toHaveLength(1);
    expect(segments[0]!.type).toBe("text");
    expect((segments[0] as { text: string }).text).toContain("{not json}");
  });

  it("an unknown kind degrades the same way — no invented rendering", () => {
    const text = '```neurai-block\n{"kind":"chart","data":[1,2]}\n```';
    const segments = parseAnswerBlocks(text);
    expect(segments[0]!.type).toBe("text");
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
