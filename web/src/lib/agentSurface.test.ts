/**
 * M33 — the surface executor. Model-authored args are validated like human
 * input; the interesting assertions are the REFUSALS (a wrong tool or a
 * malformed arg must come back as an honest result the model can read, not
 * as a throw and not as a silent no-op), and that navigation goes through
 * the surface's OWN push — the locale-aware router, never a raw location.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const members = vi.fn();
const setUserStatus = vi.fn();
const setUserRole = vi.fn();
vi.mock("@/api/client", () => ({
  api: {
    members: (...args: unknown[]) => members(...args),
    setUserStatus: (...args: unknown[]) => setUserStatus(...args),
    setUserRole: (...args: unknown[]) => setUserRole(...args),
  },
}));

import { executeClientTool, SURFACE_TOOLS } from "./agentSurface";
import { recorderControls, type RecorderHandle } from "@/components/echo/recorderControls";

function surface() {
  const push = vi.fn();
  return { push, ctx: { push } };
}

function liveRecorder(phase: "recording" | "paused"): {
  handle: RecorderHandle;
  pause: ReturnType<typeof vi.fn>;
  resume: ReturnType<typeof vi.fn>;
  finish: ReturnType<typeof vi.fn>;
} {
  const pause = vi.fn();
  const resume = vi.fn();
  const finish = vi.fn(async () => undefined);
  return { handle: { phase: () => phase, pause, resume, finish }, pause, resume, finish };
}

beforeEach(() => {
  members.mockReset();
  setUserStatus.mockReset();
  setUserRole.mockReset();
  recorderControls.current = null;
});

describe("executeClientTool", () => {
  it("navigates only to routes a human could click to — and through the router", async () => {
    const { push, ctx } = surface();
    expect((await executeClientTool("navigate", { path: "/echo/records" }, ctx)).ok).toBe(true);
    expect(push).toHaveBeenCalledWith("/echo/records");
    // a model-authored path outside the product is a refusal, not a jump
    const evil = await executeClientTool("navigate", { path: "https://evil.example" }, ctx);
    expect(evil.ok).toBe(false);
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("start_recording rides the agentStart param — the recorder's own start path", async () => {
    const { push, ctx } = surface();
    const result = await executeClientTool("start_recording", { title: "call 1" }, ctx);
    expect(result.ok).toBe(true);
    expect(push).toHaveBeenCalledWith("/echo/record?agentStart=call%201");
  });

  it("pause/resume reach the LIVE recorder or refuse honestly", async () => {
    const { ctx } = surface();
    expect(await executeClientTool("pause_recording", {}, ctx)).toEqual({
      ok: false, detail: "no recording is in progress on this screen",
    });
    const rec = liveRecorder("recording");
    recorderControls.current = rec.handle;
    expect((await executeClientTool("pause_recording", {}, ctx)).ok).toBe(true);
    expect(rec.pause).toHaveBeenCalled();
    // resuming a RECORDING take is a refusal — the phases are not interchangeable
    expect((await executeClientTool("resume_recording", {}, ctx)).ok).toBe(false);
    const paused = liveRecorder("paused");
    recorderControls.current = paused.handle;
    expect((await executeClientTool("resume_recording", {}, ctx)).ok).toBe(true);
    expect(paused.resume).toHaveBeenCalled();
  });

  it("finish_recording ends a live OR paused take — and refuses with none", async () => {
    const { ctx } = surface();
    expect((await executeClientTool("finish_recording", {}, ctx)).ok).toBe(false);
    const rec = liveRecorder("paused");
    recorderControls.current = rec.handle;
    const result = await executeClientTool("finish_recording", {}, ctx);
    expect(result.ok).toBe(true);
    expect(rec.finish).toHaveBeenCalled();
  });

  it("set_member_status resolves the person and presses the SAME api the screen does", async () => {
    const { ctx } = surface();
    members.mockResolvedValue([{ id: "u-1", username: "amir", email: "amir@x.ir", display_name: "امیر" }]);
    setUserStatus.mockResolvedValue({});
    const result = await executeClientTool("set_member_status", { member: "amir", status: "disabled" }, ctx);
    expect(result.ok).toBe(true);
    expect(members).toHaveBeenCalledWith({ search: "amir" });
    expect(setUserStatus).toHaveBeenCalledWith("u-1", "disabled");
  });

  it("ambiguity is a refusal, never a guess — two Amirs disable nobody", async () => {
    const { ctx } = surface();
    members.mockResolvedValue([
      { id: "u-1", username: "amir", email: "a@x.ir", display_name: "امیر رضایی" },
      { id: "u-2", username: "amir2", email: "b@x.ir", display_name: "امیر محمدی" },
    ]);
    const result = await executeClientTool("set_member_status", { member: "امیر", status: "disabled" }, ctx);
    expect(result.ok).toBe(false);
    expect(setUserStatus).not.toHaveBeenCalled();
    // …but an EXACT username among several matches is not ambiguous
    const exact = await executeClientTool("set_member_status", { member: "amir2", status: "disabled" }, ctx);
    expect(exact.ok).toBe(true);
    expect(setUserStatus).toHaveBeenCalledWith("u-2", "disabled");
  });

  it("a 403 comes back as the ROLE refusal — the wall is the server's, worded plainly", async () => {
    const { ctx } = surface();
    members.mockResolvedValue([{ id: "u-1", username: "amir", email: "a@x.ir", display_name: "امیر" }]);
    setUserRole.mockRejectedValue({ status: 403, detail: "forbidden" });
    const result = await executeClientTool("set_member_role", { member: "amir", role: "admin" }, ctx);
    expect(result).toEqual({ ok: false, detail: "the server refused: this needs an admin role" });
  });

  it("open_call demands a real id — a model cannot navigate by prose", async () => {
    const { ctx } = surface();
    expect((await executeClientTool("open_call", { call_id: "the meeting" }, ctx)).ok).toBe(false);
    expect(
      (await executeClientTool("open_call", { call_id: "11111111-1111-4111-8111-111111111111" }, ctx)).ok,
    ).toBe(true);
  });

  it("an unknown tool is a refusal result — never a throw, never a silent nothing", async () => {
    const { ctx } = surface();
    expect(await executeClientTool("self_destruct", {}, ctx)).toEqual({
      ok: false, detail: "this surface cannot perform that tool",
    });
  });

  it("advertises exactly what it can execute — the list and the switch cannot drift", async () => {
    const { ctx } = surface();
    members.mockResolvedValue([]);
    for (const tool of SURFACE_TOOLS) {
      // every advertised tool must be HANDLED (refusals fine; "cannot
      // perform" means the advertisement lied)
      const result = await executeClientTool(tool, {}, ctx);
      expect(result.detail).not.toBe("this surface cannot perform that tool");
    }
  });
});
