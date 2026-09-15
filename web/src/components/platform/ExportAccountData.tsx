"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/api/client";
import { notifyError } from "@/lib/notify";

/**
 * Export account data (user directive, 2026-08-22, after the sana.ai
 * reference) — a REAL export, not a request queue: the browser gathers what
 * the person can already read through their own session (profile, records
 * list, and per-record transcript + summaries + notes) and hands it over as
 * one JSON file. Nothing here widens access — every byte comes through the
 * same RLS-walled endpoints the screens use.
 *
 * Failures per record are RECORDED in the file (`errors`), never silently
 * skipped: an export with an invisible hole is worse than one that names
 * it. Audio is not included — records list their ids; the audio itself is
 * reachable per record and would make the file gigabytes.
 */
export function ExportAccountData() {
  const t = useTranslations("profile");
  /* THE "failed" ARM IS GONE (2026-09-08). It existed only to draw a red
     line under the button; the failure is a toast now, and the button's own
     state after one is `idle` — which is the truth, because pressing it
     again is exactly what to do. */
  const [state, setState] = useState<
    { kind: "idle" } | { kind: "working"; done: number; total: number }
  >({ kind: "idle" });

  async function exportAll(): Promise<void> {
    if (state.kind === "working") return;
    try {
      const me = await api.me();
      const calls = await api.listCalls({ includeArchived: true });
      setState({ kind: "working", done: 0, total: calls.length });
      const records: unknown[] = [];
      const errors: { call_id: string; step: string }[] = [];
      let done = 0;
      for (const call of calls) {
        const record: Record<string, unknown> = { ...call };
        try {
          record.transcript = await api.getTranscript(call.id);
        } catch { errors.push({ call_id: call.id, step: "transcript" }); }
        try {
          record.summaries = await api.getSummaries(call.id);
        } catch { errors.push({ call_id: call.id, step: "summaries" }); }
        try {
          record.notes = await api.callNotes(call.id);
        } catch { errors.push({ call_id: call.id, step: "notes" }); }
        records.push(record);
        done += 1;
        setState({ kind: "working", done, total: calls.length });
      }
      const bundle = {
        exported_at: new Date().toISOString(),
        profile: me,
        records,
        // present even when empty: "no errors" must be a statement, not a
        // missing key indistinguishable from "nobody checked"
        errors,
      };
      const blob = new Blob([JSON.stringify(bundle, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `neurai-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setState({ kind: "idle" });
    } catch {
      setState({ kind: "idle" });
      notifyError(t("exportFailed"));
    }
  }

  return (
    <div>
      <button
        type="button"
        className="btn-secondary"
        disabled={state.kind === "working"}
        onClick={() => void exportAll()}
      >
        {state.kind === "working"
          ? t("exportWorking", { done: state.done, total: state.total })
          : t("exportAction")}
      </button>
    </div>
  );
}
