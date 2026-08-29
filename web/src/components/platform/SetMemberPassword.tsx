"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { api, BffError } from "@/api/client";
import { PasswordInput } from "@/components/PasswordInput";
import { Field } from "@/components/ui";
import { notify } from "@/lib/notify";
import type { User } from "@/api/types";
import { personName } from "@/lib/format";
import { useLocale } from "next-intl";

/**
 * An admin sets a member's password (db/0137, user directive 2026-08-29).
 *
 * ── what this screen says out loud, and why ─────────────────────────────
 * It tells the admin, BEFORE they act, that the reset will sign that person
 * out of every device. That sentence is not decoration: setting a password
 * does not invalidate refresh tokens on its own, so a reader could
 * reasonably assume either behaviour, and the two assumptions matter in
 * opposite directions. Someone resetting for a locked-out colleague wants to
 * know their tablet will stop working; someone resetting a possibly
 * compromised account needs to know the intruder is actually being removed.
 *
 * Afterwards it reports the COUNT the server returned rather than a generic
 * "done" — "signed out of 3 devices" is a fact about what happened, where
 * "password changed" is a fact about what was requested.
 *
 * ── what it does not do ─────────────────────────────────────────────────
 * There is no "email it to them" and no "force a change at next sign-in".
 * Neither exists on this deployment, and a checkbox that quietly does
 * nothing is worse than its absence — an admin would tick it, believe the
 * person had been told, and never follow up. Handing the password over is
 * the admin's job, out of band, and the copy says so.
 */
export function SetMemberPassword({
  member,
  onClose,
}: {
  member: User;
  onClose: () => void;
}) {
  const t = useTranslations("management");
  const locale = useLocale();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mismatch = confirm.length > 0 && password !== confirm;
  const tooShort = password.length > 0 && password.length < 8;
  const ready = password.length >= 8 && password === confirm && !busy;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const { sessions_ended } = await api.setMemberPassword(member.id, password);
      /* the COUNT, not a generic success — see the header */
      notify(t("passwordSetDone", { count: sessions_ended }));
      onClose();
    } catch (e) {
      /*
       * `kind` and `detail`, following ChangePassword's shape — a BffError
       * carries no `code`, and the first draft of this read one that does
       * not exist, which would have shown the generic apology for every
       * refusal including the ones the server took care to distinguish.
       *
       * For `invalid` the SERVER's sentence wins: it owns the rank rule, the
       * provider's verdict and the "no sign-in account" case, and each of
       * those is a different thing an admin would do differently about. A
       * client re-deriving them would be copying rules it does not own.
       */
      setError(
        e instanceof BffError
          ? (e.status === 401 ? t("passwordSetFailed") : e.detail ?? t("passwordSetFailed"))
          : t("passwordSetFailed"),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("passwordSetTitle", { name: personName(member, locale) })}
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-2xl border border-border bg-surface p-5 shadow-xl"
      >
        <h2 className="h-section">{t("passwordSetTitle", { name: personName(member, locale) })}</h2>
        <p className="mt-1 text-sm leading-6 text-fg-muted">{t("passwordSetHint")}</p>

        <div className="mt-4 space-y-3">
          <Field label={t("passwordSetNew")} hint={t("passwordSetRule")}>
            <PasswordInput
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              aria-invalid={tooShort}
            />
          </Field>
          <Field label={t("passwordSetConfirm")}>
            <PasswordInput
              value={confirm}
              onChange={setConfirm}
              autoComplete="new-password"
              aria-invalid={mismatch}
            />
          </Field>
          {mismatch ? (
            <p className="text-xs text-danger">{t("passwordSetMismatch")}</p>
          ) : null}
          {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button type="button" className="btn-secondary h-9 px-4 text-sm" onClick={onClose}>
            {t("cancel")}
          </button>
          <button className="btn-primary h-9 px-4 text-sm" disabled={!ready}>
            {busy ? t("passwordSetBusy") : t("passwordSetConfirmAction")}
          </button>
        </div>
      </form>
    </div>
  );
}
