import { beforeEach, describe, expect, it, vi } from "vitest";

const deliverToolResult = vi.fn();
const executeClientTool = vi.fn();
vi.mock("@/api/client", () => ({
  api: { deliverToolResult: (...args: unknown[]) => deliverToolResult(...args) },
}));
vi.mock("./agentSurface", () => ({
  executeClientTool: (...args: unknown[]) => executeClientTool(...args),
}));

import { consentDetail, handleClientToolCall } from "./clientToolRunner";

const call = (over: Record<string, unknown> = {}) => ({
  type: "client_tool_call" as const,
  id: "c-1",
  tool: "delete_task",
  label: "حذف تسک",
  args: { task_id: "t-1", title: "جمع‌آوری صدای خام" },
  effect: "write" as const,
  requires_consent: true,
  ...over,
}) as never;

const surface = { push: vi.fn(), switchLocale: vi.fn() };

/**
 * 2026-09-06, the small hours: on the assistant page — which had no consent
 * card — every write the agent asked for RAN, because the runner treated a
 * surface without `askConsent` as one that need not ask. The comment beside
 * the page said the opposite. A consent-requiring call on a surface that
 * cannot ask is a refusal now, verified red against the fall-through.
 */
describe("consent is asked, or the call is refused — never performed on a silent yes", () => {
  beforeEach(() => {
    deliverToolResult.mockReset(); deliverToolResult.mockResolvedValue(undefined);
    executeClientTool.mockReset(); executeClientTool.mockResolvedValue({ ok: true, detail: "done" });
  });

  it("a surface with no way to ask refuses a write and performs nothing", async () => {
    await handleClientToolCall(call(), surface);
    expect(executeClientTool).not.toHaveBeenCalled();
    expect(deliverToolResult).toHaveBeenCalledWith("c-1", false, expect.stringMatching(/cannot ask/));
  });

  it("a surface that asks is told the VERB and the OBJECT, and a yes performs", async () => {
    const askConsent = vi.fn(async () => true);
    await handleClientToolCall(call(), { ...surface, askConsent });
    expect(askConsent).toHaveBeenCalledWith("حذف تسک", "جمع‌آوری صدای خام");
    expect(executeClientTool).toHaveBeenCalledWith("delete_task", { task_id: "t-1", title: "جمع‌آوری صدای خام" }, expect.anything());
    expect(deliverToolResult).toHaveBeenCalledWith("c-1", true, "done");
  });

  it("a no performs nothing and says the person declined", async () => {
    await handleClientToolCall(call(), { ...surface, askConsent: async () => false });
    expect(executeClientTool).not.toHaveBeenCalled();
    expect(deliverToolResult).toHaveBeenCalledWith("c-1", false, "the user declined");
  });

  it("the control: a call that needs no consent performs without a card", async () => {
    await handleClientToolCall(call({ tool: "navigate", label: "رفتن به صفحه", args: { path: "/tasks" }, effect: "ui", requires_consent: false }), surface);
    expect(executeClientTool).toHaveBeenCalled();
  });
});

describe("what the card names", () => {
  it("the first name-like field, and where a move is going", () => {
    expect(consentDetail({ task_id: "t-1", title: "جمع‌آوری صدای خام" })).toBe("جمع‌آوری صدای خام");
    expect(consentDetail({ project: "دیتابیس صوتی" })).toBe("دیتابیس صوتی");
    expect(consentDetail({ task_id: "t-1", title: "کار", folder: "دیتابیس صوتی" })).toBe("کار \u2190 دیتابیس صوتی");
    expect(consentDetail({ task_id: "t-1", title: "کار", column: "در حال انجام" })).toBe("کار \u2190 در حال انجام");
  });
  it("nothing to name is null, not an empty string the card would render as a dash", () => {
    expect(consentDetail({ task_id: "t-1" })).toBeNull();
    expect(consentDetail(undefined)).toBeNull();
  });
});
