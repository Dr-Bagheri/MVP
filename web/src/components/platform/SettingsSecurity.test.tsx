import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/i18n/routing", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock("@/components/scaffold", () => ({
  FormPanel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  FormRow: ({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) => (
    <div>
      <span>{label}</span>
      {description ? <span>{description}</span> : null}
      {children}
    </div>
  ),
}));

/*
 * The two session reads are stubbed rather than left to the real client,
 * which in jsdom rejects for want of a fetch backend — a rejection that
 * happens to LOOK like the refusal branch. Two different nothings arriving
 * at the same value is the exact bug this page had; a test that relied on it
 * would be asserting an accident.
 */
const mySessions = vi.fn(async () => ({ sessions: [], current: null }));
const orgSessions = vi.fn(async () => []);
vi.mock("@/api/client", () => ({
  api: {
    mySessions: (...a: unknown[]) => mySessions(...(a as [])),
    orgSessions: (...a: unknown[]) => orgSessions(...(a as [])),
    endMySession: vi.fn(), endMemberSession: vi.fn(),
    /* SignInMethods renders from this file too, and a mocked module has only
       what it is given — an api mock that covers one component's calls and
       not its neighbour's fails the neighbour for a reason that has nothing
       to do with it */
    authMethods: async () => [
      { provider: "google", enabled: true }, { provider: "github", enabled: true },
    ],
    setAuthMethod: vi.fn(),
    me: async () => ({ id: "u-1", role: "owner" }),
  },
  BffError: class extends Error {},
}));

const { SecuritySettings } = await import("./SecuritySettings");
const { SignInMethods } = await import("./SignInMethods");

describe("settings security surfaces", () => {
  it("keeps Security to what only it has: the devices and the voice print", () => {
    /*
     * The password/sign-in/export link rows LEFT the page (user directive,
     * 2026-08-28: "remove this first section of security") — every one was
     * a door the menu already reaches, and this page's own subjects are
     * the live sessions and the biometric consent. Their ABSENCE is the
     * assertion, alongside the posture block that left earlier: the wrong
     * version of this page renders perfectly.
     */
    render(<SecuritySettings />);

    expect(screen.queryByRole("link", { name: "بازکردن پروفایل" })).toBeNull();
    expect(screen.queryByRole("link", { name: "دیدن روش‌ها" })).toBeNull();
    expect(screen.queryByText("آنچه این استقرار اجرا می‌کند")).toBeNull();
    /*
     * The control: the page still positively renders its real subject.
     *
     * It names the ORG-WIDE heading now. The two session sections were merged
     * on 2026-09-02 ("remove the second section in the sessions and in first
     * show all online sessions from everywhere connected to our platform"),
     * and this assertion is what caught the change — which is the whole
     * reason a check like this carries a positive control rather than only
     * absences.
     */
    /* the heading itself went on 2026-09-05 ("remove the title"); the
       positive subject is now the row that replaced it — the org-wide
       table's all | online | offline filter, which only an admin's page has */
    expect(screen.getByRole("tab", { name: /آنلاین/ })).toBeTruthy();
  });

  it("falls back to this person's own devices when the org-wide read is refused", async () => {
    /*
     * THE MEMBER'S PATH, and the reason the merge is not a regression for
     * them: the org-wide list is refused below admin (db/0135), and a section
     * that rendered nothing on a refusal would have taken away the one thing
     * a member came here for — the ability to see and end their own devices.
     *
     * Before this round a refusal and "still loading" were the same value, so
     * this branch was unreachable: the page waited forever on an answer that
     * had already come back as no.
     */
    orgSessions.mockRejectedValueOnce(new Error("forbidden"));
    render(<SecuritySettings />);
    expect(await screen.findByText("نشست‌های فعال")).toBeTruthy();
    expect(screen.queryByRole("tab", { name: /آنلاین/ })).toBeNull();
  });

  it("lists only the two external sign-in providers", () => {
    render(<SignInMethods />);

    /* the providers read in Persian on the Persian screen (2026-09-05:
       "in fa only Persian") — the brand names are transliterated like every
       other brand the catalogue names */
    expect(screen.getByText("گوگل")).toBeTruthy();
    expect(screen.getByText("گیت‌هاب")).toBeTruthy();
    expect(screen.queryByText("ایمیل و گذرواژه")).toBeNull();
  });
});
