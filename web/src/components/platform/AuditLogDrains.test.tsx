import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * Audit log drains — a page whose correctness is almost entirely in what it
 * does NOT render, so the tests are almost entirely negative.
 *
 * That shape needs saying out loud, because a negative assertion is the kind
 * that rots quietly: it passes on an empty page, it passes on a broken page,
 * and it would pass if this component were deleted. So the first test pins
 * that the component actually rendered its subject before any of the "must not
 * exist" claims are made — otherwise this file is four confident assertions
 * about nothing, which is the vacuous-checker failure in its purest form.
 */

vi.mock("@/i18n/routing", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { AuditLogDrains } = await import("./AuditLogDrains");

describe("the drains page says what is true and builds nothing", () => {
  it("renders its subject at all — the guard the negative tests below depend on", () => {
    render(<AuditLogDrains />);
    // specific to THIS page, not "the body has children": a partially rendered
    // or empty component satisfies the looser check and would make every
    // assertion after it vacuously true
    expect(screen.getByText(/این بخش هنوز ساخته نشده است/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /رفتن به اتصال‌ها/ })).toBeTruthy();
  });

  it("offers no form — not even a disabled one", () => {
    render(<AuditLogDrains />);
    /*
     * A disabled form still asserts that the fields it shows are the fields
     * that will exist, which is a design decision nobody has made. The house
     * rule one section over is the stronger version: a form that looks like it
     * saved and saved nothing is worse than a disabled one.
     */
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders no list of destinations, empty or otherwise", () => {
    render(<AuditLogDrains />);
    /*
     * **The assertion this file exists for.** An empty table here would say
     * "you have not configured any destinations" — a claim about the
     * organization — where the truth is "destinations cannot be configured" —
     * a claim about the product. Rendered, those are the same picture, and
     * only one of them is true. It is the empty-audit-feed lie wearing a
     * different header.
     */
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("points at the mechanism that actually works today", () => {
    render(<AuditLogDrains />);
    /*
     * The one claim on the page, and it is true: webhook delivery is live,
     * signed and retried. The href is asserted because a link is a promise —
     * the route-reachability instrument exists because one that resolved
     * nowhere shipped on the product's centrepiece.
     */
    expect(screen.getByRole("link", { name: /رفتن به اتصال‌ها/ })).toHaveAttribute(
      "href",
      "/management/connectors",
    );
  });
});
