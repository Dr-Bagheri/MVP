"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { AgentMessage } from "@/api/types";

/**
 * A persisted assistant conversation, rendered.
 *
 * **Frame-agnostic on purpose.** Whether the hub shows this as a state of the
 * approved layout or beside a permanent session sidebar is with the steward;
 * either way it is the same thread, so this component takes messages and
 * renders them and knows nothing about where it sits.
 *
 * ---
 *
 * **The rule that shapes this file: a failed run leaves the question standing,
 * and nothing is invented to keep it company.**
 *
 * When a run fails there is no assistant answer, and the honest record is
 * exactly that — a question that was asked and not answered. So no synthetic
 * "something went wrong" bubble is inserted into the thread. That bubble would
 * be a message the assistant never produced, sitting in the permanent record of
 * a conversation, indistinguishable a week later from something it did say.
 *
 * The failure is still *shown* — silence with no explanation is its own lie —
 * but as an annotation on the user's message rather than as a turn: no bubble,
 * muted, visually not-a-message. The distinction is the whole point. The thread
 * is a record; the annotation is our commentary on it.
 *
 * ---
 *
 * `tool_calls` arrive as codes (`{id, name}`) and render as chips. The full
 * trace deliberately lives only on the audit surface — a conversation is not an
 * execution log, and a member reading their own thread should not be reading
 * someone's stack.
 */
export function ConversationThread({
  messages,
  streaming,
  feedback,
  onFeedback,
  onRegenerate,
}: {
  messages: AgentMessage[];
  /** True while the last message is still being written. */
  streaming?: boolean;
  /** The caller's verdicts, messageId → "up"|"down". Absent = no toolbar judging. */
  feedback?: Record<string, string>;
  /**
   * Absent on the SHARED read-only view — a colleague reading a shared
   * thread must not be offered controls that would 404 against rows that
   * are not theirs (M27: feedback is the owner's).
   */
  onFeedback?: (messageId: string, verdict: "up" | "down") => void;
  /** Offered only on the LAST assistant turn; absent hides the control. */
  onRegenerate?: () => void;
}) {
  const t = useTranslations("platform");
  const lastAssistantId = [...messages].reverse().find((m) => m.role === "assistant")?.id;

  return (
    <div className="flex flex-col gap-4">
      {messages.map((m, i) => {
        const isUser = m.role === "user";
        /*
         * A user message is "unanswered" when the run is over and nothing
         * followed it. `streaming` guards the live case: mid-stream there is
         * legitimately no answer yet, and marking it failed would turn every
         * question into an error for a second and a half.
         */
        const unanswered =
          isUser && !streaming && messages[i + 1] === undefined;

        return (
          <div key={m.id} className={isUser ? "flex justify-end" : "flex justify-start"}>
            <div className={isUser ? "max-w-[85%]" : "w-full"}>
              <div
                className={
                  isUser
                    ? "rounded-2xl rounded-ee-sm bg-accent-soft px-3.5 py-2.5 text-sm leading-7 text-fg"
                    : "rounded-2xl rounded-es-sm border border-border bg-surface px-3.5 py-2.5 text-sm leading-7 text-fg"
                }
              >
                {m.content}
                {m.streaming ? <span className="ms-1 animate-pulse text-fg-muted">▍</span> : null}
              </div>

              {m.tool_calls.length > 0 ? (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {m.tool_calls.map((c) => (
                    <span key={c.id} className="chip bg-surface-2 text-[11px] text-fg-muted">
                      {c.label || c.name}
                    </span>
                  ))}
                </div>
              ) : null}

              {/*
                NOT a message. No bubble, no avatar, no role — an annotation on
                the record, so it can never be mistaken later for something the
                assistant said.
              */}
              {(unanswered || m.failed) ? (
                <p className="mt-1.5 text-xs leading-6 text-warning">{t("runUnfinished")}</p>
              ) : null}

              {/*
                **Shape B: an answer that started and stopped.**

                Shape A (a run that failed saying nothing) is the annotation
                above — the question stands unanswered. Shape B is worse and
                looks better: the run produced text, failed partway, and the
                partial answer was persisted. After a reload it renders
                identically to a complete answer the model chose to give — «سه
                موضوع مطرح شد: نخست» read and acted on as if it were the whole
                thing. Fabricated completeness, arrived at by honest
                persistence, in a product whose value is not having to
                re-listen.

                So the marker annotates an assistant turn that REALLY HAPPENED,
                which is why Shape A's no-synthetic-turn reasoning does not
                reach it: annotating how a real turn ended is not inventing one.
                Same annotation treatment — no bubble, no role.
              */}
              {/*
                `=== true`, never truthiness: absent or unreadable must render
                NOTHING. Folding "we don't know" into "not truncated" is a lie
                of omission; annotating a COMPLETE answer as cut off tells the
                reader to distrust something intact, which is the worse of the
                two — and the one a truthiness check produces.
              */}
              {!isUser && m.truncated === true ? (
                <p className="mt-1.5 text-xs leading-6 text-warning">{t("answerTruncated")}</p>
              ) : null}

              {/*
                The toolbar (M27, the Onyx control set on our wire). Only on
                SETTLED assistant turns: a streaming reply has a local id the
                server has never heard of, and judging it would send that id
                to a route that rightly 404s. `m.streaming` guards it.
              */}
              {!isUser && !m.streaming && m.content ? (
                <MessageToolbar
                  message={m}
                  verdict={feedback?.[m.id]}
                  onFeedback={onFeedback}
                  onRegenerate={
                    onRegenerate && m.id === lastAssistantId && !streaming
                      ? onRegenerate
                      : undefined
                  }
                />
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Copy / judge / regenerate, one row under an answer. Copy is always
 * offered (it needs nothing from the server); the other two appear only
 * when their handlers do — the shared read-only view passes none.
 */
function MessageToolbar({
  message,
  verdict,
  onFeedback,
  onRegenerate,
}: {
  message: AgentMessage;
  verdict?: string | undefined;
  onFeedback?: ((messageId: string, verdict: "up" | "down") => void) | undefined;
  onRegenerate?: (() => void) | undefined;
}) {
  const t = useTranslations("platform");
  const [copied, setCopied] = useState(false);

  const btn = "grid h-7 w-7 place-items-center rounded-md text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg";
  const pressed = "grid h-7 w-7 place-items-center rounded-md bg-accent-soft text-accent";

  return (
    <div className="mt-1 flex items-center gap-0.5">
      <button
        type="button"
        className={btn}
        aria-label={t("copyAnswer")}
        onClick={() => {
          void navigator.clipboard.writeText(message.content).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 6L9 17l-5-5" /></svg>
        ) : (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>
        )}
      </button>
      {onFeedback ? (
        <>
          <button
            type="button"
            className={verdict === "up" ? pressed : btn}
            aria-label={t("goodAnswer")}
            aria-pressed={verdict === "up"}
            onClick={() => onFeedback(message.id, "up")}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M7 10v12M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" /></svg>
          </button>
          <button
            type="button"
            className={verdict === "down" ? pressed : btn}
            aria-label={t("badAnswer")}
            aria-pressed={verdict === "down"}
            onClick={() => onFeedback(message.id, "down")}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ transform: "rotate(180deg)" }}><path d="M7 10v12M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" /></svg>
          </button>
        </>
      ) : null}
      {onRegenerate ? (
        <button type="button" className={btn} aria-label={t("regenerate")} onClick={onRegenerate}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 12a9 9 0 1 1 2.64 6.36M3 22v-6h6" /></svg>
        </button>
      ) : null}
    </div>
  );
}
