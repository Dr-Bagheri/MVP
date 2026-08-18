import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/i18n/routing", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a>,
}));

const { AssistantMenu } = await import("./AssistantMenu");

describe("AssistantMenu", () => {
  it("keeps only usable conversation destinations in the left menu", () => {
    render(<AssistantMenu activeSlug="hub" />);

    expect(screen.queryByRole("link", { name: "newConversation" })).toBeNull();
    expect(screen.getByRole("link", { name: "history" }).getAttribute("href")).toBe("/conversations");
  });
});
