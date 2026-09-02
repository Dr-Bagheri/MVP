import { act, cleanup, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentCard } from "@/api/types";

/**
 * The card's contract (user directive, 2026-08-28): a press GOES — to the
 * assistant with the agent picked — and editing is an OPTION on the card's
 * ⋯ menu, not the press. The load-bearing assertions are the link's address
 * (the stale-`/` bug shipped once because the route resolved) and the
 * absence of the menu where the wall would refuse the save anyway.
 *
 * The harness renders the REAL fa catalogue. The localization fixture is
 * made DISCRIMINATING by the wire: the system agent arrives with a name the
 * catalogue does not contain, so "the catalogue won" and "the wire leaked
 * through" produce different screens — a wire name equal to the catalogue's
 * could never tell them apart.
 */
vi.mock("@/components/platform/PlatformShell", () => ({
  PlatformShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/platform/AssistantMenu", () => ({
  AssistantMenu: () => <nav />,
}));
vi.mock("@/i18n/routing", () => ({
  Link: ({ href, children, ...props }: { href: unknown; children: React.ReactNode }) => (
    <a
      href={typeof href === "string" ? href
        : `${(href as { pathname: string }).pathname}?agent=${(href as { query?: { agent?: string } }).query?.agent ?? ""}`}
      {...props}
    >{children}</a>
  ),
}));

let ROLE = "member";
const AGENTS: AgentCard[] = [
  {
    /* the name is deliberately NOT the catalogue's: it must never render */
    id: "a-sys", handle: "meetings", name: "wire-name-never-shown",
    description: "wire-desc-never-shown", level: "system",
    icon: "sparkles", color: "violet", model: null,
    tools: ["search_transcripts"], web: false,
  },
  {
    id: "a-org", handle: "agent-org-1", name: "Growth helper",
    description: "Our own agent.", level: "org",
    icon: "sparkles", color: "blue", model: null, tools: [], web: false,
  },
];

vi.mock("@/api/client", () => ({
  api: {
    agents: async () => AGENTS,
    me: async () => ({ id: "u1", role: ROLE }),
  },
}));

const { Agents } = await import("./Agents");

function mount() {
  return render(<Agents />);
}

describe("the agent cards", () => {
  beforeEach(() => { cleanup(); ROLE = "member"; });

  it("a card is a door to the assistant, with the agent in the query", async () => {
    await act(async () => { mount(); });
    const card = screen.getByRole("link", { name: "گفت‌وگو با دستیار جلسه‌ها" });
    expect(card.getAttribute("href")).toBe("/assistant?agent=meetings");
  });

  it("localizes a SHIPPED agent's copy and leaves an authored one as written", async () => {
    await act(async () => { mount(); });
    /* the catalogue's name renders and the wire's never does */
    expect(screen.getByText("دستیار جلسه‌ها")).toBeTruthy();
    expect(screen.queryByText("wire-name-never-shown")).toBeNull();
    /* the org agent's own words, untouched — the other half of the rule */
    expect(screen.getByText("Growth helper")).toBeTruthy();
  });

  it("offers Edit only where the wall would let the save land", async () => {
    /*
     * The edit affordance is a FOOTER BUTTON now (2026-09-02, the reference's
     * card): a kebab holding one item was a button wearing a hat. The rule it
     * carries is unchanged — offered only where the wall would let the save
     * land — so the assertions moved from a menu's label to the button, and
     * are scoped to the CARD: a page-wide "there is an edit button" could not
     * tell the org card's from the system card's.
     */
    const cardOf = (name: string) => screen.getByText(name).closest("article")!;
    await act(async () => { mount(); });
    /* member: neither the system card nor the org card offers Edit */
    expect(screen.queryByRole("button", { name: "ویرایش" })).toBeNull();

    cleanup();
    ROLE = "admin";
    await act(async () => { mount(); });
    /* admin: the ORG card gains Edit; the system card still has none —
       core's PATCH refuses level system, and a form whose save can only 404
       is worse than no form */
    expect(within(cardOf("Growth helper")).getByRole("button", { name: "ویرایش" })).toBeTruthy();
    expect(within(cardOf("دستیار جلسه‌ها")).queryByRole("button", { name: "ویرایش" })).toBeNull();
    /* and «گفتگو» is on EVERY card — talking to an agent needs no wall */
    expect(screen.getAllByRole("link", { name: /Growth helper|دستیار جلسه‌ها/ }).length).toBeGreaterThanOrEqual(2);
  });
});
