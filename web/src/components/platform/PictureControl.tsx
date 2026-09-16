"use client";

import { useRef, type ReactNode } from "react";
import { IconCamera, IconTrash } from "@/components/icons";

/**
 * A PICTURE THAT CAN BE CHANGED — the profile photo and the organisation's
 * logo, ONE control (user, 2026-09-16: "make the logo change like profile
 * image, put a camera icon on logo as well, and remove the edit button that
 * it already has; for profile photo remove the text «حذف عکس» and put the
 * delete icon instead — so they become the same").
 *
 * The anatomy: the picture itself, a camera badge on its lower corner that
 * opens the file picker — the badge IS the change control, and a second
 * «تعویض» button beside a picture says what the picture already says — and a
 * trash icon beside it while there is something to remove. The words survive
 * as `aria-label` and `title`, so a screen reader and a hover lose nothing;
 * what goes is the second telling. The picture is the caller's (a circle for
 * a person, a rounded square for a logo) and so is what removal means (the
 * logo asks first; the photo is one press) — this component only asks.
 *
 * The hidden input keeps the caller's `id`, so a form label can still point
 * at it (Management · General's «نشان سازمان» row is the input's label).
 */
export function PictureControl({
  picture, hasPicture, inputId, accept, busy = false, changeLabel, removeLabel, onPick, onRemove,
}: {
  /** the thing being changed — an <Avatar>, an <img>, a placeholder square */
  picture: ReactNode;
  /** whether there is something to remove; the trash is ABSENT otherwise
      (a control whose meaning comes from the image needs the image first) */
  hasPicture: boolean;
  inputId?: string;
  accept: string;
  busy?: boolean;
  changeLabel: string;
  removeLabel: string;
  onPick: (file: File) => void;
  onRemove: () => void;
}) {
  const input = useRef<HTMLInputElement | null>(null);
  return (
    <span className="flex items-center gap-3">
      <span className="relative inline-block">
        {picture}
        <button
          type="button"
          aria-label={changeLabel}
          title={changeLabel}
          disabled={busy}
          onClick={() => input.current?.click()}
          /* the theme's icon button on the picture's edge: `absolute` is a
             utility and beats `.tap`'s `relative`, `.btn` draws no border,
             hence the explicit one (the avatar badge's line since 2026-09-03) */
          className="btn btn-icon absolute -bottom-0.5 -end-0.5 border border-border bg-surface text-fg-muted shadow-sm hover:text-fg"
        >
          <IconCamera width={14} height={14} />
        </button>
      </span>
      <input
        id={inputId}
        ref={input}
        type="file"
        accept={accept}
        className="sr-only"
        disabled={busy}
        onChange={(event) => {
          const file = event.target.files?.[0];
          /* reset FIRST, so choosing the same file twice still fires change */
          event.target.value = "";
          if (file) onPick(file);
        }}
      />
      {hasPicture ? (
        <button
          type="button"
          aria-label={removeLabel}
          title={removeLabel}
          disabled={busy}
          onClick={onRemove}
          className="btn btn-icon text-danger hover:bg-danger/10"
        >
          <IconTrash width={14} height={14} />
        </button>
      ) : null}
    </span>
  );
}
