"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AgentAvatar, AgentName, ECHO } from "./AgentAvatar";
import { api } from "@/api/client";
import type { AgentMessage } from "@/api/types";
import { deliverDoc, deliverPdf } from "@/lib/deliver";
import { parseAnswerBlocks, type AnswerBlock } from "@/lib/answerBlocks";

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
  /* `findLast` rather than copying the array and reversing it: the old form
     allocated a whole new array on every render — and during a stream this
     component renders on every token. */
  const lastAssistantId = messages.findLast((m) => m.role === "assistant")?.id;

  /*
   * **Stable handler identities, so the rows below can actually skip.**
   *
   * The hub passes inline arrows (`onFeedback={(id, v) => void judge(id, v)}`),
   * which are a new function on every render — under a shallow `memo` that
   * alone would defeat every bail-out and the extraction would be ceremony.
   * These wrappers keep one identity for the life of the component and
   * dispatch through a ref that is refreshed on every render, so a row always
   * calls the CURRENT closure and never a stale one. Presence still travels:
   * a caller that passes no `onFeedback` gets `undefined`, because absent
   * means "this view offers no controls", not "the control does nothing".
   */
  const handlers = useRef({ onFeedback, onRegenerate });
  handlers.current = { onFeedback, onRegenerate };
  const stableFeedback = useCallback(
    (messageId: string, verdict: "up" | "down") =>
      handlers.current.onFeedback?.(messageId, verdict),
    [],
  );
  const stableRegenerate = useCallback(() => handlers.current.onRegenerate?.(), []);

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
          <MessageRow
            key={m.id}
            message={m}
            unanswered={unanswered}
            verdict={feedback?.[m.id]}
            onFeedback={onFeedback ? stableFeedback : undefined}
            onRegenerate={
              onRegenerate && m.id === lastAssistantId && !streaming
                ? stableRegenerate
                : undefined
            }
          />
        );
      })}
    </div>
  );
}

/**
 * ONE message, memoised.
 *
 * **Why this is its own component.** `AnswerContent` runs `parseAnswerBlocks`
 * — a global regex sweep plus a `JSON.parse` per block — and it ran inside the
 * thread's render body, for every message, on every render. A stream produces
 * ten to thirty deltas a second and each one replaces the messages array, so
 * the cost of typing one answer scaled with the length of the whole
 * conversation: a forty-turn thread re-parsed forty answers, thirty times a
 * second, to add one character to the last one.
 *
 * The bail-out works because of how the hub updates: `prev.map(m => m.id ===
 * replyId ? {...m, content: m.content + delta} : m)` gives a NEW object only
 * to the message that changed and hands every other message back by
 * reference. So a default shallow comparison is exactly right here — no
 * custom comparator, nothing to keep in sync with the props, and no way for
 * this to render something stale that the shallow check could not see.
 *
 * Deliberately the only memo added: it is the one path measured hot, and a
 * memo on a cheap component is a comparison that costs more than the render
 * it skips.
 */
const MessageRow = memo(function MessageRow({
  message: m,
  unanswered,
  verdict,
  onFeedback,
  onRegenerate,
}: {
  message: AgentMessage;
  unanswered: boolean;
  verdict?: string | undefined;
  onFeedback?: ((messageId: string, verdict: "up" | "down") => void) | undefined;
  onRegenerate?: (() => void) | undefined;
}) {
  const t = useTranslations("platform");
  const locale = useLocale();
  const isUser = m.role === "user";

  /*
   * THE QUESTION SITS ON THE PHYSICAL RIGHT, IN BOTH LOCALES (user directive,
   * 2026-09-04: "change the side that land the users conversation to the right
   * and fix it for both fa and en version").
   *
   * `justify-end` is LOGICAL, so it followed the page: right in English, left
   * in Persian. This is the same call the composer's control row made a day
   * earlier — a side that swaps with the interface language is a side you have
   * to re-learn on every switch, and the chat convention people arrive with
   * puts their own words on the right.
   *
   * Done by choosing the logical value per locale rather than by forcing
   * `dir="ltr"` on the row: the row contains PROSE, and an LTR row would drag
   * Persian punctuation to the wrong end of the sentence to win an argument
   * about alignment. Physical placement, untouched text.
   */
  const mine = locale === "fa" ? "justify-start" : "justify-end";

  return (
          <div
            className={`message-arrives flex ${isUser ? mine : locale === "fa" ? "justify-end" : "justify-start"}`}
          >
            <div className={isUser ? "max-w-[85%]" : "w-full"}>
              {/*
                WHOSE TURN THIS IS (db/0169; every answer, 2026-09-04).
                
                This used to draw a mark only for a COLLEAGUE, leaving Echo's
                turns bare on the reasoning that the assistant is the surface
                rather than a participant in it. With Roya and Ava answering in
                the same thread that inverted: the unmarked turns became the
                ones a reader had to work out, and "no face" is a worse way of
                saying "Echo" than Echo's own face. The size is the assistant
                page's, one step up from the sidebar's — the user asked for it
                bigger in the chat box, and this is the chat box.
              */}
              {!isUser ? (
                <div className="mb-1.5 flex items-center gap-2">
                  <AgentAvatar handle={m.author ?? ECHO} size="lg" />
                  <span className="text-sm font-semibold text-fg">
                    <AgentName handle={m.author ?? ECHO} />
                  </span>
                </div>
              ) : null}
              {/*
                THE ANSWER HAS NO BOX (user directive, 2026-08-27: "lose the
                text box in the ai assistant, just the text").
                
                A question is a thing someone said, so it keeps its bubble on
                the end side. An answer is the page talking back — boxing it
                makes the assistant a participant in a chat window instead of
                the surface itself, and at full width a border around every
                reply is a rectangle the eye has to cross to reach the words.
              */}
              <div
                className={
                  isUser
                    /* the clipped corner points at the speaker, so it is
                       physical too — `rounded-ee` would sit on the far side
                       of the bubble the moment the locale flipped */
                    ? `rounded-2xl bg-accent-soft px-3.5 py-2.5 text-sm leading-7 text-fg ${
                        locale === "fa" ? "rounded-bl-sm" : "rounded-br-sm"
                      }`
                    : "text-sm leading-7 text-fg"
                }
              >
                {isUser ? m.content : <AnswerContent text={m.content} />}
                {/*
                  Two different waits, said differently. Nothing written yet =
                  THINKING, and a spinner is the honest picture. Mid-sentence =
                  still typing, and the caret belongs there. A blinking cursor
                  in front of an empty answer claims words are arriving when
                  none have.
                */}
                {m.streaming && m.content === "" ? (
                  <span className="inline-flex items-center gap-2 text-fg-muted">
                    <ThinkingMark />
                    <span className="text-xs">{t("thinking")}</span>
                  </span>
                ) : null}
                {m.streaming && m.content !== "" ? (
                  <span className="ms-1 animate-pulse text-fg-muted">▍</span>
                ) : null}
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
              {/* The raw server failure sentence was BRIEFLY shown here and
                  removed by user directive (2026-08-20, "remove the log"):
                  a provider's JSON error under a chat message reads as debug
                  output, not as product. The reason still reaches the
                  operator through the audit surface and the server log —
                  the thread keeps only the human sentence. */}
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
                  verdict={verdict}
                  onFeedback={onFeedback}
                  onRegenerate={onRegenerate}
                />
              ) : null}
            </div>
          </div>
  );
});

/**
 * Copy / judge / regenerate, one row under an answer. Copy is always
 * offered (it needs nothing from the server); the other two appear only
 * when their handlers do — the shared read-only view passes none.
 */
/**
 * Phase C — show-the-reasoning: one run's trace, fetched when opened,
 * rendered as CODES (tool, outcome, duration). Arguments never travel
 * (M27's ruling, applied to the self-trace); the full trace stays on the
 * narrower admin audit surface. "How did you get this?" answered in place.
 */
function TraceBlock({ runId }: { runId: string }) {
  const t = useTranslations("platform");
  const [trace, setTrace] = useState<import("@/api/types").RunTrace | null | "failed">(null);

  useEffect(() => {
    let live = true;
    void api.runTrace(runId)
      .then((result) => { if (live) setTrace(result); })
      .catch(() => { if (live) setTrace("failed"); });
    return () => { live = false; };
  }, [runId]);

  if (trace === null) return <p className="mt-1 text-xs text-fg-subtle">{t("traceLoading")}</p>;
  if (trace === "failed") return <p className="mt-1 text-xs text-fg-subtle">{t("traceUnavailable")}</p>;
  return (
    <div className="mt-1 rounded-lg border border-border bg-surface-2/50 px-3 py-2 text-xs leading-6 text-fg-muted">
      <p>
        <span className="ltr font-mono">{trace.model}</span>
        {" · "}
        {trace.status}
        {trace.tokens_out != null ? <> · {trace.tokens_out}t</> : null}
      </p>
      {trace.steps.length === 0 ? (
        <p>{t("traceNoTools")}</p>
      ) : (
        <ol className="mt-1 space-y-0.5">
          {trace.steps.map((step, i) => (
            <li key={i}>
              <span className="ltr font-mono">{step.tool}</span>
              {" — "}{step.outcome}
              {step.ms != null ? <span className="ltr"> ({step.ms}ms)</span> : null}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

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
  const [traceOpen, setTraceOpen] = useState(false);

  const btn = "grid h-7 w-7 place-items-center rounded-md text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg";
  const pressed = "grid h-7 w-7 place-items-center rounded-md bg-accent-soft text-accent";

  return (
    <>
    <div className="mt-1 flex items-center gap-0.5">
      {message.created === "pdf" ? (
        <button
          type="button"
          className="btn btn-sm me-1 bg-accent-soft font-semibold text-accent"
          onClick={() => deliverPdf(message.content, t("createPdf"))}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" /></svg>
          {t("savePdf")}
        </button>
      ) : null}
      {message.created === "doc" ? (
        <button
          type="button"
          className="btn btn-sm me-1 bg-accent-soft font-semibold text-accent"
          onClick={() => deliverDoc(message.content, t("createDoc"))}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" /></svg>
          {t("saveDoc")}
        </button>
      ) : null}
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
      <SpeakButton text={message.content} />
      {message.run_id ? (
        <button
          type="button"
          className={traceOpen ? pressed : btn}
          aria-label={t("traceLabel")}
          title={t("traceLabel")}
          aria-expanded={traceOpen}
          onClick={() => setTraceOpen((v) => !v)}
        >
          {/* the "how" glyph — a route between points */}
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="6" cy="19" r="3" /><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" /><circle cx="18" cy="5" r="3" /></svg>
        </button>
      ) : null}
    </div>
    {traceOpen && message.run_id ? <TraceBlock runId={message.run_id} /> : null}
    </>
  );
}

/**
 * Phase D — generative blocks: an assistant answer renders its structured
 * islands (table / checklist / timeline) as real components; everything the
 * parser degrades stays the model's literal words. Whitespace is preserved
 * on text runs — prose is the default, blocks are the exception.
 */
function AnswerContent({ text }: { text: string }) {
  const segments = parseAnswerBlocks(text);
  return (
    <>
      {segments.map((segment, i) =>
        segment.type === "text" ? (
          <span key={i} className="whitespace-pre-wrap">{segment.text}</span>
        ) : (
          <BlockView key={i} block={segment.block} />
        ),
      )}
    </>
  );
}

function BlockView({ block }: { block: AnswerBlock }) {
  if (block.kind === "table") {
    return (
      <div className="my-2 overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-max text-xs">
          <thead>
            <tr className="border-b border-border bg-surface-2/60">
              {block.columns.map((column, i) => (
                <th key={i} className="px-3 py-1.5 text-start font-semibold text-fg">{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, r) => (
              <tr key={r} className="border-b border-border last:border-b-0">
                {row.map((cell, c) => (
                  <td key={c} className="px-3 py-1.5 text-fg-muted">{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (block.kind === "checklist") {
    return (
      <ul className="my-2 space-y-1">
        {block.items.map((item, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            <span aria-hidden className={item.done ? "text-success" : "text-fg-subtle"}>
              {item.done ? "☑" : "☐"}
            </span>
            <span className={item.done ? "text-fg-muted line-through" : "text-fg"}>{item.text}</span>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ol className="my-2 space-y-1 border-s-2 border-accent/30 ps-3">
      {block.items.map((item, i) => (
        <li key={i} className="text-sm">
          {item.when ? <span className="me-2 text-xs font-semibold text-accent">{item.when}</span> : null}
          <span className="text-fg">{item.what}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Phase D — speech OUT (item 18, first half): the browser's own synthesis
 * reads the answer aloud. Honest limits: voice quality and Persian support
 * depend on the OS's installed voices — this is the zero-dependency floor,
 * and a vendor TTS lane can replace the engine without touching the button.
 * Block fences are stripped before speaking; a table read cell-by-cell as
 * JSON is noise, and the prose around it is the sentence that matters.
 */
function SpeakButton({ text }: { text: string }) {
  const t = useTranslations("platform");
  const [speaking, setSpeaking] = useState(false);

  function toggle() {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    const prose = text.replace(/```neurai-block[\s\S]*?```/g, " ").trim();
    if (!prose) return;
    const utterance = new SpeechSynthesisUtterance(prose);
    utterance.lang = /[؀-ۿ]/.test(prose) ? "fa-IR" : "en-US";
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    setSpeaking(true);
  }

  const btn = "grid h-7 w-7 place-items-center rounded-md text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg";
  const pressed = "grid h-7 w-7 place-items-center rounded-md bg-accent-soft text-accent";
  return (
    <button
      type="button"
      className={speaking ? pressed : btn}
      aria-label={t("speak")}
      title={t("speak")}
      aria-pressed={speaking}
      onClick={toggle}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /></svg>
    </button>
  );
}

/** The wait's mark: a ring with a gap, turning. */
function ThinkingMark() {
  return (
    <svg viewBox="0 0 20 20" className="thinking-spin h-4 w-4" aria-hidden>
      <circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path
        d="M10 2.5a7.5 7.5 0 0 1 7.5 7.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
