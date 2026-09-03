import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A SURFACE THAT ADVERTISES CLIENT TOOLS MUST PERFORM THEM.
 *
 * This seam has now broken twice, in opposite halves, and both times it looked
 * fine from either side:
 *
 *   · 2026-08-21 — the tools were advertised by the voice orb ALONE, so a
 *     typed ask reached a model that had been told about no client tools at
 *     all. "I don't have the ability to navigate," said the assistant, about
 *     an ability it had.
 *   · 2026-09-03 — the assistant PAGE advertised them and had no handler. The
 *     model called `start_recording`, the browser dropped the event, and the
 *     server sat waiting for an answer that never came until the 120-second
 *     timeout. On screen: "در حال فکر کردن…", forever.
 *
 * The second one is the reason for this file. The FIRST fix taught the page to
 * advertise and stopped there — half a seam closed reads exactly like a whole
 * one, and there was nothing anywhere that could tell the difference.
 *
 * So: the two halves are asserted as a PAIR. Advertising is
 * `clientTools: [...SURFACE_TOOLS]` in an ask; performing is reaching
 * `handleClientToolCall`. A file that does one and not the other is the bug,
 * whichever half is missing.
 */
const SRC = join(process.cwd(), "src");

const SURFACES = [
  "components/platform/AssistantSidebar.tsx",
  "components/platform/Hub.tsx",
];

function read(file: string): string {
  return readFileSync(join(SRC, file), "utf8");
}

describe("the client-tool seam, on every surface", () => {
  it("had something to check", () => {
    /* a renamed file would make every assertion below vacuous, and this is the
       family of check that has been vacuous before */
    for (const file of SURFACES) {
      expect(read(file).length, file).toBeGreaterThan(1000);
    }
  });

  it("every surface that ADVERTISES the tools also PERFORMS them", () => {
    const broken: string[] = [];
    for (const file of SURFACES) {
      const text = read(file);
      const advertises = /clientTools:\s*\[\.\.\.SURFACE_TOOLS\]/.test(text);
      const performs = /handleClientToolCall\(/.test(text);
      if (advertises !== performs) {
        broken.push(`${file}: advertises=${advertises} performs=${performs}`);
      }
    }
    expect(broken, "advertising and performing must come in pairs").toEqual([]);
  });

  it("and they perform through the SHARED runner, not a copy", () => {
    /*
     * The sidebar had the only handler for months and the page had none; the
     * obvious fix was to paste it. A second copy is where the two answers
     * start to differ — one of them forgets the refusal path, or the
     * exception path, and the surface that forgets is the one nobody is
     * looking at.
     */
    for (const file of SURFACES) {
      const text = read(file);
      if (!/handleClientToolCall\(/.test(text)) continue;
      expect(
        /from "@\/lib\/clientToolRunner"/.test(text),
        `${file} performs client tools without the shared runner`,
      ).toBe(true);
      expect(
        /executeClientTool\(/.test(text),
        `${file} calls executeClientTool directly — that is the runner's job`,
      ).toBe(false);
    }
  });

  it("the runner answers the server on EVERY path — including the throw", () => {
    /*
     * The property that makes the hang impossible rather than unlikely. The
     * server is blocked on this reply, so a path that returns without sending
     * it is the original bug wearing a different cause — and "I returned
     * early" is the easiest way to write that by accident.
     *
     * Asserted on the source because the alternative is faking a throwing
     * executor, an SSE event and the api client to observe one call: the
     * structure IS the guarantee here, and the structure is what this reads.
     */
    const runner = readFileSync(join(SRC, "lib/clientToolRunner.ts"), "utf8");
    expect(runner).toContain("finally");
    expect(runner).toContain("catch");
    /* one place that sends, so there is one thing to be sure of */
    expect(runner.match(/deliverToolResult\(/g) ?? []).toHaveLength(1);
  });

  it("the control: a staged half-seam is detected", () => {
    /*
     * Proves the pair check can fail. Without it the whole file passes against
     * a regex that stopped matching — which is exactly how the first version
     * of a check like this reports "all clear" about a codebase it can no
     * longer see.
     */
    const staged = read("components/platform/Hub.tsx")
      .replace(/handleClientToolCall\(/g, "somethingElse(");
    const advertises = /clientTools:\s*\[\.\.\.SURFACE_TOOLS\]/.test(staged);
    const performs = /handleClientToolCall\(/.test(staged);
    expect(advertises).toBe(true);
    expect(performs).toBe(false);
    expect(advertises === performs, "the staged half-seam reads as broken").toBe(false);
  });
});
