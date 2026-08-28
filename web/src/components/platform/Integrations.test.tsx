import { act, cleanup, render, screen, within } from "@testing-library/react";
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

/** google, connected, with drafting granted — the healthy row */
const GOOGLE: ConnectorStatus = {
  provider: "google",
  configured: true,
  status: "connected",
  account_label: "amir@example.test",
  expires_at: "2026-12-01T00:00:00.000Z",
  can_draft: true,
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
    },
  ];
});

describe("the integrations page", () => {
  it("puts a connected account in the table, with what the product actually knows about it", async () => {
    await act(async () => { render(<Integrations />); });

    /* scoped to the row: «متصل» also appears on the tiles below, and an
       unscoped query cannot tell "it is in the table" from "it is on the
       page somewhere" */
    const row = (await screen.findByText("amir@example.test")).closest("tr")!;
    expect(within(row).getByText("گوگل")).toBeTruthy();
    expect(within(row).getByText("متصل")).toBeTruthy();
    // personal by construction, and the signed-in person is who consented
    expect(within(row).getByText("شخصی")).toBeTruthy();
    expect(within(row).getByText("امیررضا")).toBeTruthy();

    /* the provider with no credentials on this server has no ROW at all —
       there is no connection to report on */
    expect(screen.queryByText("مایکروسافت متصل است")).toBeNull();
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
      },
    ];
    await act(async () => { render(<Integrations />); });

    expect(screen.queryByText(notConfigured)).toBeNull();
    expect(screen.getAllByRole("button", { name: "اتصال مایکروسافت" }).length).toBe(2);
  });
});
