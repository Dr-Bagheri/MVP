import { describe, expect, it } from "vitest";
import { untitledNumbers } from "./sessionTitles";
import type { AssistantSession } from "@/api/types";

function session(id: string, title: string | null, created: string): AssistantSession {
  return {
    id,
    title,
    created_at: created,
    last_message_at: null,
    archived_at: null,
    message_count: 0,
  };
}

/**
 * "New chat N" numbering (user directive, 2026-08-26). Two properties carry
 * it: titled sessions never consume a number (a named conversation is not
 * "chat 2"), and numbers follow CREATION order regardless of list order —
 * the history table lists newest first, and numbering by list position
 * would renumber every old chat each time a new one arrived.
 */
describe("untitledNumbers", () => {
  it("numbers by creation order, not list order", () => {
    const map = untitledNumbers([
      session("newest", null, "2026-08-26T10:00:00Z"),
      session("named", "budget review", "2026-08-25T10:00:00Z"),
      session("oldest", null, "2026-08-24T10:00:00Z"),
    ]);
    expect(map.get("oldest")).toBe(1);
    expect(map.get("newest")).toBe(2);
    // a titled session takes no number at all
    expect(map.has("named")).toBe(false);
  });

  it("a title of only whitespace is no title", () => {
    // the server should never store one, but a blank must not render as a
    // conversation named nothing
    const map = untitledNumbers([session("blank", "  ", "2026-08-24T10:00:00Z")]);
    expect(map.get("blank")).toBe(1);
  });

  it("numbers hold as newer untitled chats arrive", () => {
    const before = untitledNumbers([
      session("a", null, "2026-08-24T10:00:00Z"),
      session("b", null, "2026-08-25T10:00:00Z"),
    ]);
    const after = untitledNumbers([
      session("c", null, "2026-08-26T10:00:00Z"),
      session("a", null, "2026-08-24T10:00:00Z"),
      session("b", null, "2026-08-25T10:00:00Z"),
    ]);
    expect(after.get("a")).toBe(before.get("a"));
    expect(after.get("b")).toBe(before.get("b"));
    expect(after.get("c")).toBe(3);
  });
});
