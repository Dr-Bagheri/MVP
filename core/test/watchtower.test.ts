/**
 * The watchtower's scrubbing CONTRACT (rule 13: the invariant runs). The
 * payload is constructed, and this test is the list of what may travel:
 * feed it errors CARRYING content the way real ones would, assert the
 * content never appears in the built event.
 */
import { describe, expect, it } from "vitest";
import { buildEvent, scrubMessage } from "../src/observe/watchtower.ts";

describe("scrubMessage", () => {
  it("removes every quoted span — where embedded content lives", () => {
    expect(scrubMessage('duplicate key "جلسهٔ محرمانه با وزیر" already exists'))
      .toBe('duplicate key "…" already exists');
    expect(scrubMessage("value «سلام دکتر عزیز» is invalid")).toBe("value «…» is invalid");
    expect(scrubMessage("bad input 'secret token abc'")).toBe("bad input '…'");
  });

  it("keeps only the first line, bounded", () => {
    expect(scrubMessage(`failed\n${"x".repeat(500)}`)).toBe("failed");
    expect(scrubMessage("y".repeat(500))).toHaveLength(300);
  });
});

describe("buildEvent", () => {
  it("a DATABASE error contributes identifiers and NO message at all", () => {
    const pgError = Object.assign(
      new Error('new row violates check constraint — Detail: (id, body)=(7, "متن کامل جلسه")'),
      { code: "23514", constraint_name: "call_tags_bounded", table_name: "call" },
    );
    const event = buildEvent(pgError, { service: "api" });
    const wire = JSON.stringify(event);
    // the row content from message/detail must be nowhere in the payload
    expect(wire).not.toContain("متن کامل جلسه");
    expect(wire).not.toContain("Detail");
    expect(event.exception.values[0]!.value).toBe("sqlstate 23514");
    expect(event.tags["pg.constraint_name"]).toBe("call_tags_bounded");
    expect(event.tags["pg.table_name"]).toBe("call");
  });

  it("an ordinary error travels scrubbed and truncated, with stack frames", () => {
    const error = new Error('summarize failed for "قرارداد فروش تهران"');
    const event = buildEvent(error, { service: "worker" });
    const wire = JSON.stringify(event);
    expect(wire).not.toContain("قرارداد فروش تهران");
    expect(event.exception.values[0]!.type).toBe("Error");
    expect(event.exception.values[0]!.stacktrace?.frames.length).toBeGreaterThan(0);
  });

  it("a non-Error throw still builds a sendable event", () => {
    const event = buildEvent("boom-string", {});
    expect(event.exception.values[0]!.type).toBe("Error");
    // the thrown VALUE never travels — only its type
    expect(JSON.stringify(event)).not.toContain("boom-string");
  });
});
