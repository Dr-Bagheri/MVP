import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import fa from "../../messages/fa.json";
import { agentIconName } from "./agentAppearance";

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

const { AgentAvatar, AgentName, resetAgentRosterForTest } =
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
  it("draws the agent's own icon and name once the roster lands", async () => {
    render(<><AgentAvatar handle="ava" /><AgentName handle="ava" /></>);
    await waitFor(() => expect(screen.getByText("آوا")).toBeTruthy());
    /*
     * The ICON is the agent's, not a generic one — a mark that ignored it
     * would make both colleagues look identical, which is the whole failure
     * this component exists to prevent.
     *
     * The expected glyph comes from `agentIconName`, the PRODUCER, and not
     * from the stored string. The first version of this line asserted
     * `data-icon="chart"` because that is what the fixture stores — and the
     * map turns `chart` into `pulse`, so the assertion was my belief about
     * the mapping rather than the mapping. Rule 9, in one line of a test.
     */
    expect(document.querySelector(`[data-icon="${agentIconName("chart")}"]`)).toBeTruthy();
    /* and the two are DIFFERENT, which is the property that matters: an
       identical fallback for both would satisfy the line above */
    expect(agentIconName("chart")).not.toBe(agentIconName("sparkles"));
  });

  it("draws a mark BEFORE the roster lands, not a gap", async () => {
    /*
     * The temporal case, and the one a reader actually hits. A component that
     * rendered nothing until the fetch resolved would let the message appear
     * first and the face arrive after, shoving the text. The neutral robot
     * says "not Echo" — which is the whole job — and the handle is in the
     * title, so nothing is unidentified even in that instant.
     */
    let settle: (rows: unknown) => void = () => {};
    agents.mockReturnValue(new Promise((resolve) => { settle = resolve; }));
    render(<><AgentAvatar handle="roya" /><AgentName handle="roya" /></>);
    expect(document.querySelector('[data-icon="robot"]')).toBeTruthy();
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
    expect(document.querySelector('[data-icon="robot"]')).toBeTruthy();
  });
});
