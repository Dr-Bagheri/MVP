import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE ASSISTANT APPEARS WHEN THE PERSON SIGNS IN — not on the reload after.
 *
 * User report, 2026-09-04: "on the first login the AI assistant sidebar will
 * not load; you need to refresh a second time after you login for it to be
 * added to the page."
 *
 * The identity check ran once, on mount, with an empty dependency list — and
 * the mount it ran on was the SIGN-IN page. Signing in navigates client-side,
 * so the layout holding the panel never unmounted, and the one answer it ever
 * got was "anonymous". A full reload remounted it and the assistant appeared.
 *
 * The test is about a NAVIGATION, which is why `usePathname` is a mock with a
 * value this file changes: a version that re-asks on a timer, or on focus, or
 * on any other trigger would pass a test that only re-rendered.
 */
let pathname = "/sign-in";
/* the panel reads the path from NEXT's hook, not the locale router's — the
   locale prefix is what `sidebarIsSilentOn` strips for itself */
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));
vi.mock("@/i18n/routing", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  Link: ({ href, children }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"}>{children}</a>
  ),
}));

const identityState = vi.fn();
vi.mock("@/api/client", () => ({
  api: {
    identityState: () => identityState(),
    agentSessions: async () => [],
    agents: async () => [],
    connectors: async () => [],
    cards: async () => ({ cards: [] }),
    me: async () => null,
  },
}));

const { AssistantSidebar } = await import("./AssistantSidebar");

/**
 * THE RAIL IS THE PANEL TAKING ITS PLACE.
 *
 * The panel itself renders through a portal and needs half a dozen stores to
 * mount fully; `--assistant-rail` is the variable it writes on the document so
 * the shell leaves room for it, and it is set from `visible` — the exact state
 * this test is about. `0px` is the value the effect writes when the assistant
 * is not on this screen, and its cleanup writes the same, so a stale non-zero
 * cannot make this pass by accident.
 */
const rail = () => document.documentElement.style.getPropertyValue("--assistant-rail");

beforeEach(() => {
  pathname = "/sign-in";
  identityState.mockReset();
});

describe("the assistant across the sign-in navigation", () => {
  it("appears once the identity is a member, without a reload", async () => {
    /* anonymous on the sign-in page, a member on the page after it — the two
       answers the same mounted component gets across one client-side
       navigation */
    identityState.mockResolvedValueOnce({ state: "anonymous" });
    const view = render(<AssistantSidebar />);
    await waitFor(() => expect(identityState).toHaveBeenCalledTimes(1));
    expect(rail(), "the panel took room from an anonymous visitor").toBe("0px");

    identityState.mockResolvedValueOnce({ state: "member" });
    /* the board, which is the screen the report came from — NOT `/assistant`,
       where the panel deliberately stands down (a second door into the room
       you are standing in). Picking that one first made this test fail for a
       reason that was about the destination rather than about the identity. */
    pathname = "/tasks";
    view.rerender(<AssistantSidebar />);

    await waitFor(() => expect(identityState).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(rail(), "the panel needed a reload to appear").not.toBe("0px"));
  });

  it("stops asking once it has a member — the latch, not a subscription", async () => {
    identityState.mockResolvedValue({ state: "member" });
    const view = render(<AssistantSidebar />);
    await waitFor(() => expect(identityState).toHaveBeenCalledTimes(1));

    /*
     * The control. Re-asking on every navigation forever would pass the test
     * above and put a request on every page change for the whole session —
     * a fix whose cost is invisible until somebody reads the network tab.
     */
    pathname = "/tasks";
    view.rerender(<AssistantSidebar />);
    pathname = "/meetings";
    view.rerender(<AssistantSidebar />);
    await waitFor(() => expect(rail()).not.toBe("0px"));
    expect(identityState, "it kept asking after it had its answer").toHaveBeenCalledTimes(1);
  });
});
