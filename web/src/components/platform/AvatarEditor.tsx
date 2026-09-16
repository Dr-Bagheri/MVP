"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { Me } from "@/api/types";
import { personName } from "@/lib/format";
import { Avatar } from "@/components/Avatar";
import { notifyError } from "@/lib/notify";
import { PictureControl } from "./PictureControl";

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
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function crop(file: File) {
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
      notifyError(t("photoError"));
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function save(avatar_url: string | null) {
    if (busy) return;
    setBusy(true);
    try {
      // adopt the SERVER's row — the photo everyone else will see is the one
      // it stored, not the one this tab remembers
      onSaved(await api.updateProfile({ avatar_url }));
      setPreview(null);
    } catch {
      notifyError(t("photoError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {/* ONE CONTROL WITH THE ORGANISATION'S LOGO (user, 2026-09-16: "for
          profile photo remove the text «حذف عکس» and put the delete icon
          instead, so they become the same"): the camera badge on the circle
          and a trash beside it while there is a photo — `PictureControl`,
          which the org form reads too. The words survive as the two
          buttons' names. The Avatar is `lg` (48), the page's one answer
          (2026-09-03), and the badge is the theme's icon button, so it
          covers the corner of a 48px circle rather than of a 64. */}
      <PictureControl
        accept="image/jpeg,image/png,image/webp"
        busy={busy}
        hasPicture={Boolean(me.avatar_url) && !preview}
        changeLabel={t("photoChange")}
        removeLabel={t("photoRemove")}
        onPick={(file) => void crop(file)}
        onRemove={() => void save(null)}
        picture={<Avatar name={personName(me, locale)} src={me.avatar_url} size="lg" />}
      />

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

    </div>
  );
}
