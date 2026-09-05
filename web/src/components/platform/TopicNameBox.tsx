"use client";

import { useState } from "react";
import { IconClose } from "@/components/icons";

/**
 * THE FOLDER STRIP'S INLINE NAME BOX, used by adding AND renaming a folder,
 * on the task board and on the meetings page alike.
 *
 * One component for the two jobs because they are the same interaction with
 * a different starting value — and one component for the two PAGES because
 * they are the same row (user directive, 2026-09-03: "the plus in the second
 * sub menu on top open up in different shapes in meetings page and in task
 * page, make them the same"). It lived inside Meetings.tsx while the board
 * had its own copy; on 2026-09-05 the board's folder `+` came back ("return
 * the previous new folder plus … like a new folder in meetings") and the
 * copy would have been the third drawing of one box.
 *
 * The SPAN owns the border, ground and corner; the input draws no box (a
 * themed field here would put a second box inside the first, and `.input`'s
 * `w-full` would push the ✕ out of it). Enter commits and Escape cancels,
 * which is what the ✕ also does — a ✓ would duplicate the Enter key.
 */
export function TopicNameBox({ initial, placeholder, cancelLabel, onCancel, onSubmit }: {
  initial: string;
  placeholder: string;
  cancelLabel: string;
  onCancel: () => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState(initial);
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-accent bg-surface px-1.5">
      <input
        autoFocus
        value={name}
        maxLength={80}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && name.trim() !== "") onSubmit(name.trim());
          if (e.key === "Escape") onCancel();
        }}
        placeholder={placeholder}
        className="h-[30px] w-36 bg-transparent text-xs text-fg outline-none placeholder:text-fg-subtle"
      />
      <button
        type="button"
        onClick={onCancel}
        className="btn btn-icon text-fg-muted hover:text-fg"
        aria-label={cancelLabel}
      >
        <IconClose width={12} height={12} />
      </button>
    </span>
  );
}
