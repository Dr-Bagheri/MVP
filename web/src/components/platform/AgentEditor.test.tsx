import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentCard } from "@/api/types";

/**
 * The editor's three contract facts, as things that run:
 *
 *  1. The PATCH carries EXACTLY the fields the person changed. Instructions
 *     are write-only from here — an empty box means keep, so a save that
 *     included `instructions: ""` would silently erase a prompt nobody saw.
 *     Asserted by object equality on the body, both directions (a changed
 *     name travels; everything untouched does not).
 *  2. The workflows save is a WHOLE-SET PUT — after an attach and a detach
 *     the set carries the kept rows too, order-independent. A diff-shaped
 *     PUT (only the newly-checked ids) would detach everything unmentioned.
 *  3. Org-level creation is an admin door: a member sees the option refused
 *     WITH its reason, an admin sees it live — both directions, because a
 *     gate asserted only closed cannot tell "gated" from "broken".
 */
vi.mock("@/i18n/routing", () => ({
  Link: ({ href, children, ...props }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"} {...props}>{children}</a>
  ),
}));

const updated: { id: string; patch: Record<string, unknown> }[] = [];
const putSets: { id: string; ids: string[] }[] = [];
const created: Record<string, unknown>[] = [];

/** producer-shaped (core/src/agent/agent-store.ts AgentCard) — a user-level
    agent with the db/0065 legacy icon/colour spellings, deliberately: an
    untouched legacy spelling must never re-enter the PATCH under a new name */
const AGENT: AgentCard = {
  id: "ag-1",
  handle: "sales",
  name: "Sales agent",
  description: "Helps qualify opportunities.",
  level: "user",
  icon: "chart",
  color: "lime",
  model: null,
  tools: ["search_transcripts", "read_window", "get_call", "list_related_calls"],
  web: false,
};

/** producer shape of GET /v1/agents/:id/workflows rows: { id, handle, name } */
const ATTACHED = [
  { id: "wf-1", handle: "weekly-brief", name: "Weekly brief" },
  { id: "wf-2", handle: "mail-replies", name: "Mail replies" },
];

vi.mock("@/api/client", () => ({
  BffError: class BffError extends Error {},
  api: {
    models: async () => ({
      models: [{ id: "google/gemini-3.1-pro-preview", name: "Gemini 3.1 Pro", reasoning: true, selected: false }],
      preferred_model: null, curated: false, tool_capability_filtered: false,
    }),
    assistantTools: async () => [
      "search_transcripts", "read_window", "get_call", "list_related_calls",
      "correct_transcript", "edit_speaker_roster", "replace_summary",
    ],
    engineWorkflows: async () => [
      { id: "wf-1", handle: "weekly-brief", name: "Weekly brief", description: "" },
      { id: "wf-2", handle: "mail-replies", name: "Mail replies", description: "" },
      { id: "wf-3", handle: "meeting-prep", name: "Meeting prep", description: "" },
    ],
    authoredWorkflows: async () => [],
    agentWorkflows: async () => ATTACHED,
    updateAgent: async (id: string, patch: Record<string, unknown>) => {
      updated.push({ id, patch });
      return { ...AGENT, ...patch };
    },
    setAgentWorkflows: async (id: string, ids: string[]) => {
      putSets.push({ id, ids });
      return ids.map((wid) => ({ id: wid, handle: `h-${wid}`, name: `n-${wid}` }));
    },
    createAgent: async (input: Record<string, unknown>) => {
      created.push(input);
      return { ...AGENT, id: "ag-new", ...input };
    },
  },
}));

const { AgentEditor } = await import("./AgentEditor");

const noop = () => {};

describe("AgentEditor — the save is a diff, the set is whole, the org door is an admin's", () => {
  beforeEach(() => {
    updated.length = 0;
    putSets.length = 0;
    created.length = 0;
  });

  it("PATCHes exactly the changed field — instructions stay out of an untyped save", async () => {
    render(<AgentEditor agent={AGENT} isAdmin={false} onClose={noop} onSaved={noop} />);
    const name = await screen.findByLabelText("نام");
    await userEvent.clear(name);
    await userEvent.type(name, "عامل فروش تازه");
    await userEvent.click(screen.getByRole("button", { name: "ذخیره" }));

    await waitFor(() => expect(updated.length).toBe(1));
    /* object equality is the point: no instructions, no icon, no colour, no
       tools — nothing the person did not touch */
    expect(updated[0]).toEqual({ id: "ag-1", patch: { name: "عامل فروش تازه" } });
    /* and an unchanged membership sends no PUT */
    expect(putSets).toEqual([]);
  });

  it("typed instructions join the PATCH", async () => {
    render(<AgentEditor agent={AGENT} isAdmin={false} onClose={noop} onSaved={noop} />);
    const instructions = await screen.findByLabelText("دستورها");
    await userEvent.type(instructions, "قاطع و کوتاه پاسخ بده.");
    await userEvent.click(screen.getByRole("button", { name: "ذخیره" }));

    await waitFor(() => expect(updated.length).toBe(1));
    expect(updated[0]).toEqual({ id: "ag-1", patch: { instructions: "قاطع و کوتاه پاسخ بده." } });
  });

  it("PUTs the WHOLE workflow set after attach + detach, order-independent", async () => {
    render(<AgentEditor agent={AGENT} isAdmin={false} onClose={noop} onSaved={noop} />);
    await userEvent.click(screen.getByRole("tab", { name: "گردش‌کارها" }));

    /* detach wf-1, attach wf-3 — wf-2 is the row nobody touches, and the
       assertion below is really about wf-2 surviving into the set */
    await userEvent.click(await screen.findByRole("checkbox", { name: /Weekly brief/ }));
    await userEvent.click(screen.getByRole("checkbox", { name: /Meeting prep/ }));
    await userEvent.click(screen.getByRole("button", { name: "ذخیره" }));

    await waitFor(() => expect(putSets.length).toBe(1));
    expect(putSets[0]!.id).toBe("ag-1");
    expect([...putSets[0]!.ids].sort()).toEqual(["wf-2", "wf-3"]);
    /* nothing personal changed, so there is no PATCH beside the PUT */
    expect(updated).toEqual([]);
  });

  it("offers org-level creation to admins and refuses it to members, with the reason", async () => {
    const { unmount } = render(<AgentEditor agent={null} isAdmin={false} onClose={noop} onSaved={noop} />);
    await userEvent.click(screen.getByRole("tab", { name: "دیده‌شدن" }));
    const memberOrg = screen.getByRole("radio", { name: /همهٔ اعضای سازمان/ });
    expect(memberOrg).toBeDisabled();
    expect(screen.getByText("ساخت عامل سازمانی فقط برای مدیران سازمان است.")).toBeInTheDocument();
    unmount();

    /* the other direction — a gate that is never open is indistinguishable
       from a broken control */
    render(<AgentEditor agent={null} isAdmin={true} onClose={noop} onSaved={noop} />);
    await userEvent.click(screen.getByRole("tab", { name: "دیده‌شدن" }));
    expect(screen.getByRole("radio", { name: /همهٔ اعضای سازمان/ })).toBeEnabled();
  });

  /**
   * FOURTH contract fact, added 2026-08-29 after the user reported "i can not
   * choose the already installed workflow in the agent".
   *
   * Attaching a workflow and rewriting a persona are DIFFERENT permissions and
   * db/0124 answers them differently. This editor gated both on `editable`,
   * for which a system agent is nobody — so an admin could not attach a
   * workflow to meetings, mail or prep from here, which is the surface a
   * person actually reaches for.
   *
   * Asserted in BOTH directions on the same agent, because the whole defect
   * was one predicate standing in for two: an admin may arrange a system
   * agent's workflows AND may not rewrite its persona. A test that only
   * checked the first would pass against simply deleting the read-only guard.
   */
  it("lets an admin arrange a SYSTEM agent's workflows while its persona stays read-only", async () => {
    const system: AgentCard = { ...AGENT, id: "ag-sys", handle: "prepare-meetings", level: "system" };
    render(<AgentEditor agent={system} isAdmin={true} onClose={noop} onSaved={noop} />);

    await userEvent.click(screen.getByRole("tab", { name: "گردش‌کارها" }));
    const boxes = await screen.findAllByRole("checkbox");
    expect(boxes.length).toBeGreaterThan(0);

    // and the other half of the same predicate: the persona is still theirs
    // to read and nobody's to rewrite
    await userEvent.click(screen.getByRole("tab", { name: "شخصیت" }));
    expect(screen.queryByRole("textbox", { name: /نام/ })).not.toBeInTheDocument();
  });

  it("offers a MEMBER no way to arrange a system agent — the control", async () => {
    /*
     * The question this file should answer NO to. Without it, `canArrange`
     * could be the constant `true` and every assertion above would still
     * pass — the exact shape the panel's own test was verified against.
     */
    const system: AgentCard = { ...AGENT, id: "ag-sys", handle: "prepare-meetings", level: "system" };
    render(<AgentEditor agent={system} isAdmin={false} onClose={noop} onSaved={noop} />);
    await userEvent.click(screen.getByRole("tab", { name: "گردش‌کارها" }));
    await waitFor(() => expect(screen.queryAllByRole("checkbox")).toHaveLength(0));
  });
});
