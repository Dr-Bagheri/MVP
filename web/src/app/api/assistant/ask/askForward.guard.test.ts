import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * EVERY FIELD THIS ROUTE ACCEPTS, IT FORWARDS.
 *
 * This file exists because the seam broke once and the route's own comment
 * records it: `client_tools` and `context` were added to the wire, both ends
 * were correct, and this handler — a hand-written allow-list in the middle —
 * did not learn them. The user's report was "I don't have the ability to
 * navigate"; core never saw the tools the browser had advertised, and nothing
 * anywhere was red, because a BFF that drops a key returns a perfectly good
 * stream of a slightly worse answer.
 *
 * Declaring a field and forwarding it are two edits in one file, and the
 * second is the forgettable one — it is further down, it looks like
 * boilerplate, and omitting it produces no error of any kind. So this asserts
 * they come in pairs.
 *
 * It reads the SOURCE rather than calling the handler, deliberately: invoking
 * it would need a fake for `coreStream`, the session and the stream, and the
 * thing under test is one list matching another. A source scan is the right
 * altitude for a claim about two literals in one file.
 */
const SOURCE = readFileSync(join(process.cwd(), "src/app/api/assistant/ask/route.ts"), "utf8");

/** the keys in `const body = (await request.json()) as { … }` */
function declaredKeys(source: string): string[] {
  const start = source.indexOf("const body = (await request.json()) as {");
  expect(start, "the body type is where this file expects it").toBeGreaterThan(-1);
  const end = source.indexOf("  };", start);
  expect(end, "the body type block is closed").toBeGreaterThan(start);
  return [...source.slice(start, end).matchAll(/^ {4}(\w+)\??:/gm)].map((m) => m[1]!);
}

/** the keys in the object handed to `coreStream(...)` */
function forwardedKeys(source: string): string[] {
  const start = source.indexOf('coreStream("/v1/assistant/ask", {');
  expect(start, "the forward call is where this file expects it").toBeGreaterThan(-1);
  const end = source.indexOf("    });", start);
  expect(end, "the forward call is closed").toBeGreaterThan(start);
  return [...source.slice(start, end).matchAll(/^ {6}(\w+):/gm)].map((m) => m[1]!);
}

describe("the assistant ask BFF forwards what it accepts", () => {
  it("had something to check", () => {
    /* the vacuity guard: two empty lists match perfectly, and a refactor that
       renamed either construct would make this file agree with itself about
       nothing at all */
    expect(declaredKeys(SOURCE).length).toBeGreaterThan(10);
    expect(forwardedKeys(SOURCE).length).toBeGreaterThan(10);
  });

  it("forwards every declared field", () => {
    const forwarded = new Set(forwardedKeys(SOURCE));
    const dropped = declaredKeys(SOURCE).filter((key) => !forwarded.has(key));
    expect(dropped, "declared on this route and never sent to core").toEqual([]);
  });

  it("forwards nothing it does not accept", () => {
    /* the other direction, and not symmetry for its own sake: a key forwarded
       but not declared is one the TYPE does not describe, so nothing checks
       its shape and a client can put anything in it */
    const declared = new Set(declaredKeys(SOURCE));
    const invented = forwardedKeys(SOURCE).filter((key) => !declared.has(key));
    expect(invented, "sent to core but not declared on the body type").toEqual([]);
  });

  it("the check can fail — the control", () => {
    /*
     * A staged drop, proving the two scans read the real constructs rather
     * than agreeing about nothing.
     *
     * The regex tolerates either line ending on purpose. The first version of
     * this control staged its break with a "\n" string literal, the file it
     * reads is CRLF on Windows, and `String.replace` says nothing at all when
     * it matches nothing — so the "broken" source was the intact one and the
     * staged failure never happened. It was caught only by the assertion
     * below, which is exactly why a control checks that it changed something
     * before it checks what changed.
     */
    const broken = SOURCE.replace(/ +live_text: body\.live_text,\r?\n/, "");
    expect(broken, "the staged edit changed something").not.toBe(SOURCE);
    const forwarded = new Set(forwardedKeys(broken));
    expect(declaredKeys(broken).filter((key) => !forwarded.has(key))).toEqual(["live_text"]);
  });
});
