import type { AssistantSession } from "@/api/types";

/**
 * Numbers for untitled conversations (user directive, 2026-08-26: "the name
 * must be most relevant to the text; if no name, just put new chat 1-2-3"):
 * a session's name IS its first question — already the most relevant text
 * available — so only the nameless ones need help. They are numbered by
 * CREATION order among themselves, so a conversation keeps its number as
 * newer ones arrive. Display-only: M4's titles-never-rewritten rule stands,
 * nothing is written back.
 */
export function untitledNumbers(
  sessions: readonly AssistantSession[],
): Map<string, number> {
  const untitled = sessions
    .filter((s) => s.title === null || s.title.trim() === "")
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  return new Map(untitled.map((s, i) => [s.id, i + 1]));
}
