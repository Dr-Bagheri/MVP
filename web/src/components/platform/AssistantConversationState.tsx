"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * The Home hub and its left menu are siblings. The menu's New conversation
 * action remains an ordinary, enabled menu item: it is a no-op on an already
 * blank hub and resets the live hub only after a conversation has begun.
 */
const AssistantConversationContext = createContext<{
  started: boolean;
  setStarted: (started: boolean) => void;
  resetVersion: number;
  startNewConversation: () => void;
}>({
  started: false,
  setStarted: () => undefined,
  resetVersion: 0,
  startNewConversation: () => undefined,
});

export function AssistantConversationProvider({ children }: { children: ReactNode }) {
  const [started, setStarted] = useState(false);
  const [resetVersion, setResetVersion] = useState(0);
  const startNewConversation = useCallback(() => {
    setStarted(false);
    setResetVersion((version) => version + 1);
  }, []);
  const value = useMemo(
    () => ({ started, setStarted, resetVersion, startNewConversation }),
    [resetVersion, startNewConversation, started],
  );
  return <AssistantConversationContext.Provider value={value}>{children}</AssistantConversationContext.Provider>;
}

export function useAssistantConversation() {
  return useContext(AssistantConversationContext);
}
