"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/routing";
import { api, BffError } from "@/api/client";
import { Card, Field } from "@/components/ui";
import { OAuthButtons } from "../OAuthButtons";
import { PasswordInput } from "@/components/PasswordInput";

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
  /**
   * A first Google/GitHub arrival must choose a password before ANY route into
   * the product. The server, not membership status, tells us whether that
   * password identity already exists.
   */
  const [needsOAuthPassword, setNeedsOAuthPassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  /** The invitation probe runs ONCE. Without the bound, register-succeeds
   *  while identity-stays-unregistered recurses forever — the suite found it
   *  by eating the heap, which beats a browser tab finding it. */
  const invitationProbed = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Arrived from a successful email confirmation — say so while routing. */
  const [confirmedNote, setConfirmedNote] = useState(false);
  /** Arrived from a completed password reset — the password works HERE. */
  const [resetNote, setResetNote] = useState(false);

  /*
   * The confirm-email landing (`/api/auth/confirm` redirects here).
   *
   * `?confirmed=1` means that route already exchanged the link for a session
   * cookie — so route by identity IMMEDIATELY: a brand-new person lands on
   * the org-choice step without retyping a password they entered two minutes
   * ago, and a returning one goes straight in. `?confirmed=failed` names the
   * dead link instead of presenting an unexplained sign-in form.
   *
   * Read from `location.search` in an effect, deliberately NOT
   * `useSearchParams()`: that hook forces a prerender bailout that broke the
   * production build on the hub while every dev render stayed green. A
   * one-shot read after mount has no such trap.
   */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const confirmed = params.get("confirmed");
    const oauth = params.get("oauth");
    // A completed reset lands here WITHOUT a session (user ruling,
    // 2026-08-20) — the green line says the password is set and this form
    // is where it gets used, so the arrival reads as the next step rather
    // than as being bounced.
    if (params.get("reset") === "1") setResetNote(true);
    if (confirmed === "1") {
      // Say what just happened while the routing runs — a silent redirect
      // reads as "nothing happened" for the two seconds it takes (user
      // review, 2026-08-15: the confirmation must SAY the account is ready).
      setConfirmedNote(true);
      setBusy(true);
      void routeByIdentity().finally(() => setBusy(false));
    } else if (confirmed === "failed") {
      setError(t("confirmFailed"));
    } else if (oauth === "ok") {
      // Do not route an OAuth arrival directly to a membership. A prior
      // invitation/registration may already make them a member, but the first
      // password still belongs before the platform is reachable.
      setBusy(true);
      void startOAuthArrival().finally(() => setBusy(false));
    } else if (oauth === "failed") {
      // the provider round trip died (expired code, denied consent, replay)
      setError(t("oauthFailed"));
    } else if (oauth === "disabled") {
      // 0078: an admin turned this method off — a different fact from a
      // broken round trip, and the person deserves the real one
      setError(t("oauthDisabled"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot, on arrival
  }, []);

  /** Route by what the SERVER says the caller is, never by what we sent it. */
  async function routeByIdentity() {
    const identity = await api.identityState();
    switch (identity.state) {
      case "member":
        // the hub — the AI assistant is the platform's first page (M22);
        // Echo is one card on it (user directive: land on the assistant)
        router.push("/");
        return;
      case "pending":
        router.push("/pending");
        return;
      case "suspended":
        router.push("/suspended");
        return;
      case "unregistered":
        /*
         * The INVITATION door first (db/0060): if the platform emailed this
         * person an invitation, a bare register redeems it on their verified
         * address and they are IN — active, granted role, no org screen. The
         * refusal (no invitation, no org named) is the normal answer for
         * everyone else and routes to the org-choice form exactly as before.
         */
        /*
         * NOTHING IS ASKED (user directive, 2026-09-02: "after someone login
         * don't ask for organization, just put it on waiting and tell it that
         * admin must accept its entry").
         *
         * Registering is the whole branch now. db/0149 lands a bare arrival
         * as a PENDING member of the org the platform marked as receiving
         * them, so `/pending` is the truthful destination and the screen
         * there says who has to act next. The org form this replaced asked
         * for a name most arrivals had never been told, and typing it wrong
         * looked exactly like not being welcome.
         *
         * The probe bound stays: register-succeeds-while-identity-stays-
         * unregistered would recurse forever, and the suite found that once
         * by eating the heap.
         */
        if (invitationProbed.current) {
          setError(t("registerStuck"));
          return;
        }
        invitationProbed.current = true;
        try {
          await api.register({ display_name: email.split("@")[0] ?? email });
          await routeByIdentity();
        } catch (cause) {
          /*
           * 409 = ALREADY REGISTERED — they are a member, so ask the server
           * who they are rather than showing them anything (found live: an
           * invited arrival whose invitation had redeemed on a previous
           * attempt filled the org form and got 409 — "the app got stuck").
           */
          if (cause instanceof BffError && cause.status === 409) {
            await routeByIdentity();
            return;
          }
          /* the server's own sentence: `signups_closed` is a fact about the
             PLATFORM and `org_not_found` about a name — neither is something
             this person can fix by typing, and both are worth reading */
          setError(cause instanceof BffError && cause.detail
            ? cause.detail : t("registerFailed"));
        }
        return;
      case "signed_out":
        // the cookie did not survive the hop; say so rather than looping
        setError(t("sessionLost"));
    }
  }

  async function startOAuthArrival() {
    const enrollment = await api.oauthPasswordEnrollment();
    if (enrollment.required) {
      setNeedsOAuthPassword(true);
      return;
    }
    await routeByIdentity();
  }

  async function enrollOAuthPassword(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (newPassword !== confirmNewPassword) {
      setError(tPassword("mismatch"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.setPassword(newPassword);
      setNeedsOAuthPassword(false);
      await routeByIdentity();
    } catch (cause) {
      setError(refusalText(cause, t));
    } finally {
      setBusy(false);
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

  return (
    <Card>
      {/* no logo on the gate (user ruling): the title carries the identity */}
      <h1 className="mb-5 text-xl font-bold text-fg">{t("signInTitle")}</h1>

      {resetNote ? (
        <p role="status" className="mb-4 rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-sm text-success">
          {t("resetReady")}
        </p>
      ) : null}

      {confirmedNote ? (
        /*
         * The moment the email link lands: the account's email is verified and
         * a session already exists. `role="status"` so screen readers hear it
         * without it being an interruption; the org form or the app follows in
         * a beat, but this line is what makes the click feel ANSWERED.
         */
        <p role="status" className="mb-4 rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-sm text-success">
          {t("confirmedReady")}
        </p>
      ) : null}

      {needsOAuthPassword ? (
        <form className="space-y-4" onSubmit={enrollOAuthPassword}>
          <p className="text-sm leading-7 text-fg-muted">{t("finishPasswordOauth")}</p>
          <Field label={t("choosePassword")}>
            <PasswordInput
              value={newPassword}
              onChange={setNewPassword}
              autoComplete="new-password"
            />
          </Field>
          <Field label={t("confirmPassword")}>
            <PasswordInput
              value={confirmNewPassword}
              onChange={setConfirmNewPassword}
              autoComplete="new-password"
            />
          </Field>
          {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
          <button className="btn-primary w-full" disabled={busy || !newPassword || !confirmNewPassword}>
            {busy ? t("working") : tPassword("setPassword")}
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
            <PasswordInput
              value={password}
              onChange={setPassword}
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
          <OAuthButtons />
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
