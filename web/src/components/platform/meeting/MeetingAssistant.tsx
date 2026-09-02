"use client";

import { useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import { IconAgent, IconCopy, IconRetry, IconSend } from "@/components/icons";

/**
 * دستیار این جلسه — the reference's meeting-scoped chat, on our own
 * assistant: a greeting, four suggested questions, and a composer whose
 * answers come from THIS meeting's record.
 *
 * The scoping is the `callIds` the ask carries — the same attachment the
 * hub uses for a chip — so the agent's own tools search this record first.
 * Nothing here is a second assistant: it is the platform's, pointed.
 */
interface Turn { role: "user" | "assistant"; text: string }

export function MeetingAssistant({ callId, title }: { callId: string; title: string }) {
  const t = useTranslations("meetings");
  const locale = useLocale();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const sessionId = useRef<string | undefined>(undefined);

  const suggestions = [
    t("askWhatWas"), t("askDecisions"), t("askTasks"), t("askRisks"),
  ];

  const send = (question: string) => {
    if (question.trim() === "" || busy) return;
    setBusy(true);
    setFailed(false);
    setDraft("");
    setTurns((prev) => [...prev, { role: "user", text: question }, { role: "assistant", text: "" }]);
    void (async () => {
      try {
        for await (const event of api.ask(
          question,
          { page: "meeting", callIds: [callId] },
          sessionId.current,
          { locale, surface: { route: "/meetings", entity: { kind: "call", id: callId } } },
        )) {
          if (event.type === "session") sessionId.current = event.id;
          if (event.type === "text_delta") {
            setTurns((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last !== undefined && last.role === "assistant") {
                next[next.length - 1] = { role: "assistant", text: last.text + event.delta };
              }
              return next;
            });
          }
        }
      } catch {
        setFailed(true);
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">
      {/* ── the header, theirs ───────────────────────────────────────── */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent-soft text-accent" aria-hidden>
            <IconAgent width={16} height={16} />
          </span>
          <span>
            <span className="block text-sm font-semibold text-fg">{t("assistantTitle")}</span>
            <span className="block text-[11px] text-fg-muted">{t("assistantScope")}</span>
          </span>
        </div>
        {turns.length > 0 ? (
          <button
            type="button"
            onClick={() => { setTurns([]); sessionId.current = undefined; }}
            className="btn btn-sm border border-border font-medium text-fg hover:bg-border"
          >
            <IconRetry width={12} height={12} />
            {t("assistantNewChat")}
          </button>
        ) : null}
      </div>

      <div className="scroll-quiet min-h-0 flex-1 space-y-3 overflow-y-auto">
        {/* the greeting is always first, exactly as theirs opens */}
        <div className="flex items-start gap-2.5">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent" aria-hidden>
            <IconAgent width={12} height={12} />
          </span>
          <p className="rounded-2xl bg-surface-2/70 px-3.5 py-2.5 text-sm leading-7 text-fg">
            {t("assistantGreeting", { title })}
          </p>
        </div>

        {turns.map((turn, i) => (
          <div key={i} className={turn.role === "user" ? "flex justify-end" : "flex items-start gap-2.5"}>
            {turn.role === "assistant" ? (
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent" aria-hidden>
                <IconAgent width={12} height={12} />
              </span>
            ) : null}
            <div className={turn.role === "user"
              ? "max-w-[80%] rounded-2xl bg-accent px-3.5 py-2 text-sm leading-7 text-on-accent"
              : "min-w-0 flex-1"}>
              {turn.text === "" && turn.role === "assistant" ? (
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-border border-t-accent" aria-hidden />
              ) : (
                <p className="whitespace-pre-wrap text-sm leading-7 text-fg">{turn.text}</p>
              )}
              {turn.role === "assistant" && turn.text !== "" ? (
                <button
                  type="button"
                  onClick={() => void navigator.clipboard?.writeText(turn.text).catch(() => undefined)}
                  className="btn btn-sm mt-1 text-[11px] text-fg-subtle hover:text-fg"
                >
                  <IconCopy width={12} height={12} />
                  {t("copy")}
                </button>
              ) : null}
            </div>
          </div>
        ))}

        {failed ? <p role="alert" className="text-xs text-danger">{t("assistantFailed")}</p> : null}

        {turns.length === 0 ? (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {suggestions.map((question) => (
              <button
                key={question}
                type="button"
                onClick={() => send(question)}
                className="tap h-9 rounded-xl border border-border bg-surface px-3 text-xs text-fg hover:border-border-strong"
              >
                {question}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* ── the composer ─────────────────────────────────────────────── */}
      <div className="mt-3 flex items-center gap-2 rounded-2xl border border-border bg-surface p-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") send(draft); }}
          placeholder={t("assistantPlaceholder")}
          className="min-w-0 flex-1 bg-transparent px-2 text-sm text-fg outline-none placeholder:text-fg-subtle"
        />
        <button
          type="button"
          aria-label={t("assistantSend")}
          disabled={draft.trim() === "" || busy}
          onClick={() => send(draft)}
          className="tap grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent text-on-accent disabled:opacity-50"
        >
          <IconSend width={14} height={14} />
        </button>
      </div>
    </div>
  );
}
