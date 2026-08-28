import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "@/api/types";

/**
 * **The composer never sends a model the server did not offer.**
 *
 * A saved preference outlives the catalogue. The first real member's was
 * `~anthropic/claude-opus-latest`, saved while it was served and barred the
 * day the no-Claude filter learned to spell the leading `~`.
 *
 * The server has since stopped reporting a barred preference at all (both
 * readers agree it is no preference), so this is now a BELT: a client that
 * adopts whatever `preferred_model` says would put an unservable id on every
 * ask, and the fix must not depend on the server having already filtered it.
 * The client's rule stands on its own — never send a model the server did
 * not offer in this same response.
 *
 * The assertion is the ASK's model argument, not the rendered label: a
 * picker showing the right thing while the wire carries the wrong one is
 * exactly the failure that shipped.
 */
vi.mock("@/components/platform/PlatformShell", () => ({
  PlatformShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/i18n/routing", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
  usePathname: () => "/assistant",
  useRouter: () => ({ replace: () => {}, push: () => {} }),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(
    "workflow=w1&connectorProvider=google&sourceId=msg-1&run=1",
  ),
}));

const sentModels: (string | undefined)[] = [];
let preferred: string | null = null;
const OFFERED = [
  { id: "google/gemini-3.1-pro-preview", name: "Gemini 3.1 Pro", reasoning: true },
  { id: "openai/gpt-5.2", name: "GPT-5.2", reasoning: false },
];

async function* scriptedAsk(
  _question: string,
  _ctx: unknown,
  _sessionId?: string,
  options?: { model?: string },
): AsyncGenerator<AgentEvent> {
  sentModels.push(options?.model);
  yield { type: "session", id: "s-1", created: true };
  yield { type: "text_delta", delta: "پاسخ" };
  yield { type: "done", runId: "r-1", failed: false };
}

vi.mock("@/api/client", () => ({
  /*
   * The mock owes `BffError` too: Hub catches it by CLASS to tell a
   * refusal from a transport failure, and a mock without it throws
   * "No BffError export is defined" from inside the catch — which
   * surfaced as 15 unhandled errors beside a green suite. A green
   * suite with unhandled rejections is not a green suite.
   */
  BffError: class BffError extends Error {
    constructor(public status: number, public kind?: string, public detail?: string) {
      super(detail ?? kind ?? String(status));
    }
  },
  api: {
    me: async () => ({
      id: "u-1", org_id: "o-1", username: "sara", display_name: "سارا",
      avatar_url: null, role: "admin", status: "active", locale: "fa",
      model_id: null, created_at: new Date().toISOString(),
    }),
    ask: (...args: Parameters<typeof scriptedAsk>) => scriptedAsk(...args),
    agentMessages: async () => [],
    models: async () => ({
      models: OFFERED, preferred_model: preferred,
      curated: true, tool_capability_filtered: false,
    }),
    skills: async () => [],
    agents: async () => [],
    /* one card, so the auto-run fires and the ask's model is observable
       without driving the composer */
    workflows: async () => [{
      id: "w", slug: "w1", name: "Draft email replies",
      description: "", source_kind: "mail_message", icon: "send", color: "coral",
    }],
    search: async () => [],
    assistantTools: async () => [],
    sessionFeedback: async () => ({}),
    shareState: async () => false,
    agentSessions: async () => [],
    /* the thread reads its own drafts on every run and resume */
    mailDrafts: async () => [],
  },
}));

const { Hub } = await import("./Hub");

describe("Hub — the model it sends", () => {
  beforeEach(() => {
    sentModels.length = 0;
    preferred = null;
  });

  it("falls back to an offered model when the saved one is no longer served", async () => {
    preferred = "~anthropic/claude-opus-latest";
    render(<Hub />);
    await waitFor(() => expect(sentModels.length).toBe(1));
    /* the barred id must not reach the wire; the first OFFERED model does */
    expect(sentModels[0]).toBe("google/gemini-3.1-pro-preview");
  });

  it("still honours a saved preference the server does offer", async () => {
    /* the control: without it, "always send models[0]" passes the case
       above while quietly ignoring everyone's actual choice */
    preferred = "openai/gpt-5.2";
    render(<Hub />);
    await waitFor(() => expect(sentModels.length).toBe(1));
    expect(sentModels[0]).toBe("openai/gpt-5.2");
  });
});
