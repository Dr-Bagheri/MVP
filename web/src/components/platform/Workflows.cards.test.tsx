import { act, cleanup, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowCard } from "@/api/types";

/**
 * The workflows list is two big buttons now, and "big button" is a claim about
 * the TARGET, not about the styling.
 *
 * The shape this replaced put the link around the mark and the name only, with
 * the description and a Start button outside it — so most of a card-shaped
 * thing did nothing when pressed, which is invisible in a screenshot and
 * invisible to any assertion that reads the title's own href. The question
 * that can tell the two apart is whether the DESCRIPTION is inside the link,
 * so that is what is asked here.
 *
 * The fixture is `db/0065`'s two seeded rows, transcribed field for field —
 * including `icon`/`color`, which the tile reads and a hand-written fixture
 * would have guessed.
 */
const CARDS: WorkflowCard[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    slug: "draft-email-replies",
    name: "Draft email replies",
    description: "Turn one selected email into a thoughtful reply draft for the user to review.",
    source_kind: "mail_message",
    icon: "send",
    color: "coral",
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    slug: "prepare-meetings",
    name: "Prepare me for meetings",
    description: "Gather context on the people and the agenda before a meeting starts.",
    source_kind: "calendar_event",
    icon: "calendar",
    color: "violet",
  },
];

vi.mock("@/components/platform/PlatformShell", () => ({
  PlatformShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

/* the section menu has reads of its own; this page is the subject */
vi.mock("@/components/platform/AssistantMenu", () => ({
  AssistantMenu: () => null,
}));

/*
 * The page reads `?new=1` so the section menu's "Create workflow" can arrive
 * with the builder opening. Outside the app router there is no provider and
 * `useSearchParams()` answers null, which is a fact about the harness rather
 * than about the page — so the harness supplies the params, empty.
 */
let SEARCH = "";
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(SEARCH),
}));

vi.mock("@/i18n/routing", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => "/workflows",
}));

/**
 * The identity the page reads. The builder's door is ADMIN-only, so the role
 * is a variable here rather than a constant: the same page has to be asked
 * both questions, and a fixture that can only answer one of them cannot tell
 * a gate from a missing feature.
 */
let role = "member";

const AUTHORED = [{
  id: "a1", handle: "wf-a1", name: "پیگیری", description: "", enabled: false,
  trigger_event: null, current_version: null, current_version_id: null,
  versions: 0, created_at: "2026-08-28T10:00:00.000Z",
}];

vi.mock("@/api/client", () => ({
  api: {
    workflows: async () => CARDS,
    me: async () => ({ role }),
    authoredWorkflows: async () => AUTHORED,
    autoApplyRules: async () => [],
  },
}));

const { Workflows } = await import("./Workflows");

beforeEach(() => {
  cleanup();
  role = "member";
});

describe("the workflows list", () => {
  it("renders one card per template, with the WHOLE card as the link", async () => {
    await act(async () => { render(<Workflows />); });

    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/workflows/draft-email-replies",
      "/workflows/prepare-meetings",
    ]);

    /* the description lives INSIDE the link — the assertion the previous
       title-only-link shape fails, and the only one that distinguishes a card
       that is a button from a card with a button in it */
    for (const [index, link] of links.entries()) {
      expect(link.textContent).toContain(CARDS[index]!.name);
      expect(link.textContent).toContain(CARDS[index]!.description);
    }
  });

  it("offers no way to start a run from the list", async () => {
    /*
     * Asserted as an ABSENCE, because the version with Start buttons renders
     * perfectly: running moved onto the workflow's own page, where the steps
     * it will follow are on screen beside the button.
     *
     * Scoped to the GRID rather than the document: the shell's own chrome owns
     * buttons (the menu's collapse control) that have nothing to do with this
     * page, and a document-wide count would report them as a finding.
     */
    await act(async () => { render(<Workflows />); });
    const grid = screen.getAllByRole("link")[0]!.parentElement!;
    expect(within(grid).queryAllByRole("button")).toEqual([]);
  });

  /**
   * The builder's door, asked in both directions.
   *
   * A single "the admin sees it" assertion cannot distinguish a gate from a
   * button that is simply always there — which is the version that ships a
   * member a control the server will refuse. The member half is the question
   * that has to answer NO.
   */
  it("shows the builder's door to admins and to nobody else", async () => {
    await act(async () => { render(<Workflows />); });
    expect(screen.queryByRole("button", { name: "ساخت گردش‌کار" })).toBeNull();
    /* the authored card too: a member's catalogue is the two templates */
    expect(screen.queryByText("پیگیری")).toBeNull();

    cleanup();
    role = "owner";
    await act(async () => { render(<Workflows />); });
    expect(screen.getByRole("button", { name: "ساخت گردش‌کار" })).toBeTruthy();
    /*
     * An authored workflow is a CARD in the same grid now, not a list row
     * with an edit button (user directive, 2026-08-28: "half the size of
     * the email and meeting calendar button with same style") — and a card
     * is a LINK to the workflow's own page, where the editing lives.
     */
    const authoredCard = screen.getByText("پیگیری").closest("a");
    expect(authoredCard?.getAttribute("href")).toContain("/workflows/wf-a1");
  });

  /**
   * Arriving with the builder already opening — how the section menu's
   * "Create workflow" reaches this page from anywhere else in the assistant.
   *
   * Both directions again, and the second one is not politeness: the param
   * is a REQUEST from a link anybody can type, so a member arriving with it
   * must get the page, not an editor whose Save the server would refuse.
   */
  it("opens the builder when it arrives with ?new=1, for an admin only", async () => {
    SEARCH = "new=1";
    role = "owner";
    await act(async () => { render(<Workflows />); });
    expect(screen.getByText("گردش‌کار تازه")).toBeTruthy();

    cleanup();
    role = "member";
    await act(async () => { render(<Workflows />); });
    expect(screen.queryByText("گردش‌کار تازه")).toBeNull();
    SEARCH = "";
  });
});
