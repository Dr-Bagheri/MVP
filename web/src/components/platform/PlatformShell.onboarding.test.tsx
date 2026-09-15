import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE SHELL SENDS AN UNFINISHED ARRIVAL TO THE FIRST-TIME FLOW (M54).
 *
 * The sign-in page routes there too, but a bookmark, a shared link or a
 * second tab lands on a shell page first — so the shell is where the rule
 * has to hold. Three answers from `/api/me`, three different outcomes, and
 * the third is the one a `!stamp` would get wrong: an ABSENT stamp is a
 * deployment without the flow, and sending its every member to a route
 * whose save cannot land would be the worst version of "helpful".
 */
const replace = vi.fn();
vi.mock("@/i18n/routing", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => "/meetings",
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

const me = vi.fn();
vi.mock("@/api/client", () => ({
  api: { me: () => me(), platformAccess: async () => ({ platform_root: false }) },
}));
vi.mock("./IconRail", () => ({ IconRail: () => null }));
vi.mock("./TopBar", () => ({ TopBar: () => null }));
vi.mock("./BottomBar", () => ({ BottomBar: () => null }));
vi.mock("./MeetingInviteGate", () => ({ MeetingInviteGate: () => null }));

const { PlatformShell } = await import("./PlatformShell");

const MEMBER = { id: "u1", locale: "fa", calendar: "auto", timezone: "auto", role: "owner", status: "active" };

beforeEach(() => {
  replace.mockReset();
  me.mockReset();
});

describe("the shell and the first-time flow", () => {
  it("a member whose stamp is NULL is sent to /onboarding", async () => {
    me.mockResolvedValue({ ...MEMBER, onboarding: {}, onboarding_completed_at: null });
    render(<PlatformShell><p>page</p></PlatformShell>);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/onboarding"));
  });

  it("a member with a stamp stays where they are", async () => {
    me.mockResolvedValue({ ...MEMBER, onboarding: {}, onboarding_completed_at: "2026-09-15T00:00:00Z" });
    render(<PlatformShell><p>page</p></PlatformShell>);
    await waitFor(() => expect(me).toHaveBeenCalled());
    expect(replace).not.toHaveBeenCalled();
  });

  it("THE CONTROL: a member with NO stamp field at all — an un-migrated deployment — is not sent anywhere", async () => {
    me.mockResolvedValue({ ...MEMBER });
    render(<PlatformShell><p>page</p></PlatformShell>);
    await waitFor(() => expect(me).toHaveBeenCalled());
    expect(replace).not.toHaveBeenCalled();
  });
});
