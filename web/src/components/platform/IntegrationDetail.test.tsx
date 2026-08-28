import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectorItem, ConnectorStatus } from "@/api/types";

/**
 * The detail page's failure modes all render beautifully, which is why each
 * gets a discriminating assertion rather than a screenshot-shaped one:
 *
 *  - a page that fetches the WRONG source draws a perfect table of somebody
 *    else's items — so the fetch ARGUMENT is the assertion, not the rows;
 *  - a disconnect wired straight to the press destroys a grant on a
 *    mis-click — so the wire call is asserted absent until the dialog's own
 *    confirm, and present after;
 *  - Drive on a pre-Drive grant must be an offer, not an error — and the
 *    can_drive:true control is what separates "the prompt appears when it
 *    should" from "the prompt appears always".
 */
let CONNECTORS: ConnectorStatus[] = [];
let ITEMS: ConnectorItem[] = [];

const GOOGLE: ConnectorStatus = {
  provider: "google",
  configured: true,
  status: "connected",
  account_label: "amir@example.test",
  expires_at: "2026-12-01T00:00:00.000Z",
  can_draft: true,
  can_drive: true,
  polled_at: "2026-08-28T07:15:00.000Z",
  messages_seen: 65,
};

vi.mock("@/components/platform/PlatformShell", () => ({
  PlatformShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/platform/AssistantMenu", () => ({
  AssistantMenu: () => null,
}));

/* the page publishes its crumb; the provider lives in the locale layout,
   which this test does not mount */
vi.mock("@/components/platform/CrumbTitle", () => ({
  useCrumbTitle: () => {},
}));

const push = vi.fn();

vi.mock("@/i18n/routing", () => ({
  useRouter: () => ({ push, replace: () => {} }),
  usePathname: () => "/integrations/gmail",
}));

const connectorItems = vi.fn(async () => ITEMS);
const disconnectConnector = vi.fn(async () => undefined);

vi.mock("@/api/client", () => ({
  api: {
    connectors: async () => CONNECTORS,
    me: async () => ({
      id: "u-1", org_id: "o-1", username: "amir", email: "amir@example.test",
      display_name: "امیررضا", display_name_en: null, avatar_url: null,
      role: "owner", status: "active", locale: "fa", model_id: null,
      created_at: "2026-01-01T00:00:00.000Z", calendar: "auto", timezone: "auto",
    }),
    connectorItems: (...args: unknown[]) => connectorItems(...args as []),
    disconnectConnector: (...args: unknown[]) => disconnectConnector(...args as []),
    connectorAuthorization: async () => "https://accounts.example.test/authorize",
  },
}));

const { IntegrationDetail } = await import("./IntegrationDetail");

beforeEach(() => {
  cleanup();
  push.mockClear();
  connectorItems.mockClear();
  disconnectConnector.mockClear();
  CONNECTORS = [GOOGLE];
  ITEMS = [
    { id: "ev-1", title: "جلسهٔ برنامه‌ریزی", subtitle: "دفتر مرکزی", occurred_at: "2026-08-29T09:00:00.000Z" },
    { id: "ev-2", title: "Weekly sync", subtitle: "", occurred_at: null },
  ];
});

describe("the integration detail page", () => {
  /**
   * THE fetch-argument assertion. Every source's page renders the same
   * table anatomy, so "the calendar page shows rows" is satisfied by a page
   * hardwired to mail — only the argument pair can say the click's promise
   * was kept.
   */
  it("fetches THAT source's items — the slug names the wire call", async () => {
    await act(async () => { render(<IntegrationDetail slug="google-calendar" />); });

    // the table is the proof the fetch RAN; the argument is what it asked for
    const table = await screen.findByRole("table");
    expect(connectorItems).toHaveBeenCalledWith("google", "calendar");
    expect(within(table).getByText("جلسهٔ برنامه‌ریزی")).toBeTruthy();
    expect(within(table).getByText("Weekly sync").closest("tr")!.textContent).toContain("—");
  });

  it("names the mailbox's own facts on the gmail page", async () => {
    await act(async () => { render(<IntegrationDetail slug="gmail" />); });
    // the details panel: cumulative poller count, distinct from the listing
    expect(await screen.findByText("پیام‌های بررسی‌شده")).toBeTruthy();
    expect(connectorItems).toHaveBeenCalledWith("google", "mail");
    expect(screen.getByText("۶۵")).toBeTruthy();
    // access is a product fact: just you
    expect(screen.getByText("فقط خودتان")).toBeTruthy();
  });

  /**
   * Disconnect asks first, in the theme's one dialog — and the wire call
   * happens ONLY on the dialog's confirm. The not-yet assertion is the
   * load-bearing one: without it, a menu item wired straight to the write
   * passes every "the dialog renders" check.
   */
  it("disconnects through ConfirmDialog, never on the menu press itself", async () => {
    await act(async () => { render(<IntegrationDetail slug="gmail" />); });

    fireEvent.click(await screen.findByRole("button", { name: "تنظیمات این اتصال" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "قطع اتصال" }));

    const dialog = await screen.findByRole("alertdialog");
    // the two consequences a person cannot see from the button
    expect(within(dialog).getByText(/با هم قطع می‌شوند/)).toBeTruthy();
    // asked, not done: the grant still stands
    expect(disconnectConnector).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "قطع اتصال" }));
    });
    expect(disconnectConnector).toHaveBeenCalledWith("google");
    // the connection is gone; the page walks back to the overview
    expect(push).toHaveBeenCalledWith("/integrations");
  });

  /**
   * Drive on a grant that predates the scope: the page OFFERS a reconnect
   * and — the half a rendered prompt cannot show — never asks the provider
   * for a listing the grant cannot serve.
   */
  it("offers reconnect on a pre-Drive grant and fetches nothing; the full grant fetches", async () => {
    CONNECTORS = [{ ...GOOGLE, can_drive: false }];
    await act(async () => { render(<IntegrationDetail slug="google-drive" />); });

    expect(await screen.findByText("برای دسترسی به درایو دوباره وصل شوید")).toBeTruthy();
    expect(connectorItems).not.toHaveBeenCalled();

    /* the control: with the scope granted the prompt is absent and the
       listing IS fetched, for drive — the question this test can answer NO
       to, without which "the prompt appears" is satisfied by always */
    cleanup();
    CONNECTORS = [GOOGLE];
    await act(async () => { render(<IntegrationDetail slug="google-drive" />); });
    await screen.findByRole("table");
    expect(screen.queryByText("برای دسترسی به درایو دوباره وصل شوید")).toBeNull();
    expect(connectorItems).toHaveBeenCalledWith("google", "drive");
  });

  it("answers an unknown slug with a sentence, not a broken screen", async () => {
    await act(async () => { render(<IntegrationDetail slug="no-such-thing" />); });
    expect(screen.getByText("چنین اتصالی در دسترس نیست.")).toBeTruthy();
    expect(connectorItems).not.toHaveBeenCalled();
  });

  it("filters the asset table by what is typed — proven by the row it removes", async () => {
    await act(async () => { render(<IntegrationDetail slug="google-calendar" />); });
    const table = await screen.findByRole("table");

    fireEvent.change(screen.getByPlaceholderText("جست‌وجو در موارد"), {
      target: { value: "برنامه" },
    });
    expect(within(table).queryByText("Weekly sync")).toBeNull();
    expect(within(table).getByText("جلسهٔ برنامه‌ریزی")).toBeTruthy();
  });
});
