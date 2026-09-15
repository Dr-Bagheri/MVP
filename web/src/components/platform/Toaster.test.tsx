import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as RadixDialog from "@radix-ui/react-dialog";
import { describe, expect, it } from "vitest";
import { notify, notifyError, notifySuccess, notifyWarn } from "@/lib/notify";

/**
 * THE ONE PLACE A MESSAGE APPEARS.
 *
 * The Toaster is NOT rendered here. `vitest.setup.ts` mounts it before every
 * test in the suite, because that is what the locale layout does before every
 * screen in the product — and a test that mounted its own copy would be
 * testing a second stack that does not exist, while the one every other suite
 * relies on went unexercised. What is asserted below is therefore exactly
 * what any other component's test is standing on.
 *
 * The four things worth holding still:
 *
 *  1. ONE LINE, and the kind on the glyph. A card carries the sentence and a
 *     mark; it does not carry a title over a subtitle, because the directive
 *     is one line and a two-line card invites copy that needs two.
 *  2. `alert` for the two that failed, `status` for the two that did not. A
 *     screen reader interrupts for a refusal and waits for a save.
 *  3. THE STACK IS BOUNDED. Three at once; a fourth pushes the oldest off.
 *  4. IT OUTLIVES `aria-hidden`. Every modal in the product is Radix, and
 *     Radix hides every child of <body> but its own portal while a dialog is
 *     open. That is the exact moment the most important sentences are raised
 *     — a save refused inside the dialog that refused it — and a stack that
 *     went silent there would be visibly fine and unreadable to the people
 *     who most need it read.
 */
describe("the toast stack", () => {
  it("says it in ONE line, with the kind on the glyph", async () => {
    act(() => { notifyError("ذخیره نشد."); });
    const card = await screen.findByRole("alert");
    expect(card.textContent).toContain("ذخیره نشد.");
    /* the mark is the error circle, not the tick or the caution triangle —
       read off `data-icon`, which is what `Icon` stamps for exactly this */
    expect(card.querySelector("[data-icon]")?.getAttribute("data-icon")).toBe("errorCircle");
  });

  it("gives each kind its own mark", async () => {
    act(() => {
      notifySuccess("ذخیره شد.");
      notifyWarn("چیزی را نگاه کنید.");
      notify("برای اطلاع.");
    });
    const cards = await waitFor(() => {
      const found = Array.from(document.querySelectorAll("[data-toaster] .toast-card"));
      expect(found).toHaveLength(3);
      return found;
    });
    /* the FIRST icon in each card — the second is the X, and reading every
       `[data-icon]` on the stack counts six for three notices */
    expect(cards.map((card) => card.querySelector("[data-icon]")?.getAttribute("data-icon")))
      .toEqual(["checkCircle", "warn", "infoCircle"]);
  });

  it("interrupts for a failure and waits for a success", async () => {
    act(() => { notifySuccess("ذخیره شد."); });
    expect((await screen.findByRole("status")).textContent).toContain("ذخیره شد.");
    expect(screen.queryByRole("alert")).toBeNull();

    act(() => { notifyWarn("نگاه کنید."); });
    expect((await screen.findByRole("alert")).textContent).toContain("نگاه کنید.");
  });

  it("keeps three, and the fourth pushes the oldest off", async () => {
    act(() => {
      notifyError("یک");
      notifyError("دو");
      notifyError("سه");
      notifyError("چهار");
    });
    await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(3));
    const stack = screen.getAllByRole("alert").map((el) => el.textContent ?? "");
    expect(stack.some((line) => line.includes("چهار"))).toBe(true);
    /* the LOAD-BEARING half: it is the OLDEST that left, not the newest that
       was refused entry — a cap that dropped arrivals would silently swallow
       the message somebody is waiting for */
    expect(stack.some((line) => line.includes("یک"))).toBe(false);
  });

  /*
   * REPEATS (user report, 2026-09-08: "fix issues where the same message is
   * used multiple time in the same time").
   *
   * One action is routinely several writes — four cards moved between
   * columns is four PATCHes — so one dead connection says the same sentence
   * four times. Three of those filled the whole stack and pushed out the
   * other message a person needed; the fourth was dropped on the floor.
   */
  it("says a repeated sentence ONCE, and counts it", async () => {
    act(() => {
      notifyError("ذخیره نشد.");
      notifyError("ذخیره نشد.");
      notifyError("ذخیره نشد.");
    });
    const card = await screen.findByRole("alert");
    /* one card, not three — `findByRole` throws on more than one match, so
       the line above is half the assertion by itself */
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(card.textContent).toContain("ذخیره نشد.");
    /* and it SAYS it was three. A burst collapsed into a card with nothing
       to show it was a burst is a screen deciding the person did not need to
       know how much failed. */
    expect(card.textContent).toContain("۳");
  });

  it("a repeat does not push the message beside it off the stack", async () => {
    act(() => {
      notifyError("اتصال قطع شد.");
      notifyError("ذخیره نشد.");
      notifyError("ذخیره نشد.");
      notifyError("ذخیره نشد.");
    });
    await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(2));
    /* the FIRST one is still there. Before the collapse, three repeats of
       the second sentence filled MAX_STACK and evicted it — the one message
       that was not a duplicate was the one that got lost. */
    const stack = screen.getAllByRole("alert").map((el) => el.textContent ?? "");
    expect(stack.some((line) => line.includes("اتصال قطع شد."))).toBe(true);
  });

  it("keeps a repeat where it already stands, rather than moving it", async () => {
    act(() => {
      notifyError("اولی");
      notifyError("دومی");
    });
    await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(2));
    act(() => { notifyError("اولی"); });
    await waitFor(() =>
      expect(screen.getAllByRole("alert")[0]?.textContent).toContain("اولی"));
    /* the eye is already reading this stack: a card that jumped to the
       bottom on being repeated would move the words somebody is mid-sentence
       through */
    expect(screen.getAllByRole("alert")[1]?.textContent).toContain("دومی");
  });

  it("a different KIND of the same words is a different notice", async () => {
    act(() => {
      notifyError("همان جمله");
      notifyWarn("همان جمله");
    });
    /* the collapse is on the sentence AND the kind. Two different things
       happened, and merging them would report a failure as a caution or
       silently drop one of the two. */
    await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(2));
  });

  it("the X closes the one it is on, and only that one", async () => {
    act(() => {
      notifyError("اولی");
      notifyError("دومی");
    });
    await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(2));
    const first = screen.getAllByRole("alert").find((el) => el.textContent?.includes("اولی"));
    await userEvent.click(within(first!).getByRole("button"));
    await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(1));
    expect(screen.getByRole("alert").textContent).toContain("دومی");
  });

  it("is still readable when a modal has hidden the rest of the page", async () => {
    /* THE REAL MECHANISM, not a hand-set attribute. Radix is what every
       dialog in the product is built on, and an open Radix dialog is what
       calls `aria-hidden`'s `hideOthers` on every other child of <body>. A
       test that set the attribute itself would be asserting against its own
       idea of what Radix does. */
    render(
      <RadixDialog.Root open>
        <RadixDialog.Portal>
          <RadixDialog.Content aria-label="گفت‌وگو">
            <RadixDialog.Title>گفت‌وگو</RadixDialog.Title>
          </RadixDialog.Content>
        </RadixDialog.Portal>
      </RadixDialog.Root>,
    );
    await screen.findByRole("dialog", { name: "گفت‌وگو" });

    act(() => { notifyError("ذخیره نشد."); });
    /* `findByRole` will not see an aria-hidden subtree, so this line IS the
       assertion — it passes only because the stack takes the attribute back */
    expect((await screen.findByRole("alert")).textContent).toContain("ذخیره نشد.");
    expect(document.querySelector("[data-toaster]")?.getAttribute("aria-hidden")).toBeNull();
  });
});
