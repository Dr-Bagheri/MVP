"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * The hub and its left sub-menu are siblings. This small shared state keeps
 * “New conversation” truthful: a conversation starts when a turn is placed in
 * the hub, not when an empty session-shaped UI happens to render.
 */
const AssistantConversationContext = createContext<{
  started: boolean;
  setStarted: (started: boolean) => void;
}>({
  started: false,
  setStarted: () => undefined,
});

export function AssistantConversationProvider({ children }: { children: ReactNode }) {
  const [started, setStarted] = useState(false);
  const value = useMemo(() => ({ started, setStarted }), [started]);
  return <AssistantConversationContext.Provider value={value}>{children}</AssistantConversationContext.Provider>;
}

export function useAssistantConversation() {
  return useContext(AssistantConversationContext);
}
