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

vi.mock("@/i18n/routing", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => "/workflows",
}));

vi.mock("@/api/client", () => ({
  api: { workflows: async () => CARDS },
}));

const { Workflows } = await import("./Workflows");

beforeEach(cleanup);

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
});
