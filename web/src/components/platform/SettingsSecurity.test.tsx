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
    /* the control: the page still positively renders its real subjects */
    expect(screen.getByText("نشست‌های فعال")).toBeTruthy();
  });

  it("lists only the two external sign-in providers", () => {
    render(<SignInMethods />);

    expect(screen.getByText("Google")).toBeTruthy();
    expect(screen.getByText("GitHub")).toBeTruthy();
    expect(screen.queryByText("ایمیل و گذرواژه")).toBeNull();
  });
});
