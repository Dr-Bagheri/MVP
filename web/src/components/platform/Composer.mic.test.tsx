import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { OrgPersonRecord } from "@/api/types";
import { micTone } from "@/lib/dictation";

/**
 * THE MIC'S ACTIVE STATE (user report, 2026-09-05: "the mic in the chat does
 * not show when it is active — make the 3 of them the same way").
 *
 * The room's mic wrote `text-danger` NEXT TO the `text-fg-subtle` its base
 * class already carried, and two utilities setting the same property are
 * resolved by their order in the STYLESHEET rather than in the string. So the
 * class was present, a reviewer could see it, a grep could find it, and the
 * glyph never changed colour — the CSS-layer failure this repo keeps meeting,
 * where the artifact reads as satisfied and only the computed value disagrees.
 *
 * Which is why the assertions below are about the CLASS SET the component
 * actually renders, and why the base class is asserted NOT to carry a colour
 * of its own: a test that only checked "the accent class is somewhere in the
 * string" would have passed against the broken version.
 */
vi.mock("@/i18n/routing", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  Link: ({ href, children }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"}>{children}</a>
  ),
}));
vi.mock("@/lib/usePushToTalk", () => ({ usePushToTalk: () => undefined }));

let STATUS: "idle" | "listening" = "idle";
vi.mock("@/lib/dictation", async () => {
  /* the REAL `micTone` — mocking it would make this a test of the fake.
     Only the hook is replaced, because a browser speech engine is the one
     thing jsdom cannot supply. */
  const real = await vi.importActual<typeof import("@/lib/dictation")>("@/lib/dictation");
  return {
    ...real,
    useDictation: () => ({ status: STATUS, toggle: vi.fn(), supported: true }),
  };
});

import { Composer } from "./chat/Composer";

const PEOPLE: OrgPersonRecord[] = [
  { id: "u-1", display_name: "سینا", display_name_en: null, role: "owner", username: "sina" },
];

function mic(): HTMLElement {
  return screen.getByRole("button", { name: "گفتن با میکروفون" });
}

describe("the room's mic shows that it is listening", () => {
  it("wears the accent while listening and nothing while idle", () => {
    STATUS = "listening";
    render(
      <Composer disabled={false} people={PEOPLE} replyTo={null}
        onCancelReply={() => undefined} onSend={() => undefined} />,
    );
    const on = mic().className.split(/\s+/);
    expect(on).toContain("text-accent");
    expect(on).toContain("bg-accent-soft");

    /* THE CONTROL, and the half that catches the real defect: the idle mic
       must NOT carry the accent. A version that always painted it would
       satisfy the assertion above and show a mic that is permanently on. */
    STATUS = "idle";
    render(
      <Composer disabled={false} people={PEOPLE} replyTo={null}
        onCancelReply={() => undefined} onSend={() => undefined} />,
    );
    const idle = screen.getAllByRole("button", { name: "گفتن با میکروفون" })[1]!
      .className.split(/\s+/);
    expect(idle).not.toContain("text-accent");
    expect(idle).toContain("text-fg-muted");
  });

  it("carries exactly ONE text colour, whichever state it is in", () => {
    /*
     * The defect itself, asserted directly. `text-danger` beside
     * `text-fg-subtle` is two answers to one property, and CSS picks the
     * winner by stylesheet order — so "the class is there" and "the colour
     * changed" were different facts, and only the first was checkable by
     * reading the diff.
     */
    for (const status of ["listening", "idle"] as const) {
      STATUS = status;
      const { unmount } = render(
        <Composer disabled={false} people={PEOPLE} replyTo={null}
          onCancelReply={() => undefined} onSend={() => undefined} />,
      );
      const colours = mic().className.split(/\s+/)
        .filter((c) => /^text-(?!\[)/.test(c) && !c.startsWith("text-base"));
      expect(colours).toHaveLength(1);
      unmount();
    }
  });
});

describe("one answer for all three mics", () => {
  it("is a single function, and its two states differ", () => {
    /*
     * The assistant page, the assistant sidebar and the room all call this —
     * which is the whole point of it being a function. Asserted as a
     * DIFFERENCE rather than as two literals: pinning the exact strings would
     * make this a copy of the implementation, and the property that matters
     * is that the states are told apart.
     */
    expect(micTone("listening")).not.toBe(micTone("idle"));
    expect(micTone("listening")).toContain("text-accent");
    expect(micTone("idle")).not.toContain("text-accent");
    /* denied and unsupported are not "listening" — a mic that cannot hear
       must not look like one that is */
    expect(micTone("denied")).toBe(micTone("idle"));
    expect(micTone("unsupported")).toBe(micTone("idle"));
  });
});
