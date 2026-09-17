"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api, BffError } from "@/api/client";
import { Overlay } from "@/components/platform/Overlay";
import { ConfirmDialog } from "@/components/rowActions";
import { IconClose, IconTrash, IconUpload } from "@/components/icons";
import {
  DIALOG_BODY, FIELD_LABEL, FOOTER_CANCEL, FOOTER_PRIMARY, PANEL_INPUT,
} from "@/components/platform/tasks/panelStyle";
import { digits } from "@/lib/format";
import { notifyError } from "@/lib/notify";
import {
  base64Of, derivePage, PAGE_MAX_PX, SHEET_ACCEPT, SheetError, type DerivedPage,
} from "@/lib/letterhead";

/**
 * «سربرگ شرکت» — the page an organisation's minutes are printed on.
 *
 * Two things happen here and they are one act: the file becomes a page image
 * (lib/letterhead.ts decides how, per file type), and the admin says where
 * their sheet's CLEAR AREA is by dragging three numbers until the box on the
 * preview sits inside their header and above their footer.
 *
 * THE BOX IS THE FEATURE. Nothing can measure a clear area from an image —
 * every letterhead has a different header depth — so a preview with the text
 * box drawn on it is the only way an admin can know, before they export
 * anything, that the minutes will land on the paper rather than through the
 * logo. It is also why the numbers and the image go up together (db/0228):
 * a new page under the old margins is a state this preview never showed.
 */
export function LetterheadDialog({ onClose, onSaved, current }: {
  onClose: () => void;
  onSaved: () => void;
  /** what the organisation already has, or null */
  current: { mime: string | null; source_mime: string | null; top_mm: number; bottom_mm: number; side_mm: number } | null;
}) {
  const t = useTranslations("meetings");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const pick = useRef<HTMLInputElement>(null);

  const [page, setPage] = useState<DerivedPage | null>(null);
  const [top, setTop] = useState(current?.top_mm ?? 45);
  const [bottom, setBottom] = useState(current?.bottom_mm ?? 25);
  const [side, setSide] = useState(current?.side_mm ?? 18);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  /* the STORED sheet as an image source, when there is one and nothing new
     has been picked — so the box can be adjusted against the real paper */
  const [storedUrl, setStoredUrl] = useState<string | null>(null);
  useEffect(() => {
    if (current?.mime == null) return;
    setStoredUrl(api.orgSheetUrl(Date.now()));
  }, [current?.mime]);

  const preview = page?.dataUrl ?? storedUrl;

  const read = (file: File) => {
    setReading(true);
    void derivePage(file)
      .then(setPage)
      /* a refusal names WHICH file could not be read — «we could not find the
         letterhead in this Word file» and «this is not a page» send a person
         to two different remedies */
      .catch((error: unknown) => notifyError(
        error instanceof SheetError ? t(error.code) : t("sheet_unreadable"),
      ))
      .finally(() => setReading(false));
  };

  const save = () => {
    if (page === null) {
      /* no new file: the box moved, and that is its own small write — an
         admin nudging a margin does not re-send three megabytes */
      setBusy(true);
      void api.setOrgSheetMargins({ top_mm: top, bottom_mm: bottom, side_mm: side })
        .then(() => { onSaved(); onClose(); })
        .catch(() => notifyError(t("sheetSaveFailed")))
        .finally(() => setBusy(false));
      return;
    }
    setBusy(true);
    void api.uploadOrgSheet({
      image_base64: base64Of(page.dataUrl),
      source_mime: page.sourceMime,
      top_mm: top, bottom_mm: bottom, side_mm: side,
    })
      .then(() => { onSaved(); onClose(); })
      .catch((error: unknown) => notifyError(
        error instanceof BffError && error.status === 413 ? t("sheet_too_large") : t("sheetSaveFailed"),
      ))
      .finally(() => setBusy(false));
  };

  /* REMOVING IT ASKS. The sheet is the whole organisation's stationery and
     the file it came from is not kept — every future export goes back to
     plain paper, and the person who has to undo this is whoever still has the
     original. The platform's one confirm dialog, like every other delete. */
  const [confirmRemove, setConfirmRemove] = useState(false);
  const remove = () => {
    setBusy(true);
    void api.clearOrgSheet()
      .then(() => { onSaved(); onClose(); })
      .catch(() => notifyError(t("sheetSaveFailed")))
      .finally(() => { setBusy(false); setConfirmRemove(false); });
  };

  const mm = (n: number) => digits(n, locale);

  return (
    <Overlay onClose={onClose} label={t("sheetTitle")} size="md">
      <div className="mb-1 flex items-start justify-between gap-3">
        <h2 className="h-dialog">{t("sheetTitle")}</h2>
        <button type="button" onClick={onClose} className="btn-ghost btn-icon"
          aria-label={t("close")}>
          <IconClose width={14} height={14} />
        </button>
      </div>

      <div className={DIALOG_BODY}>
        <div>
          {/* a CONSTRAINT, not an explanation (R21): which files this reads,
              said before somebody picks one that it cannot */}
          <p className="text-xs leading-6 text-fg-muted">{t("sheetAccepts")}</p>
          <input
            ref={pick}
            type="file"
            accept={SHEET_ACCEPT}
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              /* cleared BEFORE the work, so picking the same file twice still
                 fires — the picker's own rule, learned on the profile photo */
              e.target.value = "";
              if (file !== undefined) read(file);
            }}
          />
          <button type="button" onClick={() => pick.current?.click()} disabled={reading}
            className="btn-secondary btn-sm mt-2 gap-1.5">
            <IconUpload width={12} height={12} />
            {reading ? t("sheetReading") : t("sheetPick")}
          </button>
          {page !== null ? (
            <p className="mt-2 text-caption text-fg-subtle">
              {t("sheetFrom", { kind: t(`sheetKind_${sourceKey(page.sourceMime)}`) })}
              {" · "}
              {t("sheetSize", { w: mm(page.widthPx), h: mm(page.heightPx) })}
            </p>
          ) : current?.source_mime != null ? (
            <p className="mt-2 text-caption text-fg-subtle">
              {t("sheetFrom", { kind: t(`sheetKind_${sourceKey(current.source_mime)}`) })}
            </p>
          ) : null}
        </div>

        <div>
          <span className={FIELD_LABEL}>{t("sheetClearArea")}</span>
          {/* THE PAGE, with the text box drawn on it. A4's own ratio, so the
              box on screen is the box on paper: the margins are millimetres
              of 210×297, and rendering them as percentages of THIS element
              keeps the two in step at any preview size. */}
          <div
            className="relative mx-auto w-full max-w-[16rem] overflow-hidden rounded-lg border border-border bg-white"
            style={{ aspectRatio: "210 / 297" }}
            data-testid="sheet-preview"
          >
            {preview === null ? (
              <p className="grid h-full place-items-center p-4 text-center text-caption text-fg-subtle">
                {t("sheetNoneYet")}
              </p>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt={t("sheetTitle")} className="h-full w-full object-contain" />
            )}
            <div
              aria-hidden
              className="pointer-events-none absolute border-2 border-dashed border-accent/70 bg-accent/5"
              style={{
                top: `${(top / 297) * 100}%`,
                bottom: `${(bottom / 297) * 100}%`,
                left: `${(side / 210) * 100}%`,
                right: `${(side / 210) * 100}%`,
              }}
            />
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            {([
              ["sheetTop", top, setTop, 120],
              ["sheetBottom", bottom, setBottom, 120],
              ["sheetSide", side, setSide, 60],
            ] as const).map(([key, value, set, max]) => (
              <label key={key} className="block">
                <span className={FIELD_LABEL}>{t(key)}</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={max}
                  value={value}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    /* clamped HERE as well as walled by 0228: a number field
                       hands back whatever was typed, and a 900mm header would
                       otherwise draw a box the size of nothing and then be
                       refused by the server a minute later */
                    set(Number.isFinite(next) ? Math.max(0, Math.min(max, Math.round(next))) : 0);
                  }}
                  className={PANEL_INPUT}
                  dir="ltr"
                />
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
        <button type="button" onClick={onClose} className={FOOTER_CANCEL}>{tCommon("cancel")}</button>
        <div className="flex items-center gap-2">
          {current?.mime != null ? (
            <button type="button" onClick={() => setConfirmRemove(true)} disabled={busy}
              className="btn-danger gap-1.5">
              <IconTrash width={14} height={14} />
              {t("sheetRemove")}
            </button>
          ) : null}
          <button type="button" onClick={save} disabled={busy || (page === null && current?.mime == null)}
            className={FOOTER_PRIMARY}>
            {busy ? t("summarySaving") : t("summarySave")}
          </button>
        </div>
      </div>
      {confirmRemove ? (
        <ConfirmDialog
          title={t("sheetRemove")}
          /* what it COSTS, which is the part nobody can guess: the uploaded
             file is not kept, so every export goes back to plain paper and
             putting it back means finding the original again */
          body={t("sheetRemoveBody")}
          confirmLabel={t("sheetRemove")}
          cancelLabel={tCommon("cancel")}
          onCancel={() => setConfirmRemove(false)}
          onConfirm={remove}
        />
      ) : null}
    </Overlay>
  );
}

/** the catalogue key for a source type — a word a person recognises, not a
    MIME string in front of somebody who uploaded a file they already know */
function sourceKey(mime: string): string {
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("image/")) return "image";
  return "word";
}

export { PAGE_MAX_PX };
