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
  it("keeps Security focused on its linked controls rather than repeating the deployment posture", () => {
    render(<SecuritySettings />);

    expect(screen.getByRole("link", { name: "بازکردن پروفایل" }).getAttribute("href")).toBe("/profile");
    expect(screen.getByRole("link", { name: "دیدن روش‌ها" }).getAttribute("href")).toBe("/settings/sso");
    expect(screen.queryByText("آنچه این استقرار اجرا می‌کند")).toBeNull();
  });

  it("lists only the two external sign-in providers", () => {
    render(<SignInMethods />);

    expect(screen.getByText("Google")).toBeTruthy();
    expect(screen.getByText("GitHub")).toBeTruthy();
    expect(screen.queryByText("ایمیل و گذرواژه")).toBeNull();
  });
});
