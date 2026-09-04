import { PlatformShell } from "@/components/platform/PlatformShell";
import { PageContainer } from "@/components/scaffold";
import { ChatScreen } from "@/components/platform/ChatScreen";

/** 0184 — the team channel (user directive, 2026-09-04). */
export default function ChatPage() {
  return (
    <PlatformShell>
      {/* the room fills the height: a message list that stops halfway down
          the page and leaves the composer floating is the one layout a chat
          screen must not have */}
      <PageContainer width="normal" className="flex min-h-0 flex-1 flex-col">
        <ChatScreen />
      </PageContainer>
    </PlatformShell>
  );
}
