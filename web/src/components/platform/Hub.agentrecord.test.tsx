import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "@/api/types";

/**
 * **A flagged agent arms a recording; the first question starts it.**
 *
 * The defect this file exists for (user report, 2026-08-31: "if its on and
 * you add the agent it will start recording, its a bug"): selecting an agent
 * began a take immediately. Picking an agent is reading a card, not beginning
 * a conversation — somebody opening one to see what it does, or clicking
 * through three to choose, had a live microphone for each.
 *
 * The two assertions have to be a PAIR. "It records when I ask" is satisfied
 * by the buggy version too, since that one records on arrival and would still
 * be recording by the time the question goes out. Only the negative — nothing
 * has started while the composer is untouched — can tell the two apart.
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

let search = new URLSearchParams("");
vi.mock("next/navigation", () => ({ useSearchParams: () => search }));

/** every take the hub asks the engine to start */
const started: unknown[] = [];
vi.mock("@/lib/recordingEngine", () => ({
  startRecording: async (opts: unknown) => { started.push(opts); },
  recorderSnapshot: () => ({ phase: "idle", recordedMs: 0, title: "" }),
  subscribeRecorder: () => () => {},
  pause: () => {},
  resume: () => {},
  finish: async () => {},
}));

/** every question the hub actually sends — the thread's own rendering is not
    the subject here, and asserting on it would test the renderer instead */
const asked: string[] = [];

async function* scriptedAsk(question: string): AsyncGenerator<AgentEvent> {
  asked.push(question);
  yield { type: "session", id: "sess-rec-1", created: true };
  yield { type: "text_delta", delta: "پاسخ" };
  yield { type: "done", runId: "run-rec-1", failed: false };
}

const RECORDER_AGENT = {
  id: "ag-1",
  handle: "recorder",
  name: "Recording assistant",
  description: "About the take you just made.",
  level: "system" as const,
  icon: "sparkle",
  color: "blue",
  model: null,
  tools: ["search_transcripts"],
  web: false,
};

/** the person has switched the toggle on for this agent, and only this one */
let recordOnAgents: string[] = ["recorder"];

vi.mock("@/api/client", () => ({
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
      record_on_workflows: [],
      record_on_agents: recordOnAgents,
    }),
    ask: (question: string) => scriptedAsk(question),
    agentMessages: async () => [],
    models: async () => ({
      models: [{ id: "google/gemini-3.1-pro-preview", name: "Gemini 3.1 Pro", reasoning: true }],
      preferred_model: null, curated: false, tool_capability_filtered: false,
    }),
    skills: async () => [],
    agents: async () => [RECORDER_AGENT],
    workflows: async () => [],
    search: async () => [],
    assistantTools: async () => [],
    sessionFeedback: async () => ({}),
    shareState: async () => false,
    agentSessions: async () => [],
    /* the composer's ⊕ reads the connector list when it OPENS (2026-09-03).
       An absent method throws inside a promise, and the failure surfaces as
       whatever died next — here, a menu item that "could not be found". */
    connectors: async () => [],
    mailDrafts: async () => [],
  },
}));

const { Hub } = await import("./Hub");

const ask = () => screen.getByLabelText("بپرسید یا دستور بدهید…");

describe("Hub — a flagged agent records on the first question", () => {
  beforeEach(() => {
    started.length = 0;
    asked.length = 0;
    recordOnAgents = ["recorder"];
    search = new URLSearchParams("agent=recorder");
  });

  it("starts NOTHING when the agent is merely selected", async () => {
    render(<Hub />);

    /* the agent is loaded and applied — the surface is ready to be asked */
    await waitFor(() => expect(ask()).toBeTruthy());
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(started).toHaveLength(0);
  });

  it("starts the take when the person actually asks something", async () => {
    render(<Hub />);
    await waitFor(() => expect(ask()).toBeTruthy());

    fireEvent.change(ask(), { target: { value: "این جلسه درباره چه بود؟" } });
    fireEvent.keyDown(ask(), { key: "Enter" });

    await waitFor(() => expect(started).toHaveLength(1));
    /* and it is a real take, not a placeholder: the engine is handed the
       locale's language rather than whatever the last recorder used */
    expect(started[0]).toMatchObject({ source: "mic", language: "fa" });
  });

  it("starts nothing at all when the toggle is off for this agent", async () => {
    /* the control for the pair above. Without it, a hub that recorded on
       every question would satisfy both of them. */
    recordOnAgents = [];
    render(<Hub />);
    await waitFor(() => expect(ask()).toBeTruthy());

    fireEvent.change(ask(), { target: { value: "سلام" } });
    fireEvent.keyDown(ask(), { key: "Enter" });

    await waitFor(() => expect(asked).toHaveLength(1));
    expect(started).toHaveLength(0);
  });

  it("does not start a second take on the next question", async () => {
    render(<Hub />);
    await waitFor(() => expect(ask()).toBeTruthy());

    fireEvent.change(ask(), { target: { value: "سؤال یک" } });
    fireEvent.keyDown(ask(), { key: "Enter" });
    await waitFor(() => expect(started).toHaveLength(1));

    /* wait for the first run to finish before sending again — a press during
       a stream is refused by the composer's own guard, which would make this
       pass for the wrong reason */
    await waitFor(() => expect(asked).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 60));

    fireEvent.change(ask(), { target: { value: "سؤال دو" } });
    fireEvent.keyDown(ask(), { key: "Enter" });

    await waitFor(() => expect(asked).toHaveLength(2));
    expect(started).toHaveLength(1);
  });
});
