import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const setAssistantFloor = vi.fn(async (_sessionId: string, _agents: string[]) => [] as string[]);
vi.mock("@/api/client", () => ({
  api: {
    setAssistantFloor: (sessionId: string, agents: string[]) => setAssistantFloor(sessionId, agents),
    agents: async () => [
      { id: "a-1", handle: "roya", name: "رؤیا", description: "", level: "system", icon: "", color: "", model: null, tools: [], web: false, instructions: null, editable: false },
      { id: "a-2", handle: "ava", name: "آوا", description: "", level: "system", icon: "", color: "", model: null, tools: [], web: false, instructions: null, editable: false },
    ],
  },
}));

const { FloorChip } = await import("./FloorChip");
const { adoptAssistantThread, assistantSnapshot, resetAssistantForTest } = await import("@/lib/assistantSession");
const { resetAgentRosterForTest } = await import("./AgentAvatar");

/**
 * The chip is the only place the floor is VISIBLE, and its × is the only
 * release that is not a name (user, 2026-09-06). Verified red against a
 * store that never published the floor: nothing rendered for a thread Roya
 * held, and the × had nothing to clear.
 */
describe("the floor chip", () => {
  afterEach(() => { resetAssistantForTest(); resetAgentRosterForTest(); setAssistantFloor.mockClear(); });

  it("names who is in the room, in order, and is absent when it is Echo's thread", async () => {
    adoptAssistantThread("s-1", [], ["roya", "ava"]);
    const { container, unmount } = render(<FloorChip />);
    expect(container.querySelector("[data-floor]")?.getAttribute("data-floor")).toBe("roya,ava");
    await screen.findByText("رؤیا");
    await screen.findByText("آوا");
    unmount();
    adoptAssistantThread("s-1", [], []);
    const empty = render(<FloorChip />);
    expect(empty.container.querySelector("[data-floor]")).toBeNull();
  });

  it("the × hands the thread back to Echo — on screen at once, and on the session", async () => {
    adoptAssistantThread("s-2", [], ["roya"]);
    render(<FloorChip />);
    (await screen.findByRole("button", { name: "بازگشت به اکو" })).click();
    await waitFor(() => expect(assistantSnapshot().floor).toEqual([]));
    expect(setAssistantFloor).toHaveBeenCalledWith("s-2", []);
    expect(screen.queryByRole("button", { name: "بازگشت به اکو" })).toBeNull();
  });
});
