import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DOMAIN_TOOL_NAMES } from "../src/agent/domain-tools.ts";
import { filterDeclaredTools } from "../src/agent/policy.ts";

/**
 * THE SHIPPED AGENTS HOLD EVERYTHING THE ASSISTANT HOLDS.
 *
 * This file used to police a CEILING. An agent run was the ordinary assistant
 * run minus whatever its `tools` column left out, so the seed had to be kept
 * in step with the registry or an agent silently lost a capability its row
 * claimed to have. The instrument worked — and the thing it was guarding was
 * the defect.
 *
 * User report, 2026-09-04, with the screenshot: asked to create a task, Roya
 * answered "I do not have the access needed", and Echo then created it. The
 * run was holding the tool. `server.ts` was passing `allowedTools:
 * selectedAgent?.tools` and filtering it away underneath her, and a ceiling is
 * silent about what it keeps out — she could not report the real reason
 * because nothing told her there was one.
 *
 * THE RULING (2026-09-04): **full capability when a human is in the loop,
 * read-only when the reader is a model.** A person who asked Roya is reading
 * her answer and approving her writes — exactly Echo's situation, and there
 * was never a security argument for the difference, only history. A DELEGATE
 * is the other case and keeps its restriction (`delegation.ts`: no client
 * tools, no write tools, because its output is consumed by another model).
 *
 * So the assertions inverted. What is checked now is that NOTHING narrows a
 * directly-asked agent, and that the stored list — which is now a prompt hint,
 * "reach for these first" — names tools that exist. A hint pointing at a
 * retired tool is a different bug from a wall, and still worth catching.
 *
 * It reads source and migration text rather than the database, deliberately:
 * this runs in the ordinary suite with no connection, and the thing asserted
 * is what a fresh deployment gets.
 */
const MIGRATIONS = join(process.cwd(), "..", "db", "migrations");

/** the newest migration that sets `tools` on the system agents */
function seededTools(): string[] {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  for (const file of [...files].reverse()) {
    const text = readFileSync(join(MIGRATIONS, file), "utf8");
    /* the write must be the one that TARGETS the system pair — an unrelated
       migration mentioning the column would otherwise be read as the seed */
    if (!/tools\s*=\s*'\[/.test(text) || !/level\s*=\s*'system'/.test(text)) continue;
    const match = /tools\s*=\s*'(\[[^']*\])'/.exec(text);
    if (!match) continue;
    return JSON.parse(match[1]!.replace(/\s+/g, " ")) as string[];
  }
  throw new Error("no migration seeds the system agents' tools — the parser is stale");
}

describe("what the shipped agents can reach", () => {
  it("had something to read — the vacuity guard", () => {
    /* a parser that found nothing would make every set-comparison below
       trivially true, which is the failure this family of checks keeps
       finding in itself */
    expect(seededTools().length).toBeGreaterThan(3);
    expect(DOMAIN_TOOL_NAMES.length).toBeGreaterThan(3);
  });

  it("NOTHING narrows a directly-asked agent", () => {
    /*
     * The defect itself, pinned at the site it lived. A source check and not a
     * behavioural one because the bug was a single argument at a call site —
     * "the string IS the defect", the same reasoning that pins the jsonb cast
     * in db/jsonb.ts. A runtime test would have to stand up the whole ask
     * route to observe one property of one option.
     *
     * What it forbids is narrow and exact: handing the ask route the selected
     * agent's stored tools as `allowedTools`. A SKILL may still narrow a run —
     * that is a per-task instruction somebody chose for this turn, not a
     * standing wall around an agent — so `combinedAllowedTools` is untouched.
     */
    /*
     * COMMENTS STRIPPED FIRST, and the reason is this test's own first run:
     * it went red against the fixed code, because the comment at the call site
     * QUOTES the line it replaced — "It used to be `allowedTools:
     * selectedAgent?.tools`". The name matched itself, inside the sentence
     * explaining why the name should not be there.
     *
     * That is the third time this repo has paid for a name-grep matching prose
     * (the truncated column, the model-wall checker), and the second time the
     * prose was a comment written by the same hands as the check. A source pin
     * has to read CODE, or it is reading a description of code.
     */
    const route = codeOnly(
      readFileSync(join(process.cwd(), "src", "api", "server.ts"), "utf8"),
    );
    expect(
      /allowedTools:\s*selectedAgent/.test(route),
      "the agent's stored tools are a ceiling again — see the ruling above",
    ).toBe(false);

    /* and the ask route still passes the option at all: deleting the line
       entirely would satisfy the assertion above while changing behaviour in a
       way nobody meant */
    expect(/allowedTools:\s*undefined/.test(route)).toBe(true);
  });

  it("and `undefined` really does mean no ceiling", () => {
    /*
     * The half a source pin cannot see. `allowedTools: undefined` is only the
     * fix if the runtime reads it as "everything" — if it read it as "nothing"
     * the line above would pass while Roya lost every tool she had.
     */
    const tools = [{ name: "a" }, { name: "b" }] as never[];
    expect(filterDeclaredTools(tools, undefined)).toHaveLength(2);
    /* the control: it CAN narrow, so the assertion above is about `undefined`
       and not about a filter that never filters */
    expect(filterDeclaredTools(tools, ["a"])).toHaveLength(1);
  });

  it("names no tool that does not exist", () => {
    /* The stored list is a PROMPT HINT now — "you are built around these,
       reach for them first" — so a retired name no longer costs a capability.
       It costs something quieter: an agent told to reach for a tool that is
       not there, which it discovers by trying. Still worth catching. */
    const implemented = new Set(implementedToolNames());
    const invented = seededTools().filter((name) => !implemented.has(name));
    expect(invented, "seeded tool names with no implementation").toEqual([]);
  });

  it("the check can fail — the control", () => {
    /* staged: a seed naming something that does not exist. Without this the
       comparison above passes identically against a parser returning the same
       thing for both sides. */
    const implemented = new Set(implementedToolNames());
    expect(["read_window", "a_tool_nobody_wrote"].filter((n) => !implemented.has(n)))
      .toEqual(["a_tool_nobody_wrote"]);
  });
});

/**
 * The names `createDomainTools()` actually registers, read from its source.
 *
 * Calling the factory would need `pi` mocked (a top-level `Type.Object()` call
 * makes importing it eagerly expensive — domain-tools.test.ts mocks it for
 * exactly this reason), and the thing being asserted is a list of names. The
 * `name:` fields in that file are the list.
 */
function implementedToolNames(): string[] {
  const source = readFileSync(
    join(process.cwd(), "src", "agent", "domain-tools.ts"), "utf8",
  );
  const body = source.slice(source.indexOf("export function createDomainTools"));
  const names = [...body.matchAll(/^\s{4}name: "([a-z_]+)",$/gm)].map((m) => m[1]!);
  expect(names.length, "the source scan found tool names").toBeGreaterThan(3);
  return names;
}

/** Comments removed, so a source pin reads code and not a sentence about it. */
function codeOnly(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}
