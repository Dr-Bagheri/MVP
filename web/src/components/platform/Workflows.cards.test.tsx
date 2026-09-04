import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StarterWorkflow, WorkflowCard } from "@/api/types";
import fa from "../../messages/fa.json";
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
    description: "Turn one selected calendar event into a concise, evidence-based meeting brief.",
    source_kind: "calendar_event",
    icon: "calendar",
    color: "violet",
  },
];

let CARD_ROWS: WorkflowCard[] = CARDS;

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
    workflows: async () => CARD_ROWS,
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
  /* the rows the wire serves, reset per test — the localization control
     needs to hand back a RENAMED row, which a const array cannot do */
  CARD_ROWS = CARDS;
});


/**
 * Show the LIBRARY half.
 *
 * The page is two tabs since 2026-09-04 ("add a sub menu on the top in
 * workflow as well with name Active Workflow and second Workflow library") and
 * opens on Active — what this organization runs, which is the question a
 * person arrives with. The shelf is the other tab, so a case about the shelf
 * goes through the tab rather than reaching past it.
 */
async function showLibrary() {
  await act(async () => {
    fireEvent.click(screen.getByRole("tab", {
      name: (accessible) => accessible.startsWith(fa.workflows.libraryTitle),
    }));
  });
}

describe("the workflows list", () => {
  it("renders one card per template, with the WHOLE card as the link", async () => {
    await act(async () => { render(<Workflows />); });

    /* the ACTIVE half is the two templates alone now — the shelf moved to its
       own tab, which is the whole point of the change. Asserted as an exact
       list so a starter leaking back into this half fails here. */
    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/workflows/draft-email-replies",
      "/workflows/prepare-meetings",
    ]);

    /* and the shelf IS reachable, in registry order — derived from the
       producer, never transcribed. Without this the assertion above would be
       satisfied by a page that had simply lost the library. */
    await showLibrary();
    expect(screen.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(
      Object.values(STARTER_WORKFLOWS).map((starter) => `/workflows/${starter.handle}`),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("tab", {
        name: (accessible) => accessible.startsWith(fa.workflows.activeTitle),
      }));
    });

    /* the description lives INSIDE the link — the assertion the previous
       title-only-link shape fails, and the only one that distinguishes a card
       that is a button from a card with a button in it.
       And it is the LOCALIZED description: db/0065 seeds these two rows in
       English, and rendering the wire string straight is how the flagship of
       a Persian-first product introduced itself in English on its own page
       (user report with the screenshot). Both halves come from fa.json rather
       than being typed here, so the test cannot disagree with the catalogue. */
    for (const [index, card] of CARDS.entries()) {
      const copy = (fa.workflows.card as Record<string, { name: string; description: string }>)[card.slug]!;
      expect(links[index]!.textContent).toContain(copy.name);
      expect(links[index]!.textContent).toContain(copy.description);
    }
  });

  it("CONTROL: a template the org RENAMED keeps its own words", async () => {
    /*
     * The half that makes the localization safe rather than merely present.
     * The catalogue replaces a string only while it is still word for word
     * what we shipped — so an organization that renamed its template sees its
     * own name in every locale. Without this, "localize the shipped copy"
     * quietly becomes "overwrite whatever is stored", and somebody's rename
     * disappears the next time they switch language.
     */
    CARD_ROWS = [{ ...CARDS[0]!, name: "پاسخ‌های تیم فروش" }];
    await act(async () => { render(<Workflows />); });
    expect(screen.getAllByRole("link")[0]!.textContent).toContain("پاسخ‌های تیم فروش");
    expect(screen.getAllByRole("link")[0]!.textContent).not.toContain(
      (fa.workflows.card as Record<string, { name: string }>)["draft-email-replies"]!.name,
    );
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

    /* the installed one is on the ACTIVE tab, as the authored card — checked
       here, before switching, because "hidden from the shelf" and "hidden
       from the page" are the two things this case must tell apart */
    expect(
      screen.getAllByRole("link")
        .map((link) => link.getAttribute("href"))
        .filter((href) => href === "/workflows/wf-starter-autotag"),
    ).toHaveLength(1);

    await showLibrary();
    const hrefs = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
    /* NOT installed → on the shelf, linking to its own page */
    expect(hrefs).toContain("/workflows/wf-starter-followups");
    /* installed → OFF the shelf (its card on the other tab is the real thing) */
    expect(hrefs).not.toContain("/workflows/wf-starter-autotag");
    /* the shelf shrank by exactly the installed one. The whole TAB is the
       shelf now, so this counts the page's links rather than a section's —
       and that is only true because the active half is not rendered here. */
    expect(hrefs).toHaveLength(Object.keys(STARTER_WORKFLOWS).length - 1);
    /* and a shelf card carries the LOCALIZED name — the same
       `useWorkflowCopy` path the agent panel and the installed cards use */
    expect(screen.getByText("پیگیری جلسه‌ها")).toBeTruthy();
  });
});
