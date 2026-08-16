"use client";

import { useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { Me } from "@/api/types";
import { personName } from "@/lib/format";

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
          <div className="grid h-16 w-16 place-items-center overflow-hidden rounded-full bg-accent-soft text-xl font-bold text-accent">
            {me.avatar_url ? (
              /* eslint-disable-next-line @next/next/no-img-element -- a data
                 URL: next/image would proxy an image we already hold inline */
              <img src={me.avatar_url} alt="" className="h-full w-full object-cover" />
            ) : (
              /* personName, not display_name: the initial must match the
                 script the rest of the UI renders the name in */
              personName(me, locale).trim().charAt(0)
            )}
          </div>
          <button
            type="button"
            aria-label={t("photoChange")}
            className="absolute -bottom-0.5 -end-0.5 grid h-7 w-7 place-items-center rounded-full border border-border bg-surface text-fg-muted shadow-sm transition-colors hover:text-fg"
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
          {/* eslint-disable-next-line @next/next/no-img-element -- same data-URL reasoning */}
          <img src={preview} alt="" className="h-20 w-20 rounded-full object-cover" />
          <div>
            <p className="text-sm text-fg">{t("photoPreviewTitle")}</p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                className="btn-primary h-9 min-h-0 px-3 text-xs"
                disabled={busy}
                onClick={() => void save(preview)}
              >
                {t("photoAccept")}
              </button>
              <button
                type="button"
                className="btn-secondary h-9 min-h-0 px-3 text-xs"
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
