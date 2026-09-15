import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import fa from "@/messages/fa.json";
import { NAV_PRIMARY, NAV_UTILITY } from "./nav";
import { TRAIL } from "./trail";

/* the WHOLE rail, both halves — the utility entries at its foot are named
   the same way and are just as visible */
const NAV = [...NAV_PRIMARY, ...NAV_UTILITY];

/**
 * EVERY RAIL ENTRY HAS A NAME, IN BOTH LOCALES.
 *
 * The rail and the bottom bar build their label as `t(nav.key)` — a COMPUTED
 * key, which `messages/keys.test.ts` skips by design and says so in its own
 * header. That exemption is not a small one: a missing entry does not crash,
 * next-intl renders the key path, and the control shows the literal word
 * `home` as its label, its `title` and its `aria-label`.
 *
 * Which is exactly what shipped (2026-09-08). `/` became
 * Home when the landing page stopped being the dashboard; `platform.home` was
 * never written, so the FIRST entry in the rail — the one every reader meets
 * first — was named by its own key, in both locales, with every existing
 * check green.
 *
 * So the coverage list is DERIVED FROM THE PRODUCER (rule 13½: a guard's
 * coverage list is itself a seam). `NAV` is the list; adding an entry without
 * its copy fails here rather than rendering a variable name at somebody.
 *
 * THE TRAIL IS THE SAME SEAM one layer over: its labels are dotted paths
 * resolved at render time, so a root pointing at a key nobody wrote — or at
 * a key that USED to exist, which is the shape this one had — is invisible
 * until a person reads the address bar.
 */
type Messages = Record<string, unknown>;

function lookup(table: Messages, path: string): string | undefined {
  const value = path.split(".").reduce<unknown>(
    (node, part) => (node && typeof node === "object"
      ? (node as Record<string, unknown>)[part]
      : undefined),
    table,
  );
  return typeof value === "string" ? value : undefined;
}

describe("every navigable place has a name", () => {
  it("the rail names each of its own entries, in both catalogues", () => {
    const missing = NAV.flatMap((nav) => [
      ...(lookup(en as Messages, `platform.${nav.key}`) === undefined
        ? [`en: platform.${nav.key}`] : []),
      ...(lookup(fa as Messages, `platform.${nav.key}`) === undefined
        ? [`fa: platform.${nav.key}`] : []),
    ]);
    expect(missing, "a rail entry with no copy renders its own key").toEqual([]);
  });

  it("the check can fail — a coverage list matching nothing covers nothing", () => {
    /* the negative control (rule 12): without it, a `NAV` that stopped
       exporting entries, or a `lookup` that answered a string for every
       path, would leave the assertion above green forever */
    expect(NAV.length).toBeGreaterThan(3);
    expect(lookup(en as Messages, "platform.thisKeyDoesNotExist")).toBeUndefined();
  });

  it("every trail label resolves in both catalogues", () => {
    const missing = Object.entries(TRAIL).flatMap(([route, entry]) => {
      const label = (entry as { label?: string }).label;
      if (label === undefined) return [];
      return [
        ...(lookup(en as Messages, label) === undefined ? [`en: ${label} ← ${route}`] : []),
        ...(lookup(fa as Messages, label) === undefined ? [`fa: ${label} ← ${route}`] : []),
      ];
    });
    expect(missing, "a crumb pointing at a key nobody wrote").toEqual([]);
  });

  it("the root crumb and the rail's first entry are ONE name", () => {
    /*
     * The defect this file was written for was not only a missing key: the
     * trail said «داشبورد» and the rail said `home` about the SAME page. Two
     * names for one room is the drift, and a key existing in both places
     * would satisfy every assertion above while still saying two things.
     */
    const root = (TRAIL["/"] as { label?: string } | undefined)?.label;
    const first = NAV[0];
    expect(first?.href).toBe("/");
    expect(root).toBe(`platform.${first?.key}`);
  });
});
