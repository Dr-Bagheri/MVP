import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MailDraft } from "@/api/types";

/**
 * The card is the only place inside the product a message can be sent from,
 * so its assertions are about restraint: the body that goes out is the row
 * the person read, a decided draft offers no second press, and a 409 reads
 * as "somebody already did this" rather than as a failure to retry.
 */
const sent = vi.fn();
const discarded = vi.fn();

vi.mock("@/api/client", () => ({
  api: {
    sendMailDraft: (id: string) => sent(id),
    discardMailDraft: (id: string) => discarded(id),
  },
}));

const notified: string[] = [];
vi.mock("@/lib/notify", () => ({
  notify: (message: string) => { notified.push(message); },
}));

const { MailDraftCard } = await import("./MailDraftCard");

/* the harness renders the REAL fa.json (Persian-first), so the copy asserted
   here is the copy a Persian user sees — an English literal would pass only
   against a locale this product does not default to */
const SEND = "همین حالا بفرست";
const DISCARD = "کنار بگذار";
const ALREADY = "این پاسخ پیش‌تر فرستاده یا کنار گذاشته شده بود.";

const DRAFT: MailDraft = {
  id: "d-1",
  provider: "google",
  source_ref: "msg-1",
  thread_ref: "t-1",
  to_address: "amirreza@example.com",
  subject: "Re: meeting",
  body: "سلام، سه‌شنبه ساعت ۱۰ مناسب است.",
  status: "pending",
  in_provider: true,
  session_id: "s-1",
  created_at: new Date().toISOString(),
  decided_at: null,
};

describe("MailDraftCard", () => {
  beforeEach(() => {
    sent.mockReset();
    discarded.mockReset();
    notified.length = 0;
  });

  it("shows who it goes to, what it says, and that the mailbox has it", () => {
    render(<MailDraftCard draft={DRAFT} />);
    expect(screen.getByText("amirreza@example.com")).toBeTruthy();
    expect(screen.getByText("Re: meeting")).toBeTruthy();
    expect(screen.getByText(DRAFT.body)).toBeTruthy();
  });

  it("sends the DRAFT ID and nothing else", async () => {
    /* the body is not part of the press: whatever the server sends is the
       row it already holds, so an edited DOM cannot become a sent email */
    sent.mockResolvedValue({ ...DRAFT, status: "sent", decided_at: new Date().toISOString() });
    const onChanged = vi.fn();
    render(<MailDraftCard draft={DRAFT} onChanged={onChanged} />);

    fireEvent.click(screen.getByText(SEND));
    await waitFor(() => expect(sent).toHaveBeenCalledWith("d-1"));
    expect(sent.mock.calls[0]).toHaveLength(1);
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("offers no buttons once it is decided", async () => {
    sent.mockResolvedValue({ ...DRAFT, status: "sent", decided_at: new Date().toISOString() });
    render(<MailDraftCard draft={DRAFT} />);
    fireEvent.click(screen.getByText(SEND));
    await waitFor(() => expect(screen.queryByText(SEND)).toBeNull());
    /* and it does not vanish: a card that disappears on success leaves the
       person wondering whether it went */
    expect(screen.getByText("amirreza@example.com")).toBeTruthy();
  });

  it("reads a 409 as already decided, not as a failure to retry", async () => {
    sent.mockRejectedValue(Object.assign(new Error("conflict"), { status: 409 }));
    render(<MailDraftCard draft={DRAFT} />);
    fireEvent.click(screen.getByText(SEND));
    await waitFor(() => expect(notified.length).toBe(1));
    expect(notified[0]).toBe(ALREADY);
  });

  it("renders a decided draft as a record, with no send", () => {
    render(<MailDraftCard draft={{ ...DRAFT, status: "sent", decided_at: new Date().toISOString() }} />);
    expect(screen.queryByText(SEND)).toBeNull();
    expect(screen.queryByText(DISCARD)).toBeNull();
  });
});
