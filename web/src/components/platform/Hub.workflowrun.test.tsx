import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "@/api/types";

/**
 * **Picking a source RUNS the workflow.**
 *
 * The defect this file exists for (user report, 2026-08-27: "I clicked one
 * and nothing happens, nothing returns") had two halves. The launcher pushed
 * at `/`, which stopped being the hub when the dashboard took the landing
 * page — a route that still resolves, so every reachability check stayed
 * green. And even at the right address the hub only drew a pill and waited
 * for the person to invent a question describing the workflow they had just
 * pressed.
 *
 * Both halves are invisible to a test that asserts the hub renders. What
 * this asserts is the ASK: that one is issued without anyone typing, that it
 * carries the workflow and its source, and — the half that keeps it honest —
 * that it is NOT issued when the launcher did not ask for a run.
 */
vi.mock("@/components/platform/PlatformShell", () => ({
  PlatformShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

/** stable across renders, so the disarming replace is observable */
const replaced: unknown[] = [];
vi.mock("@/i18n/routing", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
  usePathname: () => "/assistant",
  useRouter: () => ({
    replace: (to: unknown) => { replaced.push(to); },
    push: () => {},
  }),
}));

/** Read at render time, so each test sets the URL it is about. */
let search = new URLSearchParams("");
/** when true the catalogue answers empty — the race the guard exists for */
let noModels = false;
vi.mock("next/navigation", () => ({
  useSearchParams: () => search,
}));

interface AskOptions {
  workflow?: string;
  connectorProvider?: string;
  sourceId?: string;
}
const asked: { question: string; options: AskOptions }[] = [];
const persisted: { id: string; role: "user" | "assistant"; content: string }[] = [];

async function* scriptedAsk(
  question: string,
  _ctx: { page: string; callIds: string[] },
  _sessionId?: string,
  options?: AskOptions,
): AsyncGenerator<AgentEvent> {
  asked.push({ question, options: options ?? {} });
  yield { type: "session", id: "sess-wf-1", created: true };
  persisted.push({ id: `m-${persisted.length}`, role: "user", content: question });
  yield { type: "text_delta", delta: "پیش‌نویس" };
  persisted.push({ id: `m-${persisted.length}`, role: "assistant", content: "پیش‌نویس" });
  yield { type: "done", runId: "run-wf-1", failed: false };
}

const CARD = {
  id: "wf-1",
  slug: "draft-email-replies",
  name: "Draft email replies",
  description: "Turn one selected email into a reply draft.",
  source_kind: "mail_message" as const,
  icon: "send",
  color: "coral",
};

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
    agentMessages: async () => persisted.map((m) => ({ ...m, tool_calls: [], proposal: null })),
    /*
       A REAL model, because a hub with none cannot run anything: the
       auto-run waits for the catalogue (a run that starts itself has to be
       at least as complete as one a person starts), so an empty list here
       would assert a run in the one state where no run is possible.
    */
    models: async () => ({
      models: noModels
        ? []
        : [{ id: "google/gemini-3.1-pro-preview", name: "Gemini 3.1 Pro", reasoning: true }],
      preferred_model: null, curated: false, tool_capability_filtered: false,
    }),
    skills: async () => [],
    agents: async () => [],
    workflows: async () => [CARD],
    search: async () => [],
    assistantTools: async () => [],
    sessionFeedback: async () => ({}),
    shareState: async () => false,
    agentSessions: async () => [],
    /* the composer's ⊕ reads the connector list when it OPENS (2026-09-03).
       An absent method throws inside a promise, and the failure surfaces as
       whatever died next — here, a menu item that "could not be found". */
    connectors: async () => [],
    /* the thread reads its own drafts on every run and resume */
    mailDrafts: async () => [],
  },
}));

const { Hub } = await import("./Hub");

const RUN_URL =
  "workflow=draft-email-replies&connectorProvider=google&sourceId=msg-1&run=1";

describe("Hub — a picked source runs its workflow", () => {
  beforeEach(() => {
    asked.length = 0;
    persisted.length = 0;
    replaced.length = 0;
    noModels = false;
    search = new URLSearchParams("");
  });

  it("asks once, unprompted, carrying the workflow and its source", async () => {
    search = new URLSearchParams(RUN_URL);
    render(<Hub />);

    await waitFor(() => expect(asked.length).toBe(1));
    /* the opening line is the SERVER's name for the workflow — the client
       does not compose the sentence a workflow is called by */
    expect(asked[0]!.question).toBe("Draft email replies");
    expect(asked[0]!.options.workflow).toBe("draft-email-replies");
    expect(asked[0]!.options.connectorProvider).toBe("google");
    expect(asked[0]!.options.sourceId).toBe("msg-1");

    /* and the answer lands in the thread, which is the whole point of a run */
    await waitFor(() => expect(screen.getByText("پیش‌نویس")).toBeTruthy());

    /* one run per pick: a re-render after the stream must not re-send */
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(asked.length).toBe(1);

    /* and the URL is disarmed: the source stays for follow-ups, `run` is
       spent, so a reload is not a second run of a workflow started once */
    const to = replaced.at(-1) as { query?: Record<string, unknown> } | undefined;
    expect(to?.query).toEqual({
      workflow: "draft-email-replies",
      connectorProvider: "google",
      sourceId: "msg-1",
    });
  });

  it("waits for the catalogue rather than asking with no model", async () => {
    /*
     * The live failure this prevents (2026-08-27): the workflow cards won
     * the race against the model list, the ask went out with no model, the
     * server fell back to a stored preference for a model the product had
     * since barred, and the run ended on a refusal about a model the person
     * never chose. Nothing on screen explained it.
     */
    noModels = true;
    search = new URLSearchParams(RUN_URL);
    render(<Hub />);
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(asked.length).toBe(0);
  });

  it("stays silent when the launcher did not ask for a run", async () => {
    /* the discriminating case: the same workflow and source, no `run` flag —
       someone linked or reloaded the page rather than pressing an item. A
       test that only proves the positive cannot tell an auto-run from a hub
       that sends on any arrival. */
    search = new URLSearchParams(
      "workflow=draft-email-replies&connectorProvider=google&sourceId=msg-1",
    );
    render(<Hub />);

    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(asked.length).toBe(0);
  });

  it("stays silent on a resumed thread", async () => {
    /* `?c=` means an existing conversation is on screen; an auto-send there
       is a message the person did not write into a thread they came back to */
    search = new URLSearchParams(`${RUN_URL}&c=sess-old-1`);
    render(<Hub />);

    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(asked.length).toBe(0);
  });
});
