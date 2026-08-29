import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentCard } from "@/api/types";

/**
 * **The org's installed workflows, attachable from the agent's own panel.**
 *
 * User report, 2026-08-29: "i can not choose the already installed workflow
 * in the agent, make that ones selectable." The panel showed what an agent
 * carried and what it could be given from the shipped catalogue, and nothing
 * in between — so the workflows the organization actually runs were the one
 * set with no door.
 *
 * The gate is read off db/0124's `agent_workflow_write` policy, and the
 * whole matrix is walked, because two thirds of one is how the M11 delete
 * shipped broken: admin-can and member-cannot were both asserted, and
 * **members-arranging-their-own-agent — the ordinary path, and the product —
 * never was.** So there are three gate tests here, not two.
 *
 * The write's shape is the other half. `setAgentWorkflows` is a WHOLE-SET
 * PUT, so a request carrying only the id that was ticked is a silent detach
 * of everything else — a bug with no symptom at the moment it happens and a
 * missing workflow later. The body is asserted, not the fact that a call
 * was made.
 */

const ATTACHED = { id: "wf-1", handle: "weekly-brief", name: "Weekly brief" };
const INSTALLED = { id: "wf-2", handle: "mail-triage", name: "Mail triage", description: "" };

const agentWorkflows = vi.fn();
const setAgentWorkflows = vi.fn();
const engineWorkflows = vi.fn();
const authoredWorkflows = vi.fn();
const me = vi.fn();

vi.mock("@/api/client", () => ({
  api: {
    agentWorkflows: (id: string) => agentWorkflows(id),
    setAgentWorkflows: (id: string, ids: string[]) => setAgentWorkflows(id, ids),
    engineWorkflows: () => engineWorkflows(),
    authoredWorkflows: () => authoredWorkflows(),
    me: () => me(),
  },
}));

vi.mock("@/i18n/routing", () => ({
  Link: ({ href, children }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"}>{children}</a>
  ),
}));

const { AgentOverviewPanel } = await import("./AgentOverviewPanel");

/** producer-shaped (core/src/agent/agent-store.ts). `growth` is deliberately
    outside `AGENT_STARTER_HANDLES`, so the starter menu cannot render and
    every workflow row on screen belongs to the list under test. */
const SYSTEM_AGENT: AgentCard = {
  id: "ag-7", handle: "growth", name: "Growth agent",
  description: "Helps qualify opportunities.", level: "system",
  icon: "chart", color: "lime", model: null,
  tools: ["search_transcripts"], web: false,
} as unknown as AgentCard;

const person = (role: string) => ({
  id: "u-1", org_id: "o-1", username: "sara", display_name: "سارا",
  avatar_url: null, role, status: "active", locale: "fa",
  model_id: null, created_at: "2026-01-01T00:00:00.000Z",
});

beforeEach(() => {
  for (const spy of [agentWorkflows, setAgentWorkflows, engineWorkflows, authoredWorkflows, me]) {
    spy.mockReset();
  }
  agentWorkflows.mockResolvedValue([ATTACHED]);
  /* an ordinary org: both workflows are installed, one of them attached.
     The "catalogue no longer offers it" case is its own fixture below —
     making it the DEFAULT would have every test quietly exercising the
     union's edge instead of the path everyone actually walks. */
  engineWorkflows.mockResolvedValue([{ ...ATTACHED, description: "" }, INSTALLED]);
  authoredWorkflows.mockResolvedValue([]);
  setAgentWorkflows.mockResolvedValue([ATTACHED, { id: INSTALLED.id, handle: INSTALLED.handle, name: INSTALLED.name }]);
  me.mockResolvedValue(person("admin"));
});

/** the tick for a named workflow — by its accessible name, which its own
    `<label for>` supplies, never by position in the list */
const tickFor = (name: RegExp) => screen.getByRole("checkbox", { name });
/** …and its first appearance, once the catalogue has landed */
const findTick = (name: RegExp) => screen.findByRole("checkbox", { name });

describe("the gate — db/0124's write policy, all three rows of it", () => {
  it("lets an ADMIN arrange a system agent", async () => {
    render(<AgentOverviewPanel agent={SYSTEM_AGENT} />);
    expect(await screen.findByRole("checkbox", { name: /Mail triage/ })).toBeTruthy();
  });

  it("does NOT let a member arrange one — the control", async () => {
    /*
     * Without this, "an admin sees checkboxes" cannot tell a gate that
     * checks the role from one that is simply always open. 0124 requires
     * `echo.actor_is_admin()` for a system agent, and the affordance must
     * mirror the wall rather than offer a request RLS will refuse.
     */
    me.mockResolvedValue(person("member"));
    render(<AgentOverviewPanel agent={SYSTEM_AGENT} />);

    /* the arrangement is still THERE, read-only: what the agent carries,
       each row a link to its own page — which is what this panel always
       showed. What a member does not get is a control */
    const row = await screen.findByRole("link", { name: /Weekly brief/ });
    expect(row.getAttribute("href")).toBe("/workflows/weekly-brief");
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    // and it says whose job it is: "not for you" must not read as "never thought of"
    expect(screen.getByText(/کارِ مدیر سازمان است/)).toBeTruthy();
  });

  it("lets a MEMBER arrange their OWN agent — the ordinary path", async () => {
    /*
     * The row that gets left out. 0124 gates `user`-level rows on
     * `a.user_id = echo.actor_id()`, not on admin — and `assistant_agent_read`
     * hands back nobody else's user agent, so an agent of this level reaching
     * this panel is the caller's own. A gate written as plain `isAdmin` passes
     * both tests above and locks every member out of the agents they made.
     */
    me.mockResolvedValue(person("member"));
    render(<AgentOverviewPanel agent={{ ...SYSTEM_AGENT, level: "user" } as AgentCard} />);
    expect(await screen.findByRole("checkbox", { name: /Mail triage/ })).toBeTruthy();
  });

  it("offers nothing while the role is still unknown", async () => {
    /*
     * `me()` in flight is not "a member". Rendering the read-only shape and
     * then growing checkboxes is the same class as the trend tiles that
     * asserted their own loading state — and the write-offering direction is
     * the one worth being slow about.
     */
    me.mockReturnValue(new Promise(() => {}));
    render(<AgentOverviewPanel agent={SYSTEM_AGENT} />);
    await screen.findByRole("link", { name: /Weekly brief/ });
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });
});

describe("attaching and detaching", () => {
  it("sends the WHOLE set, keeping what was already attached", async () => {
    render(<AgentOverviewPanel agent={SYSTEM_AGENT} />);
    await userEvent.click(await findTick(/Mail triage/));

    await waitFor(() => expect(setAgentWorkflows).toHaveBeenCalled());
    const [id, ids] = setAgentWorkflows.mock.calls[0]!;
    expect(id).toBe("ag-7");
    /*
     * **The discriminating assertion.** The producer's contract is the whole
     * set, so `["wf-2"]` is not "attach wf-2" — it is "this agent now carries
     * only wf-2", silently detaching the workflow the person never touched.
     * Sorted because the ORDER is not part of the contract and asserting it
     * would be a fact about this implementation.
     */
    expect([...ids].sort()).toEqual(["wf-1", "wf-2"]);
  });

  it("detaches by sending the set WITHOUT that id", async () => {
    setAgentWorkflows.mockResolvedValue([]);
    render(<AgentOverviewPanel agent={SYSTEM_AGENT} />);
    await waitFor(() => expect(tickFor(/Weekly brief/)).toBeChecked());

    await userEvent.click(tickFor(/Weekly brief/));
    await waitFor(() => expect(setAgentWorkflows).toHaveBeenCalled());
    expect(setAgentWorkflows.mock.calls[0]![1]).toEqual([]);
  });

  it("adopts the SERVER's answer rather than its own guess", async () => {
    /*
     * The server is the one that says what the set is now. Here it answers
     * with only the newly-ticked row — a legitimate outcome (another admin
     * detached the other one a second ago) — and the panel must show that,
     * not the union it hoped for.
     */
    setAgentWorkflows.mockResolvedValue([
      { id: INSTALLED.id, handle: INSTALLED.handle, name: INSTALLED.name },
    ]);
    render(<AgentOverviewPanel agent={SYSTEM_AGENT} />);
    await userEvent.click(await findTick(/Mail triage/));

    await waitFor(() => expect(tickFor(/Mail triage/)).toBeChecked());
    expect(tickFor(/Weekly brief/)).not.toBeChecked();
  });

  it("leaves the tick alone when the write is refused, and says so", async () => {
    /*
     * Save-then-adopt, the preferences ruling. An optimistic tick that stays
     * ticked after a refusal is a checkbox and a database disagreeing
     * permanently, with the screen making the more comfortable claim.
     */
    setAgentWorkflows.mockRejectedValue(new Error("nope"));
    render(<AgentOverviewPanel agent={SYSTEM_AGENT} />);
    await userEvent.click(await findTick(/Mail triage/));

    expect(await screen.findByRole("alert")).toHaveTextContent(/ذخیره نشد/);
    expect(tickFor(/Mail triage/)).not.toBeChecked();
    expect(tickFor(/Weekly brief/)).toBeChecked();
  });

  it("still lists a workflow the catalogue no longer offers", async () => {
    /*
     * Attached, unpublished since — so it is in `agentWorkflows` and not in
     * `engineWorkflows`. It must render, or the next tick of ANY other row
     * writes a set that has quietly dropped it. The union is the guard, and
     * this is the only fixture in which its absence is visible.
     */
    engineWorkflows.mockResolvedValue([]);
    render(<AgentOverviewPanel agent={SYSTEM_AGENT} />);
    await waitFor(() => expect(tickFor(/Weekly brief/)).toBeChecked());
  });

  it("asks for no catalogue at all on behalf of a reader", async () => {
    /*
     * A member's panel shows what the agent CARRIES, so the catalogue's
     * answer would be discarded — and `/api/workflows/manage` is admin-gated
     * server-side, so asking for it buys a guaranteed 403 in their console on
     * every single agent pick. Neither request is made.
     */
    me.mockResolvedValue(person("member"));
    render(<AgentOverviewPanel agent={SYSTEM_AGENT} />);
    await screen.findByRole("link", { name: /Weekly brief/ });
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(authoredWorkflows).not.toHaveBeenCalled();
    expect(engineWorkflows).not.toHaveBeenCalled();
  });

  it("does ask for it on behalf of an arranger — the control", async () => {
    /* "no catalogue for a member" is satisfied by a panel that never asks
       anyone; this is the half that says the fetch exists at all */
    render(<AgentOverviewPanel agent={SYSTEM_AGENT} />);
    await findTick(/Mail triage/);
    expect(engineWorkflows).toHaveBeenCalled();
    expect(authoredWorkflows).toHaveBeenCalled();
  });
});
