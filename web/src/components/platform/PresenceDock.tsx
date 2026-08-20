"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import { api } from "@/api/client";
import type { AgentCardItem, AgentEvent } from "@/api/types";
import { useRouter } from "@/i18n/routing";
import { executeClientTool, SURFACE_TOOLS } from "@/lib/agentSurface";

/**
 * PRESENCE (proposed M34) — the agent, always there.
 *
 * One persistent dock on every route: a collapsed orb at the corner, a
 * panel when opened (⌘K / Ctrl-K opens it anywhere), and the hub itself as
 * the maximized state — which is why the dock renders NOTHING on the hub
 * route: the approved first screen IS the presence, not a rival to it.
 *
 * Continuity: one conversation per day, resumed across pages and reloads
 * (the session id lives in localStorage under a dated key; the sign-out
 * sweep removes it — a conversation must not follow the next account on a
 * shared machine). Context: every ask carries the current route, so "this
 * page" means something. IDs only — the server re-reads everything under
 * RLS; nothing here is trusted (M34).
 *
 * Client tools (M33): the dock is the surface's EXECUTOR. A ui-effect call
 * runs immediately through the same code paths a human uses; a write-effect
 * call renders a consent card first — Allow performs it, Decline reports
 * "declined", and either way the run continues with the truth. The consume
 * loop AWAITS the person's choice: no further events arrive while the
 * server waits on the result, so blocking here is the honest shape.
 */

const PRESENCE_KEY = "neurai-presence-session";

interface DockMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  chips: string[];
  failed?: boolean;
}

function todayKey(): string {
  return `${PRESENCE_KEY}:${new Date().toISOString().slice(0, 10)}`;
}

export function PresenceDock() {
  const t = useTranslations("presence");
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();

  const [member, setMember] = useState(false);
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<DockMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [consent, setConsent] = useState<
    | null
    | { label: string; resolve: (allowed: boolean) => void }
  >(null);
  const [autonomy, setAutonomyState] = useState<"watch" | "assist">("assist");
  const [autonomyNote, setAutonomyNote] = useState<string | null>(null);
  /** M35: the proactivity channel — refreshed whenever the panel opens */
  const [cards, setCards] = useState<AgentCardItem[]>([]);
  const [digest, setDigest] = useState<{ enabled: boolean; available: boolean } | null>(null);
  const sessionId = useRef<string | undefined>(undefined);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  /** the dock exists only for signed-in members */
  useEffect(() => {
    let live = true;
    void api.identityState().then((who) => {
      if (live && who.state === "member") setMember(true);
    }).catch(() => undefined);
    return () => { live = false; };
  }, []);

  /** today's thread, resumed — yesterday's key is simply never read again */
  useEffect(() => {
    try {
      sessionId.current = localStorage.getItem(todayKey()) ?? undefined;
    } catch { /* storage unavailable — a fresh thread each page is the floor */ }
  }, []);

  /** ⌘K / Ctrl-K — the agent from anywhere */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => {
          const next = !v;
          if (next) setTimeout(() => inputRef.current?.focus(), 0);
          return next;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  /** cards + digest state ride the panel's open (and once for the orb dot) */
  useEffect(() => {
    if (!member) return;
    void api.cards().then((res) => setCards(res.cards)).catch(() => undefined);
    if (open) {
      void api.weeklyDigest().then(setDigest).catch(() => undefined);
    }
  }, [member, open]);

  function openCard(card: AgentCardItem) {
    if (!card.read) {
      setCards((prev) => prev.map((c) => (c.id === card.id ? { ...c, read: true } : c)));
      void api.markCardRead(card.id).catch(() => undefined);
    }
    // the card's content LIVES in its conversation — adopt it as the dock's
    // thread so "ask about it" is one keystroke away
    if (card.session_id) {
      sessionId.current = card.session_id;
      try { localStorage.setItem(todayKey(), card.session_id); } catch { /* fine */ }
    }
    router.push("/conversations");
  }

  const unread = cards.filter((c) => !c.read).length;

  const askConsent = useCallback((label: string): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      setConsent({ label, resolve });
    });
  }, []);

  async function send() {
    const question = input.trim();
    if (!question || streaming) return;
    setInput("");
    setStreaming(true);
    const replyId = `p-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: `u-${Date.now()}`, role: "user", content: question, chips: [] },
      { id: replyId, role: "assistant", content: "", chips: [] },
    ]);
    try {
      const stream = api.ask(question, { page: pathname, callIds: [] }, sessionId.current, {
        locale,
        clientTools: [...SURFACE_TOOLS],
        surface: { route: pathname.replace(/^\/(fa|en)(?=\/|$)/, "") || "/" },
      });
      for await (const event of stream) {
        await handleEvent(event, replyId);
      }
    } catch {
      setMessages((prev) =>
        prev.map((m) => (m.id === replyId ? { ...m, failed: true } : m)));
    } finally {
      setStreaming(false);
      setConsent(null);
    }
  }

  async function handleEvent(event: AgentEvent, replyId: string) {
    switch (event.type) {
      case "session":
        sessionId.current = event.id;
        try { localStorage.setItem(todayKey(), event.id); } catch { /* fine */ }
        break;
      case "text_delta":
        setMessages((prev) =>
          prev.map((m) => (m.id === replyId ? { ...m, content: m.content + event.delta } : m)));
        break;
      case "tool_call":
        if (event.state === "started") {
          setMessages((prev) =>
            prev.map((m) => (m.id === replyId ? { ...m, chips: [...m.chips, event.label] } : m)));
        }
        break;
      case "client_tool_call": {
        // consent BEFORE execution for write-effect calls; the loop blocks
        // here deliberately — the server is waiting on this very answer
        const allowed = event.requires_consent ? await askConsent(event.label) : true;
        setConsent(null);
        if (!allowed) {
          await api.deliverToolResult(event.id, false, "the user declined").catch(() => undefined);
          break;
        }
        const result = executeClientTool(event.tool, event.args, { push: router.push });
        await api.deliverToolResult(event.id, result.ok, result.detail).catch(() => undefined);
        break;
      }
      case "done":
        if (event.failed) {
          setMessages((prev) =>
            prev.map((m) => (m.id === replyId ? { ...m, failed: true } : m))
              .filter((m) => !(m.id === replyId && event.failed && m.content === "")));
        }
        break;
      default:
        break; // unknown-ignorable, the wire's contract
    }
  }

  async function changeAutonomy(next: "watch" | "assist") {
    setAutonomyNote(null);
    const prev = autonomy;
    setAutonomyState(next);
    try {
      await api.setAutonomy(next);
    } catch (cause) {
      setAutonomyState(prev);
      const kind = (cause as { kind?: string }).kind;
      setAutonomyNote(kind === "validation" || kind === "invalid" ? t("dialFailed") : t("dialNotReady"));
    }
  }

  // The hub IS the maximized presence — no orb on top of it.
  const onHub = /^\/(fa|en)?\/?$/.test(pathname);
  if (!member || onHub) return null;

  return (
    <>
      {open ? (
        <div className="fixed bottom-20 end-4 z-40 flex max-h-[70dvh] w-[min(92vw,24rem)] flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-xl">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <span className="h-2 w-2 rounded-full bg-accent" aria-hidden />
            <span className="text-sm font-semibold text-fg">{t("title")}</span>
            <select
              aria-label={t("dialLabel")}
              className="ms-auto h-7 rounded-md border border-border bg-surface px-1.5 text-xs text-fg-muted"
              value={autonomy}
              onChange={(e) => void changeAutonomy(e.target.value as "watch" | "assist")}
            >
              <option value="watch">{t("dialWatch")}</option>
              <option value="assist">{t("dialAssist")}</option>
            </select>
            <button
              type="button"
              className="tap h-7 w-7 rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg"
              aria-label={t("close")}
              onClick={() => setOpen(false)}
            >
              ✕
            </button>
          </div>

          {autonomyNote ? (
            <p role="status" className="border-b border-border bg-warning/10 px-3 py-1.5 text-xs text-warning">
              {autonomyNote}
            </p>
          ) : null}

          <div className="min-h-24 flex-1 space-y-3 overflow-y-auto px-3 py-3">
            {cards.length > 0 ? (
              <div className="space-y-1.5">
                {cards.slice(0, 4).map((card) => (
                  <button
                    key={card.id}
                    type="button"
                    className={`tap block w-full rounded-lg border px-2.5 py-1.5 text-start text-xs transition-colors ${
                      card.read
                        ? "border-border text-fg-muted hover:text-fg"
                        : "border-accent/40 bg-accent-soft text-fg"
                    }`}
                    onClick={() => openCard(card)}
                  >
                    {!card.read ? <span className="me-1.5 inline-block h-1.5 w-1.5 rounded-full bg-accent align-middle" aria-hidden /> : null}
                    {card.title}
                  </button>
                ))}
              </div>
            ) : null}
            {digest?.available ? (
              <label className="flex items-center gap-2 text-xs text-fg-muted">
                <input
                  type="checkbox"
                  checked={digest.enabled}
                  onChange={(e) => {
                    const enabled = e.target.checked;
                    setDigest({ available: true, enabled });
                    void api.setWeeklyDigest(enabled).catch(() =>
                      setDigest({ available: true, enabled: !enabled }));
                  }}
                />
                {t("digestToggle")}
              </label>
            ) : null}
            {messages.length === 0 ? (
              <p className="text-sm leading-6 text-fg-muted">{t("empty")}</p>
            ) : (
              messages.map((m) => (
                <div key={m.id} className={m.role === "user" ? "flex justify-end" : ""}>
                  <div
                    className={
                      m.role === "user"
                        ? "max-w-[85%] rounded-2xl rounded-ee-sm bg-accent-soft px-3 py-2 text-sm leading-6 text-fg"
                        : "text-sm leading-6 text-fg"
                    }
                  >
                    {m.content}
                    {m.chips.length > 0 ? (
                      <span className="mt-1 flex flex-wrap gap-1">
                        {m.chips.map((chip, i) => (
                          <span key={i} className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-fg-muted">
                            {chip}
                          </span>
                        ))}
                      </span>
                    ) : null}
                    {m.failed ? (
                      <span className="mt-1 block text-xs text-warning">{t("failed")}</span>
                    ) : null}
                  </div>
                </div>
              ))
            )}
            {consent ? (
              <div className="rounded-xl border border-accent/30 bg-accent-soft p-3">
                <p className="text-sm text-fg">{t("consentAsk", { action: consent.label })}</p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    className="btn-primary h-8 min-h-0 px-3 text-xs"
                    onClick={() => consent.resolve(true)}
                  >
                    {t("allow")}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary h-8 min-h-0 px-3 text-xs"
                    onClick={() => consent.resolve(false)}
                  >
                    {t("decline")}
                  </button>
                </div>
              </div>
            ) : null}
            <div ref={endRef} />
          </div>

          <form
            className="flex items-end gap-2 border-t border-border p-2"
            onSubmit={(e) => { e.preventDefault(); void send(); }}
          >
            <textarea
              ref={inputRef}
              rows={1}
              className="input min-h-0 flex-1 resize-none py-2 text-sm"
              placeholder={t("placeholder")}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); }
              }}
            />
            <button
              type="submit"
              className="btn-primary h-9 min-h-0 px-3 text-sm disabled:opacity-50"
              disabled={streaming || input.trim() === ""}
            >
              {streaming ? "…" : t("send")}
            </button>
          </form>
        </div>
      ) : null}

      <button
        type="button"
        aria-label={t("openLabel")}
        title={`${t("openLabel")} (Ctrl+K)`}
        className={`tap fixed bottom-4 end-4 z-40 grid h-12 w-12 place-items-center rounded-full border shadow-lg transition-colors ${
          open
            ? "border-accent bg-accent text-on-accent"
            : "border-border bg-surface text-accent hover:border-accent"
        }`}
        onClick={() => {
          setOpen((v) => {
            const next = !v;
            if (next) setTimeout(() => inputRef.current?.focus(), 0);
            return next;
          });
        }}
      >
        {/* the idle glow does the orb's job (the hub-mock ruling), literally */}
        <span className={`h-3 w-3 rounded-full ${open ? "bg-on-accent" : "animate-pulse bg-accent"}`} aria-hidden />
        {unread > 0 && !open ? (
          <span
            className="absolute -end-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-danger px-1 text-[10px] font-bold text-white"
            aria-label={t("unread", { count: unread })}
          >
            {unread}
          </span>
        ) : null}
      </button>
    </>
  );
}
