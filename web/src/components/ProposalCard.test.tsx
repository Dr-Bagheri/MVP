import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProposalCard } from "./ProposalCard";
import type { AgentProposal } from "@/api/types";
import fa from "@/messages/fa.json";

/**
 * The confirmation gate is the most consequential component in the product:
 * it is the only place an inferred write becomes a real one. Everything here
 * asserts a PROMISE we made to the user, not an implementation detail.
 */
const decide = vi.fn();
vi.mock("@/api/client", () => ({
  api: {
    decideProposal: (...args: unknown[]) => decide(...args),
  },
}));

const t = fa.assistant;

const proposal: AgentProposal = {
  id: "pr-1",
  kind: "correct_transcript",
  summary: "اصلاح خط ۰۰:۴۱",
  payload: {
    call_id: "c-1",
    before: { text: "متن پیشین" },
    after: { text: "متن اصلاح‌شده" },
  },
};

beforeEach(() => {
  decide.mockReset();
  decide.mockResolvedValue("ok");
});

describe("ProposalCard", () => {
  it("shows both sides so the user is judging, not consenting", () => {
    render(<ProposalCard proposal={proposal} runId="run-1" />);
    expect(screen.getByText("متن پیشین")).toBeInTheDocument();
    expect(screen.getByText("متن اصلاح‌شده")).toBeInTheDocument();
  });

  it("states that NOTHING has happened yet", () => {
    // core/ tells the model `awaiting_confirmation`; the UI must not claim
    // more than the model does.
    render(<ProposalCard proposal={proposal} runId="run-1" />);
    expect(screen.getByText(t.proposalNothingYet)).toBeInTheDocument();
    expect(screen.queryByText(t.proposal_applied)).not.toBeInTheDocument();
  });

  it("sends only the proposal id, run id and decision — never the payload", async () => {
    // `after` is a DISPLAY value and may be excerpted. Sending it back would
    // silently truncate the change to whatever the card had room for.
    render(<ProposalCard proposal={proposal} runId="run-1" />);
    await userEvent.click(screen.getByRole("button", { name: t.approve }));
    await waitFor(() => expect(decide).toHaveBeenCalledTimes(1));
    expect(decide).toHaveBeenCalledWith("pr-1", "run-1", "confirm");
    const args = JSON.stringify(decide.mock.calls[0]);
    expect(args).not.toContain("متن اصلاح‌شده");
  });

  it("retires both buttons once decided, so a change cannot be applied twice", async () => {
    render(<ProposalCard proposal={proposal} runId="run-1" />);
    await userEvent.click(screen.getByRole("button", { name: t.approve }));
    await waitFor(() => expect(screen.getByText(t.proposal_applied)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: t.approve })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t.reject })).not.toBeInTheDocument();
  });

  it("says nothing changed when rejected", async () => {
    render(<ProposalCard proposal={proposal} runId="run-1" />);
    await userEvent.click(screen.getByRole("button", { name: t.reject }));
    await waitFor(() => expect(screen.getByText(t.proposal_rejected)).toBeInTheDocument());
    expect(decide).toHaveBeenCalledWith("pr-1", "run-1", "reject");
  });

  it("treats a stale proposal as no-longer-applicable and offers NO retry", async () => {
    // core/ 404s when the segment went or the call changed hands between
    // propose and confirm. That is an outcome, not a fault: a retry button
    // would invite the user to push on a locked door.
    decide.mockResolvedValue("stale");
    render(<ProposalCard proposal={proposal} runId="run-1" />);
    await userEvent.click(screen.getByRole("button", { name: t.approve }));
    await waitFor(() => expect(screen.getByText(t.proposal_stale)).toBeInTheDocument());
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("reports a genuine failure differently from a stale one", async () => {
    decide.mockRejectedValue(new Error("boom"));
    render(<ProposalCard proposal={proposal} runId="run-1" />);
    await userEvent.click(screen.getByRole("button", { name: t.approve }));
    await waitFor(() => expect(screen.getByText(t.proposal_failed)).toBeInTheDocument());
  });

  it("cannot be decided without a run id", () => {
    // The proposal arrives mid-stream, before `done` carries the runId. Until
    // it does, confirming would be a request core/ must reject.
    render(<ProposalCard proposal={proposal} />);
    expect(screen.getByRole("button", { name: t.approve })).toBeDisabled();
    expect(screen.getByRole("button", { name: t.reject })).toBeDisabled();
  });

  it("renders a first-ever summary, which has no before, without inventing one", () => {
    const firstSummary: AgentProposal = {
      ...proposal,
      kind: "replace_summary",
      payload: { call_id: "c-1", after: { version: 1, body: "خلاصهٔ تازه" } },
    };
    render(<ProposalCard proposal={firstSummary} runId="run-1" />);
    expect(screen.getByText("خلاصهٔ تازه")).toBeInTheDocument();
    expect(screen.queryByText(t.proposalBefore)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: t.approve })).toBeEnabled();
  });

  it("degrades to summary-and-buttons on a kind whose values it cannot read", () => {
    // An unknown kind is DATA, not a crash: the closed set can grow.
    const unknown = {
      ...proposal,
      kind: "something_new" as AgentProposal["kind"],
      payload: { call_id: "c-1", after: { unexpected: true } },
    };
    render(<ProposalCard proposal={unknown} runId="run-1" />);
    expect(screen.getByText(proposal.summary)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t.approve })).toBeEnabled();
  });
});
