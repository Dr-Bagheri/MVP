import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import fa from "../../messages/fa.json";
import { agentAvatarTone } from "./agentAppearance";

/*
 * The REAL catalogue, not a key-echoing stub.
 *
 * `useAgentCopy` resolves a system agent's name THROUGH the catalogue on
 * purpose (seededCopy.guard: the database holds one spelling, and a name
 * served straight off the wire renders Persian to an English reader with
 * nothing going red). A stub that returns the key would make this file assert
 * `sys_ava_name` — it would pass, and it would prove nothing about whether a
 * reader ever sees «آوا».
 *
 * A miss renders as the key path rather than as invented copy, so a catalogue
 * that lost the entry fails visibly here instead of quietly.
 */
vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => (key: string) => {
    /* through `unknown`: the catalogue's real type has nested objects
       (dashboard.widget), so a direct assertion to a flat record is one
       TypeScript refuses — and rightly, since it is a lie about the shape */
    const table = (fa as unknown as Record<string, Record<string, unknown>>)[namespace];
    const value = table?.[key];
    return typeof value === "string" ? value : `${namespace}.${key}`;
  },
  useLocale: () => "fa",
}));

const agents = vi.fn();
vi.mock("@/api/client", () => ({ api: { agents: () => agents() } }));

const { AgentAvatar, AgentName, ECHO, resetAgentRosterForTest } =
  await import("./AgentAvatar");

/**
 * WHOSE WORDS THESE ARE.
 *
 * User directive, 2026-09-03: "each of them when they come to the AI assistant
 * page or on the side bar menu have to have their avatar next to the messages
 * they write."
 *
 * The assertions are about the two states a reader can actually be in — the
 * roster has landed, or it has not — because the failure mode here is not a
 * wrong face, it is a face that ARRIVES A BEAT LATE and shoves the words it
 * belongs to. A mark that pops in after the paragraph is a layout moving under
 * somebody who is reading.
 */
const ROSTER = [
  { id: "a-1", handle: "roya", name: "رؤیا", description: "", level: "system",
    icon: "sparkles", color: "violet", model: null, tools: [], web: false,
    instructions: null, editable: false },
  { id: "a-2", handle: "ava", name: "آوا", description: "", level: "system",
    icon: "chart", color: "blue", model: null, tools: [], web: false,
    instructions: null, editable: false },
];

beforeEach(() => {
  vi.clearAllMocks();
  resetAgentRosterForTest();
  agents.mockResolvedValue(ROSTER);
});

describe("a colleague's mark", () => {
  it("draws the agent's own letter and name once the roster lands", async () => {
    render(<><AgentAvatar handle="ava" /><AgentName handle="ava" /></>);
    await waitFor(() => expect(screen.getByText("آوا")).toBeTruthy());
    /*
     * The LETTER comes from the handle, which is why the directive could ask
     * for R and A at all: «رؤیا» does not start with an R. Asserting it
     * against `handle[0]` would be the code's own belief restated, so the
     * expected letters are written out.
     */
    const face = document.querySelector('[data-agent-avatar="ava"]');
    expect(face?.textContent).toBe("A");
    /* the tone is the agent's own, and the two colleagues DIFFER — an
       identical fallback for both would satisfy an assertion that only asked
       whether a class was present */
    expect(face?.className).toContain(agentAvatarTone("blue"));
    expect(agentAvatarTone("blue")).not.toBe(agentAvatarTone("violet"));
  });

  it("Echo wears the platform's own accent, with no row to read it from", async () => {
    /*
     * User directive, 2026-09-04: "for echo also add an avatar with E sign
     * like the one in the logo of the site". Echo has no seat in the agents
     * table and never will — it is the assistant, not a colleague — so this
     * asserts the two facts that make that workable: the letter comes from
     * the handle, and the tone is named rather than looked up.
     */
    render(<><AgentAvatar handle={ECHO} /><AgentName handle={ECHO} /></>);
    const face = document.querySelector(`[data-agent-avatar="${ECHO}"]`);
    expect(face?.textContent).toBe("E");
    expect(face?.className).toContain(agentAvatarTone("echo"));
    /* and it is NOT the unknown-handle face, which is the thing it would
       silently become if `echo` were resolved through the roster */
    expect(face?.className).not.toContain(agentAvatarTone("slate"));
    await waitFor(() => expect(screen.getByText(fa.platform.echo)).toBeTruthy());
  });

  it("draws a mark BEFORE the roster lands, not a gap", async () => {
    /*
     * The temporal case, and the one a reader actually hits. A component that
     * rendered nothing until the fetch resolved would let the message appear
     * first and the face arrive after, shoving the text.
     *
     * The letter is the part that makes this free: it comes from the handle,
     * so the face is CORRECT before the network, not merely present. Only the
     * tone arrives late.
     */
    let settle: (rows: unknown) => void = () => {};
    agents.mockReturnValue(new Promise((resolve) => { settle = resolve; }));
    render(<><AgentAvatar handle="roya" /><AgentName handle="roya" /></>);
    expect(document.querySelector('[data-agent-avatar="roya"]')?.textContent).toBe("R");
    expect(screen.getByText("@roya")).toBeTruthy();

    settle(ROSTER);
    await waitFor(() => expect(screen.getByText("رؤیا")).toBeTruthy());
  });

  it("survives a roster that cannot be read — the handle stands in", async () => {
    /* a thread must not throw because it could not draw a face. The fallback
       is legible: `@roya` is what a person types to summon her, so it is
       never a stranger. */
    agents.mockRejectedValue(new Error("down"));
    render(<AgentName handle="roya" />);
    await waitFor(() => expect(screen.getByText("@roya")).toBeTruthy());
  });

  it("reads the roster ONCE for a thread full of turns", async () => {
    /*
     * The reason the read is a module-level shared promise. A hook per
     * message would make a conversation with twenty of Roya's turns issue
     * twenty requests — invisible on a fast connection and a real cost on a
     * slow one, which is exactly the kind of defect that never gets reported
     * and never gets fixed.
     */
    render(
      <>
        <AgentAvatar handle="roya" /><AgentAvatar handle="ava" />
        <AgentAvatar handle="roya" /><AgentName handle="ava" />
      </>,
    );
    await waitFor(() => expect(screen.getByText("آوا")).toBeTruthy());
    expect(agents).toHaveBeenCalledTimes(1);
  });

  it("an unknown handle still says somebody spoke", async () => {
    /* an agent archived after it answered: the thread keeps its words and can
       no longer name it. Drawing nothing would silently re-attribute the turn
       to Echo, which is the one thing the author column exists to prevent. */
    render(<><AgentAvatar handle="ghost" /><AgentName handle="ghost" /></>);
    await waitFor(() => expect(screen.getByText("@ghost")).toBeTruthy());
    const face = document.querySelector('[data-agent-avatar="ghost"]');
    expect(face?.textContent).toBe("G");
    expect(face?.className).toContain(agentAvatarTone("slate"));
  });
});
