"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { api, BffError } from "@/api/client";
import { Card, Field } from "@/components/ui";

/**
 * "I forgot my password" — the request half.
 *
 * This page did not exist, and the sign-in screen linked to it. Tonight's user
 * lost their password and found a dead end: the recourse was advertised and
 * not built, which is worse than not offering it, because they stopped looking
 * for another way.
 *
 * **The confirmation is identical whether or not the address has an account.**
 * Any difference — a "no such user" message, a slower response, a different
 * screen — makes this an unauthenticated membership oracle: someone with a
 * list of addresses could ask which of them work here. The sentence shown is
 * literally true rather than a polite evasion: *if* that address has an
 * account, the mail is on its way.
 */
export default function ForgotPasswordPage() {
  const t = useTranslations("password");
  const tAuth = useTranslations("auth");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !email) return;
    setBusy(true);
    setError(null);
    try {
      await api.requestPasswordRecovery(email);
      setSent(true);
    } catch (cause) {
      /*
       * Only a rate limit surfaces. Everything else already resolved OK at the
       * route, deliberately — an upstream failure must not become "that
       * address has no account".
       */
      setError(
        cause instanceof BffError && cause.status === 429
          ? t("tooManyRequests")
          : t("failed"),
      );
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <Card>
        <h1 className="text-lg font-bold text-fg">{t("checkMailTitle")}</h1>
        <p className="mt-2 text-sm leading-7 text-fg-muted">{t("checkMailBody")}</p>
        <Link href="/sign-in" className="btn-secondary mt-5 w-full">
          {tAuth("backToSignIn")}
        </Link>
      </Card>
    );
  }

  return (
    <Card>
      <h1 className="text-lg font-bold text-fg">{t("forgotTitle")}</h1>
      <p className="mt-2 text-sm leading-7 text-fg-muted">{t("forgotBody")}</p>

      <form className="mt-4 space-y-4" onSubmit={submit}>
        <Field label={tAuth("email")}>
          <input
            className="input"
            dir="ltr"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
        </Field>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <button className="btn-primary w-full" disabled={busy || !email}>
          {busy ? t("sending") : t("sendLink")}
        </button>
      </form>

      <p className="mt-4 text-center text-sm">
        <Link href="/sign-in" className="text-accent hover:underline">
          {tAuth("backToSignIn")}
        </Link>
      </p>
    </Card>
  );
}
