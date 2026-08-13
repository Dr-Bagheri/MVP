"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { AssistantPane } from "@/components/AssistantPane";
import { PlatformShell } from "@/components/platform/PlatformShell";

/**
 * Echo's app shell — **the seam between the platform and an app inside it.**
 *
 * `PlatformShell` draws the rail, the top bar and the mobile bottom bar, and
 * nothing inside the content slot. This component fills that slot with Echo's
 * content plus Echo's assistant, because M22 puts the assistant with the APP:
 *
 *   - on the hub the assistant IS the page, so the shell renders none;
 *   - inside an app, the app docks one — and therefore owns when it opens.
 *
 * A shell that rendered an assistant on every route could not honour that
 * distinction, and the last one that tried produced the 40px-main bug and then
 * the full-screen-overlay bug fixing it.
 *
 * **This is an interim home for the existing Echo routes.** M22's Echo surface
 * is Record-on-top/Calls-below merged into one screen, which is Front-end 1's
 * build; migrating the current routes here first means they build against the
 * real frame rather than a shell about to change underneath them — and their
 * measurements mean something.
 *
 * The pane's open rule is carried forward verbatim from the shell this
 * replaces, because it is the fix for a bug that was paid for twice: it starts
 * CLOSED and opens itself only from `md` up. Below `md` the pane is
 * `fixed inset-0`, so opening it by default would put an opaque layer over the
 * app on load — which is exactly M22's law: *the app must be reachable on load,
 * at every width, without dismissing anything.* `false` initially rather than a
 * viewport read during render, because the server has no viewport and guessing
 * open would flash the blocking pane on a phone.
 */
export function EchoAppShell({
  children,
  page,
  presetCallId,
}: {
  children: ReactNode;
  /** Context label the assistant shows for "the page you're on". */
  page: string;
  presetCallId?: string;
}) {
  const t = useTranslations("nav");
  const [assistantOpen, setAssistantOpen] = useState(false);

  useEffect(() => {
    setAssistantOpen(window.matchMedia("(min-width: 768px)").matches);
  }, []);

  return (
    <PlatformShell>
      <div className="flex h-full min-h-0">
        <div className="min-w-0 flex-1 overflow-y-auto p-5">
          {/*
            The affordance to re-open the pane lives with the app, not the
            platform top bar: it is Echo's assistant, and on another app's
            surface this button would point at nothing.
          */}
          {!assistantOpen ? (
            <div className="mb-4 flex justify-end">
              <button
                type="button"
                className="btn-secondary h-9 min-h-0 px-3 text-xs"
                onClick={() => setAssistantOpen(true)}
              >
                {t("assistant")}
              </button>
            </div>
          ) : null}
          {children}
        </div>

        <AssistantPane
          page={page}
          presetCallId={presetCallId}
          open={assistantOpen}
          onClose={() => setAssistantOpen(false)}
        />
      </div>
    </PlatformShell>
  );
}
