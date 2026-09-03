import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayKey, User } from "@/api/types";

/**
 * Management · Connectors — the gateway card may not speak before it is
 * answered (user directive, 2026-09-03: the skeleton rule reaches every
 * Management and Settings sub-page).
 *
 * `keys` starts as an empty array and the card reads an empty array as «هنوز
 * کلیدی ساخته نشده است» — a claim about the ORGANIZATION made out of a fetch
 * that had not returned. The table then arrived underneath the sentence that
 * had just denied it.
 *
 * Every test here holds the fetch OPEN, because the in-flight moment is the
 * state under test: an assertion that also holds after the answer lands would
 * pass against the broken version too and stop looking (the temporal vacuum —
 * `waitFor` on a condition that is already true while loading).
 */

const admin: User = {
  id: "u-1", org_id: "o-1", username: "admin", email: "admin@example.test",
  display_name: "مدیر سازمان", avatar_url: null, role: "admin", status: "active",
  locale: "fa", model_id: null, created_at: "2026-01-01T00:00:00.000Z",
};
const member: User = { ...admin, id: "u-9", role: "member", display_name: "عضو ساده" };

const KEY: GatewayKey = {
  id: "k-1", name: "همگام‌سازی CRM", token_prefix: "echo_s", actor_id: "u-1",
  last_used_at: null, expires_at: null, revoked_at: null,
  created_at: "2026-08-01T00:00:00.000Z", allow_assistant: false,
};

vi.mock("@/components/platform/SettingsPane", () => ({
  SettingsPane: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const me = vi.fn();
const gatewayKeys = vi.fn();
const members = vi.fn();
vi.mock("@/api/client", () => ({
  api: {
    me: () => me(),
    gatewayKeys: () => gatewayKeys(),
    members: () => members(),
  },
}));

const { default: ConnectorsPage } = await import("./page");

/** a promise this test decides the ending of — the fetch stays in flight
 *  until the assertion about the in-flight state has been made */
function held<T>(): [Promise<T>, (value: T) => void] {
  let release!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    release = resolve;
  });
  return [promise, release];
}

beforeEach(() => {
  me.mockReset();
  gatewayKeys.mockReset();
  members.mockReset();
  me.mockResolvedValue(admin);
  gatewayKeys.mockResolvedValue([]);
  members.mockResolvedValue([]);
});

describe("the gateway card says nothing about the org until it is answered", () => {
  it("holds a frame while the keys are in flight, and the empty sentence only after", async () => {
    const [pending, release] = held<GatewayKey[]>();
    gatewayKeys.mockReturnValue(pending);

    const { container } = render(<ConnectorsPage />);

    /* ANCHORED, not merely awaited: the read having been made is proof that
       identity landed and this render is the admin's in-flight state — the
       one moment the assertion below is about. */
    await waitFor(() => expect(gatewayKeys).toHaveBeenCalled());
    expect(screen.queryByText(/هنوز کلیدی ساخته نشده/)).toBeNull();
    // and it is a FRAME standing there, not a gap where a card will be
    expect(container.querySelector(".animate-pulse")).not.toBeNull();

    /* the control. Without it, "the sentence is absent" could mean the page
       crashed, or that the string moved, or that this file is asserting on a
       message nothing renders — a check that can only ever answer "absent"
       cannot distinguish a fix from a wreck. */
    release([]);
    expect(await screen.findByText(/هنوز کلیدی ساخته نشده/)).toBeTruthy();
  });

  it("does not call a colleague 'not in the member list' while the list loads", async () => {
    /* the second half of the same conflation: the acts-as column resolves a
       member id through the member list, and an id missing from a list that
       has not answered renders as an id missing from the ORGANIZATION. */
    const [pendingMembers, releaseMembers] = held<User[]>();
    gatewayKeys.mockResolvedValue([KEY]);
    members.mockReturnValue(pendingMembers);

    render(<ConnectorsPage />);

    await waitFor(() => expect(members).toHaveBeenCalled());
    expect(screen.queryByText(/در فهرست اعضا نیست/)).toBeNull();

    releaseMembers([admin]);
    // the control again: with the list in hand the key is attributed by NAME
    expect(await screen.findByText("مدیر سازمان")).toBeTruthy();
  });
});

describe("a read that failed is not an organization with no keys", () => {
  it("names the failure instead of reporting an empty gateway", async () => {
    gatewayKeys.mockRejectedValue(new Error("nope"));

    render(<ConnectorsPage />);

    expect(await screen.findByText(/انجام نشد/)).toBeTruthy();
    // the empty array a failure leaves behind must never be read as an answer
    expect(screen.queryByText(/هنوز کلیدی ساخته نشده/)).toBeNull();
    // the card still carries its own name, so the reader knows what failed
    expect(screen.getByText("کلیدهای API")).toBeTruthy();
  });
});

describe("the admin gate survives the loading states", () => {
  it("refuses a member without asking the gateway anything", async () => {
    me.mockResolvedValue(member);

    render(<ConnectorsPage />);

    expect(await screen.findByText(/این بخش در اختیار مدیر سازمان است/)).toBeTruthy();
    /* the refusal is an ANSWER, never a loading state — and the skeleton must
       not still be standing under it */
    expect(gatewayKeys).not.toHaveBeenCalled();
    expect(members).not.toHaveBeenCalled();
  });
});
