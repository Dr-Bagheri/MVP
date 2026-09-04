import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import fa from "../../messages/fa.json";

vi.mock("@/i18n/routing", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("./CrumbTitle", () => ({ useCrumbTitle: () => undefined }));
const ROSTER = [{
  id: "a-1", handle: "ava", name: "آوا", description: "می‌خواند و گزارش می‌دهد.",
  level: "system", icon: "chart", color: "blue", model: null,
  tools: ["search_transcripts", "read_window"], web: false,
  instructions: null, editable: false,
}];
vi.mock("@/api/client", () => ({
  api: {
    agents: async () => ROSTER,
    assistantTools: async () => [
      "search_transcripts", "read_window", "get_call", "list_meetings",
      "create_task", "complete_task", "send_member_message", "navigate",
    ],
  },
}));
const { AgentDetail } = await import("./AgentDetail");

describe("an agent's page", () => {
  it("reads as sentences, grouped — never as identifiers", async () => {
    render(<AgentDetail handle="ava" />);
    await waitFor(() => expect(screen.getByText("آوا")).toBeTruthy());
    /* the SENTENCE for a tool, from the catalogue — not the name */
    await waitFor(() =>
      expect(screen.getByText(fa.agents.tool.search_transcripts)).toBeTruthy());
    /* and the identifier is NOT rendered as text anywhere. This is the
       assertion the old page fails: it printed `search_transcripts` in a code
       chip. Asserted as an absence, because the version that shows both looks
       perfectly reasonable. */
    expect(screen.queryByText("search_transcripts")).toBeNull();
    /* grouped, with the group's own heading */
    expect(screen.getByText(fa.agents.capability_record)).toBeTruthy();
    expect(screen.getByText(fa.agents.capability_tasks)).toBeTruthy();
  });

  it("shows what it HOLDS, not what its row lists", async () => {
    /* the stored column is a preference since M48; showing it as the
       capability list would understate the agent by fifty tools */
    render(<AgentDetail handle="ava" />);
    await waitFor(() =>
      expect(screen.getByText(fa.agents.tool.create_task)).toBeTruthy());
  });
});
