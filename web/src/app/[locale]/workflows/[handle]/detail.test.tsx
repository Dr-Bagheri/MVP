import { Suspense } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowCard } from "@/api/types";

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
    authoredWorkflows: async () => {
      throw Object.assign(new Error("forbidden"), { status: 403 });
    },
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
   * The ⋯ menu — the page's only door to running a workflow now that the list
   * has none. Opened rather than inspected in source: the panel is a portal,
   * so "the trigger exists" and "the items exist" are genuinely two facts.
   */
  it("carries Run now and the switch's other entrance in the kebab", async () => {
    ME = { ...BASE_ME, auto_draft_replies: true };
    await open("draft-email-replies");

    fireEvent.click(screen.getByRole("button", { name: "کارهای این گردش‌کار" }));
    const items = within(screen.getByRole("menu")).getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual(["اجرای اکنون", "خاموش کردن"]);
  });
});
