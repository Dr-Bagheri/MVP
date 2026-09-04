"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/routing";
import { api, BffError } from "@/api/client";
import { Card, Field } from "@/components/ui";
import { OAuthButtons } from "../OAuthButtons";
import { PasswordInput } from "@/components/PasswordInput";

/**
 * Self-registration — **and this form registered nobody.**
 *
 * It called `router.push("/pending")` on submit. The person saw the
 * waiting-for-approval screen, believed they had an account, and the server
 * had recorded nothing at all: zero rows in `auth.users`, zero in
 * `echo.app_user`. The screen that says "an admin will accept you shortly" was
 * a local route transition.
 *
 * It is the worst version of the failure this codebase keeps finding, because
 * the fake output is *reassurance*: every other instance leaves something
 * missing on screen, and this one produced a page whose entire job is to tell
 * you it worked.
 *
 * Sign-up is TWO steps and both must run (M15):
 *   1. Supabase creates the auth identity;
 *   2. core/'s `POST /v1/signup` creates the `app_user` row that makes the
 *      person exist to the product.
 * With only the first, someone holds a valid token, 401s forever, and never
 * appears in an admin's queue. The BFF route runs both and returns the created
 * member — **and the pending screen now renders because the server said
 * `status: "pending"`, not because we navigated there.**
 */
export default function SignUpPage() {
  const t = useTranslations("auth");
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmEmail, setConfirmEmail] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.signUp({
        email,
        password,
        display_name: displayName,
      });
      /*
       * 202 means the identity exists but the project requires email
       * confirmation, so there was no session to register with — the account
       * is HALF created and saying "you're all set" would be the same lie this
       * form was built out of. They are told to confirm, and the second half
       * runs on first sign-in.
       */
      if (result.confirmationRequired) {
        setConfirmEmail(true);
        return;
      }
      // No confirmation step meant a session existed and the server already
      // registered them. Route by what it MADE: a founder is ACTIVE at birth
      // (db/0056 — the confirmed email is the acceptance; with confirmation
      // off, the project has waived even that) and goes straight in. Only a
      // genuinely pending row — a joiner — earns the waiting screen.
      router.push(result.member?.status === "active" ? "/" : "/pending");
    } catch (cause) {
      setError(refusalText(cause, t));
    } finally {
      setBusy(false);
    }
  }

  if (confirmEmail) {
    return (
      <Card>
        <h1 className="text-lg font-bold text-fg">{t("confirmEmailTitle")}</h1>
        <p className="mt-2 text-sm leading-7 text-fg-muted">{t("confirmEmailBody")}</p>
        <Link href="/sign-in" className="btn-secondary mt-5 w-full">
          {t("backToSignIn")}
        </Link>
      </Card>
    );
  }

  return (
    <Card>
      {/* no logo on the gate (user ruling): the title carries the identity */}
      <h1 className="mb-5 text-xl font-bold text-fg">{t("signUpTitle")}</h1>

      <form className="space-y-4" onSubmit={submit}>
        {/* EMAIL, not «نام کاربری» — Supabase authenticates an address. The
            old form collected a username, which is a different, optional field
            chosen later on the profile screen and cannot be signed in with. */}
        <Field label={t("email")}>
          <input
            className="input"
            dir="ltr"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
        </Field>
        <Field label={t("displayName")}>
          <input
            className="input"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </Field>
        {/*
          Creating an organisation is the only path offered, and that is a
          limit rather than a choice: core/'s `join_org` takes an org UUID,
          which is not something a person can be asked to type. Joining an
          existing org needs an invite flow that does not exist yet, so
          offering the option would be a control that cannot succeed.
        */}
        <Field label={t("password")}>
          <PasswordInput
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
            />
        </Field>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <button
          className="btn-primary w-full"
          disabled={busy || !email || !password || !displayName}
        >
          {busy ? t("working") : t("signUp")}
        </button>
        <OAuthButtons />
      </form>

      {/* Provider history, kept because it is this screen's origin story: the
          mock form's Google button pushed to /pending with no OAuth behind it
          and was removed under the no-dead-buttons rule. The buttons above
          returned only when both providers were ENABLED in Supabase and the
          PKCE routes went live (2026-08-16) — an OAuth arrival lands as
          `unregistered` and register-on-first-sign-in gives them the org
          step, so sign-up-via-provider needs no separate machinery. */}

      <p className="mt-4 text-center text-sm">
        <Link href="/sign-in" className="text-accent hover:underline">
          {t("haveAccount")}
        </Link>
      </p>
    </Card>
  );
}

/**
 * Server sentence first. `conflict` is the one worth carrying verbatim: core/
 * distinguishes "this account is already registered" from a taken username,
 * and both are actionable in different ways.
 */
function refusalText(cause: unknown, t: (key: string) => string): string {
  if (cause instanceof BffError) {
    if (cause.kind === "invalid" || cause.kind === "conflict" || cause.status === 400) {
      return cause.detail ?? t("signUpFailed");
    }
  }
  return t("signUpFailed");
}
