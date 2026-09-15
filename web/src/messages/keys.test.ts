import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import fa from "./fa.json";
import en from "./en.json";
/* the PRODUCER, imported rather than re-typed. Not published by core's
   package exports, so this is a relative path — the same arrangement the
   audit-copy test uses, and the swap-back condition is a real export. */
import { CAPABILITIES } from "../../../core/src/api/capabilities.ts";
import { WORKFLOW_PROPOSAL_KINDS } from "../../../core/src/api/vocabulary.ts";

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
  /*
   * THE WIDGET-TITLE CHECK IS GONE, and with it the import that stopped this
   * whole file from being collected (2026-09-08).
   *
   * It read `WIDGET_SPECS` from `@/lib/widgetRegistry` — a producer that is
   * not in the tree. The dashboard was parked on 2026-08-27 and there is no
   * component left that builds `t(`widget.${spec.labelKey}`)`, so the
   * assertion had no subject: `dashboard.widget.*` are eleven keys nothing
   * renders.
   *
   * Deleted rather than pointed at a hand-written list, for the reason the
   * comment it replaces gave in the first place — the coverage list must be
   * derived from the producer, and when the producer is gone the honest
   * move is to drop the check with it. What it cost meanwhile was the whole
   * file: an unresolvable import fails COLLECTION, so the four real
   * assertions here — key existence in both locales, parity, the capability
   * copy, the proposal copy — were not running at all while this looked
   * like one broken test.
   */

  /**
   * A LABEL AND A HINT FOR EVERY CAPABILITY CORE DECLARES (review F16).
   *
   * `CAPABILITIES` declares ten; the catalogues carried copy for eight.
   * `workflows.run` and `workflows.manage` shipped with none, so the Member
   * privileges screen rendered `management.privilege_workflows_run` as
   * literal text — on a security surface whose whole job is to say plainly
   * what a role may do.
   *
   * Three instruments missed it and each for a structural reason worth
   * keeping: the key scanner above SKIPS computed keys by design and these
   * are computed from the server's own capability key; locale parity is
   * SYMMETRIC and the keys were absent from both files, so the two agreed
   * perfectly; and `t()` on a miss renders the key path rather than
   * throwing, so the page rendered and the build stayed green.
   *
   * Derived from the producer, never hand-listed beside it — an eleventh
   * capability with no copy fails HERE rather than on somebody's screen.
   *
   * NOTE FOR VERIFYING THIS: delete a key from ONE locale and the parity test
   * catches it, which proves nothing about this check — parity is exactly why
   * the original four survived. Delete it from BOTH and only this test fails.
   */
  it("has a label and a hint for every capability core declares, in both locales", () => {
    /* the vacuum guard: an import that resolved to an empty array would make
       every assertion below pass over nothing */
    expect(CAPABILITIES.length, "capabilities declared by core").toBeGreaterThan(8);
    const missing = CAPABILITIES.flatMap((cap) => {
      const suffix = cap.key.replace(/\./g, "_");
      return [`privilege_${suffix}`, `privilegeHint_${suffix}`].flatMap((key) => [
        ...(lookup(fa as Messages, "management", key) === undefined
          ? [`fa: management.${key} (capability ${cap.key})`] : []),
        ...(lookup(en as Messages, "management", key) === undefined
          ? [`en: management.${key} (capability ${cap.key})`] : []),
      ]);
    });
    expect(missing).toEqual([]);
  });

  /**
   * THE SAME SHAPE, ONE PRODUCER OVER — and it is why F16 is not a
   * four-string finding.
   *
   * The run page renders `` t(`proposal_${proposal.proposal}`) `` in the
   * `workflows` namespace. `WORKFLOW_PROPOSAL_KINDS` has three members and
   * that namespace carried two, so a `draft_mail` proposal rendered its key
   * path as its label.
   *
   * Note the trap this one sets for a reader: a plain grep for
   * `proposal_draft_mail` RETURNS A HIT, because the `builder` namespace has
   * always had it. The question is never "does the string exist in the file"
   * — it is "does it exist in the namespace the component binds".
   */
  it("has a label for every workflow proposal kind, in the namespace the run page binds", () => {
    expect(WORKFLOW_PROPOSAL_KINDS.length, "proposal kinds declared by core").toBeGreaterThan(2);
    const missing = WORKFLOW_PROPOSAL_KINDS.flatMap((kind) => [
      ...(lookup(fa as Messages, "workflows", `proposal_${kind}`) === undefined
        ? [`fa: workflows.proposal_${kind}`] : []),
      ...(lookup(en as Messages, "workflows", `proposal_${kind}`) === undefined
        ? [`en: workflows.proposal_${kind}`] : []),
    ]);
    expect(missing).toEqual([]);
  });
});
