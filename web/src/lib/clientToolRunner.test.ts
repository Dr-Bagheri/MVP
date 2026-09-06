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
    expect(askConsent, "the card is told the verb, the object AND the tool").toHaveBeenCalledWith("حذف تسک", "جمع‌آوری صدای خام", "delete_task");
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
 * DELETE still asks, because that is the verb the board was lost to; since
 * the afternoon's ruling ("yes, exclude them") so does every write whose
 * effect leaves the person's screen — a message, an invitation, a role, a
 * scope (lib/consentGrant.ts NEVER_COVERED; the class list has its own test).
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

  it("a message to a colleague and a role change still ask inside a granted session (2026-09-06 ruling)", async () => {
    await handleClientToolCall(call({ tool: "create_task", args: { title: "الف" } }), { ...surface, askConsent: async () => "session" as const });
    const askConsent = vi.fn(async () => "no" as const);
    await handleClientToolCall(call({ tool: "send_member_message", label: "پیام به همکار", args: { member: "sina", message: "سلام" } }), { ...surface, askConsent });
    await handleClientToolCall(call({ tool: "set_member_status", label: "تغییر وضعیت عضو", args: { member: "sina", status: "disabled" } }), { ...surface, askConsent });
    expect(askConsent, "a message or a status change ran on the session grant").toHaveBeenCalledTimes(2);
    expect(executeClientTool, "only the create performed").toHaveBeenCalledTimes(1);
    /* THE CONTROL in the same granted session: an edit is covered and asks nobody */
    await handleClientToolCall(call({ tool: "update_task", label: "ویرایش تسک", args: { task_id: "t", title: "الف" } }), { ...surface, askConsent });
    expect(askConsent).toHaveBeenCalledTimes(2);
    expect(executeClientTool).toHaveBeenCalledTimes(2);
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
  it("the first name-like field, and where a move is going — the generic rule for tools without an entry", () => {
    expect(consentDetail("delete_task", { task_id: "t-1", title: "جمع‌آوری صدای خام" })).toBe("جمع‌آوری صدای خام");
    expect(consentDetail("create_task", { project: "دیتابیس صوتی" })).toBe("دیتابیس صوتی");
    expect(consentDetail("update_task", { task_id: "t-1", title: "کار", folder: "دیتابیس صوتی" })).toBe("کار \u2190 دیتابیس صوتی");
    expect(consentDetail("update_task", { task_id: "t-1", title: "کار", column: "در حال انجام" })).toBe("کار \u2190 در حال انجام");
  });
  it("nothing to name is null, not an empty string the card would render as a dash", () => {
    expect(consentDetail("update_task", { task_id: "t-1" })).toBeNull();
    expect(consentDetail("navigate", undefined)).toBeNull();
    expect(consentDetail("rename_record", { title: "kickoff" }), "a new title with no record to rename").toBeNull();
  });
  it("names the OBJECT and not its new value, per tool (2026-09-06)", () => {
    /* every one of these named the wrong half under the generic rule: the
       first name-like key in a fixed order, which is the NEW value whenever a
       tool carries both */
    expect(consentDetail("rename_record", { record: "call 3", title: "kickoff" })).toBe("call 3 → kickoff");
    expect(consentDetail("update_project", { project: "الف", name: "ب" })).toBe("الف → ب");
    expect(consentDetail("update_task_column", { column: "در حال انجام", name: "انجام", archived: false })).toBe("در حال انجام → انجام ✗");
    expect(consentDetail("set_member_role", { member: "amir", role: "admin" })).toBe("amir → admin");
    expect(consentDetail("set_member_status", { member: "amir", status: "disabled" })).toBe("amir → disabled");
    expect(consentDetail("set_project_member", { project: "الف", member: "sina", member_of: false })).toBe("الف: sina ✗");
    expect(consentDetail("set_role_permission", { role: "member", capability: "tasks.delete", allowed: true })).toBe("tasks.delete: member ✓");
    expect(consentDetail("set_model_allowed", { model_id: "google/gemini", allowed: false })).toBe("google/gemini ✗");
    expect(consentDetail("invite_member", { email: "a@b.ir", role: "member" })).toBe("a@b.ir → member");
    expect(consentDetail("delete_record", { record: "جلسهٔ هفتگی" })).toBe("جلسهٔ هفتگی");
    expect(consentDetail("share_conversation", { conversation: "بودجه", shared: false })).toBe("بودجه ✗");
  });
  it("a record edit names the record and quotes the words about to replace its text (2026-09-06)", () => {
    expect(consentDetail("correct_transcript", { record: "call 3", segment_id: "s-1", text: "پروژهٔ نورای" })).toBe("call 3: «پروژهٔ نورای»");
    expect(consentDetail("edit_summary", { record: "call 3", body: "خلاصهٔ تازه" })).toBe("call 3: «خلاصهٔ تازه»");
  });
  it("a connector hand names where it lands and quotes what it carries (2026-09-06)", () => {
    expect(consentDetail("send_slack_message", { channel: "#general", text: "سلام تیم" })).toBe("#general: «سلام تیم»");
    expect(consentDetail("send_whatsapp_message", { to: "+989120000000", template: "welcome" })).toBe("+989120000000");
    expect(consentDetail("create_jira_issue", { project: "NEU", summary: "باگ ورود", description: "…" })).toBe("NEU: «باگ ورود»");
    expect(consentDetail("create_notion_page", { parent: "یادداشت‌ها", title: "جلسهٔ هفتگی" })).toBe("یادداشت‌ها: «جلسهٔ هفتگی»");
    expect(consentDetail("create_zoom_meeting", { topic: "هماهنگی", minutes: "30" })).toBe("هماهنگی");
    expect(consentDetail("call_mcp_tool", { tool: "search", arguments_json: "{\"q\":\"x\"}" })).toBe("search: «{\"q\":\"x\"}»");
  });
  it("quotes the words a person is about to send in their own name, cut at sixty", () => {
    expect(consentDetail("send_member_message", { member: "sina", message: "سلام، جلسه ساعت ده" })).toBe("sina: «سلام، جلسه ساعت ده»");
    const long = "ا".repeat(80);
    expect(consentDetail("send_member_message", { member: "sina", message: long })).toBe(`sina: «${"ا".repeat(60)}…»`);
  });
});
