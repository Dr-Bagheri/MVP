import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/api/types";

/**
 * THE MENU OFFERS WHAT THE VIEWER CAN OPEN.
 *
 * User directive, 2026-09-18: "make member access invisible to the member
 * roles, admins can see it but also they can not see the admins page of it."
 *
 * The second half was already true and is asserted in core: an admin's
 * `/v1/privileges` response simply contains no admin rows, so the screen has
 * nothing to hide and no curtain to draw. The first half was not: a member saw
 * «سازمان» and four people-sections in the Management menu, pressed one, and
 * met a card telling them it is for admins. Nothing was ever exposed — the
 * page refused, and core/ + RLS refused under it — but a menu whose entries
 * mostly refuse teaches that the navigation does not mean anything.
 *
 * ── what each case here is for ────────────────────────────────────────────
 * Both panes are asserted, not one: they are two registries and two
 * components, and fixing the reported screen alone would leave Settings
 * offering Audit logs and Models to the same person. That is this repo's
 * "fixing one instance does not fix its siblings", and it is the reason the
 * shared hook exists rather than a filter in one file.
 *
 * The MEMBER cases carry a positive assertion beside every absence — a pane
 * that rendered no menu at all would satisfy every `queryBy…` toBeNull() in
 * the file and be completely broken.
 */

const me = vi.fn();
vi.mock("@/api/client", () => ({ api: { me: () => me() } }));

vi.mock("./TwoPane", () => ({
  /* the pane under test decides the GROUPS; TwoPane's own layout is asserted
     in its own file. Rendering the model rather than the chrome is what keeps
     this test about visibility. */
  TwoPane: ({ groups, children }: {
    groups: { key: string; title: string; items: { slug: string; label: string }[] }[];
    children: React.ReactNode;
  }) => (
    <nav aria-label="menu">
      {groups.map((g) => (
        <section key={g.key} aria-label={g.title}>
          {g.items.map((i) => <a key={i.slug} href="#" data-slug={i.slug}>{i.label}</a>)}
        </section>
      ))}
      {children}
    </nav>
  ),
}));

const { ManagementPane } = await import("./ManagementPane");
const { SettingsPane } = await import("./SettingsPane");

const asRole = (role: Role | null) =>
  me.mockResolvedValue(role === null ? null : { id: "u1", role });

const slugs = async () => {
  const nav = await screen.findByRole("navigation");
  return [...nav.querySelectorAll("a")].map((a) => a.getAttribute("data-slug"));
};

beforeEach(() => {
  me.mockReset();
  /* the tab-scoped memory is real state between tests: one case seeding it
     would decide the next one's first paint */
  try { sessionStorage.clear(); } catch { /* jsdom always has it */ }
});

describe("Management's menu", () => {
  it("shows a member only what a member may read", async () => {
    asRole("member");
    render(<ManagementPane activeSlug="">x</ManagementPane>);
    await waitFor(async () => expect(await slugs()).toEqual(["speakers"]));
    /* the group that emptied took its TITLE with it: a heading over no doors
       reads as a broken menu rather than as a menu that is not for you */
    expect(screen.queryByRole("region", { name: /سازمان/ })).toBeNull();
  });

  it("shows an admin every section", async () => {
    asRole("admin");
    render(<ManagementPane activeSlug="">x</ManagementPane>);
    await waitFor(async () =>
      expect(await slugs()).toEqual(["general", "users", "invitations", "privileges", "speakers"]));
  });

  it("shows an owner every section — the control for a check that hid on any non-admin", async () => {
    asRole("owner");
    render(<ManagementPane activeSlug="">x</ManagementPane>);
    await waitFor(async () => expect((await slugs()).length).toBe(5));
  });

  it("keeps the admin sections while the identity is STILL BEING ASKED", async () => {
    /* the direction is deliberate: after the first load of a session the role
       is remembered per tab, so this decides a cold start only — and there an
       admin's menu must not be built member-shaped and then grow. Every row it
       shows for that one paint refuses a member underneath. */
    me.mockReturnValue(new Promise(() => {}));
    render(<ManagementPane activeSlug="">x</ManagementPane>);
    expect(await slugs()).toContain("privileges");
  });

  it("does not empty the menu when the identity read FAILS", async () => {
    /*
     * A network blip is not "there is nobody". Reporting it as one would take
     * an admin's whole Management menu away mid-session — the kinds-of-nothing
     * rule, on a curtain.
     *
     * Two renders on purpose: the first is what puts `admin` in the tab's
     * memory, and the second is the one whose fetch fails. A single render
     * could not tell "the failure was ignored" from "the fetch never
     * resolved", because both leave the seeded answer standing.
     */
    asRole("admin");
    const first = render(<ManagementPane activeSlug="">x</ManagementPane>);
    await waitFor(async () => expect(await slugs()).toContain("privileges"));
    first.unmount();

    me.mockRejectedValue(new Error("offline"));
    render(<ManagementPane activeSlug="">y</ManagementPane>);
    const nav = await screen.findByRole("navigation");
    const after = [...nav.querySelectorAll("a")].map((a) => a.getAttribute("data-slug"));
    expect(after).toContain("privileges");
  });
});

describe("Settings' menu", () => {
  it("hides the admin-only sections from a member and keeps their own", async () => {
    asRole("member");
    render(<SettingsPane activeSlug="general">x</SettingsPane>);
    await waitFor(async () => {
      const list = await slugs();
      expect(list).toContain("general");        // theirs
      expect(list).toContain("security");       // theirs
      expect(list).not.toContain("models");     // admin
      expect(list).not.toContain("audit-logs"); // admin
    });
  });

  it("shows an admin the admin-only sections", async () => {
    asRole("admin");
    render(<SettingsPane activeSlug="general">x</SettingsPane>);
    await waitFor(async () => {
      const list = await slugs();
      expect(list).toContain("models");
      expect(list).toContain("audit-logs");
    });
  });
});
