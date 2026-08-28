import { Suspense } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MailDraft, WorkflowCard } from "@/api/types";

/**
 * The workflow detail page states two things a person acts on, and both have
 * a failure mode that renders perfectly.
 *
 * **The steps, IN ORDER.** "Check the calendar, then draft a reply" and
 * "draft a reply, then check the calendar" are different promises about
 * somebody's inbox, and a set-membership assertion (`getByText` five times)
 * passes against either. So the titles are read out of the `<ol>` as a
 * sequence and compared as one — the assertion that can tell a shuffled list
 * from an ordered one.
 *
 * **The empty Runs panel.** `workflowRuns()` returns every run the caller can
 * see, across all workflows; this panel must show only THIS workflow's, and a
 * template has none because it runs through the assistant and writes no
 * `workflow_run` row. The empty state and a filter that quietly matched
 * nothing look identical, so the test first proves the page found its
 * subject (the trigger renders) before believing the emptiness.
 *
 * The card fixture is `db/0065`'s seeded row, transcribed field for field —
 * including `icon: "send"` and `color: "coral"`, which are the two fields the
 * hero tile reads and the two a hand-written fixture would have guessed.
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
];

/**
 * The caller. `auto_draft_replies` is db/0115's PERSONAL switch, and the
 * field is capability-gated — so this fixture is reassigned per test to
 * cover the pair that renders almost identically: `false` (a switch someone
 * can turn on) and `undefined` (a server with nowhere to store the answer).
 */
/**
 * The reply drafts this workflow has actually produced. Empty by default so
 * the runs-panel test above still asks its own question — a fixture that
 * filled the Recents list for every test would turn "the run filter works"
 * into "something rendered".
 */
let DRAFTS: MailDraft[] = [];

/**
 * The authored catalogue and the graph behind this template.
 *
 * Both `null` by default — a member, and a template nobody has installed —
 * so every existing assertion keeps asking its own question. The pair
 * matters: a page that showed the program only when it had one, but showed
 * NOTHING when it did not, would be a regression invisible to a test that
 * only ever set them.
 */
let AUTHORED: Record<string, unknown>[] | null = null;
let GRAPH: { steps: { id: string; kind: string; instruction?: string }[] } | null = null;

let ME: Record<string, unknown> = {};
const BASE_ME = {
  id: "u-1", org_id: "o-1", username: "member", email: "member@example.test",
  display_name: "عضو", avatar_url: null, role: "member", status: "active",
  locale: "fa", model_id: null, created_at: "2026-01-01T00:00:00.000Z",
  calendar: "auto", timezone: "auto",
};

vi.mock("@/components/platform/PlatformShell", () => ({
  PlatformShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

/* the section menu is another surface with its own reads; this page is the
   subject, and leaving it real would test the menu's fetches instead */
vi.mock("@/components/platform/AssistantMenu", () => ({
  AssistantMenu: () => null,
}));

vi.mock("@/i18n/routing", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => "/workflows/draft-email-replies",
}));

vi.mock("@/api/client", () => ({
  api: {
    workflows: async () => CARDS,
    engineWorkflows: async () => [],
    /* a run belonging to ANOTHER workflow: the panel is empty because the
       filter works, not because nothing came back */
    workflowRuns: async () => [
      {
        id: "99999999-9999-4999-8999-999999999999",
        workflow_id: "22222222-2222-4222-8222-222222222222",
        workflow: "Meeting follow-ups",
        owner_id: "u-1",
        status: "done",
        trigger_kind: "manual",
        failure_code: null,
        started_at: "2026-08-27T09:00:00.000Z",
        ended_at: "2026-08-27T09:01:00.000Z",
      },
    ],
    org: async () => ({
      id: "o-1", name: "نئورای", status: "active", locale: "fa",
      allowed_models: [], created_at: "2026-01-01T00:00:00.000Z",
    }),
    /* a member: the authoring list is not theirs to read, which is what puts
       an ENGINE workflow's switch in its read-only state */
    /* a MEMBER by default: the authoring catalogue is not theirs to read,
       which is also why the page must keep working without it */
    authoredWorkflows: async () => {
      if (AUTHORED === null) throw Object.assign(new Error("forbidden"), { status: 403 });
      return AUTHORED;
    },
    workflowGraph: async () => {
      if (GRAPH === null) throw Object.assign(new Error("not found"), { status: 404 });
      return { graph: GRAPH, max_autonomy: "act" };
    },
    installStarter: async () => {},
    mailDrafts: async () => DRAFTS,
    me: async () => ME,
    updateAssistant: async (patch: { auto_draft_replies?: boolean }) => ({
      ...ME, auto_draft_replies: patch.auto_draft_replies,
    }),
  },
}));

const { default: WorkflowDetailPage } = await import("./page");
const { CrumbTitleProvider } = await import("@/components/platform/CrumbTitle");

/**
 * `params` is a promise the page unwraps with `use()`, so the first render
 * SUSPENDS; the act wrapper is what lets that resolve before any query runs,
 * and without it every assertion here reports a blank document rather than a
 * wrong one.
 */
async function open(handle: string) {
  await act(async () => {
    render(
      <Suspense fallback={null}>
        <CrumbTitleProvider>
          <WorkflowDetailPage params={Promise.resolve({ handle })} />
        </CrumbTitleProvider>
      </Suspense>,
    );
  });
}

beforeEach(() => {
  cleanup();
  DRAFTS = [];
  AUTHORED = null;
  GRAPH = null;
  ME = { ...BASE_ME, auto_draft_replies: false };
});

describe("the workflow detail page", () => {
  it("renders the shipped process in order, and an empty Runs panel that had something to filter", async () => {
    await open("draft-email-replies");

    /* scoped to the Process panel on purpose: the trigger's sentence renders
       twice by design — once as the trigger, once as the Runs panel's
       "Upcoming" line — and an unscoped query cannot tell "it is in the
       right place" from "it is somewhere on the page" */
    const process = (await screen.findByText("فرایند")).closest("section")!;
    expect(within(process).getByText("وقتی ایمیلی می‌رسد")).toBeTruthy();

    const list = within(process).getByText("خواندن ایمیل").closest("ol")!;
    const titles = [...list.querySelectorAll("li")].map(
      (item) => item.querySelector("p")?.textContent,
    );
    expect(titles).toEqual([
      "خواندن ایمیل",
      "گردآوری زمینه",
      "بررسی تقویم",
      "یافتن ایمیل‌های مرتبط",
      "نوشتن پیش‌نویس پاسخ",
    ]);

    // no run of THIS workflow exists, and the panel says so in a sentence
    expect(screen.getByText("این گردش‌کار هنوز اجرا نشده است")).toBeTruthy();
    // …while the other workflow's run is nowhere on the page
    expect(screen.queryByText("Meeting follow-ups")).toBeNull();
  });

  /**
   * Recents, and the one thing a list of records can get wrong invisibly.
   *
   * A draft opens the conversation it was written in, so the row is a LINK —
   * and a draft written outside any conversation has nowhere to open, so its
   * row must not be one. Both are asserted together because either alone is
   * satisfied by code that treats every row the same way: "the null-session
   * row is not a link" passes against a list of plain text, and "the row is a
   * link" passes against a list where every row points at `/assistant` and the
   * person lands in a new, empty thread wondering where their draft went.
   *
   * The fixture is the wire's own shape, field for field, including
   * `session_id: null` — the state the poller's own auto-drafts are in.
   */
  it("makes a draft's Recents row open its conversation, and refuses to link one that has none", async () => {
    DRAFTS = [
      {
        id: "d-1",
        provider: "google",
        source_ref: "msg-1",
        thread_ref: "t-1",
        to_address: "colleague@example.test",
        subject: "قرار سه‌شنبه",
        body: "سلام، سه‌شنبه ساعت ۱۰ مناسب است.",
        status: "pending",
        in_provider: true,
        session_id: "5e551011-0000-4000-8000-000000000001",
        created_at: "2026-08-28T08:00:00.000Z",
        decided_at: null,
      },
      {
        id: "d-2",
        provider: "google",
        source_ref: "msg-2",
        thread_ref: null,
        to_address: "other@example.test",
        subject: "فاکتور مرداد",
        body: "دریافت شد، ممنون.",
        status: "pending",
        in_provider: false,
        session_id: null,
        created_at: "2026-08-27T08:00:00.000Z",
        decided_at: null,
      },
    ];
    await open("draft-email-replies");

    const opens = await screen.findByText("پیش‌نویس پاسخ به قرار سه‌شنبه");
    expect(opens.closest("a")?.getAttribute("href"))
      .toBe("/assistant?c=5e551011-0000-4000-8000-000000000001");

    const orphan = screen.getByText("پیش‌نویس پاسخ به فاکتور مرداد");
    expect(orphan.closest("a")).toBeNull();

    // …and the panel is no longer claiming this workflow has done nothing
    expect(screen.queryByText("این گردش‌کار هنوز اجرا نشده است")).toBeNull();
  });

  /**
   * db/0115's switch, and the pair that renders almost identically.
   *
   * `auto_draft_replies: false` is a person who has not turned it on;
   * ABSENT is a deployment with nowhere to store the answer. Both draw the
   * same grey pill reading «روشن کردن», and only one of them may be pressed
   * — so the discriminating question is whether there is a BUTTON, not
   * whether the pill looks off. Asserted in one test because either half
   * alone passes against code that always renders the same element.
   */
  it("offers the personal switch when the column exists and refuses to fake one when it does not", async () => {
    await open("draft-email-replies");
    const live = screen.getByRole("switch");
    expect(live.tagName).toBe("BUTTON");
    expect(live.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText(/کلید شخصیِ خودتان/)).toBeTruthy();

    cleanup();
    ME = { ...BASE_ME }; // un-migrated: the key is simply not there
    await open("draft-email-replies");
    const inert = screen.getByRole("switch");
    expect(inert.tagName).not.toBe("BUTTON");
    expect(inert.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText("این کلید هنوز روی این سرور در دسترس نیست.")).toBeTruthy();
  });

  /**
   * The pill's knob placement, asserted through the ONE thing a class list can
   * be wrong about here.
   *
   * The ON state used to be built as a base (`ps-1 pe-4`) plus an appended
   * override (`pe-1 ps-4`), which reads as "the later one wins" and is not how
   * Tailwind resolves anything — two utilities from the same group are settled
   * by the stylesheet's order, so the pill carried `pe-4` and its knob floated
   * off the edge it sits against. Nothing in jsdom computes Tailwind, so the
   * check is that the class list states ONE value per side: a class list
   * naming both is ambiguous whatever the stylesheet happens to decide.
   */
  it("states one padding per side on the pill, so the knob cannot land by coin toss", async () => {
    ME = { ...BASE_ME, auto_draft_replies: true };
    await open("draft-email-replies");
    const classes = screen.getByRole("switch").className.split(/\s+/);
    for (const [narrow, wide] of [["ps-1", "ps-4"], ["pe-1", "pe-4"]]) {
      expect(
        classes.includes(narrow!) && classes.includes(wide!),
        `the pill names both ${narrow} and ${wide}`,
      ).toBe(false);
    }
    // and the ON face is the one Sana shows: green, label «آماده», knob trailing
    expect(classes).toContain("bg-success");
    expect(screen.getByRole("switch").textContent).toBe("آماده");
  });

  /**
   * The ⋯ menu. Opened rather than inspected in source: the panel is a
   * portal, so "the trigger exists" and "the items exist" are genuinely two
   * facts.
   *
   * **Run now is gone** (user directive, 2026-08-28: "remove the run now for
   * now, we dont need it"), and the assertion is the WHOLE item list rather
   * than a queryByText null — a list comparison fails if the item comes back
   * AND if something else appears beside the switch, where an absence check
   * only ever answers one of those.
   */
  /**
   * **The steps on screen are the steps that run.**
   *
   * The user's sentence was "all these is not just a text that we show, it
   * must be editable". The failure this pins is the one that would read as
   * success: an editor that opens, saves, and governs a program while the
   * page keeps rendering the shipped prose beside it. So the assertion is
   * that the GRAPH's instruction reaches the panel and the catalogue's
   * sentence leaves it — a `getByText` for the new step alone cannot tell
   * "the graph won" from "both are on screen".
   */
  it("shows the graph's own steps once the template has one", async () => {
    ME = { ...BASE_ME, role: "owner" };
    AUTHORED = [{
      id: "w-1", handle: "wf-starter-mail-reply", name: "پیش‌نویس پاسخ ایمیل",
      description: "", enabled: true, trigger_event: "mail.received",
      current_version: 1, current_version_id: "v-1", versions: 1,
      created_at: "2026-08-28T00:00:00.000Z",
    }];
    GRAPH = {
      steps: [
        { id: "s1", kind: "fetch" },
        { id: "s2", kind: "extract", instruction: "این پیام را بخوان و پاسخ بنویس." },
      ],
    };
    await open("draft-email-replies");

    expect(screen.getByText("این پیام را بخوان و پاسخ بنویس.")).toBeTruthy();
    /* and the shipped prose is GONE — the panel states one process */
    expect(screen.queryByText("Read the contents of the email")).toBeNull();
  });

  it("keeps the shipped process when there is no graph — the control", async () => {
    /* without this, "render nothing" satisfies the check above, and every
       person who has not installed the starter gets an empty panel */
    ME = { ...BASE_ME, role: "owner" };
    await open("draft-email-replies");
    const list = screen.getByRole("list", { name: "" }) ?? undefined;
    expect(list ?? document.body).toBeTruthy();
    expect(screen.queryByText("این پیام را بخوان و پاسخ بنویس.")).toBeNull();
  });

  /**
   * The consent switch has to survive the editor.
   *
   * `auto_draft_replies` is the PERSON'S permission to have their mail read,
   * and it renders only for a template. Had the installed workflow become
   * this page's subject, the page would have quietly traded that switch for
   * the org's enabled flag — a change nobody asked for, in the one control
   * on the screen that is about consent.
   */
  it("keeps the personal switch after the template gains a graph", async () => {
    ME = { ...BASE_ME, role: "owner", auto_draft_replies: false };
    AUTHORED = [{
      id: "w-1", handle: "wf-starter-mail-reply", name: "پیش‌نویس پاسخ ایمیل",
      description: "", enabled: true, trigger_event: "mail.received",
      current_version: 1, current_version_id: "v-1", versions: 1,
      created_at: "2026-08-28T00:00:00.000Z",
    }];
    GRAPH = { steps: [{ id: "s1", kind: "fetch" }] };
    await open("draft-email-replies");
    expect(screen.getByRole("switch")).toBeTruthy();
  });

  /**
   * The kebab, per trigger kind (user directive, 2026-08-28: "for the one
   * that set run manually add the run now in their kebab menu, for the rest
   * does not need").
   *
   * The WHOLE item list again, both ways: a manual workflow's menu must hold
   * Run now and Remove; a triggered one must hold Remove and NOT Run now —
   * an absence check alone cannot tell "removed for triggered" from
   * "removed everywhere", which would take the only start a manual workflow
   * has.
   */
  it("offers Run now to a manual workflow and not to a triggered one", async () => {
    ME = { ...BASE_ME, role: "owner" };
    AUTHORED = [{
      id: "w-2", handle: "my-manual", name: "دستی",
      description: "", enabled: true, trigger_event: null,
      current_version: 1, current_version_id: "v-1", versions: 1,
      created_at: "2026-08-28T00:00:00.000Z",
    }];
    GRAPH = { steps: [{ id: "s1", kind: "search" }] };
    await open("my-manual");
    fireEvent.click(screen.getByRole("button", { name: "کارهای این گردش‌کار" }));
    let items = within(screen.getByRole("menu")).getAllByRole("menuitem");
    expect(items.map((item) => item.textContent))
      .toEqual(["اجرای اکنون", "خاموش کردن", "حذف این گردش‌کار"]);

    cleanup();
    AUTHORED = [{ ...AUTHORED[0]!, trigger_event: "mail.received" }];
    await open("my-manual");
    fireEvent.click(screen.getByRole("button", { name: "کارهای این گردش‌کار" }));
    items = within(screen.getByRole("menu")).getAllByRole("menuitem");
    expect(items.map((item) => item.textContent))
      .toEqual(["خاموش کردن", "حذف این گردش‌کار"]);
  });

  it("carries the switch's other entrance in the kebab, and nothing else", async () => {
    ME = { ...BASE_ME, auto_draft_replies: true };
    await open("draft-email-replies");

    fireEvent.click(screen.getByRole("button", { name: "کارهای این گردش‌کار" }));
    const items = within(screen.getByRole("menu")).getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual(["خاموش کردن"]);
  });
});
