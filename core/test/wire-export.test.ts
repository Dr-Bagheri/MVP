/**
 * `@echo/core/wire` must stay TYPE-ONLY.
 *
 * The barrel re-exports shapes from modules that import `postgres` and
 * Fastify. That is safe only because `export type` is erased before any
 * module resolution happens — one `export {` without `type` and a browser
 * bundle starts pulling in a database driver, which fails somewhere far away
 * from this file and looks nothing like its cause.
 *
 * Asserted on the text because the defect IS the text: at runtime under
 * vitest the erasure has already happened, so a value export would import
 * cleanly here and break only in the consumer's build.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { CallPart, CallSummary, OrgRecord, AuditEntry, MemberRecord } from "../src/api/wire.ts";

const source = readFileSync(new URL("../src/api/wire.ts", import.meta.url), "utf8");

describe("the wire barrel is type-only", () => {
  it("has no value exports", () => {
    const exports = source.match(/^export\s+(?!type\b)/gm) ?? [];
    expect(exports, "every export must be `export type` — see this file's header").toEqual([]);
  });

  it("has no value imports either", () => {
    // A plain `import` for a side effect would be just as fatal, and easier
    // to add by accident when someone reaches for a helper.
    const imports = source.match(/^import\s+(?!type\b)/gm) ?? [];
    expect(imports).toEqual([]);
  });
});

describe("the published shapes still resolve", () => {
  it("names every field a consumer builds against", () => {
    /**
     * A compile-time assertion wearing a runtime test's clothes: if any of
     * these fields is renamed or removed, `tsc --noEmit` fails on THIS file.
     * The values are irrelevant — the point is that the names type-check.
     *
     * The three fields spelled out for CallPart are the three a consumer got
     * wrong by inventing them (`index`, `starts_at_seconds`,
     * `duration_seconds`), so this is where a rename should hurt.
     */
    const part: CallPart = {
      id: "p", idx: 0, offset_ms: 0, duration_ms: null, status: "pending",
      has_word_timestamps: false, missing: false, failure_reason: null,
      audio_format: null, byte_size: null,
    };
    expect(part.idx).toBe(0);

    // Assignability only — never constructed, so no fixture to drift.
    type Assert<T> = (value: T) => void;
    const summary: Assert<CallSummary> = () => {};
    const org: Assert<OrgRecord> = () => {};
    const entry: Assert<AuditEntry> = () => {};
    const member: Assert<MemberRecord> = () => {};
    expect([summary, org, entry, member].every((f) => typeof f === "function")).toBe(true);
  });
});
