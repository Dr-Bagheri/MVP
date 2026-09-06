import { CoreError, coreFetch, errorResponse, readJson } from "@/server/core";

/**
 * Approve or refuse an inferred write (SPEC/M4 — the human confirmation gate).
 *
 * **The body carries only `run_id`, never the payload.** core/ re-reads the
 * proposal from the `agent_run.steps` row the agent wrote when it proposed. If
 * the client sent the payload back, "what was proposed" and "what was
 * approved" would be two independent claims, and this whole flow exists to
 * make them one object. Anything else in the body is ignored — and if it ever
 * stopped being ignored, that would be the bug.
 *
 * A 404 on confirm is NOT an error: minutes can pass between propose and
 * confirm, so core/ re-validates and re-checks ownership. The segment may be
 * gone or the call may have changed hands. That is "no longer applicable",
 * and the UI should say so rather than offering a retry.
 *
 * Owner only — RLS gates on `owns_call`, not org membership and not admin.
 */
export async function POST(request: Request, { params }: { params: Promise<{ proposalId: string }> }) {
  try {
    const { proposalId } = await params;
    const { run_id, decision } = await readJson<{ run_id?: unknown; decision?: unknown }>(request);
    /*
     * The decision is a CLOSED WORD and the id is ENCODED before either joins
     * a path: this route used to splice both raw, so a body of
     * `decision: "../../calls"` reached a core route this layer does not
     * expose (under the caller's own bearer, so no authority was gained —
     * but a forwarder that can be steered off its route is not forwarding).
     */
    if (decision !== "confirm" && decision !== "reject") {
      throw new CoreError("invalid", 400, "decision must be confirm or reject", "bad_decision");
    }
    if (typeof run_id !== "string" || run_id === "") {
      throw new CoreError("invalid", 400, "run_id is required", "bad_body");
    }
    return Response.json(
      await coreFetch(`/v1/assistant/proposals/${encodeURIComponent(proposalId)}/${decision}`, {
        method: "POST",
        body: { run_id },
      }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
