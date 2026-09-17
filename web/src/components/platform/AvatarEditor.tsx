"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { Me } from "@/api/types";
import { digits, personName } from "@/lib/format";
import { Avatar } from "@/components/Avatar";
import { notifyError } from "@/lib/notify";
import { PictureControl } from "./PictureControl";
import { AVATAR_PRESETS } from "./avatarPresets";

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

/**
 * A PRESET IS AN IMAGE DOCUMENT OF ITS OWN, never inlined (2026-09-17): the
 * generated SVGs carry DiceBear's element ids (`viewboxMask`), and eight of
 * them inlined into one page share those ids — every `url(#viewboxMask)`
 * resolves to the FIRST one in the document. Measured on the candidate
 * sheet: a second style's faces clipped to a quarter of a circle by the
 * first style's mask. A data URL is its own document, so nothing can
 * collide, and the accept card's rasteriser loads the very same URL.
 */
function svgUrl(svg: string): string {
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}
const PRESET_URLS = AVATAR_PRESETS.map((p) => ({ key: p.key, url: svgUrl(p.svg) }));

export function AvatarEditor({ me, onSaved }: { me: Me; onSaved: (me: Me) => void }) {
  const t = useTranslations("profile");
  const locale = useLocale();
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** the centred square of `img`, as the JPEG the accept card shows */
  function rasterize(img: HTMLImageElement): string {
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
    return canvas.toDataURL("image/jpeg", 0.85);
  }

  async function crop(file: File) {
    const url = URL.createObjectURL(file);
    try {
      setPreview(rasterize(await loadImage(url)));
    } catch {
      notifyError(t("photoError"));
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /* A READY-MADE AVATAR takes the photo's own road (2026-09-17): the SVG is
     rasterised to the same 256×256 JPEG a picked file becomes, lands in the
     accept card, and is uploaded only on the accept — so a preset can never
     reach the profile by a path the photo does not take, and the server
     learns nothing new. */
  async function pickPreset(url: string) {
    try {
      setPreview(rasterize(await loadImage(url)));
    } catch {
      notifyError(t("photoError"));
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
      <div className="flex flex-wrap items-center gap-3">
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

        {/* THE DIVIDER, THEN EIGHT READY-MADE AVATARS (user, 2026-09-17: "in
            front of it put a divider and add 8 avatar images, 5 girls and 3
            boys, animated, for them to select as a profile image"). A
            vertical hairline separates "your own picture" from "one of
            ours"; each avatar is a round 36px key named by its number, and a
            press opens the same accept card a picked photo opens. Not a
            `btn`: the picture IS the control, and the family's corner and
            inset would frame it. */}
        <span role="separator" aria-orientation="vertical" className="h-8 w-px shrink-0 bg-border" />
        <div role="group" aria-label={t("avatarPresets")} className="flex flex-wrap items-center gap-2">
          {PRESET_URLS.map((preset, i) => (
            <button
              key={preset.key}
              type="button"
              disabled={busy}
              aria-label={`${t("avatarPreset")} ${digits(i + 1, locale)}`}
              title={`${t("avatarPreset")} ${digits(i + 1, locale)}`}
              onClick={() => void pickPreset(preset.url)}
              className="tap h-9 w-9 shrink-0 overflow-hidden rounded-full ring-2 ring-transparent transition-shadow hover:ring-accent focus-visible:outline-none focus-visible:ring-accent disabled:opacity-60"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- our own generated picture as a data URL (see svgUrl), never a person's input */}
              <img src={preset.url} alt="" draggable={false} className="block h-full w-full" />
            </button>
          ))}
        </div>
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

    </div>
  );
}
