import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminModelRow, User } from "@/api/types";

/**
 * Management · Models — the ADD dialog, and the two facts a row must carry.
 *
 * The dialog used to offer "every model the org has not allowed, first
 * forty", in the catalogue's own order — which, past the suggested five, is
 * alphabetical. So it opened on `ai21/jamba-large-1.7` (a provider that has
 * been RETIRED), three `aion-labs` and four `amazon/nova`: three hundred rows
 * sorted by nothing an admin cares about, each one a bare name with no price
 * beside it.
 *
 * Two rules came out of that, and each is asserted with the case that tells a
 * working version from a plausible broken one:
 *
 *  - The untyped box shows core/'s ranked SHELF; typing reaches the whole
 *    catalogue. A shortlist that were also a WALL would be worse than the
 *    alphabet — an admin who knows the model they want could no longer add
 *    it — so the search half is not a nicety, it is what makes the shelf
 *    safe. Hence the off-shelf fixture, which must be absent at rest and
 *    findable by name.
 *
 *  - A row states its price and its context window. The discriminating
 *    fixture is `deepseek/deepseek-v4-flash`, whose price is $0.0882 — a
 *    number a naive integer format renders as "$0", which is the same string
 *    a free model would produce.
 *
 * `ROWS` are transcribed from the live OpenRouter catalogue (pi-ai 0.84.1),
 * prices and context windows included, rather than invented: an id I make up
 * agrees with whatever rule I just wrote.
 */

const admin: User = {
  id: "u-1", org_id: "o-1", username: "admin", email: "admin@example.test",
  display_name: "مدیر سازمان", avatar_url: null, role: "admin", status: "active",
  locale: "fa", model_id: null, created_at: "2026-01-01T00:00:00.000Z",
};

const ROWS: AdminModelRow[] = [
  {
    id: "openai/gpt-5.6-terra", name: "OpenAI: GPT-5.6 Terra",
    allowed: false, suggested: true, recommended: true, tools: true,
    cost: { input: 1, output: 6 }, contextWindow: 1_050_000,
  },
  {
    id: "deepseek/deepseek-v4-flash", name: "DeepSeek: V4 Flash",
    allowed: false, suggested: false, recommended: true, tools: true,
    cost: { input: 0.0882, output: 0.1764 }, contextWindow: 1_048_576,
  },
  {
    // OFF the shelf: the alphabetical head of the real catalogue, and the id
    // this dialog used to open on.
    id: "ai21/jamba-large-1.7", name: "AI21: Jamba Large 1.7",
    allowed: false, suggested: false, recommended: false, tools: false,
    cost: { input: 2, output: 8 }, contextWindow: 256_000,
  },
  {
    id: "z-ai/glm-5.2", name: "Z.AI: GLM 5.2",
    allowed: true, suggested: true, recommended: true, tools: true,
    cost: { input: 0.6902, output: 2.1692 }, contextWindow: 1_048_576,
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

describe("the add dialog opens on a shortlist, not on the alphabet", () => {
  it("shows the shelf at rest and hides what is not on it", async () => {
    const { list } = await openDialog();
    // BOTH halves: a version that simply lists everything satisfies the
    // first, and one that lists nothing satisfies the second.
    expect(within(list).getByText("GPT-5.6 Terra")).toBeTruthy();
    expect(within(list).queryByText("Jamba Large 1.7")).toBeNull();
  });

  it("reaches the WHOLE catalogue once a name is typed", async () => {
    const { user, list } = await openDialog();
    await user.type(screen.getByPlaceholderText("جست‌وجو در همهٔ فهرست مدل‌ها"), "jamba");
    await waitFor(() => expect(within(list).getByText("Jamba Large 1.7")).toBeTruthy());
    // and the shelf entry that does not match is gone — a search that only
    // ADDED to the shelf would pass the line above while filtering nothing
    expect(within(list).queryByText("GPT-5.6 Terra")).toBeNull();
  });

  it("never offers a model the org already runs", async () => {
    const { list } = await openDialog();
    expect(within(list).queryByText("GLM 5.2")).toBeNull();
  });

  it("says which nothing an empty shelf is", async () => {
    // Nothing was typed, so «مدلی با این نام پیدا نشد» would be a claim about
    // a search nobody ran.
    adminModels.mockResolvedValue(ROWS.map((m) => ({ ...m, allowed: true })));
    const user = userEvent.setup();
    render(<ModelsPage />);
    await screen.findByText("GLM 5.2");
    await user.click(screen.getByRole("button", { name: "افزودن مدل" }));
    expect(await screen.findByText(/همهٔ مدل‌های پیشنهادی/)).toBeTruthy();
    expect(screen.queryByText(/پیدا نشد/)).toBeNull();
  });
});

describe("a row states what it costs and how much it holds", () => {
  it("carries the price and the context window beside the vendor", async () => {
    const { list } = await openDialog();
    const row = within(list).getByText("GPT-5.6 Terra").parentElement!;
    expect(row.textContent).toContain("openai");
    expect(row.textContent).toContain("$۱ / $۶");
    expect(row.textContent).toContain("۱M");
  });

  it("does not round a sub-cent price down to free", async () => {
    // $0.0882 is the cheapest thing on the shelf and rendering it as "$۰"
    // makes it indistinguishable from a model that bills nothing.
    const { list } = await openDialog();
    const row = within(list).getByText("V4 Flash").parentElement!;
    // the SEPARATOR stays ASCII: `digits()` is the platform's one rule and it
    // maps digit glyphs only, so a Persian decimal comma here would be a
    // second convention living on one screen.
    expect(row.textContent).toContain("$۰.۰۸۸");
    expect(row.textContent).not.toContain("$۰ /");
  });

  it("puts the same price on the table the admin REVIEWS", async () => {
    render(<ModelsPage />);
    const row = (await screen.findByText("GLM 5.2")).closest("tr")!;
    expect(row.textContent).toContain("$۰.۶۹");
  });
});
