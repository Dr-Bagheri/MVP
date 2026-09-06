import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectorStatus } from "@/api/types";
import fa from "../../messages/fa.json";

/**
 * The integrations page has one failure mode that renders perfectly: a tile
 * for a provider the SERVER holds no OAuth credentials for, drawn as a working
 * Connect button. Pressing it cannot succeed for any person on any account —
 * `not_configured` is a claim about the product, not about this member — so
 * the tile has to say so in a sentence and offer nothing to press.
 *
 * That is asserted against a POSITIVE CONTROL in the same test: the same
 * provider, `configured` and merely not connected, must offer a real button.
 * Without the pair, "no Connect button for Microsoft" is satisfied just as
 * happily by a page that never renders a Connect button at all.
 *
 * `CONNECTORS` is reassigned per case rather than being two fixtures, so both
 * halves are read through the one code path the product uses.
 */
let CONNECTORS: ConnectorStatus[] = [];

/**
 * Today at 10:45, built from the clock rather than written as a literal: the
 * row's first line is a RELATIVE date, so a fixed ISO string would render
 * «امروز» on the day it was written and a calendar date forever after —
 * a test that stops testing what it was written for without ever going red.
 */
const POLLED = (() => {
  const at = new Date();
  at.setHours(10, 45, 0, 0);
  return at.toISOString();
})();

/** google, connected, with drafting AND drive granted — the healthy row */
const GOOGLE: ConnectorStatus = {
  provider: "google",
  configured: true,
  status: "connected",
  account_label: "amir@example.test",
  expires_at: "2026-12-01T00:00:00.000Z",
  can_draft: true,
  can_drive: true,
  polled_at: POLLED,
  messages_seen: 65,
};

vi.mock("@/components/platform/PlatformShell", () => ({
  PlatformShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/platform/AssistantMenu", () => ({
  AssistantMenu: () => null,
}));

/** captured so a row click can be asserted as the NAVIGATION it promises */
const push = vi.fn();

vi.mock("@/i18n/routing", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
  useRouter: () => ({ push, replace: () => {} }),
  usePathname: () => "/integrations",
}));

/** a vi.fn so the briefing test can assert WHEN the OAuth flow starts */
const connectorAuthorization = vi.fn(async () => "https://accounts.example.test/authorize");

vi.mock("@/api/client", () => ({
  api: {
    connectors: async () => CONNECTORS,
    me: async () => ({
      id: "u-1", org_id: "o-1", username: "amir", email: "amir@example.test",
      display_name: "امیررضا", display_name_en: null, avatar_url: null,
      role: "owner", status: "active", locale: "fa", model_id: null,
      created_at: "2026-01-01T00:00:00.000Z", calendar: "auto", timezone: "auto",
    }),
    connectorAuthorization: (...args: unknown[]) => connectorAuthorization(...args as []),
  },
}));

const { Integrations } = await import("./Integrations");

beforeEach(() => {
  cleanup();
  push.mockClear();
  connectorAuthorization.mockClear();
  /*
   * Google alone. Microsoft came off the OFFER (user directive, 2026-08-28:
   * "we just go with the google") — the server still speaks Graph and an
   * existing Microsoft grant still lists, but nothing is sold, so a fixture
   * carrying one would be describing a screen this product does not render.
   */
  CONNECTORS = [GOOGLE];
});


/**
 * Show the CONNECTED half.
 *
 * The page is two tabs now (user directive, 2026-09-04) and opens on
 * Available, because a fresh account has nothing connected and an empty table
 * is a poor first screen. Four cases here are about the connected table, so
 * they say so — going through the real tab rather than reaching past it, for
 * the reason every menu test in this repo does: a test that reached past the
 * control would keep passing after the control stopped working.
 */
async function showConnected() {
  /* named from the CATALOGUE, not retyped: a tab label with a ZWNJ in it is
     one a hand-written regex gets subtly wrong, and the failure reads as "the
     tab does not exist" rather than "I spelled it differently" */
  /* a PREFIX match, from the catalogue rather than retyped: the tab's
     accessible name is its label PLUS its count badge, and an exact match
     against the label alone fails in a way that reads as "the tab does not
     exist" rather than "the name has a number on the end" */
  const tab = screen.getByRole("tab", {
    name: (accessible) => accessible.startsWith(fa.integrations.connectedTitle),
  });
  await act(async () => { fireEvent.click(tab); });
}

describe("the integrations page", () => {
  /**
   * ONE grant, FOUR rows, and the differences between them are the assertion.
   *
   * The mailbox is polled, so it has a last-looked time and a count of
   * messages passed through; calendar, Meet and Drive are read on demand and
   * have neither. A per-provider row could only ever report one of those
   * states, which is precisely the fact the user came to this table for
   * ("i got the email but it did not update itself... it must show in that
   * table").
   *
   * Both halves are asserted together because either alone passes against
   * code that says the same thing on every row: "the calendar shows a dash"
   * is satisfied by a table with no counts at all, and "Gmail shows 65" is
   * satisfied by a table that prints the count on every row it draws.
   */
  it("splits one connection into its sources, and reports the mailbox's sync where the others have none", async () => {
    await act(async () => { render(<Integrations />); });
    await showConnected();

    /* scoped to the TABLE: «جی‌میل» and «تقویم گوگل» also name the tiles in
       the Available section below, and an unscoped query cannot tell "it is
       in the table" from "it is on the page somewhere" */
    const table = await screen.findByRole("table");
    const gmail = within(table).getByText("جی‌میل").closest("tr")!;
    const calendar = within(table).getByText("تقویم گوگل").closest("tr")!;

    // the grant fans out into Drive and Meet rows too (user directive:
    // "add google meet, google drive, gmail there as well")
    expect(within(table).getByText("گوگل درایو")).toBeTruthy();
    expect(within(table).getByText("گوگل میت")).toBeTruthy();

    // the account the grant was made on, under BOTH of its sources
    expect(within(gmail).getByText("amir@example.test")).toBeTruthy();
    expect(within(calendar).getByText("amir@example.test")).toBeTruthy();

    // the mailbox: polled, so it says WHEN, and how many it has been through
    expect(within(gmail).getByText("همگام شد")).toBeTruthy();
    expect(within(gmail).getByText(/امروز/)).toBeTruthy();
    expect(within(gmail).getByText(/۱۰:۴۵/)).toBeTruthy();
    expect(within(gmail).getByText("۶۵")).toBeTruthy();

    /* the calendar: live, but nothing polls it and nothing counts there —
       so it says «فعال» with no time, and its Assets cell is a dash rather
       than a number we would have had to invent */
    expect(within(calendar).getByText("فعال")).toBeTruthy();
    expect(within(calendar).queryByText(/امروز/)).toBeNull();
    expect(within(calendar).getByText("—")).toBeTruthy();

    // personal by construction, and the signed-in person is who consented
    expect(within(gmail).getByText("شخصی")).toBeTruthy();
    expect(within(gmail).getByText("امیررضا")).toBeTruthy();

    /* the provider with no credentials on this server has no ROW at all —
       there is no connection to report on */
    expect(within(table).queryByText("ایمیل اوت‌لوک")).toBeNull();
  });

  /**
   * The row is the way in (user directive: "the items in table must be
   * selectable"). Asserted as the NAVIGATION it performs — the pushed
   * address carries the source's own slug, which is what makes the detail
   * page fetch THAT source's items and not whichever one is first.
   */
  it("opens a source's own detail page when its row is clicked", async () => {
    await act(async () => { render(<Integrations />); });
    await showConnected();
    const table = await screen.findByRole("table");

    fireEvent.click(within(table).getByText("تقویم گوگل").closest("tr")!);
    expect(push).toHaveBeenCalledWith("/integrations/google-calendar");

    fireEvent.click(within(table).getByText("جی‌میل").closest("tr")!);
    expect(push).toHaveBeenCalledWith("/integrations/gmail");
  });

  /**
   * The search box, proven by the row it must REMOVE.
   *
   * A filter is only a filter if some input makes rows disappear; asserting
   * that the matching row is still there would pass against a box wired to
   * nothing, which is the control-that-does-nothing defect this repo treats
   * as a bug rather than as decoration.
   */
  it("filters the table by what is typed, including the account under the name", async () => {
    await act(async () => { render(<Integrations />); });
    await showConnected();
    const table = await screen.findByRole("table");
    const box = screen.getByPlaceholderText("جست‌وجو در اتصال‌ها");

    await act(async () => {
      fireEvent.change(box, { target: { value: "تقویم" } });
    });
    expect(within(table).queryByText("جی‌میل")).toBeNull();
    expect(within(table).getByText("تقویم گوگل")).toBeTruthy();

    /* the account label is the row's other line, and a search that ignored
       it would answer "nothing found" for text plainly on the screen */
    await act(async () => {
      fireEvent.change(box, { target: { value: "amir@example" } });
    });
    expect(within(table).getByText("جی‌میل")).toBeTruthy();
  });

  it("renders an unconfigured provider as a status and nothing to press, and a configured one as a door", async () => {
    /*
     * The vehicle is GOOGLE now, not Microsoft: the distinction under test is
     * "the operator gave this deployment no OAuth credentials" versus "they
     * did", and it has to be asked of a provider the page actually renders.
     */
    CONNECTORS = [{
      provider: "google",
      configured: false,
      status: "not_configured",
      account_label: null,
      expires_at: null,
      can_draft: false,
      can_drive: false,
      polled_at: null,
      messages_seen: 0,
    }];
    await act(async () => { render(<Integrations />); });

    const notConfigured = "روی سرور پیکربندی نشده";
    // all four Google tiles wear the status, and none is a control
    expect(screen.getAllByText(notConfigured).length).toBe(4);
    expect(screen.queryByRole("button", { name: /^اتصال / })).toBeNull();

    /*
     * The control. Same provider, same page, one field different: with OAuth
     * credentials in place the tiles must offer a real Connect button — the
     * question this check has to be able to answer NO to.
     */
    cleanup();
    CONNECTORS = [{
      provider: "google",
      configured: true,
      status: "not_connected",
      account_label: null,
      expires_at: null,
      can_draft: false,
      can_drive: false,
      polled_at: null,
      messages_seen: 0,
    }];
    await act(async () => { render(<Integrations />); });

    expect(screen.queryByText(notConfigured)).toBeNull();
    /* the TILE is the control, named for what it connects — four tiles, four
       names, so a screen reader is not offered «اتصال گوگل» four times */
    for (const name of ["جی‌میل", "تقویم گوگل", "گوگل درایو", "گوگل میت"]) {
      expect(screen.getByRole("button", { name: `اتصال ${name}` })).toBeTruthy();
    }
    expect(screen.getAllByText("وصل نشده").length).toBe(4);
  });

  /**
   * The connect BRIEFING (user directive: "when you click the one without
   * connections it must show like the image that connect me").
   *
   * The load-bearing half is the ORDER: pressing Connect must open the
   * dialog and must NOT start the OAuth redirect — the redirect is spent
   * only by the dialog's own button. Without the not-yet assertion, a tile
   * wired straight to the provider passes every "the dialog renders"
   * check by rendering it beside the navigation it failed to hold back.
   */
  it("briefs before the OAuth redirect: dialog first, provider only on its button", async () => {
    CONNECTORS = [{
      provider: "google",
      configured: true,
      status: "not_connected",
      account_label: null,
      expires_at: null,
      can_draft: false,
      can_drive: false,
      polled_at: null,
      messages_seen: 0,
    }];
    await act(async () => { render(<Integrations />); });

    fireEvent.click(screen.getByRole("button", { name: "اتصال جی‌میل" }));

    const dialog = await screen.findByRole("alertdialog");
    // what the person is agreeing to, before the provider asks them again
    expect(within(dialog).getByText("اتصال خصوصی")).toBeTruthy();
    expect(within(dialog).getByText(/یک بار ورود با گوگل/)).toBeTruthy();
    // the flow has NOT started — the dialog is a door, not a decoration
    expect(connectorAuthorization).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "اتصال فقط برای من" }));
    });
    expect(connectorAuthorization).toHaveBeenCalledWith("google", "fa");
  });

  /**
   * Drive on a grant that predates the scope: connected-and-cannot-list is
   * an OFFER to reconnect, never an error — and never a silent hole. The
   * control (can_drive: true) is what distinguishes "the prompt appears
   * when it should" from "the prompt appears always".
   */
  it("offers reconnect-for-Drive on a pre-Drive grant, and not on a full one", async () => {
    CONNECTORS = [{ ...GOOGLE, can_drive: false }];
    await act(async () => { render(<Integrations />); });

    /* the offer is the Drive TILE itself, in the Available half — the page's
       opening tab, so nothing is switched to see it: its chip names what is
       missing and its one press is the re-consent */
    const drive = screen.getByRole("button", { name: "اتصال دوبارهٔ گوگل درایو برای دسترسی به درایو" });
    expect(within(drive).getByText("بدون دسترسی به درایو")).toBeTruthy();
    /* no briefing in between: the account is already connected and briefed,
       so the press goes straight to the provider */
    await act(async () => { fireEvent.click(drive); });
    expect(connectorAuthorization).toHaveBeenCalledWith("google", "fa");
    /* and no Drive ROW in the connected half: a grant that never covered Drive
       has no Drive connection to report on — not a broken one, an unasked one */
    await showConnected();
    const table = screen.getByRole("table");
    expect(within(table).queryByText("گوگل درایو")).toBeNull();

    // the control: with the scope granted, no such prompt anywhere
    cleanup();
    CONNECTORS = [GOOGLE];
    await act(async () => { render(<Integrations />); });
    expect(screen.queryByText("بدون دسترسی به درایو")).toBeNull();
    expect(screen.queryByRole("button", { name: /برای دسترسی به درایو$/ })).toBeNull();
    /* and the Drive tile is the ordinary connected door */
    expect(screen.getByRole("button", { name: "بازکردن جزئیات گوگل درایو" })).toBeTruthy();
    await showConnected();
    expect(within(screen.getByRole("table")).getByText("گوگل درایو")).toBeTruthy();
  });

  /**
   * THE SHELF (user directive, 2026-09-06: "like an app store … smaller
   * buttons same size each row 4 of them with their own logos and just the
   * name and their status"). Asserted as the four things the directive names
   * and as one ABSENCE: the description, which the previous cards carried and
   * which is the sentence R21 forbids — a shelf that grew it back would look
   * finished and be wrong.
   */
  it("is an app-store shelf: four to a row, each tile the provider's own mark, the name and its status here — nothing else", async () => {
    await act(async () => { render(<Integrations />); });
    const gmail = await screen.findByRole("button", { name: "بازکردن جزئیات جی‌میل" });

    // the grid: four columns from md up, two below
    const grid = gmail.parentElement!;
    expect(grid.className).toContain("md:grid-cols-4");
    expect(grid.className).toContain("grid-cols-2");
    expect(grid.children.length).toBe(4);

    // every tile: THIS provider's mark (inline — no remote brand asset), the name, the status
    const tiles = [
      ["gmail", "جی‌میل"], ["google-calendar", "تقویم گوگل"],
      ["google-drive", "گوگل درایو"], ["google-meet", "گوگل میت"],
    ] as const;
    for (const [slug, name] of tiles) {
      const tile = screen.getByRole("button", { name: `بازکردن جزئیات ${name}` });
      expect(tile.parentElement, `${slug} sits in the grid`).toBe(grid);
      expect(tile.querySelector(`svg[data-brand="${slug}"]`), `${slug}'s own mark`).not.toBeNull();
      expect(within(tile).getByText(name)).toBeTruthy();
      expect(within(tile).getByText("متصل است")).toBeTruthy();
      /* one shape for all four: the same class string, whatever the state,
         is what keeps a row of tiles one height */
      expect(tile.className).toBe(gmail.className);
    }

    // and nothing else: no description, no provider line
    expect(within(grid).queryByText(fa.integrations.gmailDesc)).toBeNull();
    expect(within(grid).queryByText("گوگل")).toBeNull();

    // a connected tile opens its own page
    fireEvent.click(gmail);
    expect(push).toHaveBeenCalledWith("/integrations/gmail");
  });

  it("offers nothing Microsoft, anywhere on the page", async () => {
    /*
     * The negative control for the offer list. Asserting the Google rows are
     * present cannot distinguish "Microsoft is gone" from "Microsoft was
     * never asked about" — only a question that SHOULD answer no can. If the
     * offer widens again, this fails and names the reason.
     */
    await act(async () => { render(<Integrations />); });
    expect(screen.queryByText("ایمیل اوت‌لوک")).toBeNull();
    expect(screen.queryByText("تقویم اوت‌لوک")).toBeNull();
    expect(screen.queryByRole("button", { name: /مایکروسافت/ })).toBeNull();
  });
});
