"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/api/client";
import { ConfirmDialog } from "@/components/rowActions";
import { notifyError } from "@/lib/notify";
import { deriveSignature, SIGNATURE_ACCEPT, SignatureError } from "@/lib/signatureImage";
import { PictureControl } from "./PictureControl";

/**
 * THE SIGNATURE ON FILE (db/0229) — a person's own, edited in their profile
 * the way their photo is: the picture, a camera badge that opens the picker,
 * a trash beside it while there is one. `PictureControl`, the platform's one
 * picture control, so this and the photo above it cannot be two shapes.
 *
 * What is different from the photo, and why:
 *
 *   · it is NOT cropped or squared. A signature is wide and low, and what
 *     goes onto the minutes is exactly what was uploaded (lib/signatureImage
 *     shrinks it and keeps its transparency, and does nothing else);
 *   · it is drawn ON WHITE whatever the theme. A signature is dark ink on
 *     paper, and a transparent PNG over the dark surface is invisible — the
 *     letterhead preview's own reason;
 *   · removing it ASKS. Unlike the photo (one press, the initial comes back),
 *     the file is gone and the person has to find it again — and the
 *     meetings already signed keep their snapshot, which the dialog says so
 *     nobody removes a signature expecting to un-sign something;
 *   · it is fetched by URL rather than carried on `me`: the picture is the
 *     one thing about a person nobody else may fetch, so it lives behind its
 *     own self-scoped route rather than on the record the shell shows
 *     everybody.
 */
export function SignatureEditor() {
  const t = useTranslations("profile");
  const tCommon = useTranslations("common");
  /* three states, kept apart: asking (skeleton), none on file (the empty
     word), on file (the picture) — `null` here would be "still loading"
     AND "there is none", the pair this repo keeps separate everywhere */
  const [state, setState] = useState<"loading" | "none" | "some">("loading");
  /* busts the browser's cache after an upload — the URL never changes when
     the picture does */
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  useEffect(() => {
    let alive = true;
    /* HEAD would do, but a 404 on the bytes route is the answer either way
       and one request is one request. Inside a promise from the first call,
       so a page test whose mock lacks the method cannot throw into the
       render (the VerificationBanner's own lesson): a missing read is "none
       on file", never a crashed identity section. */
    void Promise.resolve()
      .then(() => fetch(api.mySignatureUrl(), { method: "GET" }))
      .then((r) => { if (alive) setState(r.ok ? "some" : "none"); })
      .catch(() => { if (alive) setState("none"); });
    return () => { alive = false; };
  }, []);

  const pick = (file: File) => {
    setBusy(true);
    void deriveSignature(file)
      .then((derived) => api.uploadMySignature(derived.base64))
      .then(() => {
        setState("some");
        setVersion(Date.now());
      })
      .catch((error: unknown) => {
        notifyError(error instanceof SignatureError ? t(error.code) : t("signatureError"));
      })
      .finally(() => setBusy(false));
  };

  const remove = () => {
    setConfirmRemove(false);
    setBusy(true);
    void api.clearMySignature()
      .then(() => setState("none"))
      .catch(() => notifyError(t("signatureError")))
      .finally(() => setBusy(false));
  };

  return (
    <div>
      <PictureControl
        accept={SIGNATURE_ACCEPT}
        busy={busy || state === "loading"}
        hasPicture={state === "some"}
        changeLabel={state === "some" ? t("signatureChange") : t("signatureUpload")}
        removeLabel={t("signatureRemove")}
        onPick={pick}
        onRemove={() => setConfirmRemove(true)}
        picture={
          /* a paper-white well the width of a signature line; the photo's
             circle would crop the one shape a signature always has */
          <span
            data-testid="signature-preview"
            className="flex h-12 w-36 items-center justify-center overflow-hidden rounded-lg border border-border bg-white"
          >
            {state === "some" ? (
              // eslint-disable-next-line @next/next/no-img-element -- a session-scoped bytes route, not a static asset
              <img
                src={api.mySignatureUrl(version)}
                alt={t("signature")}
                className="max-h-full max-w-full object-contain p-1"
              />
            ) : state === "none" ? (
              <span className="text-caption text-fg-subtle">{t("signatureNone")}</span>
            ) : null}
          </span>
        }
      />
      {confirmRemove ? (
        <ConfirmDialog
          title={t("signatureRemove")}
          body={t("signatureRemoveBody")}
          confirmLabel={t("signatureRemove")}
          cancelLabel={tCommon("cancel")}
          onCancel={() => setConfirmRemove(false)}
          onConfirm={remove}
        />
      ) : null}
    </div>
  );
}
