/**
 * M33 client tools: the agent's hands on the surface. These pin the four
 * properties the design leans on — the event carries consent semantics, the
 * broker resolves ONLY for the asker, a silent surface is a loud forfeit,
 * and watch mode offers nothing at all.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  CLIENT_TOOL_NAMES,
  CLIENT_TOOLS,
  createClientTools,
  deliverClientToolResult,
  pendingClientCalls,
  type ClientToolCallEvent,
} from "../src/agent/client-tools.ts";
import type { ToolContext } from "../src/agent/tools.ts";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const CTX = { identity: { userId: USER } } as unknown as ToolContext<unknown>;

function firstEmitted(events: ClientToolCallEvent[]): ClientToolCallEvent {
  const event = events[0];
  if (!event) throw new Error("nothing was emitted");
  return event;
}

describe("createClientTools", () => {
  it("offers only the ADVERTISED subset — a surface that cannot perform is never asked to", () => {
    const tools = createClientTools(["navigate", "not_a_tool"], {
      userId: USER, autonomy: "assist", emit: () => {},
    });
    expect(tools.map((t) => t.name)).toEqual(["navigate"]);
  });

  it("watch mode offers NOTHING — a property of the code, not of the caller", () => {
    const tools = createClientTools([...CLIENT_TOOL_NAMES], {
      userId: USER, autonomy: "watch", emit: () => {},
    });
    expect(tools).toEqual([]);
  });

  it("a write tool asks for consent in assist mode; a ui tool does not", async () => {
    const events: ClientToolCallEvent[] = [];
    const tools = createClientTools(["start_recording", "navigate"], {
      userId: USER, autonomy: "assist", emit: (e) => events.push(e), timeoutMs: 50,
    });
    await tools.find((t) => t.name === "start_recording")!.run(CTX, {} as never);
    await tools.find((t) => t.name === "navigate")!.run(CTX, {} as never);
    const write = events.find((e) => e.tool === "start_recording")!;
    const ui = events.find((e) => e.tool === "navigate")!;
    expect(write.effect).toBe("write");
    expect(write.requires_consent).toBe(true);
    expect(ui.effect).toBe("ui");
    expect(ui.requires_consent).toBe(false);
  });

  it("the run suspends until the SURFACE answers, and resolves with its result", async () => {
    const events: ClientToolCallEvent[] = [];
    const tools = createClientTools(["navigate"], {
      userId: USER, autonomy: "assist", emit: (e) => events.push(e),
    });
    const running = tools[0]!.run(CTX, { path: "/echo/calls" } as never);
    const call = firstEmitted(events);
    expect(deliverClientToolResult(call.id, USER, { ok: true, detail: "navigated" })).toBe(true);
    await expect(running).resolves.toEqual({ performed: true, detail: "navigated" });
    expect(pendingClientCalls()).toBe(0);
  });

  it("someone ELSE cannot answer the call — and the refusal is indistinguishable from no-such-call", async () => {
    const events: ClientToolCallEvent[] = [];
    const tools = createClientTools(["navigate"], {
      userId: USER, autonomy: "assist", emit: (e) => events.push(e), timeoutMs: 100,
    });
    const running = tools[0]!.run(CTX, {} as never);
    const call = firstEmitted(events);
    expect(deliverClientToolResult(call.id, OTHER, { ok: true, detail: "hijack" })).toBe(false);
    expect(deliverClientToolResult("no-such-id", OTHER, { ok: true, detail: "x" })).toBe(false);
    // the rightful owner still resolves it
    expect(deliverClientToolResult(call.id, USER, { ok: false, detail: "declined" })).toBe(true);
    await expect(running).resolves.toEqual({ performed: false, detail: "declined" });
  });

  it("a surface that never answers is a LOUD forfeit, not a hang", async () => {
    const events: ClientToolCallEvent[] = [];
    const tools = createClientTools(["navigate"], {
      userId: USER, autonomy: "assist", emit: (e) => events.push(e), timeoutMs: 30,
    });
    const result = await tools[0]!.run(CTX, {} as never);
    expect(result).toEqual({ performed: false, detail: "the surface did not respond in time" });
    expect(pendingClientCalls()).toBe(0);
  });
});

describe("the registry", () => {
  it("contains NO data-destroying action — purge/erase are never the agent's to press", () => {
    // The absence half of an M33 clause, twice narrowed by user directive
    // (2026-08-21: "any button we have on platform, make it possible"):
    // delete_record is M11's SOFT delete (restorable 30 days) and
    // delete_conversation is an archive — both reversible, both consented
    // below Act, both role-walled server-side. What actually DESTROYS
    // (purge, erasure, tombstoning a person) stays out at every dial
    // setting — the line is reversibility, not the verb.
    const names = CLIENT_TOOLS.map((t) => t.name).join(" ");
    expect(names).not.toMatch(/purge|erase|tombstone/);
  });

  it("every table-action tool is write-effect — consent below Act", () => {
    for (const name of [
      "finish_recording", "set_member_status", "set_member_role",
      "rename_record", "set_record_scope", "archive_record", "unarchive_record",
      "delete_record", "restore_record", "delete_conversation", "add_speaker_person",
    ]) {
      const tool = CLIENT_TOOLS.find((t) => t.name === name);
      expect(tool, name).toBeDefined();
      expect(tool!.effect, name).toBe("write");
    }
  });

  it("labels carry BOTH languages — the chip reads in the asker's UI language", () => {
    for (const tool of CLIENT_TOOLS) {
      expect(tool.label.fa.length, tool.name).toBeGreaterThan(0);
      expect(tool.label.en.length, tool.name).toBeGreaterThan(0);
    }
  });

  it("every tool declares an effect the consent logic understands", () => {
    for (const tool of CLIENT_TOOLS) {
      expect(["ui", "write"]).toContain(tool.effect);
    }
  });

  it("stays under the ask route's advertisement cap — a cap below the registry silently drops tools", () => {
    /*
     * The cap is DERIVED from the registry now (M49) rather than typed as 32,
     * so this asserts the DERIVATION rather than a number that has to be kept
     * in step by hand. It fired once, correctly, when the registry grew past
     * the literal — and the honest fix for "a number somebody must remember to
     * raise" is to stop having one.
     */
    const route = readFileSync(
      join(process.cwd(), "src", "api", "server.ts"), "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, " ");
    expect(route, "the advertisement cap is a literal again").toContain(
      ".slice(0, CLIENT_TOOL_NAMES.length)",
    );
  });
});
