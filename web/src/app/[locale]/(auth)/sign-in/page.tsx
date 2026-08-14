"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/routing";
import { api, BffError } from "@/api/client";
import { Card, Field } from "@/components/ui";

/**
 * Sign-in — **and this form did not sign anyone in.**
 *
 * It called `router.push("/calls")` on submit. No request, no session, no
 * failure: typing anything at all took you into the app, and typing the wrong
 * password took you into the app too. The first real user signed in
 * "successfully" against a form that has never spoken to a server.
 *
 * That is the whole failure family this codebase keeps naming, in its most
 * consequential position: **present, transitions, and does nothing.** Nothing
 * could have caught it from the outside — the screens rendered, the route
 * changed, and the app appeared. Only asking "what did the server record?"
 * finds it, and the answer was zero rows.
 *
 * The flow now, in order, because each step exists to catch a different
 * failure:
 *
 * 1. `POST /api/auth/sign-in` exchanges the password for a session cookie
 *    server-side. **The browser never receives a token** (M1); the response is
 *    `{ok:true}` and nothing else.
 * 2. `identityState()` then asks who that session belongs to — and its answer
 *    decides the destination. A successful password check is NOT the same as
 *    being allowed in: a pending account signs in perfectly and still may see
 *    nothing.
 * 3. `unregistered` triggers **register-on-first-sign-in**. That branch is not
 *    an edge case: if the Supabase project requires email confirmation,
 *    sign-up cannot complete its second half, and without this the person
 *    authenticates forever against an account the product has never heard of.
 */
export default function SignInPage() {
  const t = useTranslations("auth");
  const tPassword = useTranslations("password");
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [orgName, setOrgName] = useState("");
  /** Set when the server says this token has no membership yet (M15 recovery). */
  const [needsOrg, setNeedsOrg] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Route by what the SERVER says the caller is, never by what we sent it. */
  async function routeByIdentity() {
    const identity = await api.identityState();
    switch (identity.state) {
      case "member":
        router.push("/echo");
        return;
      case "pending":
        router.push("/pending");
        return;
      case "suspended":
        router.push("/suspended");
        return;
      case "unregistered":
        // authenticated, but no `app_user` row — ask for the org and register
        setNeedsOrg(true);
        return;
      case "signed_out":
        // the cookie did not survive the hop; say so rather than looping
        setError(t("sessionLost"));
    }
  }

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.signIn(email, password);
      await routeByIdentity();
    } catch (cause) {
      setError(refusalText(cause, t));
    } finally {
      setBusy(false);
    }
  }

  async function register(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // display_name defaults to the local part of the address: the token
      // carries the email, and asking again for something we already know is
      // friction. They rename themselves on the profile screen.
      await api.register({ display_name: email.split("@")[0] ?? email, org_name: orgName });
      router.push("/pending");
    } catch (cause) {
      setError(refusalText(cause, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="mb-5 flex items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-md bg-accent text-sm font-bold text-on-accent">
          E
        </span>
        <h1 className="text-xl font-bold text-fg">{t("signInTitle")}</h1>
      </div>

      {needsOrg ? (
        <form className="space-y-4" onSubmit={register}>
          <p className="text-sm leading-7 text-fg-muted">{t("finishSetup")}</p>
          <Field label={t("orgName")} hint={t("orgNameHint")}>
            <input className="input" value={orgName} onChange={(e) => setOrgName(e.target.value)} />
          </Field>
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          <button className="btn-primary w-full" disabled={busy || !orgName.trim()}>
            {busy ? t("working") : t("finish")}
          </button>
        </form>
      ) : (
        <form className="space-y-4" onSubmit={signIn}>
          {/*
            EMAIL, not «نام کاربری». The identity Supabase authenticates is an
            address; the form asked for a username, which is a different field
            entirely (`app_user.username`, optional, chosen later). Someone
            typing their handle here could never sign in, and the error would
            have said their password was wrong.
          */}
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
          <Field label={t("password")}>
            <input
              className="input"
              dir="ltr"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </Field>
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          <button className="btn-primary w-full" disabled={busy || !email || !password}>
            {busy ? t("working") : t("signIn")}
          </button>
        </form>
      )}

      {/*
        The Google button is GONE, not disabled.

        It called `router.push("/calls")` — no OAuth, no provider, no session:
        a button labelled "continue with Google" that signed nobody in and let
        anybody through. An auth method that does not exist must not be offered,
        and a greyed-out one still advertises a capability we do not have. The
        strings stay in the message files for when the provider is configured.
      */}

      {/* The recovery link now has a page behind it. It was advertised here
          with nothing built, which is worse than not offering it: someone who
          has lost their password stops looking for another way. */}
      <p className="mt-4 text-center text-sm">
        <Link href="/forgot" className="text-accent hover:underline">
          {tPassword("forgotTitle")}
        </Link>
      </p>
      <p className="mt-2 text-center text-sm">
        <Link href="/sign-up" className="text-accent hover:underline">
          {t("noAccount")}
        </Link>
      </p>
    </Card>
  );
}

/**
 * The server's sentence where there is one, our wording where there is not.
 *
 * `invalid` on this route means the credentials were refused — core/ and
 * Supabase both phrase it, and their phrasing is more accurate than a guess.
 * Anything else is a failure of the CALL rather than of what was typed, and
 * saying "wrong password" for an upstream outage sends someone to reset a
 * password that was fine.
 */
function refusalText(cause: unknown, t: (key: string) => string): string {
  if (cause instanceof BffError) {
    if (cause.kind === "invalid" || cause.status === 401) return cause.detail ?? t("invalid");
    if (cause.kind === "conflict") return cause.detail ?? t("alreadyRegistered");
  }
  return t("signInFailed");
}
