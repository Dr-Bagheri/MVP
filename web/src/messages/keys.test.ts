import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import fa from "./fa.json";
import en from "./en.json";

/**
 * **Every translation key a component asks for must exist in BOTH locales.**
 *
 * A missing key does not crash. next-intl renders the key path, so
 * `settings.orgTitle` appears on screen looking like a variable name someone
 * forgot to fill in — visible to a user, invisible to a typecheck, and
 * invisible to anyone testing in the other locale.
 *
 * The failure is asymmetric and that is what makes it worth a test: this
 * project is Persian-first, so a key added to `fa.json` and forgotten in
 * `en.json` renders perfectly for everyone who builds it and breaks only for
 * the reviewer who switches locale. Several namespaces here were added by
 * script; "I added it to both" is exactly the claim that reads as true.
 *
 * Scanning caveat, stated because a checker that cries wolf gets muted:
 * only literal `t("…")` calls are collected. Computed keys (`t(EVENT_LABEL[e])`,
 * `t(\`tile.${k}\`)`) are skipped deliberately — evaluating them would test
 * this regex rather than the app, and a false "missing key" is worse than an
 * uncovered one.
 */

type Messages = Record<string, unknown>;

/** Resolve a dotted path to a string, or undefined. Namespaces may nest. */
function lookup(table: Messages, ns: string, key: string): string | undefined {
  const value = `${ns}.${key}`
    .split(".")
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined,
      table,
    );
  return typeof value === "string" ? value : undefined;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

interface Usage {
  ns: string;
  key: string;
  file: string;
}

/**
 * `useTranslations("ns")` binds a namespace to a variable; every literal call
 * on that variable is a key in it. Files may bind several (`t`, `tAdmin`, …),
 * so the binding name is tracked rather than assumed to be `t`.
 */
function usages(): Usage[] {
  const found: Usage[] = [];
  const SRC = join(process.cwd(), "src");
  for (const file of walk(SRC)) {
    if (!/\.tsx?$/.test(file) || /\.test\.tsx?$/.test(file)) continue;
    const text = readFileSync(file, "utf8");
    const bindings = new Map<string, string>();
    for (const m of text.matchAll(/const\s+(\w+)\s*=\s*useTranslations\(\s*["'](\w+)["']\s*\)/g)) {
      bindings.set(m[1]!, m[2]!);
    }
    if (bindings.size === 0) continue;
    for (const [binding, ns] of bindings) {
      const call = new RegExp(`\\b${binding}\\(\\s*["']([A-Za-z0-9_.\\-]+)["']`, "g");
      for (const m of text.matchAll(call)) {
        found.push({ ns, key: m[1]!, file: file.slice(SRC.length + 1) });
      }
    }
  }
  return found;
}

describe("translation keys", () => {
  const used = usages();

  /*
   * Guards. Without these the suite passes by scanning nothing — the empty
   * audit that scores a perfect result because it had no subject.
   */
  it("finds translation calls to check", () => {
    expect(used.length).toBeGreaterThan(50);
  });

  it("covers more than one namespace", () => {
    expect(new Set(used.map((u) => u.ns)).size).toBeGreaterThan(3);
  });

  it("has every referenced key in fa.json", () => {
    const missing = used
      .filter((u) => lookup(fa as Messages, u.ns, u.key) === undefined)
      .map((u) => `${u.ns}.${u.key}  ← ${u.file}`);
    expect([...new Set(missing)]).toEqual([]);
  });

  it("has every referenced key in en.json", () => {
    const missing = used
      .filter((u) => lookup(en as Messages, u.ns, u.key) === undefined)
      .map((u) => `${u.ns}.${u.key}  ← ${u.file}`);
    expect([...new Set(missing)]).toEqual([]);
  });

  /**
   * Structural parity, independent of what any component happens to reference.
   * A key present in one locale and absent in the other is a bug even if
   * nothing uses it yet — it will be used, by someone building in the locale
   * where it works.
   */
  it("has identical key sets in both locales", () => {
    const flatten = (obj: Messages, prefix = ""): string[] =>
      Object.entries(obj).flatMap(([k, v]) =>
        v && typeof v === "object"
          ? flatten(v as Messages, `${prefix}${k}.`)
          : [`${prefix}${k}`],
      );
    const faKeys = flatten(fa as Messages).sort();
    const enKeys = flatten(en as Messages).sort();
    expect(faKeys.filter((k) => !enKeys.includes(k))).toEqual([]);
    expect(enKeys.filter((k) => !faKeys.includes(k))).toEqual([]);
  });
});
