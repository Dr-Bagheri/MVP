"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { AgentMessage, Call, ModelInfo } from "@/api/types";

/**
 * The dockable assistant (SPEC): on every screen, knows the page it's on,
 * takes call mentions as context, streams answers with visible tool calls,
 * and asks before applying an inferred write.
 */
export function AssistantPane({
  page,
  presetCallId,
  open,
  onClose,
}: {
  page: string;
  presetCallId?: string;
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("assistant");
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelId, setModelId] = useState<string>("");
  const [calls, setCalls] = useState<Call[]>([]);
  const [contextIds, setContextIds] = useState<string[]>(
    presetCallId ? [presetCallId] : [],
  );
  const [showMention, setShowMention] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void api.models().then((all) => {
      // only allowed + tool-capable models are selectable (SPEC/M5)
      const selectable = all.filter((m) => m.allowed && m.tool_capable);
      setModels(selectable);
      void api.me().then((me) => {
        setModelId(me.model_id ?? selectable.find((m) => m.suggested)?.id ?? selectable[0]?.id ?? "");
      });
    });
    void api.listCalls().then(setCalls);
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
      for await (const event of api.ask(question, { page, callIds: contextIds })) {
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== draft.id) return m;
            switch (event.type) {
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
    <aside className="flex h-full w-full shrink-0 flex-col border-border bg-surface md:w-[380px] md:border-s">
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

            {message.failed ? (
              <p className="mt-2 text-xs text-danger">{message.error ?? t("runFailed")}</p>
            ) : null}

            {message.proposal ? (
              <div className="mt-2 rounded-md border border-warning/40 bg-warning/10 p-3">
                <p className="text-xs font-semibold text-warning">{t("proposal")}</p>
                <p className="mt-1 text-sm text-fg">{message.proposal.summary}</p>
                <div className="mt-2 flex gap-2">
                  <button className="btn-primary h-9 min-h-0 px-3 text-xs">{t("approve")}</button>
                  <button className="btn-secondary h-9 min-h-0 px-3 text-xs">{t("reject")}</button>
                </div>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <div className="border-t border-border p-3">
        <div className="mb-2 flex items-center gap-2">
          <label className="text-xs text-fg-muted" htmlFor="assistant-model">
            {t("model")}
          </label>
          <select
            id="assistant-model"
            className="input h-9 min-h-0 flex-1 py-0 text-xs"
            value={modelId}
            onChange={(e) => {
              setModelId(e.target.value);
              void api.updateProfile({ model_id: e.target.value });
            }}
          >
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
                {model.suggested ? " ★" : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-2">
          <input
            className="input"
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
          <button className="btn-primary px-4" disabled={busy || !input.trim()} onClick={() => void send()}>
            {t("send")}
          </button>
        </div>
        <p className="mt-1.5 text-[11px] text-fg-muted">{t("toolCapableOnly")}</p>
      </div>
    </aside>
  );
}
