import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import fa from "./fa.json";
import en from "./en.json";

/**
 * EVERY TRIGGER A STARTER CAN CARRY HAS A NAME, IN BOTH LOCALES.
 *
 * User report, 2026-09-04, with the screenshot: the workflow library's filter
 * row read «پس از رونوشت» «پس از خلاصه» «دستی» — and then
 * `workflows.libraryKind_mail_received` and
 * `workflows.libraryKind_meeting_soon`, raw key paths sitting in a Persian
 * menu.
 *
 * The label is COMPUTED — `t(\`libraryKind_${trigger.replace(".", "_")}\`)` —
 * and that is the whole reason nothing caught it:
 *
 *   · `keys.test` scans for literal key strings and cannot see a computed one;
 *   · locale PARITY compares fa against en and passes when a key is missing
 *     from BOTH, which is exactly what happened.
 *
 * So the coverage list is derived from the PRODUCER, which is core's own
 * starter registry — the same rule the dashboard widget titles ended up under
 * after the identical bug. A starter added in core with a new trigger event
 * fails here, in a suite, rather than being found by a person reading their
 * own menu.
 *
 * `manual` is in the set and is not a `trigger_event` value: a starter with no
 * trigger is manual, and `null` becomes that string at the call site. Derived
 * lists have to include what the CODE derives, not only what the data holds.
 */
const AUTHORING = join(
  process.cwd(), "..", "core", "src", "api", "workflow-authoring.ts",
);

/** every distinct trigger a starter declares, plus the one `null` becomes */
function triggerKinds(): string[] {
  const source = readFileSync(AUTHORING, "utf8");
  const named = [...source.matchAll(/trigger_event:\s*"([a-z._]+)"/g)].map((m) => m[1]!);
  const hasManual = /trigger_event:\s*null/.test(source);
  return [...new Set([...named, ...(hasManual ? ["manual"] : [])])];
}

describe("the workflow library's filter names itself", () => {
  it("had something to check — the registry was actually read", () => {
    /* a moved file or a renamed field would make the sweep below scan nothing
       and report a clean tree forever, which is the vacuum this family of
       check keeps producing in this repo */
    const kinds = triggerKinds();
    expect(kinds.length, "no trigger events found — the parser is stale").toBeGreaterThan(2);
    expect(kinds).toContain("manual");
  });

  it("names every one of them in Persian AND English", () => {
    const missing: string[] = [];
    for (const kind of triggerKinds()) {
      const key = `libraryKind_${kind.replace(/\./g, "_")}`;
      const inFa = (fa.workflows as Record<string, unknown>)[key];
      const inEn = (en.workflows as Record<string, unknown>)[key];
      if (typeof inFa !== "string") missing.push(`fa: ${key}`);
      if (typeof inEn !== "string") missing.push(`en: ${key}`);
    }
    expect(
      missing,
      "a computed key with no entry renders as its own key path, in the menu",
    ).toEqual([]);
  });

  it("and no Persian entry is left in English", () => {
    /*
     * The other half, and the one Persian-first hides: a key present in both
     * files passes the check above even when the fa value is the English
     * sentence somebody pasted while adding it. Latin letters in a fa value
     * here are always a mistake — these are five short phrases, none of them a
     * product name.
     */
    const latin: string[] = [];
    for (const kind of triggerKinds()) {
      const key = `libraryKind_${kind.replace(/\./g, "_")}`;
      const value = (fa.workflows as Record<string, unknown>)[key];
      if (typeof value === "string" && /[A-Za-z]{3,}/.test(value)) latin.push(key);
    }
    expect(latin, "a Persian label that is still English").toEqual([]);
  });

  it("the control: the checks CAN fail", () => {
    /* proves both sweeps are able to answer no — without it a broken key
       derivation would report a clean menu forever */
    const key = `libraryKind_${"a.trigger.nobody.declared".replace(/\./g, "_")}`;
    expect((fa.workflows as Record<string, unknown>)[key]).toBeUndefined();
    expect(/[A-Za-z]{3,}/.test("After an email arrives")).toBe(true);
    expect(/[A-Za-z]{3,}/.test("پس از رسیدن ایمیل")).toBe(false);
  });
});
