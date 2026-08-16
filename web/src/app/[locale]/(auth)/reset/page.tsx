"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/routing";
import { api, BffError } from "@/api/client";
import { Card, Field } from "@/components/ui";

/**
 * The recovery link's landing page — **the consumer that did not exist.**
 *
 * The `token_hash` arrives in the QUERY STRING and is posted to the BFF, which
 * exchanges it for a session server-side. It is deliberately not read from the
 * URL fragment: Supabase's default recovery link returns `access_token` in the
 * fragment, which only the browser can see, and adopting that would hand the
 * browser a token on the one flow where the person is least equipped to notice
 * (M1 forbids it everywhere, and here it would be worst).
 *
 * **That choice constrains configuration, not just code**: the project's
 * "Reset Password" email template must use `{{ .TokenHash }}` and point here.
 * Until it does, the mail carries fragment tokens, this page sees no
 * `token_hash`, and it says so rather than showing a form that cannot work.
 * A flow correct in code and unreachable in configuration is indistinguishable
 * from a broken one — so this page distinguishes them out loud.
 */
export default function ResetPasswordPage() {
  const t = useTranslations("password");
  const tAuth = useTranslations("auth");
  const router = useRouter();
  const [tokenHash, setTokenHash] = useState<string | null>(null);
  /** `recovery` (forgot-password) or `invite` (the emailed invitation) — the
   *  link says which, and the copy follows. Allow-listed; anything else
   *  falls back to recovery. */
  const [linkType, setLinkType] = useState<"recovery" | "invite">("recovery");
  const [checked, setChecked] = useState(false);
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    /*
     * Read on the client because the token must not sit in a server-rendered
     * page's props or in any log line that records the URL. `checked` is a
     * separate flag so the "no token" screen renders only after we have
     * actually looked — otherwise the first paint accuses a perfectly good
     * link of being broken.
     */
    const params = new URLSearchParams(window.location.search);
    setTokenHash(params.get("token_hash"));
    if (params.get("type") === "invite") setLinkType("invite");
    setChecked(true);
  }, []);

  const mismatch = confirm.length > 0 && next !== confirm;
  const ready = tokenHash !== null && next.length > 0 && next === confirm && !busy;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!ready || tokenHash === null) return;
    setBusy(true);
    setError(null);
    try {
      await api.resetPassword(tokenHash, next, linkType);
      // signed in by the reset itself — sending them to a login form seconds
      // after they proved they own the address is a step with no purpose.
      // "/" so an invited arrival lands on the hub, where the shell's
      // register-on-first-sign-in flow redeems their invitation (db/0060).
      router.push("/");
    } catch (cause) {
      if (cause instanceof BffError && cause.kind === "invalid_token") {
        setExpired(true);
        return;
      }
      setError(cause instanceof BffError ? (cause.detail ?? t("failed")) : t("failed"));
    } finally {
      setBusy(false);
    }
  }

  if (!checked) return null;

  if (expired || tokenHash === null) {
    return (
      <Card>
        <h1 className="text-lg font-bold text-fg">{t("linkDeadTitle")}</h1>
        {/* Expired, already used, or altered — indistinguishable from here and
            from the person's side, and all three have the same fix. Offering a
            retry of the same link would be offering the one action that cannot
            work. */}
        <p className="mt-2 text-sm leading-7 text-fg-muted">{t("linkDeadBody")}</p>
        <Link href="/forgot" className="btn-primary mt-5 w-full">
          {t("sendLink")}
        </Link>
        <Link href="/sign-in" className="btn-secondary mt-2 w-full">
          {tAuth("backToSignIn")}
        </Link>
      </Card>
    );
  }

  return (
    <Card>
      <h1 className="text-lg font-bold text-fg">
        {linkType === "invite" ? t("inviteTitle") : t("resetTitle")}
      </h1>
      <p className="mt-2 text-sm leading-7 text-fg-muted">
        {linkType === "invite" ? t("inviteBody") : t("resetBody")}
      </p>

      <form className="mt-4 space-y-4" onSubmit={submit}>
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
          />
          {mismatch ? <span className="mt-1 block text-xs text-danger">{t("mismatch")}</span> : null}
        </Field>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <button className="btn-primary w-full" disabled={!ready}>
          {busy ? t("saving") : t("setPassword")}
        </button>
      </form>
    </Card>
  );
}
