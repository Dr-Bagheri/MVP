import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import * as intl from "next-intl";
import { EntryTopBar } from "./EntryTopBar";
import { ProductDemo } from "./ProductDemo";
import { storeTheme, THEME_STORAGE_KEY } from "@/lib/theme";
import { STAGES } from "./steps";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("reset=1") }));
vi.mock("@/i18n/routing", () => ({
  usePathname: () => "/sign-in",
  Link: ({ href, locale, children, scroll: _scroll, ...props }: { href: string; locale: string; children: ReactNode; scroll?: boolean }) =>
    <a href={`/${locale}${href}`} {...props}>{children}</a>,
}));

beforeEach(() => {
  localStorage.clear();
  storeTheme("light");
  vi.spyOn(intl, "useLocale").mockReturnValue("fa");
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("entry bar", () => {
  it("reapplies the stored theme when a locale navigation replaces the document root", () => {
    const { rerender } = render(<EntryTopBar />);
    // Observed in the browser: replacing [locale] strips the runtime root attribute.
    delete document.documentElement.dataset.theme;
    vi.mocked(intl.useLocale).mockReturnValue("en");
    rerender(<EntryTopBar />);
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  it("keeps the page and auth query when choosing a language; Persian is selected", () => {
    render(<EntryTopBar />);
    expect(screen.getByRole("link", { name: "English" })).toHaveAttribute("href", "/en/sign-in?reset=1");
    expect(screen.getByRole("link", { name: "فارسی" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("link", { name: "English" })).not.toHaveAttribute("aria-current");
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("the real shared theme preference changes the document AND the Persian movie, in both directions", () => {
    const { container } = render(<><EntryTopBar /><ProductDemo lesson="meeting" autoPlay={false} /></>);
    expect(container.querySelector("video")).toHaveAttribute("src", "/demo/fa/meeting.mp4");
    fireEvent.click(screen.getByRole("button", { name: "تغییر به پوستهٔ تیره" }));
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(container.querySelector("video")).toHaveAttribute("src", "/demo/fa/dark/meeting.mp4");
    expect(container.querySelector("video")).toHaveAttribute("poster", "/demo/fa/dark/meeting.jpg");
    // A write outside this control also reaches both consumers: no second theme store.
    act(() => storeTheme("light"));
    expect(screen.getByRole("button", { name: "تغییر به پوستهٔ تیره" })).toBeTruthy();
    expect(container.querySelector("video")).toHaveAttribute("src", "/demo/fa/meeting.mp4");
  });

  it("uses the real onboarding stage and progress while keeping preferences available", () => {
    const { container, rerender } = render(<EntryTopBar step="data" />);
    expect(screen.getAllByRole("listitem")).toHaveLength(STAGES.length);
    expect(container.querySelector('[aria-current="step"]')).toHaveTextContent("دسترسی‌ها");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "36");
    expect(screen.getByRole("button", { name: "تغییر به پوستهٔ تیره" })).toBeTruthy();
    rerender(<EntryTopBar step="languages" />);
    expect(container.querySelector('[aria-current="step"]')).toHaveTextContent("راه‌اندازی");
    expect(container.querySelector('[aria-current="step"]')).not.toHaveTextContent("دسترسی‌ها");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "55");
  });
});
