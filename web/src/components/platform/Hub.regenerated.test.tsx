import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AgentMessage } from "@/api/types";

/**
 * Resuming the conversation shape a REGENERATE leaves behind: user turn, then
 * TWO consecutive assistant turns (append-only regenerate, M27). The fixture
 * is transcribed from the first real Frankfurt session (seq 0/1/2, tool_calls
 * [] on every row, runs ok) — the "hi" conversation whose opening crashed the
 * page with a client-side exception (user report, 2026-08-17).
 */
vi.mock("@/components/platform/PlatformShell", () => ({
  PlatformShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/i18n/routing", () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  usePathname: () => "/",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("c=31fe0020-cfbc-4f0f-92a8-3f4864e5db54"),
}));

const REGENERATED: AgentMessage[] = [
  { id: "m0", role: "user", content: "hi", tool_calls: [], proposal: null },
  { id: "m1", role: "assistant", content: "سلام! چطور می‌توانم کمکتان کنم؟", tool_calls: [], proposal: null },
  { id: "m2", role: "assistant", content: "سلام! من دستیار اکو هستم و می‌توانم دربارهٔ تماس‌ها و رونوشت‌هایتان کمک کنم.", tool_calls: [], proposal: null },
];

vi.mock("@/api/client", () => ({
  api: {
    me: async () => ({
      id: "u-1", org_id: "o-1", username: "sara", display_name: "سارا",
      avatar_url: null, role: "owner", status: "active", locale: "fa",
      model_id: null, created_at: new Date().toISOString(),
    }),
    agentMessages: async () => REGENERATED,
    models: async () => ({ models: [{ id: "google/gemini-3.1-pro-preview", name: "Google: Gemini 3.1 Pro Preview" }], preferred_model: null, curated: true, tool_capability_filtered: false }),
    skills: async () => [],
    assistantTools: async () => [],
    sessionFeedback: async () => ({}),
    shareState: async () => false,
  },
}));

const { Hub } = await import("./Hub");

describe("resuming a regenerated conversation", () => {
  it("renders both assistant turns without crashing — the append-only regenerate shape", async () => {
    render(<Hub />);
    expect(await screen.findByText("hi")).toBeTruthy();
    expect(screen.getByText(/دستیار اکو هستم/)).toBeTruthy();
    // both assistant turns are ON the record (append-only, never replaced)
    expect(screen.getByText(/چطور می‌توانم کمکتان کنم/)).toBeTruthy();
  });
});
