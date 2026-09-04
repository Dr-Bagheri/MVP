import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "@/api/types";

vi.mock("@/components/platform/PlatformShell", () => ({
  PlatformShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/i18n/routing", () => ({
  Link: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a>,
  usePathname: () => "/assistant",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/fa/assistant",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));
const asked: string[] = [];
vi.mock("@/api/client", () => ({
  BffError: class extends Error {},
  api: {
    me: async () => ({ id: "u-1", org_id: "o-1", username: "sara", display_name: "سارا",
      avatar_url: null, role: "admin", status: "active", locale: "fa", model_id: null,
      created_at: new Date().toISOString() }),
    ask: (q: string) => { asked.push(q); return (async function* (): AsyncGenerator<AgentEvent> {
      yield { type: "text_delta", delta: "ok" };
      yield { type: "done", runId: "r", failed: false };
    })(); },
    agentMessages: async () => [], models: async () => ({ models: [], preferred_model: null, curated: false, tool_capability_filtered: false }),
    skills: async () => [], agents: async () => [], workflows: async () => [], search: async () => [],
    assistantTools: async () => [], sessionFeedback: async () => ({}), shareState: async () => false,
    agentSessions: async () => [], connectors: async () => [], mailDrafts: async () => [],
  },
}));
const { Hub } = await import("./Hub");

describe("the send button", () => {
  beforeEach(() => { asked.length = 0; });

  it("sends what is in the box when the ↵ button is pressed", async () => {
    render(<Hub />);
    const box = screen.getByPlaceholderText(/بپرسید/);
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    setter.call(box, "سلام");
    box.dispatchEvent(new Event("input", { bubbles: true }));

    const send = await screen.findByRole("button", { name: /ارسال/ });
    expect(send.hasAttribute("disabled"), "the button must be live once there is text").toBe(false);
    fireEvent.click(send);
    await waitFor(() => expect(asked).toEqual(["سلام"]));
  });

  it("and by pressing Enter in the box", async () => {
    render(<Hub />);
    const box = screen.getByPlaceholderText(/بپرسید/);
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    setter.call(box, "دو");
    box.dispatchEvent(new Event("input", { bubbles: true }));
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(asked).toEqual(["دو"]));
  });
});
