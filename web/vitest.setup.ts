import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

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
    return t;
  },
  useLocale: () => "fa",
}));
