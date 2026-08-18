import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AssistantConversationProvider, useAssistantConversation } from "./AssistantConversationState";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/i18n/routing", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a>,
}));

const { AssistantMenu } = await import("./AssistantMenu");

function StateControl() {
  const { setStarted } = useAssistantConversation();
  return <button type="button" onClick={() => setStarted(true)}>start</button>;
}

describe("AssistantMenu — New conversation", () => {
  it("is a fresh-hub link before a conversation starts, then becomes disabled", () => {
    render(
      <AssistantConversationProvider>
        <StateControl />
        <AssistantMenu activeSlug="new" />
      </AssistantConversationProvider>,
    );

    expect(screen.getByRole("link", { name: "newConversation" }).getAttribute("href")).toBe("/");
    fireEvent.click(screen.getByRole("button", { name: "start" }));
    expect(screen.getByRole("button", { name: "newConversation" })).toBeDisabled();
  });
});
