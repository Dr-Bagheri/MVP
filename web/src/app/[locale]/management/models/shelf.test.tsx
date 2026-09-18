import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminModelRow, User } from "@/api/types";

/**
 * Management · Models — the ADD dialog, and the two facts a row must carry.
 *
 * ── the file keeps its name and the shelf is gone ─────────────────────────
 * The dialog used to offer "every model the org has not allowed, first
 * forty", in the catalogue's own order — which is alphabetical — so it opened
 * on `ai21/jamba-large-1.7` (a RETIRED provider), three `aion-labs` and four
 * `amazon/nova`. The fix was a SHELF: core/ served a ranked shortlist, an
 * untyped box showed only that, and typing reached the whole catalogue.
 *
 * On 2026-09-18 the product narrowed to three models and the shelf lost its
 * subject. What is asserted here now is the other side of the same concern —
 * that the dialog shows what an admin can actually add, and says so when
 * there is nothing left. The file is still `shelf.test.tsx` because renaming
 * a file under `[locale]/` is the one move this repo has already lost work
 * to; the name is a worse cost to pay than the sentence explaining it.
 *
 * The row rules did not change and are asserted with the case that tells a
 * working version from a plausible broken one: a row states its price and
 * its context window, and the discriminating fixture is the cheap rung at
 * $0.06 — a number a naive integer format renders as "$0", which is the same
 * string a free model would produce.
 *
 * `ROWS` are the three the product offers, with prices and context windows
 * TRANSCRIBED from the live OpenRouter catalogue rather than invented: an id
 * I make up agrees with whatever rule I just wrote.
 */

const admin: User = {
  id: "u-1", org_id: "o-1", username: "admin", email: "admin@example.test",
  display_name: "مدیر سازمان", avatar_url: null, role: "admin", status: "active",
  locale: "fa", model_id: null, created_at: "2026-01-01T00:00:00.000Z",
};

const ROWS: AdminModelRow[] = [
  {
    id: "deepseek/deepseek-v4-flash-0731", name: "DeepSeek: V4 Flash",
    allowed: false, tools: true,
    cost: { input: 0.06, output: 0.12 }, contextWindow: 1_310_720,
  },
  {
    id: "google/gemini-3.6-flash", name: "Google: Gemini 3.6 Flash",
    allowed: false, tools: true,
    cost: { input: 0.75, output: 3.75 }, contextWindow: 1_048_576,
  },
  {
    id: "z-ai/glm-5.2", name: "Z.AI: GLM 5.2",
    allowed: true, tools: true,
    cost: { input: 0.554, output: 1.742 }, contextWindow: 1_048_576,
  },
];

vi.mock("@/components/platform/SettingsPane", () => ({
  SettingsPane: ({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) => (
    <div>{actions}{children}</div>
  ),
}));

const me = vi.fn();
const adminModels = vi.fn();
vi.mock("@/api/client", () => ({
  api: {
    me: () => me(),
    adminModels: () => adminModels(),
    updateOrg: async () => ({}),
  },
}));

const { default: ModelsPage } = await import("./page");

beforeEach(() => {
  me.mockReset();
  adminModels.mockReset();
  me.mockResolvedValue(admin);
  adminModels.mockResolvedValue(ROWS);
});

/** Open the add dialog and hand back the list it renders. */
async function openDialog() {
  const user = userEvent.setup();
  render(<ModelsPage />);
  await screen.findByText("GLM 5.2");
  await user.click(screen.getByRole("button", { name: "افزودن مدل" }));
  const list = await screen.findByRole("list");
  return { user, list };
}

describe("the add dialog offers what is left to add", () => {
  it("lists every model the org does not already run", async () => {
    const { list } = await openDialog();
    // BOTH halves: a version that lists nothing satisfies the third
    // assertion, and one that lists everything satisfies the first two.
    expect(within(list).getByText("V4 Flash")).toBeTruthy();
    expect(within(list).getByText("Gemini 3.6 Flash")).toBeTruthy();
    expect(within(list).queryByText("GLM 5.2")).toBeNull();
  });

  it("has no search field — three rows do not need one", async () => {
    // Asserted as an ABSENCE because the version that still renders the box
    // looks perfectly reasonable: it filters, it just filters a list the
    // reader can already see all of, under a placeholder promising a
    // catalogue that no longer exists.
    await openDialog();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("says which nothing an empty list is — about the PRODUCT, not the search", async () => {
    // The sentence this replaced said "every recommended model is already on
    // the list, search the catalogue for others", which after the narrowing
    // would send an admin looking for models that do not exist: a true claim
    // about the org turning into a false one about the product.
    adminModels.mockResolvedValue(ROWS.map((m) => ({ ...m, allowed: true })));
    const user = userEvent.setup();
    render(<ModelsPage />);
    await screen.findByText("GLM 5.2");
    await user.click(screen.getByRole("button", { name: "افزودن مدل" }));
    expect(await screen.findByText("همهٔ مدل‌های این پلتفرم در فهرست هستند.")).toBeTruthy();
  });
});

describe("a row states what it costs and how much it holds", () => {
  it("carries the price and the context window beside the vendor", async () => {
    const { list } = await openDialog();
    const row = within(list).getByText("Gemini 3.6 Flash").parentElement!;
    expect(row.textContent).toContain("google");
    expect(row.textContent).toContain("$۰.۷۵ / $۳.۷۵");
    expect(row.textContent).toContain("۱M");
  });

  it("does not round a sub-cent price down to free", async () => {
    // $0.06 is the cheapest thing the product offers and rendering it as
    // "$۰" makes it indistinguishable from a model that bills nothing.
    const { list } = await openDialog();
    const row = within(list).getByText("V4 Flash").parentElement!;
    // the SEPARATOR stays ASCII: `digits()` is the platform's one rule and it
    // maps digit glyphs only, so a Persian decimal comma here would be a
    // second convention living on one screen.
    expect(row.textContent).toContain("$۰.۰۶");
    expect(row.textContent).not.toContain("$۰ /");
  });

  it("puts the same price on the table the admin REVIEWS", async () => {
    render(<ModelsPage />);
    const row = (await screen.findByText("GLM 5.2")).closest("tr")!;
    expect(row.textContent).toContain("$۰.۵۵۴");
  });
});
