import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **The overview comes up WITH the agent** (M47, the user's ask): picking an
 * agent for the conversation must surface its workflows and its reach beside
 * the thread — fetched from the wire by the agent's ID, never invented.
 *
 * The control is the half that keeps this honest: with no agent picked the
 * panel is ABSENT and the wire is never asked. A test that only proves the
 * positive cannot tell "the panel follows the pick" from "the panel renders
 * always" — the AssistantPane default-open overlay was exactly that failure.
 */
vi.mock("@/components/platform/PlatformShell", () => ({
  PlatformShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/i18n/routing", () => ({
  Link: ({ href, children, ...props }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"} {...props}>{children}</a>
  ),
  usePathname: () => "/assistant",
  useRouter: () => ({ replace: () => {}, push: () => {} }),
}));

/** read at render time, so each test sets the URL it is about */
let search = new URLSearchParams("");
vi.mock("next/navigation", () => ({
  useSearchParams: () => search,
}));

/** the fetch argument is the assertion: the wire keys on the agent's ID
    while the URL carries its HANDLE — a fetch by handle would 404 quietly */
const workflowCalls: string[] = [];

/** producer-shaped AgentCard (core/src/agent/agent-store.ts), the M47 wire */
const AGENT = {
  id: "ag-7",
  handle: "sales",
  name: "Sales agent",
  description: "Helps qualify opportunities.",
  level: "system" as const,
  icon: "chart",
  color: "lime",
  model: null,
  tools: ["search_transcripts", "read_window"],
  web: true,
};

vi.mock("@/api/client", () => ({
  BffError: class BffError extends Error {
    constructor(public status: number, public kind?: string, public detail?: string) {
      super(detail ?? kind ?? String(status));
    }
  },
  api: {
    me: async () => ({
      id: "u-1", org_id: "o-1", username: "sara", display_name: "سارا",
      avatar_url: null, role: "member", status: "active", locale: "fa",
      model_id: null, created_at: new Date().toISOString(),
    }),
    ask: async function* () { yield { type: "done", runId: "r", failed: false }; },
    agentMessages: async () => [],
    models: async () => ({
      models: [{ id: "google/gemini-3.1-pro-preview", name: "Gemini 3.1 Pro", reasoning: true }],
      preferred_model: null, curated: false, tool_capability_filtered: false,
    }),
    skills: async () => [],
    agents: async () => [AGENT],
    workflows: async () => [],
    search: async () => [],
    assistantTools: async () => [],
    sessionFeedback: async () => ({}),
    shareState: async () => false,
    agentSessions: async () => [],
    mailDrafts: async () => [],
    /* the panel's wire — producer shape: { id, handle, name } rows */
    agentWorkflows: async (id: string) => {
      workflowCalls.push(id);
      return [{ id: "wf-1", handle: "weekly-brief", name: "Weekly brief" }];
    },
  },
}));

const { Hub } = await import("./Hub");

describe("Hub — the agent overview panel", () => {
  beforeEach(() => {
    workflowCalls.length = 0;
    search = new URLSearchParams("");
  });

  it("renders the picked agent's workflows from the wire, fetched by its id", async () => {
    search = new URLSearchParams("agent=sales");
    render(<Hub />);

    /* the panel identifies itself and carries the agent's face */
    expect(await screen.findByLabelText("عامل انتخاب‌شده")).toBeInTheDocument();
    expect(screen.getByText("Sales agent")).toBeInTheDocument();

    /* the workflows arrive from the wire, asked by ID (the URL only ever
       held the handle — this is the seam the assertion pins) */
    const row = await screen.findByRole("link", { name: /Weekly brief/ });
    expect(workflowCalls).toEqual(["ag-7"]);
    expect(row.getAttribute("href")).toBe("/workflows/weekly-brief");

    /* the knowledge summary tells the truth about reach */
    expect(screen.getByText("جست‌وجوی وب روشن")).toBeInTheDocument();
    expect(screen.getByText("search transcripts")).toBeInTheDocument();
  });

  it("is ABSENT when no agent is picked, and the wire is never asked", async () => {
    render(<Hub />);
    /* give every mount effect its chance to misbehave before asserting */
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(screen.queryByLabelText("عامل انتخاب‌شده")).toBeNull();
    expect(workflowCalls).toEqual([]);
  });
});
