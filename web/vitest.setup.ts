import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

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

type Messages = Record<string, Record<string, string>>;

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => {
    const table = (fa as Messages)[namespace] ?? {};
    const t = (key: string, values?: Record<string, string | number>) => {
      const raw = table[key];
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
