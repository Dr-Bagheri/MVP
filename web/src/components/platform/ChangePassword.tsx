"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { api, BffError } from "@/api/client";
import { Card, Chip, Field } from "@/components/ui";

/**
 * Change your own password, from inside the product.
 *
 * Built because tonight's first real user had **no way to do this and no way
 * to recover** — the two buttons that should have offered it pointed at pages
 * that did not exist. This is the half you can only use while you still know
 * your password; `/forgot` is the half for when you do not.
 *
 * The current password is required. GoTrue does not ask for it — a valid
 * session is enough — which means a stolen session could otherwise change the
 * password and lock the owner out in one request, with recovery as their only
 * remaining route back.
 */
export function ChangePassword() {
  const t = useTranslations("password");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * The confirmation field is checked HERE and only here — it is the one rule
   * in this form the server has no opinion about, because it never sees the
   * second copy. Everything else (length, complexity, leaked-password checks)
   * belongs to GoTrue and is reported in GoTrue's words.
   */
  const mismatch = confirm.length > 0 && next !== confirm;
  const ready = current.length > 0 && next.length > 0 && next === confirm && !busy;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      await api.changePassword(current, next);
      setDone(true);
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (cause) {
      setError(refusalText(cause, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="max-w-xl space-y-4">
      <h2 className="h-section">{t("title")}</h2>

      <form className="space-y-4" onSubmit={submit}>
        <Field label={t("current")}>
          <input
            className="input"
            dir="ltr"
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
          />
        </Field>
        <Field label={t("new")}>
          <input
            className="input"
            dir="ltr"
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
          />
        </Field>
        <Field label={t("confirm")}>
          <input
            className="input"
            dir="ltr"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            aria-invalid={mismatch || undefined}
            aria-describedby={mismatch ? "password-mismatch" : undefined}
          />
          {mismatch ? (
            <span id="password-mismatch" className="mt-1 block text-xs text-danger">
              {t("mismatch")}
            </span>
          ) : null}
        </Field>

        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}

        <div className="flex items-center gap-3">
          <button className="btn-primary" disabled={!ready}>
            {busy ? t("saving") : t("save")}
          </button>
          {done ? <Chip tone="success">{t("changed")}</Chip> : null}
        </div>
      </form>
    </Card>
  );
}

/**
 * `wrong_password` is its own kind for a reason: "your current password is
 * wrong" and "your new password was rejected" are different problems with
 * different fixes, and they arrive as the same 400. Collapsing them would tell
 * someone to invent a stronger password when the real issue is a typo in the
 * field above.
 */
function refusalText(cause: unknown, t: (key: string) => string): string {
  if (cause instanceof BffError) {
    if (cause.kind === "wrong_password") return t("wrongCurrent");
    if (cause.kind === "invalid") return cause.detail ?? t("failed");
    if (cause.status === 401) return t("signedOut");
  }
  return t("failed");
}
