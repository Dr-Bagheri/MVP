import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectorStatus } from "@/api/types";

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

/** google, connected, with drafting granted — the healthy row */
const GOOGLE: ConnectorStatus = {
  provider: "google",
  configured: true,
  status: "connected",
  account_label: "amir@example.test",
  expires_at: "2026-12-01T00:00:00.000Z",
  can_draft: true,
  polled_at: POLLED,
  messages_seen: 65,
};

vi.mock("@/components/platform/PlatformShell", () => ({
  PlatformShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/platform/AssistantMenu", () => ({
  AssistantMenu: () => null,
}));

vi.mock("@/i18n/routing", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => "/integrations",
}));

vi.mock("@/api/client", () => ({
  api: {
    connectors: async () => CONNECTORS,
    me: async () => ({
      id: "u-1", org_id: "o-1", username: "amir", email: "amir@example.test",
      display_name: "امیررضا", display_name_en: null, avatar_url: null,
      role: "owner", status: "active", locale: "fa", model_id: null,
      created_at: "2026-01-01T00:00:00.000Z", calendar: "auto", timezone: "auto",
    }),
    connectorAuthorization: async () => "https://accounts.example.test/authorize",
  },
}));

const { Integrations } = await import("./Integrations");

beforeEach(() => {
  cleanup();
  CONNECTORS = [
    GOOGLE,
    /* the operator never gave this deployment Microsoft credentials */
    {
      provider: "microsoft",
      configured: false,
      status: "not_configured",
      account_label: null,
      expires_at: null,
      can_draft: false,
      polled_at: null,
      messages_seen: 0,
    },
  ];
});

describe("the integrations page", () => {
  /**
   * ONE grant, TWO rows, and the pair is the assertion.
   *
   * The mailbox is polled, so it has a last-looked time and a count of
   * messages passed through; the calendar is read on demand and has neither.
   * A per-provider row could only ever report one of those two states, which
   * is precisely the fact the user came to this table for ("i got the email
   * but it did not update itself... it must show in that table").
   *
   * Both halves are asserted together because either alone passes against
   * code that says the same thing on every row: "the calendar shows a dash"
   * is satisfied by a table with no counts at all, and "Gmail shows 65" is
   * satisfied by a table that prints the count on every row it draws.
   */
  it("splits one connection into its sources, and reports the mailbox's sync where the calendar has none", async () => {
    await act(async () => { render(<Integrations />); });

    /* scoped to the TABLE: «جی‌میل» and «تقویم گوگل» also name the tiles in
       the Available section below, and an unscoped query cannot tell "it is
       in the table" from "it is on the page somewhere" */
    const table = await screen.findByRole("table");
    const gmail = within(table).getByText("جی‌میل").closest("tr")!;
    const calendar = within(table).getByText("تقویم گوگل").closest("tr")!;

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
   * The search box, proven by the row it must REMOVE.
   *
   * A filter is only a filter if some input makes rows disappear; asserting
   * that the matching row is still there would pass against a box wired to
   * nothing, which is the control-that-does-nothing defect this repo treats
   * as a bug rather than as decoration.
   */
  it("filters the table by what is typed, including the account under the name", async () => {
    await act(async () => { render(<Integrations />); });
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

  it("renders an unconfigured provider as a sentence, and a configured one as a button", async () => {
    await act(async () => { render(<Integrations />); });

    const notConfigured = "مایکروسافت روی سرور پیکربندی نشده است";
    // both Outlook tiles say it, and neither offers anything to press
    expect(screen.getAllByText(notConfigured).length).toBe(2);
    expect(screen.queryByRole("button", { name: /مایکروسافت/ })).toBeNull();

    /*
     * The control. Same provider, same page, one field different: with OAuth
     * credentials in place the tiles must offer a real Connect button — the
     * question this check has to be able to answer NO to.
     */
    cleanup();
    CONNECTORS = [
      GOOGLE,
      {
        provider: "microsoft",
        configured: true,
        status: "not_connected",
        account_label: null,
        expires_at: null,
        can_draft: false,
        polled_at: null,
        messages_seen: 0,
      },
    ];
    await act(async () => { render(<Integrations />); });

    expect(screen.queryByText(notConfigured)).toBeNull();
    expect(screen.getAllByRole("button", { name: "اتصال مایکروسافت" }).length).toBe(2);
  });
});
