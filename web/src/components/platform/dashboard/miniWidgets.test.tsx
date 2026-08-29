import { act, cleanup, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BffError } from "@/api/client";
import type { ConnectorItem, ConnectorStatus, User } from "@/api/types";

/**
 * THE THREE KINDS OF NOTHING, on a glance surface.
 *
 * Every tile on this board can be empty for three different reasons, and on
 * screen they are one blank rectangle apiece unless something makes them
 * differ:
 *
 *   · we have not asked yet          → resolves on its own; say nothing yet
 *   · we asked, there is nothing     → a sentence about the ORGANIZATION
 *   · we asked and it did not land   → a sentence about the READ
 *
 * A tile that showed the waiting state forever would be lying by waiting,
 * and one that reported an outage as "you have no colleagues" would be
 * making a false claim about the company. So the assertions below are
 * DISCRIMINATING: each case checks that the state it is about renders AND
 * that the other two do not, because "the empty sentence is on screen" is
 * satisfied by a widget that shows it unconditionally.
 *
 * The calendar is the one that differs, deliberately: its ordinary failure
 * is that nobody has connected Google, so a refusal there is an invitation
 * rather than an apology.
 */

let MEMBERS: () => Promise<User[]>;
let CALENDAR: () => Promise<ConnectorItem[]>;
let CONNECTORS: () => Promise<ConnectorStatus[]>;

const person = (id: string, name: string): User => ({
  id,
  org_id: "o-1",
  username: null,
  email: `${id}@example.test`,
  display_name: name,
  display_name_en: null,
  avatar_url: null,
  role: "member",
  status: "active",
  model_id: null,
  created_at: "2026-01-01T00:00:00.000Z",
  last_seen_at: null,
});

vi.mock("@/i18n/routing", () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => "/",
}));

/*
 * `BffError` is NOT stubbed — the real class is re-exported, because the
 * hook branches on `instanceof`. A hand-written stand-in would be a second
 * definition of the thing under test, and every `instanceof` would answer
 * false while the fixture looked right.
 */
vi.mock("@/api/client", async () => ({
  ...(await vi.importActual<typeof import("@/api/client")>("@/api/client")),
  api: {
    members: () => MEMBERS(),
    connectorItems: () => CALENDAR(),
    connectors: () => CONNECTORS(),
  },
}));

const { CalendarWidget, IntegrationsWidget, MembersWidget } = await import("./miniWidgets");

/** a promise nobody resolves — the "not answered yet" state, held open */
const pending = <T,>() => new Promise<T>(() => {});

beforeEach(() => {
  cleanup();
  MEMBERS = async () => [person("u-1", "امیررضا")];
  CALENDAR = async () => [];
  CONNECTORS = async () => [];
});

describe("a list tile's three kinds of nothing", () => {
  it("says nothing at all while the read is still out", async () => {
    MEMBERS = () => pending<User[]>();
    await act(async () => { render(<MembersWidget size="large" />); });

    // neither claim has been earned yet: not "there is nobody", not "we
    // could not look"
    expect(screen.queryByText("هنوز کسی اینجا نیست.")).toBeNull();
    expect(screen.queryByText("فعلاً نمی‌توان رکوردهای شما را خواند.")).toBeNull();
  });

  it("says the ORGANIZATION is empty when the read lands with nothing", async () => {
    MEMBERS = async () => [];
    await act(async () => { render(<MembersWidget size="large" />); });

    expect(screen.getByText("هنوز کسی اینجا نیست.")).toBeTruthy();
    expect(screen.queryByText("فعلاً نمی‌توان رکوردهای شما را خواند.")).toBeNull();
  });

  it("says the READ failed when it does — never that the org is empty", async () => {
    MEMBERS = async () => { throw new Error("no"); };
    await act(async () => { render(<MembersWidget size="large" />); });

    expect(screen.getByText("فعلاً نمی‌توان رکوردهای شما را خواند.")).toBeTruthy();
    expect(screen.queryByText("هنوز کسی اینجا نیست.")).toBeNull();
  });

  it("calls a REFUSAL a permission, never an outage", async () => {
    /*
     * The people list is Management's, and Management is admin-gated — so a
     * member's 403 is the ordinary answer, not a fault. Told it failed, they
     * would go looking for a problem that does not exist; and the same
     * sentence would be wrong in the other direction for an admin during a
     * real outage.
     */
    MEMBERS = async () => { throw new BffError(403, "forbidden"); };
    await act(async () => { render(<MembersWidget size="large" />); });

    expect(screen.getByText("فهرست افراد برای مدیران است.")).toBeTruthy();
    expect(screen.queryByText("فعلاً نمی‌توان رکوردهای شما را خواند.")).toBeNull();
    expect(screen.queryByText("هنوز کسی اینجا نیست.")).toBeNull();
  });

  it("shows only as many rows as the tier has room for", async () => {
    MEMBERS = async () => Array.from({ length: 9 }, (_, i) => person(`u-${i}`, `نفر ${i}`));
    /*
     * `small` is three rows and `large` is six — the ladder lives in
     * `rowsFor`, and this asserts the widget READS it rather than slicing to
     * a number of its own. Both tiers in one test because a widget ignoring
     * the tier satisfies either half alone.
     */
    await act(async () => { render(<MembersWidget size="small" />); });
    expect(screen.getAllByRole("listitem")).toHaveLength(3);

    cleanup();
    await act(async () => { render(<MembersWidget size="large" />); });
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
  });
});

describe("the calendar tile", () => {
  it("invites a connection when the read is refused, rather than apologising", async () => {
    /*
     * The ordinary reason this read fails is that nobody has connected
     * Google — so the tile offers the way to fix it. An outage sentence
     * here would be technically true and useless: there is nothing for the
     * reader to wait for.
     */
    CALENDAR = async () => { throw new BffError(404); };
    await act(async () => { render(<CalendarWidget size="large" />); });

    expect(screen.getByText("وصل کردن حساب")).toBeTruthy();
    expect(screen.queryByText("چیزی در تقویم نیست.")).toBeNull();
  });

  it("apologises for a real fault instead of blaming the connection", async () => {
    /*
     * The control for the case above. `connection()` throws NotFoundError
     * when nobody has connected Google — a 404 — so a 500 is something else
     * entirely, and offering "connect an account" there would send someone
     * to reconnect a connection that is fine.
     */
    CALENDAR = async () => { throw new BffError(500); };
    await act(async () => { render(<CalendarWidget size="large" />); });

    expect(screen.getByText("فعلاً نمی‌توان رکوردهای شما را خواند.")).toBeTruthy();
    expect(screen.queryByText("وصل کردن حساب")).toBeNull();
  });

  it("says the calendar is empty when it IS empty — a different fact", async () => {
    CALENDAR = async () => [];
    await act(async () => { render(<CalendarWidget size="large" />); });

    expect(screen.getByText("چیزی در تقویم نیست.")).toBeTruthy();
    expect(screen.queryByText("وصل کردن حساب")).toBeNull();
  });

  it("lists what the connected calendar returns", async () => {
    CALENDAR = async () => [{
      id: "e-1",
      title: "بازبینی هفتگی",
      subtitle: "اتاق ۲",
      occurred_at: "2026-08-29T09:30:00.000Z",
    }];
    await act(async () => { render(<CalendarWidget size="large" />); });

    expect(screen.getByText("بازبینی هفتگی")).toBeTruthy();
  });
});

describe("the integrations tile", () => {
  /**
   * The catalogue is the subject, not the grants: an organization that has
   * connected nothing must still see what there IS to connect. A tile that
   * listed only live grants would render blank on exactly the account that
   * needs the list most, and blank reads as "nothing here".
   */
  it("lists what the product offers even when nothing is connected", async () => {
    CONNECTORS = async () => [];
    await act(async () => { render(<IntegrationsWidget size="large" />); });

    expect(screen.getByText("جی‌میل")).toBeTruthy();
    expect(screen.getAllByText("وصل نشده").length).toBeGreaterThan(0);
    expect(screen.queryByText("فعال")).toBeNull();
  });

  it("marks the connected provider's sources active — and only those", async () => {
    CONNECTORS = async () => [{
      provider: "google",
      configured: true,
      status: "connected",
      account_label: "amir@example.test",
      expires_at: null,
      can_draft: true,
      can_drive: true,
      polled_at: null,
      messages_seen: 0,
    }];
    await act(async () => { render(<IntegrationsWidget size="large" />); });

    /* the control: with google connected, "not connected" must STOP being
       said about google's own sources — an unconditional word satisfies the
       positive half on its own */
    expect(screen.getAllByText("فعال").length).toBeGreaterThan(0);
    expect(screen.queryByText("وصل نشده")).toBeNull();
  });
});
