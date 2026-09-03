import { api } from "@/api/client";
import type { AgentEvent } from "@/api/types";
import { executeClientTool } from "./agentSurface";

/**
 * PERFORMING A CLIENT TOOL, once, for every surface that advertises one.
 *
 * ── THE BUG THIS EXISTS FOR (user report, 2026-09-03: "echo stuck in thinking
 * mode") ───────────────────────────────────────────────────────────────────
 *
 * The assistant PAGE advertised `SURFACE_TOOLS` and had no `client_tool_call`
 * case. So the model was told it could start a recording, called
 * `start_recording`, and the browser silently dropped the event — while the
 * server sat waiting for the answer it had asked for. The run hung until the
 * 120-second client-tool timeout, which on screen is a spinner that never
 * stops. Nothing anywhere was red: both halves were individually correct, and
 * the failure lived in the space between them.
 *
 * It is the SAME SEAM that broke once before, and the comment above the
 * offending line said so — "SURFACE_TOOLS was advertised by the voice orb
 * alone, so a TYPED ask reached a model that had been told about no client
 * tools at all". That fix taught the page to ADVERTISE and never taught it to
 * PERFORM. Half a seam closed reads exactly like a whole one.
 *
 * So the handler is one function now, and `clientTools.guard.test.ts` asserts
 * that advertising and performing come in pairs — the same shape as the BFF's
 * declare-and-forward guard, for the same reason.
 *
 * ── WHY THE CALLER STILL PASSES THINGS IN ──────────────────────────────────
 *
 * Consent, navigation and the voice are the surface's own: a sidebar asks in a
 * card inside itself, the page asks in its own frame, and only one of them has
 * a voice to silence. Those are injected. What is NOT injected is the part
 * that must never differ — that every path answers the server exactly once,
 * including the refusals and the throws.
 */
export interface ClientToolSurface {
  /** ask the person; `undefined` means this surface performs writes unasked */
  askConsent?: ((label: string) => Promise<boolean>) | undefined;
  push(path: string): void;
  switchLocale(next: string): void;
  /** starting or resuming a recording silences the spoken reply, where there is one */
  onRecordingStarted?: (() => void) | undefined;
}

type ClientToolCall = Extract<AgentEvent, { type: "client_tool_call" }>;

export async function handleClientToolCall(
  event: ClientToolCall,
  surface: ClientToolSurface,
): Promise<void> {
  /*
   * ONE answer, on every path — including the ones that throw.
   *
   * The server is blocked on this reply; a path that returns without sending
   * it is the hang this file was written to end, and "I returned early" is the
   * easiest way to write that by accident. The try/finally is what makes the
   * guarantee structural rather than a thing four call sites remember.
   */
  let answered = false;
  const answer = async (ok: boolean, detail: string) => {
    if (answered) return;
    answered = true;
    /* a failed DELIVERY is swallowed: the run is already waiting, and throwing
       here would replace a slow failure with a broken stream */
    await api.deliverToolResult(event.id, ok, detail).catch(() => undefined);
  };

  try {
    /* consent BEFORE execution for write-effect calls; the loop blocks here
       deliberately — the server is waiting on this very answer */
    if (event.requires_consent && surface.askConsent) {
      const allowed = await surface.askConsent(event.label);
      if (!allowed) {
        await answer(false, "the user declined");
        return;
      }
    }

    const result = await executeClientTool(event.tool, event.args, {
      push: surface.push,
      switchLocale: surface.switchLocale,
    });

    if (result.ok && (event.tool === "start_recording" || event.tool === "resume_recording")) {
      surface.onRecordingStarted?.();
    }
    await answer(result.ok, result.detail);
  } catch (cause) {
    /* an exception here is OUR fault, not a refusal, and it still has to reach
       the server — a thrown handler that says nothing is the same hang wearing
       a different cause */
    await answer(false, cause instanceof Error ? cause.message : "the surface could not perform that");
  } finally {
    await answer(false, "the surface did not answer");
  }
}
