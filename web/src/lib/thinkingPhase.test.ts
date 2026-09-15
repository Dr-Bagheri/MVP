import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentToolCall } from "@/api/types";
import { PHASE_KEYS, runningPhase, thinkingPhase, type ThinkingPhase } from "./thinkingPhase";

/*
 * `fileURLToPath`, never `new URL(...).pathname` — the second percent-encodes
 * a space in a checkout path and sends the read to a directory that does not
 * exist, which is exactly how the two WorkflowBuilder catalogue tests fail on
 * a tree whose folder name has a space in it.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const catalogue = (locale: "fa" | "en"): Record<string, string> =>
  JSON.parse(readFileSync(join(HERE, "..", "messages", `${locale}.json`), "utf8")).platform;

const call = (name: string, state: AgentToolCall["state"]): AgentToolCall =>
  ({ id: `t-${name}`, name, label: name, state });

describe("the wait names its work", () => {
  /**
   * The verbs, one per phase. Not a census of the registry — a count would be
   * a fact about today's tool list wearing the costume of a fact about the
   * rule — but every phase has to be REACHABLE, or a branch of the map is
   * dead and the line can never say it.
   */
  it("classifies each kind of work", () => {
    const seen = new Map<ThinkingPhase, string>();
    for (const [tool, phase] of [
      ["search_transcripts", "search"],
      ["list_meetings", "read"],
      ["get_summary", "read"],
      ["read_window", "read"],
      ["whoami", "read"],
      ["member_stats", "read"],
      ["create_task", "create"],
      ["add_meeting_item", "create"],
      ["invite_to_meeting", "create"],
      ["update_task", "update"],
      ["rename_record", "update"],
      ["complete_task", "update"],
      ["delete_task", "remove"],
      ["archive_meeting", "remove"],
      ["revoke_invitation", "remove"],
      ["send_slack_message", "send"],
      ["run_workflow", "run"],
      ["translate_record", "run"],
      ["call_mcp_tool", "run"],
    ] as const) {
      expect(thinkingPhase(tool), tool).toBe(phase);
      seen.set(phase, tool);
    }
    /* the control: a phase nothing reaches is a phrase nobody will ever read */
    expect([...seen.keys()].sort()).toEqual(Object.keys(PHASE_KEYS).sort());
  });

  /**
   * THE PAIR THE PREFIX ORDER EXISTS FOR. `set_search` changed a setting and
   * `search_transcripts` searches; a checker that looked for the word
   * "search" anywhere would call both a search, and the line would tell the
   * reader the assistant was looking something up while it wrote to their
   * settings. Longest prefix wins, and this is the case that proves it.
   *
   * `set_search` itself LEFT THE REGISTRY on 2026-09-15 with the page it
   * opened, and the case stays because this function takes a NAME, not a
   * registered tool: the collision is a property of the two prefixes, and the
   * next `set_*` whose tail is a verb meets it again. Kept as the mechanism's
   * regression case, named as a former tool rather than a current one.
   */
  it("reads a set_-prefixed name as an update, not a search", () => {
    expect(thinkingPhase("set_search")).toBe("update");
    expect(thinkingPhase("search_transcripts")).toBe("search");
  });

  /**
   * The fallback is the DESIGN. A tool nobody has classified must reach the
   * general word, because a wrong verb is worse than a vague one: «در حال
   * نوشتن…» over a read tells the reader something untrue about what is
   * happening to their data.
   */
  it("says nothing rather than guessing at an unknown tool", () => {
    expect(thinkingPhase("frobnicate_widget")).toBeNull();
    expect(runningPhase([call("frobnicate_widget", "started")])).toBeNull();
  });

  it("names the call that is running, not one that has finished", () => {
    /* the reducer keeps every call on the message and settles them in place,
       so a finished search sitting above a running read must not name the
       line — without the state check it would, and it is the last-wins
       ordering that makes the wrong answer plausible */
    expect(runningPhase([
      call("search_transcripts", "ok"),
      call("read_window", "started"),
    ])).toBe("read");

    /* between calls the assistant really is just thinking */
    expect(runningPhase([
      call("search_transcripts", "ok"),
      call("read_window", "error"),
    ])).toBeNull();

    expect(runningPhase([])).toBeNull();
  });

  /**
   * A key that exists in ANOTHER namespace satisfies a grep and renders as a
   * raw key on screen — this repo has shipped that three times — and the line
   * looks up its key at RUNTIME from the phase, so `keys.test` (which
   * resolves literal `t()` calls) cannot see any of these. Both catalogues,
   * the `platform` namespace, non-empty, and different from each other.
   */
  it("has both catalogues carrying every phrase the line can show", () => {
    const fa = catalogue("fa");
    const en = catalogue("en");
    for (const key of ["thinking", ...Object.values(PHASE_KEYS)]) {
      expect(typeof fa[key], `platform.${key} missing from fa`).toBe("string");
      expect(typeof en[key], `platform.${key} missing from en`).toBe("string");
      expect(fa[key]!.trim().length, `platform.${key} is blank in fa`).toBeGreaterThan(0);
      expect(en[key]!.trim().length, `platform.${key} is blank in en`).toBeGreaterThan(0);
      /* one language per screen: an English phrase copied into fa (or the
         reverse) is the failure this line would show most prominently */
      expect(fa[key], `platform.${key} is the same string in both`).not.toBe(en[key]);
    }
  });

  /**
   * The phrases must DIFFER from one another, in both catalogues. Seven keys
   * all reading «در حال کار…» is full coverage of a distinction that does not
   * exist — the shape a copy-paste leaves behind, and invisible to every
   * assertion above.
   */
  it("says something different for each phase", () => {
    for (const locale of ["fa", "en"] as const) {
      const messages = catalogue(locale);
      const phrases = Object.values(PHASE_KEYS).map((key) => messages[key]);
      expect(new Set(phrases).size, `${locale}: two phases share a phrase`).toBe(phrases.length);
    }
  });
});
