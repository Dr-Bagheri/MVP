"use client";

import { useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { Me } from "@/api/types";
import { personName } from "@/lib/format";
import { Avatar } from "@/components/Avatar";

/**
 * The profile photo, edited in place (user directive, 2026-08-16): no
 * separate "Avatar" button — a small camera control sits ON the circle,
 * picking a file crops it to a centered square, and nothing is uploaded
 * until the person accepts the crop they are looking at.
 *
 * The crop happens HERE, in a canvas, and what is uploaded is exactly the
 * 256×256 the preview showed — not the original plus crop coordinates for
 * a server to apply. One image, seen then sent, means the accept step can
 * never approve something different from what arrives.
 *
 * JPEG at 0.85 keeps the payload ~15–25KB against core's 128KB cap. The
 * canvas is white-filled first: photos carry no alpha, and a transparent
 * PNG composed straight into JPEG would silently turn its background black.
 */
const CROP_SIZE = 256;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("unreadable image"));
    img.src = url;
  });
}

export function AvatarEditor({ me, onSaved }: { me: Me; onSaved: (me: Me) => void }) {
  const t = useTranslations("profile");
  const locale = useLocale();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function crop(file: File) {
    setFailed(false);
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const sx = (img.naturalWidth - side) / 2;
      const sy = (img.naturalHeight - side) / 2;
      const canvas = document.createElement("canvas");
      canvas.width = CROP_SIZE;
      canvas.height = CROP_SIZE;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no canvas");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, CROP_SIZE, CROP_SIZE);
      ctx.drawImage(img, sx, sy, side, side, 0, 0, CROP_SIZE, CROP_SIZE);
      setPreview(canvas.toDataURL("image/jpeg", 0.85));
    } catch {
      setFailed(true);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function save(avatar_url: string | null) {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      // adopt the SERVER's row — the photo everyone else will see is the one
      // it stored, not the one this tab remembers
      onSaved(await api.updateProfile({ avatar_url }));
      setPreview(null);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-4">
        <div className="relative">
          {/*
            2026-09-03: the platform's avatar, not a fifth hand-drawn one.
            This was a 64px circle, and the header of the very page it sits on
            drew the SAME person at 56 — two sizes, neither of them a token,
            eight pixels and one scroll apart. Both are `lg` (48) now, so the
            page has one answer.

            `personName`, not `display_name`, stays the caller's job: which of
            a person's two names to show is a locale decision, and the
            component is deliberately given the resolved string.

            The one visible consequence, said out loud rather than discovered:
            the camera badge below is `.btn-icon` (28px, the theme's only icon
            size), so it now covers more of a 48px circle than it did of a 64.
            That is a control decision belonging to whoever revisits the badge
            — inventing a smaller icon button here is the exact defect this
            pass exists to close.
          */}
          <Avatar name={personName(me, locale)} src={me.avatar_url} size="lg" />
          <button
            type="button"
            aria-label={t("photoChange")}
            /* 2026-09-03: this one IS a control — the camera badge a person
               presses — and it was already the theme's icon button written out
               by hand (28px, centred), so it wears `.btn btn-icon` and picks up
               the platform's corner, cursor and disabled handling with it.
               `.btn` draws no border, hence the explicit one; `absolute` is a
               utility and beats `.tap`'s `relative`, so the badge still sits on
               the circle's edge. */
            className="btn btn-icon absolute -bottom-0.5 -end-0.5 border border-border bg-surface text-fg-muted shadow-sm hover:text-fg"
            onClick={() => fileRef.current?.click()}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M14.5 4h-5L7.8 6H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-3.8l-1.7-2z" />
              <circle cx="12" cy="13" r="3.5" />
            </svg>
          </button>
        </div>
        {me.avatar_url && !preview ? (
          <button
            type="button"
            className="text-xs text-fg-muted underline-offset-2 hover:underline"
            disabled={busy}
            onClick={() => void save(null)}
          >
            {t("photoRemove")}
          </button>
        ) : null}
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            // reset so choosing the same file twice still fires change
            e.target.value = "";
            if (file) void crop(file);
          }}
        />
      </div>

      {preview ? (
        <div className="mt-3 flex items-center gap-4 rounded-lg border border-border bg-surface-2 p-3">
          {/* KEPT hand-drawn (2026-09-03), and it is not the same thing as the
              mark above it: this is the crop being INSPECTED before it is
              accepted, so `src` is never absent and the photo-or-initial
              decision the Avatar owns can never arise here. It is deliberately
              larger than the result, because the question this card asks is
              "look at this closely" — shrinking it to `lg` for the sake of a
              shared class would make the thing under review smaller than the
              thing already saved. */}
          {/* eslint-disable-next-line @next/next/no-img-element -- same data-URL reasoning */}
          <img src={preview} alt="" className="h-20 w-20 rounded-full object-cover" />
          <div>
            <p className="text-sm text-fg">{t("photoPreviewTitle")}</p>
            {/* 2026-09-03: `.btn-sm` is the theme's compact control (34px,
                measured off the reference), so the accept/cancel pair stops
                re-answering the height, the corner and the type size that
                `.btn` already answers. A size restated on top of `.btn` is the
                same invented shape as one written from scratch — it just reads
                as compliant, because the class is right there. */}
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                className="btn-primary btn-sm"
                disabled={busy}
                onClick={() => void save(preview)}
              >
                {t("photoAccept")}
              </button>
              <button
                type="button"
                className="btn-secondary btn-sm"
                disabled={busy}
                onClick={() => setPreview(null)}
              >
                {t("photoCancel")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {failed ? (
        <p role="alert" className="mt-2 text-xs text-danger">
          {t("photoError")}
        </p>
      ) : null}
    </div>
  );
}
