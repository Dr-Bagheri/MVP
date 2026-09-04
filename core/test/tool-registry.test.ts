import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

/*
 * The real `Type`, spread in from pi-ai: platform-tools builds its schemas at
 * module load, and a stubbed `Type` takes the file down before a test runs.
 */
vi.mock("../src/agent/pi.ts", async () => ({
  ...await import("@earendil-works/pi-ai"),
  runPi: vi.fn(),
}));

const { toolsFor } = await import("../src/agent/platform-tools.ts");
const { DOMAIN_TOOL_NAMES } = await import("../src/agent/domain-tools.ts");

/**
 * EVERY TOOL THAT EXISTS IS OFFERED TO SOMEBODY.
 *
 * The fourth instrument in the 13½ family (granted-vs-called, routes, tables,
 * queue handlers), and it exists because this repo has now shipped the same
 * defect twice at feature scale:
 *
 *   · the webhook dispatcher — written, line-reviewed, given an SSRF guard and
 *     a replay-protected signing scheme, and never registered as a handler.
 *     `total_messages = 0` over its entire life.
 *   · `platform-tools.ts` — SEVENTEEN read tools, tested, with a header saying
 *     "Echo carries EVERYTHING", and `createPlatformTools()` had two callers,
 *     both inside `delegation.ts`. Echo never had one of them. The only way to
 *     reach a single one was for Echo to ask Roya or Ava, which is exactly the
 *     behaviour the user asked to stop.
 *
 * Neither was findable by reading the file that had the bug. Both files were
 * correct; the wiring was absent, and absence has no line to review.
 *
 * The corpus is `api/server.ts`'s default toolset — the one thing every
 * assistant run and every directly-asked agent is built from. A tool that is
 * not in it is offered to nobody, whatever its own file says.
 */
const SERVER = readFileSync(join(process.cwd(), "src", "api", "server.ts"), "utf8");

/** the source scanned for factory calls, with comments removed so prose about
    a factory is not read as a call to it (the name-matching-itself trap, which
    this repo has now paid for three times) */
function codeOnly(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

describe("every tool the platform implements is offered by the platform", () => {
  it("had something to check — the factories are real and non-empty", () => {
    /* a renamed export or a factory returning [] would make every assertion
       below vacuous, which is the failure this whole family keeps finding in
       itself */
    expect(toolsFor("all").length).toBeGreaterThan(10);
    expect(DOMAIN_TOOL_NAMES.length).toBeGreaterThan(3);
  });

  it("the ask route builds its toolset from the platform reads, not only the domain ones", () => {
    /*
     * The defect, pinned where it lived. `toolsFor("all")` must appear in the
     * server's default toolset — the branch taken when a caller passes no
     * tools, which is every real deployment (`api/main.ts` omits the option).
     *
     * Asserted on the CALL and not on the import: an import that nothing calls
     * is precisely the shape that shipped, and it would satisfy a check
     * looking for the module name.
     */
    const code = codeOnly(SERVER);
    const start = code.indexOf("const domainTools = options.tools === undefined");
    expect(start, "the default-toolset branch has moved — this check is stale").toBeGreaterThan(0);
    const branch = code.slice(start, start + 400);
    expect(branch).toContain("createDomainTools()");
    expect(branch).toContain("createWriteTools()");
    expect(branch, "the platform reads are not in the default toolset").toContain("toolsFor(");
  });

  it("names every platform tool in the agent vocabulary, so an agent may declare one", () => {
    /*
     * `availableTools()` is what POST/PATCH /v1/agents validates a stored tool
     * list against. It was the seven domain+write names, so an organisation
     * could not author an agent that declares `list_meetings` — while db/0168
     * wrote `list_members` straight into both shipped rows, which that
     * validator would have rejected.
     *
     * A vocabulary narrower than the implementation is the same seam one layer
     * up: the tool exists, the run offers it, and the form refuses to say its
     * name.
     */
    const skills = codeOnly(
      readFileSync(join(process.cwd(), "src", "api", "skills.ts"), "utf8"),
    );
    expect(skills, "availableTools() does not know the platform tools").toMatch(
      /availableTools[\s\S]{0,400}toolsFor|PLATFORM_TOOL_NAMES/,
    );
  });

  it("the control: the branch scan CAN answer no", () => {
    /*
     * Proves the assertion above is about the server's text and not about a
     * matcher that returns true for everything — the version of this check
     * that cannot fail is the one this family keeps producing.
     */
    const staged = "const domainTools = options.tools === undefined\n"
      + "  ? [...createDomainTools()]\n  : options.tools;";
    expect(staged.includes("toolsFor(")).toBe(false);
  });
});
