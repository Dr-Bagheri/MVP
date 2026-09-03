import { act, cleanup, render, screen } from "@testing-library/react";
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
    id: "a-sys", handle: "roya", name: "wire-name-never-shown",
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
    const card = screen.getByRole("link", { name: "گفت‌وگو با رؤیا" });
    expect(card.getAttribute("href")).toBe("/assistant?agent=roya");
  });

  it("localizes a SHIPPED agent's copy and leaves an authored one as written", async () => {
    await act(async () => { mount(); });
    /* the catalogue's name renders and the wire's never does */
    /* db/0163: the eight job-shaped agents are gone and رؤیا is the shipped
       one this fixture stands for — the RULE is unchanged (the catalogue's
       name renders and the wire's never does), only its subject */
    expect(screen.getByText("رؤیا")).toBeTruthy();
    expect(screen.queryByText("wire-name-never-shown")).toBeNull();
    /* the org agent's own words, untouched — the other half of the rule */
    expect(screen.getByText("Growth helper")).toBeTruthy();
  });

  it("offers Edit only where the wall would let the save land", async () => {
    await act(async () => { mount(); });
    /* member: the system card has no menu, and neither does the org card */
    expect(screen.queryByRole("button", { name: /گزینه‌های/ })).toBeNull();

    cleanup();
    ROLE = "admin";
    await act(async () => { mount(); });
    /* admin: the ORG card gains its menu; the system card still has none —
       core's PATCH refuses level system, and a form whose save can only 404
       is worse than no form */
    expect(screen.getByRole("button", { name: "گزینه‌های Growth helper" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "گزینه‌های دستیار جلسه‌ها" })).toBeNull();
  });
});
