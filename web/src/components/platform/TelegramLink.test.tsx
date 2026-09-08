import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * db/0212 — linking a Telegram account.
 *
 * The screen is small and one assertion carries it: **the code is shown, and
 * only here.** The server stores a SHA-256, so if this component ever fails
 * to display what it minted, the person's only route to that code is gone —
 * and the feature is a button that appears to do nothing.
 *
 * The real catalogue answers, so a missing key renders as `profile.telegramX`
 * and fails loudly rather than quietly matching a key.
 */

const telegramLink = vi.fn();
const mintTelegramCode = vi.fn();
const unlinkTelegram = vi.fn();

vi.mock("@/api/client", () => ({
  api: {
    telegramLink: () => telegramLink(),
    mintTelegramCode: () => mintTelegramCode(),
    unlinkTelegram: () => unlinkTelegram(),
  },
  BffError: class extends Error {},
}));

const { TelegramLink } = await import("./TelegramLink");

const unlinked = {
  linked: false, telegram_username: null, linked_at: null,
  code_expires_at: null, bot_username: "neurai_bot",
};
/* the same person, in an org whose bot nobody has connected — a different
   sentence, not a missing one */
const noBot = { ...unlinked, bot_username: null };
const linked = {
  linked: true, telegram_username: "sina", linked_at: "2026-09-08T10:00:00Z",
  code_expires_at: null, bot_username: "neurai_bot",
};

beforeEach(() => {
  telegramLink.mockReset();
  mintTelegramCode.mockReset();
  unlinkTelegram.mockReset();
});

describe("linking a Telegram account", () => {
  it("shows the code it minted, exactly once and in Latin order", async () => {
    telegramLink.mockResolvedValue(unlinked);
    mintTelegramCode.mockResolvedValue({ code: "ABCD2345", expires_at: "2026-09-08T10:15:00Z" });
    render(<TelegramLink />);

    await userEvent.click(await screen.findByRole("button", { name: /کد اتصال/ }));
    const code = await screen.findByText("ABCD2345");
    expect(code).toBeInTheDocument();
    /* the code is Latin letters and digits on a Persian page: without an
       explicit direction a bidi-neutral run reorders them, and a person
       types what they see */
    expect(code.getAttribute("dir")).toBe("ltr");
  });

  it("names the bot the person has to send it to", async () => {
    telegramLink.mockResolvedValue(unlinked);
    render(<TelegramLink />);
    /* the sentence is a CONSEQUENCE (R21's kept kind): it says what pressing
       the button lets happen, and there is nowhere else to learn the handle */
    await waitFor(() => expect(screen.getByText(/@neurai_bot/)).toBeInTheDocument());
  });

  it("does not invent a bot name when there is none to give", async () => {
    telegramLink.mockResolvedValue(noBot);
    render(<TelegramLink />);
    await waitFor(() => expect(screen.getByText(/ربات تلگرام سازمان/)).toBeInTheDocument());
    expect(screen.queryByText(/@/)).toBeNull();
  });

  it("shows the linked account instead of a code, once it is linked", async () => {
    telegramLink.mockResolvedValue(linked);
    render(<TelegramLink />);
    await waitFor(() => expect(screen.getByText("@sina")).toBeInTheDocument());
    /* the pair: no minting control survives once the account is linked, or
       the screen offers two states at once */
    expect(screen.queryByRole("button", { name: /کد اتصال/ })).toBeNull();
    expect(screen.getByRole("button", { name: /قطع اتصال/ })).toBeInTheDocument();
  });

  it("asks before unlinking, and re-reads afterwards", async () => {
    telegramLink.mockResolvedValueOnce(linked).mockResolvedValueOnce(unlinked);
    unlinkTelegram.mockResolvedValue(undefined);
    render(<TelegramLink />);

    await userEvent.click(await screen.findByRole("button", { name: /قطع اتصال/ }));
    /* the confirm is the wall: nothing has been sent yet */
    expect(unlinkTelegram).not.toHaveBeenCalled();
    /* an ALERTDIALOG, which is what ConfirmDialog renders — "dialog" here
       found nothing and the failure read as "the confirm never opened" */
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /قطع اتصال/ }));

    await waitFor(() => expect(unlinkTelegram).toHaveBeenCalledTimes(1));
    /* and the screen goes back to offering a code — a stale "connected" row
       after an unlink is the state that reads as "it did not work" */
    await waitFor(() => expect(screen.getByRole("button", { name: /کد اتصال/ })).toBeInTheDocument());
  });

  it("says the read FAILED rather than turning forever, or claiming not-linked", async () => {
    /*
     * Three states, and two of them are nothing. The first version of this
     * component had two, so a failed read left a skeleton spinning: a screen
     * that looks like it is still loading, permanently, with nothing to press
     * and nothing said. "Not linked" would have been worse — that is a claim
     * about the person's account, made without knowing.
     */
    telegramLink.mockRejectedValue(new Error("upstream"));
    render(<TelegramLink />);
    await waitFor(() => expect(screen.getByText(/خوانده نشد/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /کد اتصال/ })).toBeNull();
    expect(screen.getByRole("button", { name: /دوباره/ })).toBeInTheDocument();
  });

  it("says nothing about the link while the read is in flight", () => {
    telegramLink.mockReturnValue(new Promise(() => {}));
    render(<TelegramLink />);
    /* "not linked" is a claim about somebody's account, and a screen that
       makes it before it knows is the loading-vs-empty confusion pointed at
       a security fact */
    expect(screen.queryByRole("button", { name: /کد اتصال/ })).toBeNull();
    expect(screen.queryByText("@sina")).toBeNull();
  });
});
