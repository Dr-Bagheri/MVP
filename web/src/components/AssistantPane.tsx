"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { AgentMessage, Call, ModelInfo, Skill } from "@/api/types";
import { modelLabel } from "@/lib/format";
import { useSkillName } from "@/lib/skillName";
import { ASSISTANT_PANEL, ResizablePanel } from "@/components/scaffold/Resizable";
import { ProposalCard } from "./ProposalCard";
import { SendIcon } from "./platform/icons";

/**
 * The dockable assistant (SPEC): on every screen, knows the page it's on,
 * takes call mentions as context, streams answers with visible tool calls,
 * and asks before applying an inferred write.
 */
export function AssistantPane({
  page,
  presetCallId,
  presetSessionId,
  open,
  onClose,
}: {
  page: string;
  presetCallId?: string;
  /** Open an EXISTING conversation in the pane (the Conversations surface):
   *  the stored thread loads, and every ask continues it. */
  presetSessionId?: string;
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("assistant");
  const skillName = useSkillName();
  /**
   * The composer's direction follows the LOCALE, stated explicitly rather
   * than inherited.
   *
   * Inheritance works right up until any ancestor sets `direction` — and this
   * codebase has a `.ltr` utility applied to Latin fragments (timestamps,
   * model ids) precisely because they sit inside Persian text. A wrapper
   * gaining that class would flip the composer's caret and placeholder to LTR
   * in Persian, and nothing about the markup would look wrong.
   *
   * Not `dir="auto"`: that follows the first strong character of what has
   * been TYPED, so an empty box would sit LTR until the first Persian letter
   * and then jump. The directive is that entry follows the locale, and a
   * caret that moves after the first keystroke is its own bug.
   */
  const locale = useLocale();
  const composerDir = locale === "fa" ? "rtl" : "ltr";
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelId, setModelId] = useState<string>("");
  const [calls, setCalls] = useState<Call[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [skill, setSkill] = useState<string>("");
  const [skillMenuOpen, setSkillMenuOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [modelFilter, setModelFilter] = useState("");
  const [contextIds, setContextIds] = useState<string[]>(
    presetCallId ? [presetCallId] : [],
  );
  const [showMention, setShowMention] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  /**
   * The conversation this pane is IN. A ref, not state: it is read inside
   * the stream loop. Without it the pane asked with no session id every
   * time — a NEW conversation per message, while the thread on screen
   * looked continuous (the exact failure the hub's session-capture comment
   * warns about, alive in the pane the whole time).
   */
  const sessionRef = useRef<string | undefined>(presetSessionId);

  useEffect(() => {
    // the Conversations surface hands us a stored thread to continue
    if (!presetSessionId) return;
    sessionRef.current = presetSessionId;
    void api.agentMessages(presetSessionId).then(setMessages).catch(() => undefined);
  }, [presetSessionId]);

  useEffect(() => {
    void api.models().then((res) => {
      // core/ has already applied the org allow-list; nothing filters on tool
      // support, so this must not pretend to either
      setModels(res.models);
      /*
       * The state adopts what the <select> RENDERS. The earlier `?? ""`
       * defended the null's has-not-chosen information — and produced the
       * silent-substitution select: state "" matched no option, the box
       * displayed its first model anyway, and every ask 400d with "no model
       * selected" against a picker that looked chosen (live failure,
       * 2026-08-16). A state the screen contradicts carries no information
       * at all. M5 stands: these are the org's curated options; the state
       * just tells the truth about which one is showing.
       */
      setModelId(res.preferred_model ?? res.models[0]?.id ?? "");
    });
    void api.listCalls().then(setCalls);
    // skills in the docked pane too (user directive) — same resolver view
    // the hub offers, slugs on the wire
    void api.skills().then(setSkills).catch(() => setSkills([]));
  }, []);

  useEffect(() => {
    if (presetCallId) setContextIds((ids) => (ids.includes(presetCallId) ? ids : [...ids, presetCallId]));
  }, [presetCallId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function send() {
    const question = input.trim();
    if (!question || busy) return;
    setInput("");
    setBusy(true);
    const userMessage: AgentMessage = {
      id: `m-${Date.now()}`,
      role: "user",
      content: question,
      tool_calls: [],
      proposal: null,
    };
    const draft: AgentMessage = {
      id: `m-${Date.now()}-a`,
      role: "assistant",
      content: "",
      tool_calls: [],
      proposal: null,
      streaming: true,
    };
    setMessages((prev) => [...prev, userMessage, draft]);

    // Reduce core/'s SSE vocabulary into message state. `done` must arrive —
    // a stream that ends without it is a TRANSPORT failure, never success.
    let sawDone = false;
    try {
      /*
       * `model` TRAVELS. The pane rendered a model picker and then asked
       * with no model at all — the server refused pre-stream and the catch
       * dressed the 400 as "connection dropped" (user report, three empty
       * bubbles). The hub passed it from day one; the pane never did.
       */
      for await (const event of api.ask(
        question,
        { page, callIds: contextIds },
        sessionRef.current,
        { model: modelId || undefined, skill: skill || undefined },
      )) {
        if (event.type === "session") sessionRef.current = event.id;
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== draft.id) return m;
            switch (event.type) {
              case "session":
                /*
                 * Arrives FIRST, and on a `created: true` turn it is the only
                 * place the new conversation id will ever appear. Ignoring it
                 * loses the handle to something the server is now persisting —
                 * silently, because the answer still renders perfectly.
                 * Adopted into sessionRef above so the NEXT ask continues
                 * this conversation instead of opening one per message.
                 */
                return { ...m, session_id: event.id };
              case "text_delta":
                return { ...m, content: m.content + event.delta };
              case "tool_call": {
                const existing = m.tool_calls.findIndex((c) => c.id === event.id);
                const call = {
                  id: event.id,
                  name: event.name,
                  label: event.label,
                  state: event.state,
                  ms: event.ms,
                };
                const tool_calls =
                  existing >= 0
                    ? m.tool_calls.map((c, i) => (i === existing ? call : c))
                    : [...m.tool_calls, call];
                return { ...m, tool_calls };
              }
              case "proposal":
                return {
                  ...m,
                  proposal: {
                    id: event.id,
                    kind: event.kind,
                    summary: event.summary,
                    payload: event.payload,
                  },
                };
              case "done":
                return {
                  ...m,
                  streaming: false,
                  // keep the runId: confirming a proposal REQUIRES it, and the
                  // proposal arrived mid-stream, before this id existed
                  run_id: event.runId,
                  failed: event.failed,
                  error: event.error,
                };
            }
          }),
        );
        if (event.type === "done") sawDone = true;
      }
    } catch {
      sawDone = false;
    }

    if (!sawDone) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === draft.id
            ? { ...m, streaming: false, failed: true, error: t("streamLost") }
            : m,
        ),
      );
    }
    setBusy(false);
  }

  if (!open) return null;

  return (
    /*
     * Below md the pane is an OVERLAY DRAWER, not a flex sibling.
     *
     * As a static sibling it took the full 375px of a phone viewport and
     * squeezed <main> to 40px — a sliver of unreadable content on every
     * screen. It was silent because nothing overflowed the page: the layout
     * "worked", it just had no room left for the app. A 40px main is the kind
     * of breakage that a horizontal-scroll check can't see.
     *
     * `fixed inset-0 z-40` lifts it out of the row so main keeps the full
     * width underneath; from md up it returns to being a docked column —
     * RESIZABLE since 2026-08-18 (user directive): 15% default, 40% max,
     * dragged at its inner edge. The wrapper owns the width; below md it has
     * no size and the fixed overlay inside ignores it entirely.
     */
    <ResizablePanel side="end" spec={ASSISTANT_PANEL} label={t("resize")}>
      <aside className="fixed inset-0 z-40 flex h-full w-full flex-col border-border bg-surface md:static md:z-auto md:h-full md:w-full md:border-s">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-fg">{t("title")}</span>
        </div>
        <button className="btn-ghost h-9 min-h-0 px-2 text-xs" onClick={onClose}>
          {t("close")}
        </button>
      </header>

      {/* context: page + mentioned calls */}
      <div className="border-b border-border px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-fg-muted">{t("contextPage", { page })}</span>
          {contextIds.map((id) => {
            const call = calls.find((c) => c.id === id);
            return (
              <span key={id} className="chip bg-accent-soft text-accent">
                @{call?.title.slice(0, 18) ?? id}
                <button
                  className="ms-1 text-accent/70 hover:text-accent"
                  onClick={() => setContextIds((ids) => ids.filter((x) => x !== id))}
                  aria-label={t("close")}
                >
                  ×
                </button>
              </span>
            );
          })}
          <button
            className="chip bg-surface-2 text-fg-muted hover:text-fg"
            onClick={() => setShowMention((v) => !v)}
          >
            + {t("mention")}
          </button>
        </div>
        {showMention ? (
          <div className="mt-2 max-h-40 overflow-y-auto rounded-md border border-border">
            {calls.map((call) => (
              <button
                key={call.id}
                className="block w-full px-3 py-2 text-start text-sm hover:bg-surface-2"
                onClick={() => {
                  setContextIds((ids) => (ids.includes(call.id) ? ids : [...ids, call.id]));
                  setShowMention(false);
                }}
              >
                {call.title}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <p className="pt-8 text-center text-sm text-fg-muted">{t("emptyState")}</p>
        ) : null}
        {messages.map((message) => (
          <div key={message.id}>
            <div
              className={
                message.role === "user"
                  ? "ms-auto w-fit max-w-[85%] rounded-lg bg-accent-soft px-3 py-2 text-sm text-fg"
                  : "rounded-lg bg-surface-2 px-3 py-2.5 text-sm text-fg"
              }
            >
              {message.content || (message.streaming ? t("running") : "")}
            </div>

            {message.tool_calls.length > 0 ? (
              <ul className="mt-2 space-y-1">
                {message.tool_calls.map((call) => (
                  <li key={call.id} className="flex items-center gap-2 text-xs text-fg-muted">
                    {/* denied/blocked are REFUSALS, not errors — they get the
                        neutral "stopped" mark, only `error` reads as a fault */}
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        call.state === "started"
                          ? "animate-pulse bg-info"
                          : call.state === "ok"
                            ? "bg-success"
                            : call.state === "error"
                              ? "bg-danger"
                              : "bg-fg-muted"
                      }`}
                      aria-hidden
                    />
                    <span className="ltr font-medium">{call.name}</span>
                    <span className="truncate">{call.label}</span>
                    {call.state === "denied" || call.state === "blocked" ? (
                      <span className="shrink-0">{t(call.state)}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}

            {/* the human sentence only — the raw provider error was removed
                everywhere by user directive (2026-08-20, "remove the log") */}
            {message.failed ? (
              <p className="mt-2 text-xs text-danger">{t("runFailed")}</p>
            ) : null}

            {message.proposal ? (
              <ProposalCard proposal={message.proposal} runId={message.run_id} />
            ) : null}
          </div>
        ))}
      </div>

      <div className="border-t border-border p-3">
        <div className="flex items-end gap-2">
          <textarea
            className="input min-h-[6.75rem] flex-1 resize-none py-3"
            dir={composerDir}
            rows={3}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={t("placeholder")}
          />
          <button
            type="button"
            className="btn-primary grid h-12 min-h-0 w-12 shrink-0 place-items-center px-0"
            aria-label={t("send")}
            title={t("send")}
            disabled={busy || !input.trim()}
            onClick={() => void send()}
          >
            <SendIcon width={18} height={18} />
          </button>
        </div>
        {/* The controls live beneath the composer, matching the hub: the
            question is the primary action and the two choices are compact
            pills, not a label-and-select form competing with it. */}
        {/* At the pane's 15% minimum width this row deliberately owns 70% of
            the sidebar. Both controls receive the same fixed share, so a
            long model name truncates inside its pill instead of widening the
            assistant pane or pushing the model picker off-screen. */}
        <div className="mt-2 flex w-[70%] min-w-0 items-center justify-start gap-2" dir="ltr">
          <PickerMenu
            open={skillMenuOpen}
            onOpen={() => setSkillMenuOpen(true)}
            onClose={() => setSkillMenuOpen(false)}
            side="up"
            className="min-w-0 flex-1"
            panelClass="w-56 p-1.5"
            button={
              <button
                type="button"
                className="tap flex h-8 w-full min-w-0 items-center justify-between gap-1.5 rounded-full border border-border px-3 text-xs text-fg-muted hover:border-border-strong hover:text-fg"
                dir={composerDir}
                aria-haspopup="menu"
                aria-expanded={skillMenuOpen}
                onClick={() => setSkillMenuOpen((value) => !value)}
              >
                <span className="truncate">
                  {skill ? skillName(skills.find((item) => item.slug === skill) ?? skills[0]!) : t("skillDefault")}
                </span>
                <PickerChevron />
              </button>
            }
          >
            <div role="menu" aria-label={t("skill")}>
              {[{ slug: "", label: t("skillDefault") }, ...skills.map((item) => ({ slug: item.slug, label: skillName(item) }))].map(
                (item) => (
                  <button
                    key={item.slug || "@default"}
                    type="button"
                    role="menuitemradio"
                    aria-checked={skill === item.slug}
                    className={`tap flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm hover:bg-surface-2 ${
                      skill === item.slug ? "font-semibold text-accent" : "text-fg"
                    }`}
                    onClick={() => {
                      // value = SLUG: core's resolver takes /slug, not an id.
                      setSkill(item.slug);
                      setSkillMenuOpen(false);
                    }}
                  >
                    <span className="truncate">{item.label}</span>
                    {skill === item.slug ? <span aria-hidden>✓</span> : null}
                  </button>
                ),
              )}
            </div>
          </PickerMenu>

          <PickerMenu
            open={modelMenuOpen}
            onOpen={() => setModelMenuOpen(true)}
            onClose={() => setModelMenuOpen(false)}
            side="up"
            className="min-w-0 flex-1"
            panelClass="w-64 p-1.5"
            button={
              <button
                type="button"
                className="tap flex h-8 w-full min-w-0 items-center justify-between gap-1.5 rounded-full border border-border px-3 text-xs text-fg-muted hover:border-border-strong hover:text-fg"
                aria-haspopup="menu"
                aria-expanded={modelMenuOpen}
                onClick={() => setModelMenuOpen((value) => !value)}
              >
                <span className="truncate ltr">
                  {modelLabel(models.find((item) => item.id === modelId)?.name ?? modelId) || t("modelPicker")}
                </span>
                <PickerChevron />
              </button>
            }
          >
            {models.length > 12 ? (
              <input
                className="input mb-1.5 h-9 min-h-0 w-full text-sm"
                placeholder={t("modelFilter")}
                value={modelFilter}
                onChange={(e) => setModelFilter(e.target.value)}
              />
            ) : null}
            <div role="menu" aria-label={t("model")} className="max-h-64 overflow-y-auto">
              {models
                .filter((item) => {
                  const filter = modelFilter.trim().toLowerCase();
                  return filter === "" || item.id.toLowerCase().includes(filter) || modelLabel(item.name).toLowerCase().includes(filter);
                })
                .map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={modelId === item.id}
                    className={`tap flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm hover:bg-surface-2 ${
                      modelId === item.id ? "font-semibold text-accent" : "text-fg"
                    }`}
                    onClick={() => {
                      setModelId(item.id);
                      setModelMenuOpen(false);
                      // Its own call: model preference does not belong in
                      // the profile patch and would otherwise be dropped.
                      void api.setPreferredModel(item.id);
                    }}
                  >
                    <span className="truncate ltr">{modelLabel(item.name)}</span>
                    {modelId === item.id ? <span aria-hidden>✓</span> : null}
                  </button>
                ))}
            </div>
          </PickerMenu>
        </div>
        {/* "Only tool-capable models are listed" REMOVED — it was false.
            Nothing filters on tool support: the catalogue carries no such
            field and core/ reports `tool_capability_filtered: false` rather
            than ship a heuristic that would look like enforcement. The string
            stays in the message files for whenever the fact has a real
            source; it must not be rendered until then. */}
      </div>
      </aside>
    </ResizablePanel>
  );
}

/** The same hover/click picker geometry used by the landing-page assistant. */
function PickerMenu({
  open,
  onOpen,
  onClose,
  align = "start",
  side = "down",
  className = "",
  button,
  panelClass,
  children,
}: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  align?: "start" | "end";
  side?: "up" | "down";
  className?: string;
  button: ReactNode;
  panelClass: string;
  children: ReactNode;
}) {
  return (
    <div className={`relative min-w-0 ${className}`} onMouseEnter={onOpen} onMouseLeave={onClose}>
      {button}
      {open ? (
        <div className={`absolute ${align === "start" ? "start-0" : "end-0"} ${side === "up" ? "bottom-full pb-2" : "top-full pt-2"} z-30`}>
          <div className={`rounded-xl border border-border bg-surface text-start shadow-lg ${panelClass}`}>
            {children}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PickerChevron() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
