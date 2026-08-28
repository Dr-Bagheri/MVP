import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import en from "../messages/en.json";
import fa from "../messages/fa.json";
import { STARTER_WORKFLOWS } from "../../../core/src/api/workflow-authoring.ts";
import { SEEDED_STARTERS, useWorkflowCopy } from "./workflowName";

/**
 * The shipped-starter half of the mixing bug (user report, with a screenshot:
 * the English `/workflows` list read «برچسب‌گذاری خودکار جلسه» and
 * «پیگیری جلسه‌ها»).
 *
 * Two things are proven here, and the first is the one that rots:
 *
 * 1. `SEEDED_STARTERS` still matches the PRODUCER. The mirror exists because
 *    `workflow-authoring.ts` cannot go in the client bundle, and a mirror
 *    nothing checks is exactly the drift shape this repo keeps finding — so
 *    the real module is imported here, in Node, and compared literal for
 *    literal. Rename a starter in core without touching the catalogue and this
 *    goes red, instead of the row silently falling back to Persian on the
 *    English UI.
 *
 * 2. The rename discriminator behaves in both directions, in both locales,
 *    with the negative half asserted every time: "the English is present" and
 *    "both are present" are the same green, and the complaint is about MIXING.
 */

let locale: "en" | "fa" = "en";
const catalogue = { en, fa } as unknown as Record<string, Record<string, Record<string, unknown>>>;

vi.mock("next-intl", () => {
  const walk = (root: Record<string, unknown>, key: string): unknown =>
    key.split(".").reduce<unknown>(
      (node, part) =>
        node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined,
      root,
    );
  return {
    useTranslations: (namespace: string) => {
      const table = () => catalogue[locale]?.[namespace] ?? {};
      const t = (key: string) => {
        const value = walk(table(), key);
        return typeof value === "string" ? value : `${namespace}.${key}`;
      };
      t.raw = (key: string): unknown => {
        const value = walk(table(), key);
        if (value === undefined) throw new Error(`missing message: ${namespace}.${key}`);
        return value;
      };
      return t;
    },
    useLocale: () => locale,
  };
});

function copyOf(
  as: "en" | "fa",
  workflow: { handle: string; name: string; description?: string | null },
) {
  locale = as;
  const { result } = renderHook(() => useWorkflowCopy());
  return result.current(workflow);
}

describe("SEEDED_STARTERS mirrors core's STARTER_WORKFLOWS", () => {
  it("every shipped starter's handle, name and description match the producer exactly", () => {
    const fromCore = Object.fromEntries(
      Object.values(STARTER_WORKFLOWS).map((starter) => [
        starter.handle,
        { name: starter.name, description: starter.description },
      ]),
    );
    /* whole-object equality in both directions at once: an entry we invented
       and a starter core added are both failures, and a per-key loop over our
       OWN list could only ever check the ones we already knew about */
    expect(SEEDED_STARTERS).toEqual(fromCore);
  });

  it("every seeded handle has copy in BOTH locales", () => {
    for (const handle of Object.keys(SEEDED_STARTERS)) {
      for (const table of [en, fa]) {
        const entry = (table.workflows as unknown as {
          starter?: Record<string, { name?: string; description?: string }>;
        }).starter?.[handle];
        expect(typeof entry?.name, `${handle} name`).toBe("string");
        expect(typeof entry?.description, `${handle} description`).toBe("string");
      }
    }
  });
});

describe("useWorkflowCopy — shipped copy localizes, a person's words never do", () => {
  const seeded = STARTER_WORKFLOWS.autotag;
  const EN = (en.workflows as unknown as {
    starter: Record<string, { name: string; description: string }>;
  }).starter[seeded.handle]!;

  it("en: an untouched starter renders in English, and the seeded Persian is ABSENT", () => {
    const copy = copyOf("en", {
      handle: seeded.handle, name: seeded.name, description: seeded.description,
    });
    expect(copy.name).toBe(EN.name);
    expect(copy.description).toBe(EN.description);
    // the discriminating half — the reported bug is the Persian coming through
    expect(copy.name).not.toBe(seeded.name);
    expect(copy.description).not.toBe(seeded.description);
  });

  it("fa: the control — the same row renders the seeded Persian", () => {
    const copy = copyOf("fa", {
      handle: seeded.handle, name: seeded.name, description: seeded.description,
    });
    expect(copy.name).toBe(seeded.name);
    expect(copy.description).toBe(seeded.description);
  });

  it("en: a RENAMED starter keeps the person's name — theirs is never translated", () => {
    const copy = copyOf("en", {
      handle: seeded.handle, name: "برچسب‌های ما", description: seeded.description,
    });
    expect(copy.name).toBe("برچسب‌های ما");
    // and the untouched description is still ours, so it still localizes:
    // name and description are separately editable and gate separately
    expect(copy.description).toBe(EN.description);
  });

  it("en: an org-authored workflow (no shipped handle) renders exactly as authored", () => {
    const copy = copyOf("en", {
      handle: "wf-a1b2c3d4", name: "گردش‌کار ما", description: "توضیح ما",
    });
    expect(copy).toEqual({ name: "گردش‌کار ما", description: "توضیح ما" });
  });

  it("a missing description is a string, not undefined — callers render it directly", () => {
    expect(copyOf("en", { handle: "wf-x", name: "n" }).description).toBe("");
  });
});
