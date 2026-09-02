import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AssistantConversationProvider, useAssistantConversation } from "./AssistantConversationState";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "fa",
}));

/* the menu NAVIGATES to resume a conversation now (the orb is suppressed on
   every surface it renders on), so the stub owes it a router */
const pushed: unknown[] = [];
vi.mock("@/i18n/routing", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a>,
  useRouter: () => ({ push: (to: unknown) => { pushed.push(to); }, replace: () => {} }),
  usePathname: () => "/assistant",
}));

const { AssistantMenu } = await import("./AssistantMenu");

describe("AssistantMenu", () => {
  it("keeps New conversation enabled, idle on a blank hub, and resettable after a turn", () => {
    function StateProbe() {
      const { started, setStarted, resetVersion } = useAssistantConversation();
      return <>
        <button type="button" onClick={() => setStarted(true)}>start</button>
        <output>{`${started}:${resetVersion}`}</output>
      </>;
    }
    render(
      <AssistantConversationProvider>
        <StateProbe />
        <AssistantMenu activeSlug="new" />
      </AssistantConversationProvider>,
    );

    const fresh = screen.getByRole("button", { name: "newConversation" });
    expect(fresh.getAttribute("aria-disabled")).toBeNull();
    expect(screen.getByText("false:0")).toBeTruthy();
    fireEvent.click(fresh);
    expect(screen.getByText("false:0")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "start" }));
    fireEvent.click(fresh);
    expect(screen.getByText("false:1")).toBeTruthy();
    /* history is a page with a table now, so the toolbar's second item is the
       link to it (2026-09-02 — the recents that used to sit in this pane are
       that page's rows) */
    expect(screen.getByRole("link", { name: "title" }).getAttribute("href")).toBe("/conversations");
  });

  it("keeps New conversation on assistant subpages and navigates to the hub", () => {
    /*
     * 2026-08-25: the hub moved off `/` when the dashboard became the landing
     * page — the item still NAVIGATES from a subpage, which is the property
     * this test exists for.
     *
     * It is a BUTTON rather than a link now (2026-09-02), because on the hub
     * itself the same control RESETS an in-progress thread rather than going
     * anywhere: one control, two jobs, decided by where you are standing. So
     * the assertion moved from an href to the push it performs.
     */
    render(
      <AssistantConversationProvider>
        <AssistantMenu activeSlug="history" />
      </AssistantConversationProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "newConversation" }));
    expect(pushed).toContain("/assistant");
  });
});
