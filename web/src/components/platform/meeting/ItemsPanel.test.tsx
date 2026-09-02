import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "fa",
}));

const meetingItems = vi.fn();
const addMeetingItem = vi.fn();
const updateMeetingItem = vi.fn();
const deleteMeetingItem = vi.fn();

vi.mock("@/api/client", () => ({
  api: {
    meetingItems: (...a: unknown[]) => meetingItems(...a),
    addMeetingItem: (...a: unknown[]) => addMeetingItem(...a),
    updateMeetingItem: (...a: unknown[]) => updateMeetingItem(...a),
    deleteMeetingItem: (...a: unknown[]) => deleteMeetingItem(...a),
  },
}));

const { ItemsPanel } = await import("./ItemsPanel");

const row = (over: Record<string, unknown> = {}) => ({
  id: "i1", kind: "decision", body: "قرارداد امضا شود", source: "user",
  done: false, owner: null, at_ms: null, created_at: "2026-09-02T10:00:00Z", ...over,
});

beforeEach(() => {
  meetingItems.mockReset();
  addMeetingItem.mockReset();
  updateMeetingItem.mockReset();
  deleteMeetingItem.mockReset();
});

describe("ItemsPanel", () => {
  it("adopts the SERVER's row on add, not the draft the person typed", async () => {
    /*
     * The distinction that makes this worth a test: if the panel appended the
     * DRAFT, every assertion about "the item appears" would still pass, and
     * the screen would silently disagree with the record the moment the
     * server normalised anything. So the stub returns text that is NOT what
     * was typed, and the assertion is on the server's version.
     */
    meetingItems.mockResolvedValue([]);
    addMeetingItem.mockResolvedValue(row({ id: "i9", body: "SERVER TEXT" }));
    render(<ItemsPanel meetingId="m1" locale="fa" />);
    await screen.findByText("itemEmpty_decision");

    fireEvent.change(screen.getByLabelText("itemAdd_decision"), { target: { value: "typed text" } });
    fireEvent.click(screen.getByRole("button", { name: /add/ }));

    await screen.findByText("SERVER TEXT");
    expect(screen.queryByText("typed text")).toBeNull();
    expect(addMeetingItem).toHaveBeenCalledWith("m1", { kind: "decision", body: "typed text" });
  });

  it("badges the assistant's rows and ONLY the assistant's", async () => {
    /*
     * The negative control is the whole check. "The badge renders" passes
     * against a component that badges everything, which would be a lie in the
     * one direction that matters — a person's decision presented as the
     * machine's. Two rows, one of each source, and the count must be one.
     */
    meetingItems.mockResolvedValue([
      row({ id: "a", body: "person wrote this", source: "user" }),
      row({ id: "b", body: "assistant wrote this", source: "ai" }),
    ]);
    render(<ItemsPanel meetingId="m1" locale="fa" />);
    await screen.findByText("person wrote this");
    expect(screen.getAllByText("itemByAssistant")).toHaveLength(1);
  });

  it("puts a tick back when the write is refused", async () => {
    /*
     * THE LOAD-BEARING CASE. An optimistic tick that survives a refused write
     * is a checkbox that says "done" about an action item the database never
     * recorded — and nothing corrects it until a reload, which is exactly
     * when nobody is looking. Verified red by deleting the catch's restore.
     */
    meetingItems.mockResolvedValue([row({ id: "t", kind: "action", body: "امضای قرارداد" })]);
    updateMeetingItem.mockRejectedValue(new Error("refused"));
    render(<ItemsPanel meetingId="m1" locale="fa" />);

    fireEvent.click(await screen.findByRole("tab", { name: /item_action/ }));
    const box = await screen.findByRole("checkbox", { name: "itemDone" });
    expect(box.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(box);
    /* anchored on the FAILURE line, not merely awaited: aria-checked is
       "false" before the click too, so waiting for it alone would pass in the
       state this test is not about */
    await screen.findByText("itemWriteFailed");
    expect(box.getAttribute("aria-checked")).toBe("false");
  });

  it("keeps the tick when the write succeeds", async () => {
    /* the permitted twin — without it the test above passes against a
       checkbox that never ticks at all */
    meetingItems.mockResolvedValue([row({ id: "t", kind: "action", body: "امضای قرارداد" })]);
    updateMeetingItem.mockResolvedValue(undefined);
    render(<ItemsPanel meetingId="m1" locale="fa" />);

    fireEvent.click(await screen.findByRole("tab", { name: /item_action/ }));
    const box = await screen.findByRole("checkbox", { name: "itemDone" });
    fireEvent.click(box);
    await waitFor(() => expect(box.getAttribute("aria-checked")).toBe("true"));
    expect(updateMeetingItem).toHaveBeenCalledWith("m1", "t", { done: true });
  });

  it("removes a row the assistant added — through the dialog, and only through it", async () => {
    /*
     * Two properties in one, and the first is the one that would rot: the
     * trash press ASKS and does not write. A test that only asserted the row
     * disappears would pass against a control wired straight to the delete,
     * which is the shape the platform's confirm rule exists to forbid.
     */
    meetingItems.mockResolvedValue([row({ id: "b", body: "assistant wrote this", source: "ai" })]);
    deleteMeetingItem.mockResolvedValue(undefined);
    render(<ItemsPanel meetingId="m1" locale="fa" />);
    await screen.findByText("assistant wrote this");

    fireEvent.click(screen.getByRole("button", { name: "itemRemove" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(deleteMeetingItem).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "itemRemove" }));
    await waitFor(() => expect(screen.queryByText("assistant wrote this")).toBeNull());
    expect(deleteMeetingItem).toHaveBeenCalledWith("m1", "b");
  });

  it("offers to play from a moment only when the row has one", async () => {
    /* at_ms null means a person typed it, which is not "at zero" — a seek
       button on such a row would send the audio to the start and look like a
       feature (rule 12: the absent thing is a legitimate value) */
    const onSeek = vi.fn();
    meetingItems.mockResolvedValue([
      row({ id: "a", body: "typed by hand", at_ms: null }),
      row({ id: "b", body: "heard at 90s", at_ms: 90_000, source: "ai" }),
    ]);
    render(<ItemsPanel meetingId="m1" onSeek={onSeek} locale="fa" />);
    await screen.findByText("typed by hand");

    const seeks = screen.getAllByTitle("playFromHere");
    expect(seeks).toHaveLength(1);
    fireEvent.click(seeks[0]!);
    expect(onSeek).toHaveBeenCalledWith(90_000);
  });
});
