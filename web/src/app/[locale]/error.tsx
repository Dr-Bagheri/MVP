"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";

/**
 * The locale segment's error boundary — what renders when a CLIENT crash
 * happens anywhere in the app.
 *
 * Before this file existed, that was Next's raw black "Application error: a
 * client-side exception has occurred" page (seen live, 2026-08-17): no
 * theme, no words in the person's language, no way forward but devtools.
 * A crash is already the product failing; the screen about it must not
 * fail twice.
 *
 * The digest/message goes to the console only — an error string can quote
 * anything the crashing component held, and the screen is not the place
 * for it.
 */
export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errorPage");

  useEffect(() => {
    // the one place the detail belongs: where whoever debugs is looking
    console.error("client crash", error.digest ?? error.message);
  }, [error]);

  return (
    <div className="grid min-h-screen place-items-center bg-bg p-6">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 text-center">
        <h1 className="text-lg font-bold text-fg">{t("title")}</h1>
        <p className="mt-2 text-sm leading-7 text-fg-muted">{t("body")}</p>
        <div className="mt-5 flex justify-center gap-2">
          <button type="button" className="btn-primary" onClick={reset}>
            {t("retry")}
          </button>
          <a href="/" className="btn-secondary">
            {t("home")}
          </a>
        </div>
      </div>
    </div>
  );
}
