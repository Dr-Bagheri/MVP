import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
const source = vi.fn();

vi.mock("@/api/client", () => ({
  api: {
    sendMailDraft: (id: string) => sent(id),
    discardMailDraft: (id: string) => discarded(id),
    mailDraftSource: (id: string) => source(id),
  },
}));

const notified: string[] = [];
vi.mock("@/i18n/routing", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    <a href={String(href)} {...props}>{children}</a>,
}));

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
const ENABLE = "فعال‌کردن ارسال";
const SHOW_SOURCE = "نمایش متن";
const IN_MAILBOX = "در پیش‌نویس‌های صندوق پستی شما هم هست";
const STILL_IN_MAILBOX = "هنوز در پوشهٔ پیش‌نویس‌های شماست؛ از همان‌جا پاکش کنید";
const DISCARD_TITLE = "پاسخ به «Re: meeting» کنار گذاشته شود؟";

/**
 * Press Discard, then answer the dialog that the platform's rule puts in
 * front of it. The card's own button and the dialog's confirm carry the SAME
 * word, so the confirm is reached through the dialog element rather than by
 * text — `getByText` would be ambiguous, and picking the first match would
 * silently re-press the button that opened it.
 */
function discardThroughTheDialog(): void {
  fireEvent.click(screen.getByText(DISCARD));
  const dialog = screen.getByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("button", { name: DISCARD }));
}

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
    /* the default is a provider that cannot be read: every assertion about
       the reply itself must hold with no quote above it, or the quote has
       become load-bearing for a card that existed before it */
    source.mockReset();
    source.mockRejectedValue(new Error("unreadable"));
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

  it("stops claiming the mailbox agrees once a draft is discarded", async () => {
    /*
     * Discard writes OUR row and does not touch the mailbox, so the draft is
     * still sitting in the person's Drafts folder. A card that kept saying
     * "also in your Drafts folder" would be technically true and read as
     * confirmation that the discard reached the mail — two stories about one
     * object, which is how "why is this still here?" happens.
     */
    discarded.mockResolvedValue({
      ...DRAFT, status: "discarded", decided_at: new Date().toISOString(),
    });
    render(<MailDraftCard draft={DRAFT} />);
    expect(screen.getByText(IN_MAILBOX)).toBeTruthy();

    discardThroughTheDialog();
    await waitFor(() => expect(screen.getByText(STILL_IN_MAILBOX)).toBeTruthy());
    expect(screen.queryByText(IN_MAILBOX)).toBeNull();
  });

  /**
   * Discard ASKS first (the platform's destructive-action rule). Asserted on
   * its own rather than folded into the test above, because "the press wrote
   * the row" and "the press only opened a dialog" are different claims, and
   * a helper that walks the dialog would hide the second one.
   */
  it("asks before discarding, and writes nothing until the dialog is answered", async () => {
    discarded.mockResolvedValue({ ...DRAFT, status: "discarded" });
    render(<MailDraftCard draft={DRAFT} />);

    fireEvent.click(screen.getByText(DISCARD));
    expect(discarded).not.toHaveBeenCalled();
    /* the dialog names the reply being thrown away, not just "are you sure" */
    expect(screen.getByRole("alertdialog", { name: DISCARD_TITLE })).toBeTruthy();

    fireEvent.click(screen.getByText("انصراف"));
    expect(discarded).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();

    discardThroughTheDialog();
    await waitFor(() => expect(discarded).toHaveBeenCalledWith("d-1"));
  });

  it("renders a decided draft as a record, with no send", () => {
    render(<MailDraftCard draft={{ ...DRAFT, status: "sent", decided_at: new Date().toISOString() }} />);
    expect(screen.queryByText(SEND)).toBeNull();
    expect(screen.queryByText(DISCARD)).toBeNull();
  });
  it("offers the upgrade instead of a Send that would fail at the provider", () => {
    /* a connection made before the compose scope reads mail fine and refuses
       to send it. The failure would be Google's and the person would read it
       as ours, so the press is not offered at all. */
    render(<MailDraftCard draft={DRAFT} canSend={false} />);
    expect(screen.queryByText(SEND)).toBeNull();
    expect(screen.getByText(ENABLE)).toBeTruthy();
  });

  it("offers Send when the connection can actually send — the control", () => {
    /* without this, "never offer Send" would pass every assertion above */
    render(<MailDraftCard draft={DRAFT} canSend />);
    expect(screen.getByText(SEND)).toBeTruthy();
  });

  /**
   * The message being answered, ABOVE the reply (user directive, 2026-08-28:
   * "the draft must come like this already prepared with the email on top of
   * it as well").
   *
   * "On top of" is the assertion, not "somewhere on the card": a quote
   * rendered underneath the reply asks a person to approve a decision and
   * only then shows them what it was about. So the check is DOM order, which
   * is the one thing a getByText pair cannot tell you.
   *
   * The second half is the degrade: reading the original is a live call to
   * the provider, and it must be able to fail without taking the reply — the
   * actual record — down with it.
   */
  it("names the original above the reply, and still shows the reply when it cannot be read", async () => {
    source.mockResolvedValue({
      from: "colleague@example.com",
      subject: "قرار سه‌شنبه",
      body: "سلام، برای سه‌شنبه وقت داری؟",
      occurred_at: "2026-08-28T07:30:00.000Z",
    });
    render(<MailDraftCard draft={DRAFT} />);

    const quoted = await screen.findByText("قرار سه‌شنبه");
    expect(screen.getByText("colleague@example.com")).toBeTruthy();
    /* the fetch asks for THIS draft — a card that quoted a fixed message, or
       the wrong one, would satisfy every text assertion above */
    expect(source).toHaveBeenCalledWith("d-1");

    const reply = screen.getByText(DRAFT.body);
    expect(
      Boolean(quoted.compareDocumentPosition(reply) & Node.DOCUMENT_POSITION_FOLLOWING),
      "the source renders BEFORE the reply",
    ).toBe(true);

    /*
     * The BODY of someone else's email is behind one press. Identifying a
     * source is what makes a reply checkable; reprinting it in full above
     * every draft pushes the thing being decided off the screen. Both halves
     * are asserted — collapsed means ABSENT here, not merely hidden, since a
     * `display:none` quote would still be read aloud by a screen reader.
     */
    expect(screen.queryByText("سلام، برای سه‌شنبه وقت داری؟")).toBeNull();
    fireEvent.click(screen.getByText(SHOW_SOURCE));
    expect(screen.getByText("سلام، برای سه‌شنبه وقت داری؟")).toBeTruthy();

    // the provider refuses: no quote, and the reply is untouched
    cleanup();
    source.mockRejectedValue(new Error("unreadable"));
    render(<MailDraftCard draft={DRAFT} />);
    await waitFor(() => expect(screen.getByText(SEND)).toBeTruthy());
    expect(screen.queryByText("سلام، برای سه‌شنبه وقت داری؟")).toBeNull();
    expect(screen.getByText(DRAFT.body)).toBeTruthy();
  });
});
