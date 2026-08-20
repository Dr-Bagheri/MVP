/**
 * M33 — the surface executor. Model-authored args are validated like human
 * input; the interesting assertions are the REFUSALS (a wrong tool or a
 * malformed arg must come back as an honest result the model can read, not
 * as a throw and not as a silent no-op), and that navigation goes through
 * the surface's OWN push — the locale-aware router, never a raw location.
 */
import { describe, expect, it, vi } from "vitest";
import { executeClientTool, SURFACE_TOOLS } from "./agentSurface";
import { recorderControls } from "@/components/echo/recorderControls";

function surface() {
  const push = vi.fn();
  return { push, ctx: { push } };
}

describe("executeClientTool", () => {
  it("navigates only to routes a human could click to — and through the router", () => {
    const { push, ctx } = surface();
    expect(executeClientTool("navigate", { path: "/echo/calls" }, ctx).ok).toBe(true);
    expect(push).toHaveBeenCalledWith("/echo/calls");
    // a model-authored path outside the product is a refusal, not a jump
    const evil = executeClientTool("navigate", { path: "https://evil.example" }, ctx);
    expect(evil.ok).toBe(false);
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("start_recording rides the agentStart param — the recorder's own start path", () => {
    const { push, ctx } = surface();
    const result = executeClientTool("start_recording", { title: "call 1" }, ctx);
    expect(result.ok).toBe(true);
    expect(push).toHaveBeenCalledWith("/echo/record?agentStart=call%201");
  });

  it("pause/resume reach the LIVE recorder or refuse honestly", () => {
    const { ctx } = surface();
    recorderControls.current = null;
    expect(executeClientTool("pause_recording", {}, ctx)).toEqual({
      ok: false, detail: "no recording is in progress on this screen",
    });
    const pause = vi.fn();
    const resume = vi.fn();
    recorderControls.current = { phase: () => "recording", pause, resume };
    expect(executeClientTool("pause_recording", {}, ctx).ok).toBe(true);
    expect(pause).toHaveBeenCalled();
    // resuming a RECORDING take is a refusal — the phases are not interchangeable
    expect(executeClientTool("resume_recording", {}, ctx).ok).toBe(false);
    recorderControls.current = { phase: () => "paused", pause, resume };
    expect(executeClientTool("resume_recording", {}, ctx).ok).toBe(true);
    expect(resume).toHaveBeenCalled();
    recorderControls.current = null;
  });

  it("open_call demands a real id — a model cannot navigate by prose", () => {
    const { ctx } = surface();
    expect(executeClientTool("open_call", { call_id: "the meeting" }, ctx).ok).toBe(false);
    expect(
      executeClientTool("open_call", { call_id: "11111111-1111-4111-8111-111111111111" }, ctx).ok,
    ).toBe(true);
  });

  it("an unknown tool is a refusal result — never a throw, never a silent nothing", () => {
    const { ctx } = surface();
    expect(executeClientTool("self_destruct", {}, ctx)).toEqual({
      ok: false, detail: "this surface cannot perform that tool",
    });
  });

  it("advertises exactly what it can execute — the list and the switch cannot drift", () => {
    const { ctx } = surface();
    for (const tool of SURFACE_TOOLS) {
      // every advertised tool must be HANDLED (refusals fine; "cannot
      // perform" means the advertisement lied)
      const result = executeClientTool(tool, {}, ctx);
      expect(result.detail).not.toBe("this surface cannot perform that tool");
    }
  });
});
