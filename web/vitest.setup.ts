import "@testing-library/jest-dom/vitest";
import { beforeEach, vi } from "vitest";

/**
 * THE ASSISTANT'S CONVERSATION IS MODULE STATE, ON PURPOSE.
 *
 * `lib/assistantSession` holds the thread and the running stream outside React
 * so a run survives the screen it started on — which is the whole point, and
 * which also means it survives a TEST. Left alone, one file's in-flight stream
 * writes into the next file's first assertion; `lib/liveConversation` already
 * documents that exact symptom ("expected 'sess-live-1' to be undefined" on an
 * ask that had not happened yet), and it was mocked away there rather than
 * closed.
 *
 * Central rather than per-file, for the same reason as the stub above: it bites
 * every test that renders either assistant surface, and a reset each author has
 * to rediscover is a tax paid repeatedly for one fact about the store. It
 * ABORTS anything running, which is what actually stops the late write.
 */
beforeEach(async () => {
  /*
   * IMPORTED HERE, NOT AT THE TOP, and the difference is not style.
   *
   * A static import in a setup file instantiates the module — and everything
   * it imports — BEFORE any test file's `vi.mock` is registered. The store
   * imports `@/api/client`, so the top-level version bound the REAL client
   * while the suite under test was driving a scripted mock: every ask went to
   * a fetch nobody had stubbed, and the symptom was `expected +0 to be 1` on
   * a call count, which reads as "the component did not ask" rather than "the
   * component asked the wrong module". A dynamic import inside the hook runs
   * after the mocks are in place and returns the same instance the test file
   * already loaded.
   */
  const { resetAssistantForTest } = await import("@/lib/assistantSession");
  resetAssistantForTest();
});

/**
 * jsdom has no `scrollIntoView`, and unstubbed it THROWS inside an effect —
 * which takes the whole render down and surfaces as "element not found".
 * That reads as a missing feature rather than a missing browser API, so the
 * next person debugs their component instead of their environment.
 *
 * Central rather than per-file: it bites every component test that scrolls,
 * and a stub each author has to rediscover is a tax paid repeatedly for one
 * fact about jsdom.
 */
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {
    /* no-op: jsdom does not lay out, so there is nothing to scroll */
  };
}

/**
 * next-intl reads a request-scoped config that doesn't exist under jsdom, so
 * components are tested against the REAL message files with the key path
 * returned verbatim when a key is missing.
 *
 * That last part is deliberate: a stub returning the key for everything would
 * make a test pass while the string was absent — the same "renders identically
 * to its absence" failure we keep finding in the product. Here a missing key
 * shows up as a literal `assistant.foo` in the assertion.
 */
import fa from "./src/messages/fa.json";

/**
 * `unknown` leaves, not `string`: next-intl namespaces may NEST, and
 * `settings.*` does (`group.configuration`, `section.general`, …). The narrower
 * type made the real `fa.json` uncastable the moment a nested namespace landed.
 */
type Messages = Record<string, Record<string, unknown>>;

/**
 * Resolve a dotted key path, returning a string or `undefined`.
 *
 * Nesting has to be walked rather than looked up flat, or `t("group.general")`
 * misses and reports itself as missing — which would be the harness lying in
 * the *safe* direction, but lying: the string is present and the test says it
 * isn't. Anything that resolves to a non-string is treated as a miss too, since
 * rendering `[object Object]` is not a pass.
 */
function resolve(table: Record<string, unknown>, key: string): string | undefined {
  const value = key.split(".").reduce<unknown>(
    (node, part) =>
      node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined,
    table,
  );
  return typeof value === "string" ? value : undefined;
}

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => {
    const table = (fa as Messages)[namespace] ?? {};
    const t = (key: string, values?: Record<string, string | number>) => {
      const raw = resolve(table, key);
      if (raw === undefined) return `${namespace}.${key}`;
      return values
        ? Object.entries(values).reduce(
            (out, [name, value]) => out.replace(`{${name}}`, String(value)),
            raw,
          )
        : raw;
    };
    /**
     * `t.raw` mirrors next-intl's: the message VALUE untouched, whatever its
     * type — it is how array-valued messages (starter questions) are read.
     * Without it here, the starters localizer's try/catch swallowed the
     * stub's TypeError and every test quietly exercised only the fallback:
     * a suite testing the code's absence while reporting on its presence.
     * Throws on a miss exactly as the real one does, so the fallback branch
     * is REACHED by a missing key, never by a missing stub method.
     */
    t.raw = (key: string): unknown => {
      const value = key.split(".").reduce<unknown>(
        (node, part) =>
          node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined,
        table,
      );
      if (value === undefined) throw new Error(`missing message: ${namespace}.${key}`);
      return value;
    };
    return t;
  },
  useLocale: () => "fa",
}));
