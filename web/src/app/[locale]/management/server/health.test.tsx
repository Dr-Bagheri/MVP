import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerHealth, User } from "@/api/types";

/**
 * Management · Server — one rule, asserted from both sides.
 *
 * **Not measured must never render as zero.** Every metric carries its own
 * `measured_at`; null there means we did not find out, and a real zero arrives
 * WITH a timestamp.
 *
 * The reason the two halves are asserted TOGETHER, in one test, is the whole
 * point of this file. The obvious implementation — `value || "—"` — passes any
 * test written against the storage row, whose value is genuinely null, while
 * being wrong on the keys row, whose zero is real. A suite that checked only
 * "null renders —" would be green against code that renders "—" for every
 * falsy value, which is the bug. **`keys.active: 0` with a timestamp is the
 * row that tells a working rule from a broken one.**
 *
 * `CAPTURED` is B1's real body, transcribed unedited from their capture — the
 * mixed case they went and re-measured for this purpose: two metrics read,
 * one permanently unavailable. The zero in `keys` is genuine (dev has no api
 * keys), not one they arranged.
 */

const CAPTURED: ServerHealth = {
  queues: {
    measured_at: "2026-08-13T11:57:00.356Z",
    items: [
      { name: "echo_deliver_webhook", depth: 0, retrying: 0, archived: 0 },
      { name: "echo_link_speakers", depth: 0, retrying: 0, archived: 0 },
      { name: "echo_process_part", depth: 0, retrying: 0, archived: 22 },
      { name: "echo_summarize", depth: 0, retrying: 0, archived: 2 },
    ],
  },
  keys: { measured_at: "2026-08-13T11:57:00.356Z", active: 0, revoked: 0 },
  storage: {
    measured_at: null,
    bytes: null,
    unavailable: "the api role cannot read the storage schema",
  },
};

const admin: User = {
  id: "u-1", org_id: "o-1", username: "admin", email: "admin@example.test",
  display_name: "مدیر سازمان", avatar_url: null, role: "admin", status: "active",
  locale: "fa", model_id: null, created_at: "2026-01-01T00:00:00.000Z",
};
const member: User = { ...admin, id: "u-9", role: "member", display_name: "عضو ساده" };

vi.mock("@/components/platform/ManagementPane", () => ({
  ManagementPane: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const me = vi.fn();
const serverHealth = vi.fn();
vi.mock("@/api/client", () => ({
  api: { me: () => me(), serverHealth: () => serverHealth() },
}));

const { default: ServerManagementPage } = await import("./page");

beforeEach(() => {
  me.mockReset();
  serverHealth.mockReset();
  me.mockResolvedValue(admin);
  serverHealth.mockResolvedValue(CAPTURED);
});

describe("a measured zero and an unmeasured value are different things", () => {
  it("renders the real zero as ۰ and the unmeasured one as —, in the same render", async () => {
    render(<ServerManagementPage />);
    await screen.findByText("echo_process_part");

    /*
     * BOTH halves, one assertion block. `keys.active` is a genuine measured
     * zero and must read ۰; `storage.bytes` was never obtained and must read
     * "—". Code that renders "—" for anything falsy satisfies the second and
     * fails the first — which is precisely the implementation someone reaches
     * for, and precisely why a storage-only test would pass over the bug.
     */
    const keys = screen.getByText("فعال").parentElement!;
    expect(keys.textContent).toContain("۰");
    expect(keys.textContent).not.toContain("—");

    const storage = screen.getByText("حجم فایل‌های صوتی").parentElement!;
    expect(storage.textContent).toContain("—");
    expect(storage.textContent).not.toMatch(/[۰0]/);
  });

  it("names the fix instead of leaving the gap blank", async () => {
    render(<ServerManagementPage />);
    // the server's own sentence, verbatim — it points at the grant that would
    // make the number exist, which a bare dash cannot do
    expect(await screen.findByText("the api role cannot read the storage schema")).toBeTruthy();
  });

  it("renders a size once the value exists — the branch that is null today", async () => {
    /*
     * `storage.bytes` is null until someone grants the schema, so this branch
     * never renders against real data and would ship unseen. Rule 9: the state
     * that does not occur naturally is the one the fixture must create.
     */
    serverHealth.mockResolvedValue({
      ...CAPTURED,
      storage: { measured_at: "2026-08-13T11:57:00.356Z", bytes: 5_368_709_120 },
    });
    render(<ServerManagementPage />);
    // `digits()` maps 0–9 and leaves the decimal point alone, so this is an
    // ASCII "." between Persian digits — app-wide behaviour, not this page's
    expect(await screen.findByText(/۵\.۰ گیگابایت/)).toBeTruthy();
  });
});

describe("one unreadable metric does not blank the others", () => {
  it("still shows live key counts when the queue read was refused", async () => {
    /*
     * core/ answers 200 with per-metric status precisely so this is possible.
     * A page-level "not connected" banner over two working metrics is the same
     * lie as a fabricated zero, pointed the other way: it understates what is
     * healthy, and an operator who cannot trust the page stops reading it.
     */
    serverHealth.mockResolvedValue({
      ...CAPTURED,
      queues: { measured_at: null, items: [], unavailable: "the api role may not read this" },
    });
    render(<ServerManagementPage />);

    expect(await screen.findByText("the api role may not read this")).toBeTruthy();
    // keys survived — measured, and still reading zero rather than a dash
    const keys = screen.getByText("فعال").parentElement!;
    expect(keys.textContent).toContain("۰");
    expect(keys.textContent).not.toContain("—");
    expect(screen.queryByText("echo_process_part")).toBeNull();
  });
});

describe("the names B1 chose are rendered as chosen", () => {
  it("never calls retrying work a dead letter", async () => {
    render(<ServerManagementPage />);
    await screen.findByText("echo_process_part");
    /*
     * The page's earlier copy promised "dead letters" over this number. pgmq
     * has no dead-letter queue, so that label would make a correct number
     * wrong. A negative assertion because the failure mode is a WORD, and the
     * word is the kind of thing a later copy pass reintroduces as a "clearer"
     * label.
     */
    expect(screen.queryByText(/نامه‌های به‌مقصد‌نرسیده|نامهٔ به‌مقصد‌نرسیده/)).toBeNull();
    expect(screen.getByText("در حال تلاش دوباره")).toBeTruthy();
  });

  it("does not colour archived throughput as a failure", async () => {
    render(<ServerManagementPage />);
    const row = (await screen.findByText("echo_process_part")).closest("tr")!;
    const cells = [...row.querySelectorAll("td")];
    // 22 archived on this queue is completed-or-failed work, not an alarm
    const archived = cells[3]!;
    expect(archived.textContent).toBe("۲۲");
    expect(archived.className).not.toMatch(/danger|warning/);
  });

  it("marks retrying work only when there is some", async () => {
    /*
     * The negative control for the highlight: every queue in the real capture
     * has `retrying: 0`, so "no warning styling" is satisfied trivially. This
     * proves the styling can appear at all — without it, a broken highlight
     * and a working one are indistinguishable.
     */
    serverHealth.mockResolvedValue({
      ...CAPTURED,
      queues: {
        measured_at: CAPTURED.queues.measured_at,
        items: [{ name: "echo_summarize", depth: 3, retrying: 2, archived: 2 }],
      },
    });
    render(<ServerManagementPage />);
    const row = (await screen.findByText("echo_summarize")).closest("tr")!;
    expect([...row.querySelectorAll("td")][2]!.className).toMatch(/warning/);
  });
});

describe("the admin gate", () => {
  it("refuses a member and does not read service health at all", async () => {
    me.mockResolvedValue(member);
    render(<ServerManagementPage />);
    await screen.findByText(/این بخش در اختیار مدیر سازمان است/);
    expect(serverHealth).not.toHaveBeenCalled();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("renders for an admin — proving the gate is not simply always closed", async () => {
    render(<ServerManagementPage />);
    await waitFor(() => expect(serverHealth).toHaveBeenCalled());
    expect(await screen.findByRole("table")).toBeTruthy();
  });
});

describe("when service health cannot be read", () => {
  it("shows no numbers at all rather than stale ones", async () => {
    serverHealth.mockRejectedValue(new Error("nope"));
    render(<ServerManagementPage />);
    expect(await screen.findByText(/خواندن وضعیت سرویس ممکن نشد/)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("recovers on retry", async () => {
    serverHealth.mockRejectedValueOnce(new Error("nope")).mockResolvedValueOnce(CAPTURED);
    render(<ServerManagementPage />);
    await screen.findByText(/خواندن وضعیت سرویس ممکن نشد/);

    await userEvent.click(screen.getByRole("button", { name: /تلاش دوباره/ }));
    expect(await screen.findByText("echo_process_part")).toBeTruthy();
    expect(screen.queryByText(/خواندن وضعیت سرویس ممکن نشد/)).toBeNull();
  });
});
