import { act, cleanup, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StarterWorkflow, WorkflowCard } from "@/api/types";
/* the PRODUCER's registry, imported in Node exactly as workflowName.test.ts
   does — the library fixture below is derived from it rather than
   hand-written, so a starter added in core is in this suite's world the
   moment it exists (rule 10: the fixture comes from the producer) */
import { STARTER_WORKFLOWS } from "../../../../core/src/api/workflow-authoring.ts";

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

const BASE_AUTHORED = [{
  id: "a1", handle: "wf-a1", name: "پیگیری", description: "", enabled: false,
  trigger_event: null, current_version: null, current_version_id: null,
  versions: 0, created_at: "2026-08-28T10:00:00.000Z",
}];
/** reassigned per test — the dedupe test installs a starter here */
let AUTHORED = BASE_AUTHORED;

/** the GET's rows, derived from the registry — the wire mapping core serves */
const STARTERS: StarterWorkflow[] = Object.entries(STARTER_WORKFLOWS).map(
  ([key, starter]) => ({
    key,
    handle: starter.handle,
    name: starter.name,
    description: starter.description,
    trigger_event: starter.trigger_event,
    max_autonomy: starter.max_autonomy,
    graph: starter.graph as unknown as StarterWorkflow["graph"],
  }),
);

vi.mock("@/api/client", () => ({
  api: {
    workflows: async () => CARDS,
    me: async () => ({ role }),
    authoredWorkflows: async () => AUTHORED,
    workflowStarters: async () => STARTERS,
    autoApplyRules: async () => [],
  },
}));

const { Workflows } = await import("./Workflows");

beforeEach(() => {
  cleanup();
  role = "member";
  AUTHORED = BASE_AUTHORED;
});

describe("the workflows list", () => {
  it("renders one card per template, with the WHOLE card as the link", async () => {
    await act(async () => { render(<Workflows />); });

    /* the two templates first, then the whole LIBRARY in registry order —
       the expected list is derived from the producer, never transcribed */
    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/workflows/draft-email-replies",
      "/workflows/prepare-meetings",
      ...Object.values(STARTER_WORKFLOWS).map((starter) => `/workflows/${starter.handle}`),
    ]);

    /* the description lives INSIDE the link — the assertion the previous
       title-only-link shape fails, and the only one that distinguishes a card
       that is a button from a card with a button in it */
    for (const [index, card] of CARDS.entries()) {
      expect(links[index]!.textContent).toContain(card.name);
      expect(links[index]!.textContent).toContain(card.description);
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

  /**
   * The LIBRARY's dedupe — the load-bearing half (user directive,
   * 2026-08-28: every shipped starter reachable from this page, but an
   * installed one already has a real card above, and the same handle twice
   * reads as two different workflows).
   *
   * Both directions in one test, scoped to the library's own section: the
   * installed starter's NAME legitimately renders twice on this page (its
   * authored card above localizes through the same path), so an unscoped
   * absence check would fail against correct code, and an unscoped presence
   * check would pass against a library that lists everything.
   */
  it("lists an uninstalled starter in the library and hides an installed one", async () => {
    role = "owner";
    AUTHORED = [{
      ...BASE_AUTHORED[0]!,
      id: "a2", handle: "wf-starter-autotag",
      name: STARTER_WORKFLOWS.autotag.name, enabled: true,
    }];
    await act(async () => { render(<Workflows />); });

    const section = screen.getByText("کتابخانهٔ گردش‌کارها").closest("section")!;
    const hrefs = within(section).getAllByRole("link")
      .map((link) => link.getAttribute("href"));
    /* NOT installed → on the shelf, linking to its own page */
    expect(hrefs).toContain("/workflows/wf-starter-followups");
    /* installed → OFF the shelf (its card above is the real thing)… */
    expect(hrefs).not.toContain("/workflows/wf-starter-autotag");
    /* …while the page as a whole still links it exactly once, as the
       authored card — hidden from the shelf, not from the page */
    expect(
      screen.getAllByRole("link")
        .map((link) => link.getAttribute("href"))
        .filter((href) => href === "/workflows/wf-starter-autotag"),
    ).toHaveLength(1);
    /* the shelf shrank by exactly the installed one */
    expect(within(section).getAllByRole("link"))
      .toHaveLength(Object.keys(STARTER_WORKFLOWS).length - 1);
    /* and a shelf card carries the LOCALIZED name — the same
       `useWorkflowCopy` path the agent panel and the installed cards use */
    expect(within(section).getByText("پیگیری جلسه‌ها")).toBeTruthy();
  });
});
