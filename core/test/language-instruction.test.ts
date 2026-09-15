/**
 * The answer's language MIRRORS the conversation (user directive,
 * 2026-08-20): reply in the language of the user's latest message, switching
 * when they switch. The interface locale is only the tiebreaker for
 * language-less messages. This helper is the single producer; ask and
 * regenerate both consume it.
 */
import { describe, expect, it } from "vitest";
import { languageInstruction } from "../src/api/assistant.ts";

describe("languageInstruction", () => {
  it("always states the mirror rule — even for a client that sent no locale", () => {
    // An older client sends no locale; the conversation-mirroring behavior
    // must not depend on the newest bundle being deployed.
    for (const locale of [undefined, null, "", "de", 42]) {
      const line = languageInstruction(locale);
      expect(line).toContain("most recent message");
      expect(line).toContain("switch");
    }
  });

  it("adds the interface tiebreaker only when the locale is known", () => {
    expect(languageInstruction("fa")).toContain("answer in Persian");
    expect(languageInstruction("en")).toContain("answer in English");
    // no invented tiebreaker for a locale we don't recognize
    expect(languageInstruction("de")).not.toContain("no clear language");
    expect(languageInstruction(undefined)).not.toContain("no clear language");
  });

  /*
   * The regression this clause exists for (observed 2026-09-09): an
   * English question answered in Persian because the transcript the tools
   * returned was Persian. The mirror rule alone did not cover it — "the
   * language of the message" reads as satisfied by a context that is entirely
   * Persian, so the source case has to be named.
   */
  it("says the language of what it READ never decides the answer's language", () => {
    for (const locale of [undefined, "fa", "en"]) {
      const line = languageInstruction(locale);
      expect(line).toContain("READ");
      expect(line).toContain("WRITE");
    }
  });

  it("fa and en produce different instructions — the tiebreaker is real, not decorative", () => {
    expect(languageInstruction("fa")).not.toBe(languageInstruction("en"));
  });
});
