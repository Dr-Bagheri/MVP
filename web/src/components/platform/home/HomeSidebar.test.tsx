import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE SESSION ROWS.
 *
 * Three behaviours, and each is asserted with the case that would pass without
 * it:
 *
 *  · the AGE is per row and comes from the row's own stamp — a version that
 *    printed one clock for the whole list satisfies "an age is rendered";
 *  · DELETE ASKS — a handler that archives on the press passes every
 *    assertion about the menu item existing;
 *  · the WORKING row is coloured and the others are NOT, which is the half
 *    that catches a version that colours everything.
 *
 * The hover itself is CSS (`group-hover`), which jsdom computes not at all, so
 * these tests assert what is in the DOM and the browser is where "it appears on
 * hover" is checked. Asserting the class string instead would be asserting the
 * spelling of the mechanism rather than the mechanism.
 */

const agentSessions = vi.fn();
const archiveSession = vi.fn();
const announceChange = vi.fn();

/** the assistant store's snapshot, swapped per test */
let snapshot = { messages: [], streaming: false, sessionId: null as string | null, floor: [], error: null };

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => Object.assign(
    (k: string, v?: Record<string, unknown>) =>
      v === undefined ? k : `${k}:${Object.values(v).join(",")}`,
    { raw: (k: string) => k },
  ),
}));
vi.mock("@/i18n/routing", () => ({
  Link: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>{children}</a>
  ),
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => "/",
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/api/client", () => ({
  api: {
    agentSessions: (...args: unknown[]) => agentSessions(...args),
    archiveSession: (...args: unknown[]) => archiveSession(...args),
  },
}));
vi.mock("@/lib/refreshBus", () => ({
  announceChange: (...args: unknown[]) => announceChange(...args),
  useRefreshEpoch: () => 0,
}));
vi.mock("@/lib/notify", () => ({ notify: vi.fn() }));
vi.mock("@/lib/assistantSession", () => ({
  subscribeAssistant: () => () => {},
  assistantSnapshot: () => snapshot,
  assistantServerSnapshot: () => snapshot,
  /* vitest.setup.ts resets the real store between tests, so a mock that omits
     this hook fails every case in the file with a message about the MOCK
     rather than about the subject — the shape a stubbed module owes its
     harness, not something this suite uses */
  resetAssistantForTest: () => {},
}));
vi.mock("@/components/platform/AssistantConversationState", () => ({
  useAssistantConversation: () => ({ started: false, startNewConversation: () => {} }),
}));

import { HomeConversationsSheet, HomeSidebar } from "./HomeSidebar";
import { registerPageMenuAnchor } from "@/components/platform/pageMenuAnchor";

const HOUR = 3_600_000;
const rows = () => [
  {
    id: "s-old", title: "Older thread", message_count: 4,
    created_at: new Date(Date.now() - 5 * HOUR).toISOString(),
    last_message_at: new Date(Date.now() - 3 * HOUR).toISOString(),
  },
  {
    id: "s-new", title: "Recent thread", message_count: 2,
    created_at: new Date(Date.now() - 20 * 60_000).toISOString(),
    last_message_at: new Date(Date.now() - 12 * 60_000).toISOString(),
  },
];

beforeEach(() => {
  snapshot = { messages: [], streaming: false, sessionId: null, floor: [], error: null };
  agentSessions.mockReset().mockResolvedValue(rows());
  archiveSession.mockReset().mockResolvedValue(undefined);
  announceChange.mockReset();
});
afterEach(cleanup);

/** the row's wrapper, found through the link a person actually presses */
const rowFor = (title: string) => {
  const link = screen.getByRole("link", { name: new RegExp(title) });
  const row = link.parentElement;
  if (row === null) throw new Error(`"${title}" has no row wrapper`);
  return row;
};

describe("the home sidebar's session rows", () => {
  it("stamps each row with ITS OWN age", async () => {
    render(<HomeSidebar />);
    await screen.findByText("Older thread");
    /*
     * The discriminating half: two rows, two different ages. A version reading
     * one clock — or `created_at` where the list is ordered by
     * `last_message_at` — renders two identical strings and passes any check
     * that only asks whether an age is present.
     */
    expect(within(rowFor("Older thread")).getByText("3h ago")).toBeInTheDocument();
    expect(within(rowFor("Recent thread")).getByText("12m ago")).toBeInTheDocument();
  });

  it("carries the exact date on the link's title beside the relative age", async () => {
    /* the age is for scanning and the title is for settling which day — a row
       that showed only «3h ago» cannot answer "was that Tuesday" */
    render(<HomeSidebar />);
    const link = await screen.findByRole("link", { name: /Older thread/ });
    expect(link.getAttribute("title")).toMatch(/^Older thread - .+/);
  });

  it("offers delete in the row's own menu, ASKS first, and archives only on consent", async () => {
    render(<HomeSidebar />);
    await screen.findByText("Older thread");

    const trigger = rowFor("Older thread").querySelector<HTMLElement>("button[aria-haspopup='menu']");
    expect(trigger, "the row has no ⋯ menu").not.toBeNull();
    fireEvent.pointerDown(trigger!, { button: 0 });
    fireEvent.click(trigger!);
    await act(async () => {});

    fireEvent.click(await screen.findByRole("menuitem", { name: /delete/ }));
    /* the press ASKS — nothing is written before the dialog's own consent */
    expect(archiveSession).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "delete" }));
    await act(async () => {});
    /* ARCHIVE, not delete: nothing in the product may delete a conversation
       row, and `true` is what keeps it out of every list */
    expect(archiveSession).toHaveBeenCalledWith("s-old", true);
    /* and the HISTORY TABLE hears about it — a local refetch would leave the
       row sitting in that table one press away */
    expect(announceChange).toHaveBeenCalledWith("sessions");
  });

  /*
   * THE DOT CARRIES THE STATE, NOT THE TITLE.
   *
   * This asserted `text-accent` on the LINK until the titles stopped
   * changing colour — the assertion outlived the rule it was written for, so
   * it read as a regression in the product rather than as stale copy of its
   * own. It reads the dot now, and the sr-only word beside it: colour was
   * the only announcement before, and colour is not one.
   */
  it("marks the row being answered — and ONLY that one", async () => {
    snapshot = { ...snapshot, streaming: true, sessionId: "s-new" };
    render(<HomeSidebar />);
    await screen.findByText("Recent thread");

    const dotOf = (title: string) =>
      screen.getByRole("link", { name: new RegExp(title) })
        .querySelector<HTMLElement>("span[aria-hidden]")!;
    expect(dotOf("Recent thread").className).toContain("animate-pulse");
    /* the sr-only word beside it, by its ROLE in the markup rather than by
       its text: this file's next-intl stub answers with key paths, so an
       exact string here would be asserting the stub */
    expect(rowFor("Recent thread").querySelector(".sr-only")).not.toBeNull();
    /* the control, and it is the whole test: a version that marks every row
       satisfies the lines above and is completely wrong */
    expect(dotOf("Older thread").className).not.toContain("animate-pulse");
    expect(rowFor("Older thread").querySelector(".sr-only")).toBeNull();
  });

  it("leaves every row plain when nothing is running", async () => {
    /* the other direction of the same rule — `streaming` false with a session
       id still set is the state right after an answer settles */
    snapshot = { ...snapshot, streaming: false, sessionId: "s-new" };
    render(<HomeSidebar />);
    await screen.findByText("Recent thread");
    for (const title of ["Recent thread", "Older thread"]) {
      expect(screen.getByRole("link", { name: new RegExp(title) })
        .querySelector<HTMLElement>("span[aria-hidden]")!.className)
        .not.toContain("animate-pulse");
    }
  });
});

/**
 * R23 — THE SIDEBAR IS CHROME (then, on the rendered screen).
 *
 * It carried `border-e border-border bg-surface`. The first pass took all
 * three, which removed the pane line AND the distinction from the thread
 * beside it; the sheet is what puts the distinction back without a line.
 *
 * The TRIPLE, because each part alone passes against a version that is still
 * wrong: the sheet without the seam check is the bordered look wearing glass;
 * the seam check without the sheet is the column dissolved into the chat; and
 * both without `w-64` are satisfied by a column that is not there.
 *
 * The sheet is asserted BY NAME, and so is the one it must NOT be: the
 * calibration is precisely "not the header's white", and a check that only
 * demanded some glass class would pass against the version this replaced.
 *
 * R24 - AND THE SEAM IS BACK, BUT NOT THE PANE. R23 pulled the edge, the pane
 * ink and the opaque ground as ONE gesture, and only two thirds of that
 * gesture were right:
 * `bg-surface` and `border-border` are what made this column read as a second
 * PANEL beside the thread. The edge on its own does not. So the seam is
 * REQUIRED here now, and pinned to `border-fg/[.07]` - the same ink as the
 * rule inside the column, because "the same color" means one value for every
 * line this sidebar draws, and a bare `border-e` check would pass against a
 * seam repainted in the pane tone R23 removed on purpose.
 */
describe("R23/R24: the home sidebar is its own sheet — not the page, not the header", () => {
  it("keeps its column, carries the chrome, and draws its edge without the pane", async () => {
    render(<HomeSidebar />);
    await screen.findByText("Older thread");
    const column = screen.getByRole("link", { name: /Older thread/ }).closest("nav");
    expect(column, "the sidebar is not a nav any more").not.toBeNull();
    const classes = column!.className.split(/\s+/);
    expect(classes, "the column lost its width").toContain("w-64");
    expect(classes, "the sidebar is not wearing its own sheet").toContain("glass-soft");
    /* and NOT the chrome's: `glass-chrome` is the rail's and the bar's white,
       which read as too much like a header and was rejected */
    expect(classes, "the sidebar took the chrome's tone instead of its own")
      .not.toContain("glass-chrome");
    /* the OPAQUE ground and the PANE-coloured hairline stay gone: those two
       are what made this column read as a second panel beside the thread */
    for (const seam of ["border-border", "bg-surface"]) {
      expect(classes, `the sidebar still carries ${seam}`).not.toContain(seam);
    }
    /* R24 - and the EDGE itself is back, drawn in the column's own ink */
    expect(classes, "the sidebar lost the seam against the chat").toContain("border-e");
    expect(classes, "the seam is not drawn in the column's own ink")
      .toContain("border-fg/[.07]");
  });
});

/**
 * THE SAME COLUMN ON A PHONE (2026-09-08 — the mobile view against the new
 * home page).
 *
 * The column is `lg:flex` for a good reason, and what that left below `lg` was
 * a Home with no door to any of it: New conversation, Workflows, Agents and
 * every stored conversation live in this file and nowhere else, and
 * `/workflows` and `/agents` redirect INTO the pane beside it — so on a phone
 * they resolved to a page whose sidebar is not rendered.
 *
 * The pair, again, because either half passes alone: a sheet that renders a
 * SECOND list would satisfy "the conversations are reachable" while being the
 * exact drift this component was extracted to prevent, and a sheet that never
 * closes satisfies "the rows are pressable" while burying the answer to the
 * press under itself.
 */
describe("the phone's slide-over", () => {
  it("opens the SAME component, not a second conversations list", async () => {
    render(<HomeConversationsSheet />);
    /* closed, it is one control and nothing else — no panel parked off screen
       with the list already fetched behind it */
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "sidebarLabel" }));
    const sheet = screen.getByRole("dialog", { name: "sidebarLabel" });

    /* the rows the column renders, inside the sheet — found through the store
       this file already mocks, so a hand-written list in the sheet would show
       up as the wrong titles rather than as no titles */
    const link = await within(sheet).findByRole("link", { name: /Older thread/ });
    expect(link).toBeTruthy();
    expect(within(sheet).getByRole("button", { name: /newConversation/ })).toBeTruthy();

    /* and it wears the SOLID sheet over the scrim (2026-09-09), not the
       column's soft tone — which composites to almost nothing against a
       darkened screen — and not the chrome's alpha either, which composites
       to grey there. A scrim behind a panel means `.glass-solid`. */
    const classes = sheet.className.split(/\s+/);
    expect(classes).toContain("glass-solid");
    expect(classes).not.toContain("glass-soft");
    expect(classes).not.toContain("glass-chrome");
    /* the column inside it draws no seam: there is no thread beside it here */
    const column = link.closest("nav")!;
    expect(column.className.split(/\s+/), "the sheet's column kept the page's seam")
      .not.toContain("border-e");
  });

  it("closes when a row inside it navigates", async () => {
    render(<HomeConversationsSheet />);
    fireEvent.click(screen.getByRole("button", { name: "sidebarLabel" }));
    const sheet = screen.getByRole("dialog", { name: "sidebarLabel" });
    fireEvent.click(await within(sheet).findByRole("link", { name: /Older thread/ }));
    expect(screen.queryByRole("dialog"), "the drawer stayed over the answer").toBeNull();
  });

  it("closes on Escape", () => {
    render(<HomeConversationsSheet />);
    fireEvent.click(screen.getByRole("button", { name: "sidebarLabel" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  /*
   * THE HAMBURGER SITS IN THE BAR.
   *
   * The PAIR, because either half passes against a version the directive
   * rejects: "it is inside the bar's slot" is satisfied by a component that
   * ALSO keeps drawing its own strip (two hamburgers, one over the other, on
   * the screen with the least room for either), and "there is no strip" is
   * satisfied by a component that lost the button altogether — which on a
   * phone is a drawer with no handle. And the third case is the one the
   * fallback exists for: with no bar on the page the strip must come back,
   * or the sheet is unreachable wherever the shell is not rendered.
   */
  it("portals its button into the top bar's slot, and keeps no strip of its own", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const release = registerPageMenuAnchor(host);
    try {
      render(<HomeConversationsSheet />);
      const button = screen.getByRole("button", { name: "sidebarLabel" });
      expect(host.contains(button), "the button did not land in the bar's slot").toBe(true);
      expect(screen.getAllByRole("button", { name: "sidebarLabel" })).toHaveLength(1);
      /* and it still opens the drawer from there */
      fireEvent.click(button);
      expect(screen.getByRole("dialog", { name: "sidebarLabel" })).toBeTruthy();
    } finally {
      release();
      host.remove();
    }
  });

  it("draws its own strip when there is no bar to portal into", () => {
    render(<HomeConversationsSheet />);
    const button = screen.getByRole("button", { name: "sidebarLabel" });
    expect(button.parentElement?.className).toContain("pt-2");
  });
});
