"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/routing";
import { api, BffError } from "@/api/client";
import type { Me } from "@/api/types";
import { notifyError, notifySuccess } from "@/lib/notify";
import { Card, Field } from "@/components/ui";
import { PasswordInput } from "@/components/PasswordInput";
import { DemoPanel } from "../DemoPanel";
import { OAuthButtons } from "../OAuthButtons";

/**
 * THE ONE GATE (M54, 2026-09-15 — user directive: "you go with one click on
 * your email inside and you can use the platform"), and since 2026-09-16 the
 * REFERENCE'S TWO HALVES (user directive: "the login page should look like a
 * mixture of these two images — a login on the right side always, and the
 * left side our demo video, and in the login it shows you options that you
 * can connect with these 4 or email, or you already signed up").
 *
 * So the page is a split: the DEMO on the left (DemoPanel — the video when
 * one exists, the product's own scenes until then) and the DOOR on the right,
 * always on the right — the grid is pinned `dir="ltr"` so the two halves keep
 * their physical sides in both locales, and each half restores the locale's
 * own direction inside itself. Below `lg` the demo steps aside and the door
 * stands alone; a phone is not the place for a film beside a form.
 *
 * The door: the four provider buttons (Google, Apple, Microsoft, SSO), «یا»,
 * an email field, one press — and, for whoever already has one, the password
 * one link away. The mail that arrives carries a LINK and a six-digit CODE.
 * The link lands on `/api/auth/confirm` (token hash, exchanged server-side —
 * M1); the code is typed on this same screen. Either one is both signing up
 * and signing in: GoTrue creates the identity if the address is new, and the
 * product registers the person on their first successful verify.
 *
 * ── The states, and why they are one component ───────────────────────────
 *
 *   email     the doors, the address, Continue
 *   sso       the work email for single sign-on (the fourth door's own field)
 *   code      "check your email": the six-digit box, send again, change the
 *             address, or fall back to a password
 *   password  the previous gate, kept whole for everyone who has one (the
 *             org's members) and for an OAuth arrival's first password —
 *             a secondary path, one link away, never the first thing shown
 *
 * They share the address and the routing, which is why splitting them into
 * pages would be four copies of `routeByIdentity`.
 *
 * ── What did NOT change ───────────────────────────────────────────────────
 *
 * `routeByIdentity()` is the same function this page has carried since the
 * form that signed nobody in: the SERVER decides where a session lands (the
 * first-time flow until it is finished, home after; pending; suspended; the
 * register-on-first-sign-in probe with its recursion bound; the OAuth first
 * password). Its tests still hold.
 *
 * The history this file used to open with — the mock form that pushed to
 * /calls without a request — lives in git (`git log -- this file`). The
 * lesson it taught is in the tests: every case asserts a request LEFT the
 * browser and that the destination came from the server's answer.
 */

/** how long «send again» waits — GoTrue refuses a second mail inside a minute */
const RESEND_COOLDOWN_S = 60;

type Mode = "email" | "sso" | "code" | "password";

/** Where a MEMBER lands: the first-time flow until it is finished, home after. */
export function landingFor(me: Pick<Me, "onboarding_completed_at"> | undefined): string {
  /*
   * ABSENT and NULL are different facts (types.ts): an un-migrated deployment
   * serves no stamp at all and must land home, or every member of it would be
   * sent to a flow whose save route does not exist.
   */
  return me !== undefined && me.onboarding_completed_at === null ? "/onboarding" : "/";
}

export default function SignInPage() {
  const t = useTranslations("auth");
  const tPassword = useTranslations("password");
  const locale = useLocale();
  const dir = locale === "fa" ? "rtl" : "ltr";
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [cooldown, setCooldown] = useState(0);
  /**
   * A first Google/Apple/Microsoft/SSO arrival must choose a password before
   * ANY route into the product. The server, not membership status, tells us
   * whether that password identity already exists.
   */
  const [needsOAuthPassword, setNeedsOAuthPassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  /** The invitation probe runs ONCE. Without the bound, register-succeeds
   *  while identity-stays-unregistered recurses forever — the suite found it
   *  by eating the heap, which beats a browser tab finding it. */
  const invitationProbed = useRef(false);
  const [busy, setBusy] = useState(false);
  const codeRef = useRef<HTMLInputElement | null>(null);

  /* the resend cooldown — one interval, cleared with the mode */
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  /*
   * The confirm-email landing (`/api/auth/confirm` redirects here).
   *
   * `?confirmed=1` means that route already exchanged the link for a session
   * cookie — so route by identity IMMEDIATELY: a brand-new person lands in
   * their own workspace and on the first-time flow without retyping anything,
   * and a returning one goes straight in. `?confirmed=failed` names the dead
   * link instead of presenting an unexplained form. `?confirmed=fragment` is a
   * link minted by a template still using GoTrue's own URL — it arrived with
   * the session in the URL FRAGMENT, which this app refuses to read (M1), so
   * the person is told to type the code instead.
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
    if (params.get("reset") === "1") {
      notifySuccess(t("resetReady"));
      setMode("password");
    }
    if (confirmed === "1") {
      // Say what just happened while the routing runs — a silent redirect
      // reads as "nothing happened" for the two seconds it takes (user
      // review, 2026-08-15: the confirmation must SAY the account is ready).
      notifySuccess(t("confirmedReady"));
      setBusy(true);
      void routeByIdentity().finally(() => setBusy(false));
    } else if (confirmed === "failed") {
      notifyError(t("confirmFailed"));
    } else if (confirmed === "fragment") {
      notifyError(t("fragmentLink"));
    } else if (oauth === "ok") {
      // Do not route an OAuth arrival directly to a membership. A prior
      // invitation/registration may already make them a member, but the first
      // password still belongs before the platform is reachable.
      setBusy(true);
      void startOAuthArrival().finally(() => setBusy(false));
    } else if (oauth === "failed") {
      // the provider round trip died (expired code, denied consent, replay)
      notifyError(t("oauthFailed"));
    } else if (oauth === "disabled") {
      // 0078/0225: this door is not switched on — a different fact from a
      // broken round trip, and the person deserves the real one
      notifyError(t("oauthDisabled"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot, on arrival
  }, []);

  /** Route by what the SERVER says the caller is, never by what we sent it. */
  async function routeByIdentity() {
    const identity = await api.identityState();
    switch (identity.state) {
      case "member":
        /* the first-time flow until it is finished (db/0223), then the hub —
           the AI assistant is the platform's first page (M22) */
        router.push(landingFor(identity.me));
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
         * address and they are IN — active, granted role. Otherwise db/0223
         * founds a workspace of their own (or, on a deployment that marked an
         * intake org, lands them pending there). NOTHING IS ASKED either way
         * (user directive, 2026-09-02): the org form this replaced asked for
         * a name most arrivals had never been told.
         *
         * The probe bound stays: register-succeeds-while-identity-stays-
         * unregistered would recurse forever, and the suite found that once
         * by eating the heap.
         */
        if (invitationProbed.current) {
          notifyError(t("registerStuck"));
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
           * attempt got 409 — "the app got stuck").
           */
          if (cause instanceof BffError && cause.status === 409) {
            await routeByIdentity();
            return;
          }
          /* the server's own sentence: `org_not_found` is a fact about a
             name and `no_organization` about the platform — neither is
             something this person can fix by typing, and both are worth
             reading */
          notifyError(cause instanceof BffError && cause.detail
            ? cause.detail : t("registerFailed"));
        }
        return;
      case "signed_out":
        // the cookie did not survive the hop; say so rather than looping
        notifyError(t("sessionLost"));
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
      notifyError(tPassword("mismatch"));
      return;
    }
    setBusy(true);
    try {
      await api.setPassword(newPassword);
      setNeedsOAuthPassword(false);
      await routeByIdentity();
    } catch (cause) {
      notifyError(refusalText(cause, t));
    } finally {
      setBusy(false);
    }
  }

  /** "Send me a code" — the whole first step. */
  async function sendCode(event?: React.FormEvent) {
    event?.preventDefault();
    if (busy || !email) return;
    setBusy(true);
    try {
      await api.requestEmailCode(email);
      setCode("");
      setMode("code");
      setCooldown(RESEND_COOLDOWN_S);
      notifySuccess(t("codeSent"));
      /* the box is where the next thing happens; focus it once it exists */
      setTimeout(() => codeRef.current?.focus(), 0);
    } catch (cause) {
      notifyError(
        cause instanceof BffError && cause.status === 429
          ? t("codeTooMany")
          : cause instanceof BffError && cause.detail ? cause.detail : t("signInFailed"),
      );
    } finally {
      setBusy(false);
    }
  }

  /** The typed code becomes a session; then the server says where to go. */
  async function verifyCode(event?: React.FormEvent) {
    event?.preventDefault();
    if (busy || code.length < 6) return;
    setBusy(true);
    try {
      await api.verifyEmailCode(email, code);
      await routeByIdentity();
    } catch (cause) {
      notifyError(cause instanceof BffError && cause.status === 401 ? t("codeWrong") : refusalText(cause, t));
    } finally {
      setBusy(false);
    }
  }

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await api.signIn(email, password);
      await routeByIdentity();
    } catch (cause) {
      notifyError(refusalText(cause, t));
    } finally {
      setBusy(false);
    }
  }

  /**
   * SINGLE SIGN-ON — the fourth door's own step: the work email says which
   * organisation's identity provider to go to. The server mints the PKCE
   * verifier and answers with the provider's URL; the browser only follows
   * it. Two named refusals, two sentences (the route's own reasons).
   */
  async function startSso(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !email) return;
    setBusy(true);
    try {
      const { url } = await api.startSso(email);
      window.location.assign(url);
    } catch (cause) {
      if (cause instanceof BffError && cause.code === "disabled") notifyError(t("ssoDisabled"));
      else if (cause instanceof BffError && cause.code === "not_configured") notifyError(t("ssoNotConfigured"));
      else notifyError(t("signInFailed"));
      setBusy(false);
    }
  }

  /* digits only, whatever keyboard typed them — the route normalises Persian
     digits too, but a box that only ever holds six ASCII digits is the one
     that can auto-submit on the sixth */
  const onCode = (raw: string) => {
    const digits = raw
      .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
      .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
      .replace(/\D/g, "")
      .slice(0, 6);
    setCode(digits);
  };

  let door: React.ReactNode;

  if (needsOAuthPassword) {
    door = (
      <>
        <h1 className="h-page mb-5">{t("signInTitle")}</h1>
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
          <button className="btn-primary w-full" disabled={busy || !newPassword || !confirmNewPassword}>
            {busy ? t("working") : tPassword("setPassword")}
          </button>
        </form>
      </>
    );
  } else if (mode === "code") {
    door = (
      <>
        <h1 className="h-page">{t("codeTitle")}</h1>
        {/* ARRIVAL — the one sentence that says what the mail carries and
            what to do with it; without it this is a box with no story */}
        <p className="mt-2 text-sm leading-7 text-fg-muted">{t("codeLead", { email })}</p>
        <form className="mt-4 space-y-4" onSubmit={verifyCode}>
          <Field label={t("codeLabel")}>
            <input
              ref={codeRef}
              className="input text-center text-xl font-semibold"
              dir="ltr"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => onCode(e.target.value)}
              /* the sixth digit is the press: a person who typed all six has
                 nothing left to do but wait for us */
              onInput={(e) => {
                const next = (e.target as HTMLInputElement).value.replace(/\D/g, "");
                if (next.length >= 6) setTimeout(() => void verifyCode(), 0);
              }}
            />
          </Field>
          <button className="btn-primary w-full" disabled={busy || code.length < 6}>
            {busy ? t("working") : t("codeVerify")}
          </button>
          <button
            type="button"
            className="btn-secondary w-full"
            disabled={busy || cooldown > 0}
            onClick={() => void sendCode()}
          >
            {cooldown > 0 ? t("codeResendIn", { s: cooldown }) : t("codeResend")}
          </button>
        </form>
        <p className="mt-4 text-center text-sm">
          <button type="button" className="text-accent hover:underline" onClick={() => setMode("email")}>
            {t("changeEmail")}
          </button>
        </p>
        <p className="mt-2 text-center text-sm">
          <button type="button" className="text-accent hover:underline" onClick={() => setMode("password")}>
            {t("usePassword")}
          </button>
        </p>
      </>
    );
  } else if (mode === "password") {
    door = (
      <>
        {/* no logo on the gate (user ruling): the title carries the identity */}
        <h1 className="h-page mb-5">{t("signInTitle")}</h1>
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
          <button className="btn-primary w-full" disabled={busy || !email || !password}>
            {busy ? t("working") : t("signIn")}
          </button>
        </form>
        {/* The recovery link has a page behind it. It was advertised here
            with nothing built, which is worse than not offering it: someone
            who has lost their password stops looking for another way. */}
        <p className="mt-4 text-center text-sm">
          <Link href="/forgot" className="text-accent hover:underline">
            {tPassword("forgotTitle")}
          </Link>
        </p>
        <p className="mt-2 text-center text-sm">
          <button type="button" className="text-accent hover:underline" onClick={() => setMode("email")}>
            {t("useCode")}
          </button>
        </p>
      </>
    );
  } else if (mode === "sso") {
    door = (
      <>
        <h1 className="h-page">{t("ssoTitle")}</h1>
        <p className="mt-2 text-sm leading-7 text-fg-muted">{t("ssoLead")}</p>
        <form className="mt-4 space-y-4" onSubmit={startSso}>
          <Field label={t("ssoEmail")}>
            <input
              className="input"
              dir="ltr"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              autoFocus
            />
          </Field>
          <button className="btn-primary w-full" disabled={busy || !email}>
            {busy ? t("working") : t("ssoContinue")}
          </button>
        </form>
        <p className="mt-4 text-center text-sm">
          <button type="button" className="text-accent hover:underline" onClick={() => setMode("email")}>
            {t("ssoBack")}
          </button>
        </p>
      </>
    );
  } else {
    door = (
      <>
        {/* no logo on the gate (user ruling): the title carries the identity */}
        <h1 className="h-page">{t("emailTitle")}</h1>
        {/* ARRIVAL — a stranger's first screen says what the one press does */}
        <p className="mt-2 text-sm leading-7 text-fg-muted">{t("emailLead")}</p>
        {/* THE FOUR DOORS, then «یا», then the address — the reference's own
            order (user, 2026-09-16) */}
        <div className="mt-5">
          <OAuthButtons onSso={() => setMode("sso")} />
        </div>
        <div className="my-4 flex items-center gap-3 text-detail text-fg-subtle" aria-hidden>
          <span className="h-px flex-1 bg-border" />
          {t("orDivider")}
          <span className="h-px flex-1 bg-border" />
        </div>
        <form className="space-y-4" onSubmit={sendCode}>
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
          <button className="btn-primary w-full" disabled={busy || !email}>
            {busy ? t("working") : t("emailContinue")}
          </button>
        </form>
        {/* «already signed up» — the password path, one link away, for
            everyone who has one */}
        <p className="mt-4 text-center text-sm">
          <button type="button" className="text-accent hover:underline" onClick={() => setMode("password")}>
            {t("havePassword")}
          </button>
        </p>
      </>
    );
  }

  return (
    /*
     * THE SPLIT. `dir="ltr"` on the grid pins the PHYSICAL order — demo left,
     * door right — in both locales ("a login on the right side always"); each
     * half restores the page's own direction inside itself so the Persian
     * form still reads right-to-left. `items-stretch` gives the demo the
     * door's height, so the two read as one panel rather than a card beside
     * a taller poster.
     */
    <div dir="ltr" className="mx-auto grid w-full max-w-6xl items-stretch gap-6 lg:grid-cols-2">
      <div dir={dir} className="order-2 lg:order-1">
        <DemoPanel />
      </div>
      <div dir={dir} className="order-1 flex items-center justify-center lg:order-2">
        <Card className="w-full max-w-md">{door}</Card>
      </div>
    </div>
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
