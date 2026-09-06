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
import { consentGrantedForSession, resetConsentGrantForTest, revokeSessionConsent } from "./consentGrant";

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
    const askConsent = vi.fn(async () => "once" as const);
    await handleClientToolCall(call(), { ...surface, askConsent });
    expect(askConsent).toHaveBeenCalledWith("حذف تسک", "جمع‌آوری صدای خام");
    expect(executeClientTool).toHaveBeenCalledWith("delete_task", { task_id: "t-1", title: "جمع‌آوری صدای خام" }, expect.anything());
    expect(deliverToolResult).toHaveBeenCalledWith("c-1", true, "done");
  });

  it("a no performs nothing and says the person declined", async () => {
    await handleClientToolCall(call(), { ...surface, askConsent: async () => "no" as const });
    expect(executeClientTool).not.toHaveBeenCalled();
    expect(deliverToolResult).toHaveBeenCalledWith("c-1", false, "the user declined");
  });

  it("the control: a call that needs no consent performs without a card", async () => {
    await handleClientToolCall(call({ tool: "navigate", label: "رفتن به صفحه", args: { path: "/tasks" }, effect: "ui", requires_consent: false }), surface);
    expect(executeClientTool).toHaveBeenCalled();
  });
});

/**
 * THE STANDING YES (user, 2026-09-06: "add this option to give permission for
 * the whole session so they don't ask one after the other"). Asked once,
 * answered «برای این نشست», the next writes run without a card — and a
 * DELETE still asks, because that is the verb the board was lost to.
 */
describe("a yes for the session", () => {
  beforeEach(() => {
    resetConsentGrantForTest();
    deliverToolResult.mockReset(); deliverToolResult.mockResolvedValue(undefined);
    executeClientTool.mockReset(); executeClientTool.mockResolvedValue({ ok: true, detail: "done" });
  });

  it("answering «for this session» performs this call and the next one without asking again", async () => {
    const askConsent = vi.fn(async () => "session" as const);
    const create = call({ tool: "create_task", label: "ساختن تسک", args: { title: "الف" } });
    await handleClientToolCall(create, { ...surface, askConsent });
    expect(executeClientTool).toHaveBeenCalledTimes(1);
    expect(consentGrantedForSession()).toBe(true);

    await handleClientToolCall(call({ tool: "update_task", label: "ویرایش تسک", args: { task_id: "t", title: "الف" } }), { ...surface, askConsent });
    expect(askConsent, "the second write asked again inside a granted session").toHaveBeenCalledTimes(1);
    expect(executeClientTool).toHaveBeenCalledTimes(2);
    expect(deliverToolResult).toHaveBeenLastCalledWith("c-1", true, "done");
  });

  it("a DELETE still asks inside a granted session — the grant never covers it", async () => {
    await handleClientToolCall(call({ tool: "create_task", args: { title: "الف" } }), { ...surface, askConsent: async () => "session" as const });
    const askConsent = vi.fn(async () => "no" as const);
    await handleClientToolCall(call(), { ...surface, askConsent });
    expect(askConsent, "a delete ran on the session grant").toHaveBeenCalledTimes(1);
    expect(executeClientTool).toHaveBeenCalledTimes(1);
    expect(deliverToolResult).toHaveBeenLastCalledWith("c-1", false, "the user declined");
  });

  it("revoking asks again, and a surface with no card is refused again", async () => {
    await handleClientToolCall(call({ tool: "create_task", args: { title: "الف" } }), { ...surface, askConsent: async () => "session" as const });
    revokeSessionConsent();
    await handleClientToolCall(call({ tool: "create_task", args: { title: "ب" } }), surface);
    expect(executeClientTool).toHaveBeenCalledTimes(1);
    expect(deliverToolResult).toHaveBeenLastCalledWith("c-1", false, expect.stringMatching(/cannot ask/));
  });

  it("the control: «once» performs once and grants nothing", async () => {
    const askConsent = vi.fn(async () => "once" as const);
    await handleClientToolCall(call({ tool: "create_task", args: { title: "الف" } }), { ...surface, askConsent });
    await handleClientToolCall(call({ tool: "create_task", args: { title: "ب" } }), { ...surface, askConsent });
    expect(askConsent).toHaveBeenCalledTimes(2);
    expect(consentGrantedForSession()).toBe(false);
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
