"use client";

import { Recorder } from "./Recorder";
import { UnfinishedTakes } from "./UnfinishedTakes";

/**
 * Echo · New meeting — the RECORDER, and nothing else (user directive,
 * 2026-08-25). The two-tab bar retired: uploading a file is a trailing
 * icon on this very menu row now, and it never opens a page. The section's
 * own title says what this is, so the panel repeats no heading — and the
 * call title left the form entirely: the engine names an untitled take
 * («جلسه ۳»), and renaming it later takes one pencil on the record.
 */
export function NewMeetingSection({ onFinished }: { onFinished?: () => void }) {
  return (
    <div className="space-y-5">
      {/* unfinished takes come FIRST — continuing beats starting over */}
      <UnfinishedTakes />
      <Recorder {...(onFinished ? { onFinished } : {})} />
    </div>
  );
}
