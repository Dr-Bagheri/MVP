"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { AgentProposal } from "@/api/types";

/**
 * The human confirmation gate (SPEC/M4). An inferred write is proposed here
 * and applied only on an explicit yes.
 *
 * **Nothing has happened when this renders.** The tool result the model saw
 * says `awaiting_confirmation`, so no wording here may be past tense before a
 * confirm — the model isn't claiming it corrected anything, and the UI must
 * not claim it either.
 *
 * It lives in the conversation flow and nowhere else (M4): no badge counts,
 * no proposals list, no inbox. A proposal read away from the sentence that
 * motivated it loses what made it approvable, and an inbox becomes a queue
 * people feel obliged to clear — a consent property, not a UX preference.
 */
type Outcome = "pending" | "applied" | "rejected" | "stale" | "failed";

export function ProposalCard({
  proposal,
  runId,
}: {
  proposal: AgentProposal;
  /** from the `done` event — confirm/reject require it */
  runId?: string;
}) {
  const t = useTranslations("assistant");
  const [outcome, setOutcome] = useState<Outcome>("pending");
  const [busy, setBusy] = useState(false);

  const before = displayValue(proposal.payload.before);
  const after = displayValue(proposal.payload.after);

  async function decide(decision: "confirm" | "reject") {
    if (!runId) return;
    setBusy(true);
    try {
      const result = await api.decideProposal(proposal.id, runId, decision);
      setOutcome(result === "stale" ? "stale" : decision === "confirm" ? "applied" : "rejected");
    } catch {
      setOutcome("failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 rounded-md border border-warning/40 bg-warning/10 p-3">
      <p className="text-xs font-semibold text-warning">{t("proposal")}</p>
      {/* the agent's own account of what it wants to do — the card's headline */}
      <p className="mt-1 text-sm leading-7 text-fg">{proposal.summary}</p>

      {/*
        before → after. `before` is absent only for a first-ever summary, and
        an unknown kind may carry values we can't read; in both cases we show
        what we have rather than crash or invent. A card WITHOUT `before` is
        asking for consent; with it, it's asking for a judgement.
      */}
      {after !== null ? (
        <dl className="mt-3 space-y-2 text-sm">
          {before !== null ? (
            <div>
              <dt className="text-xs text-fg-muted">{t("proposalBefore")}</dt>
              <dd className="leading-7 text-fg-muted line-through decoration-fg-muted/40">{before}</dd>
            </div>
          ) : null}
          <div>
            <dt className="text-xs text-fg-muted">{t("proposalAfter")}</dt>
            <dd className="leading-7 text-fg">{after}</dd>
          </div>
        </dl>
      ) : null}

      {outcome === "pending" ? (
        <>
          <p className="mt-3 text-xs leading-6 text-fg-muted">{t("proposalNothingYet")}</p>
          <div className="mt-2 flex gap-2">
            <button
              className="btn-primary h-9 min-h-0 px-3 text-xs"
              disabled={busy || !runId}
              onClick={() => void decide("confirm")}
            >
              {t("approve")}
            </button>
            <button
              className="btn-secondary h-9 min-h-0 px-3 text-xs"
              disabled={busy || !runId}
              onClick={() => void decide("reject")}
            >
              {t("reject")}
            </button>
          </div>
        </>
      ) : (
        /*
         * `stale` is NOT an error and gets no retry: minutes pass between
         * propose and confirm, core/ re-validates and re-checks ownership,
         * and the segment may be gone or the call may have changed hands.
         * "No longer applicable" is a true outcome; offering a retry against
         * it would be inviting the user to push on a locked door.
         */
        <p
          className={`mt-3 text-xs ${
            outcome === "failed" ? "text-danger" : "text-fg-muted"
          }`}
        >
          {t(`proposal_${outcome}`)}
        </p>
      )}
    </div>
  );
}

/**
 * `before`/`after` are a matched pair whose keys vary by kind — `{text}`,
 * `{label}`, or `{version, body}`. Read the known display keys and return
 * null for anything else: an unknown kind still renders its summary and
 * buttons, it just shows no diff. **These are display values and may be
 * excerpted** — never send them back as the thing to write.
 */
function displayValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of ["text", "label", "body"]) {
    const candidate = record[key];
    if (typeof candidate === "string") return candidate;
  }
  return null;
}
