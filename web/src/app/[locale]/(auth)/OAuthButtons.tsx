"use client";

import { useTranslations } from "next-intl";

/**
 * The provider buttons — REAL ones. This screen's history demands the note:
 * the original mock form shipped a Google button that pushed a route and
 * authenticated nobody, and it was removed under the no-dead-buttons rule.
 * These return only now that both providers are enabled in the Supabase
 * project and the PKCE routes behind them are live.
 *
 * Plain <a>, not the locale-aware Link: these navigate to BFF routes that
 * leave the app entirely — a locale prefix would 404 them.
 */
export function OAuthButtons() {
  const t = useTranslations("auth");
  return (
    <div>
      <div className="my-4 flex items-center gap-3 text-detail text-fg-subtle" aria-hidden>
        <span className="h-px flex-1 bg-border" />
        {t("orContinueWith")}
        <span className="h-px flex-1 bg-border" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <a href="/api/auth/oauth/google" className="btn-secondary text-sm">
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
            <path fill="#4285F4" d="M23.5 12.3c0-.9-.1-1.5-.3-2.2H12v4.1h6.5c-.1 1.1-.8 2.7-2.4 3.8l3.7 2.9c2.2-2.1 3.7-5.1 3.7-8.6z"/>
            <path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.7-2.9c-1 .7-2.4 1.2-4.2 1.2-3.2 0-6-2.2-6.9-5.2H1.3v3C3.3 21.2 7.3 24 12 24z"/>
            <path fill="#FBBC05" d="M5.1 14.2c-.2-.7-.4-1.4-.4-2.2s.1-1.5.4-2.2v-3H1.3C.5 8.4 0 10.1 0 12s.5 3.6 1.3 5.2l3.8-3z"/>
            <path fill="#EA4335" d="M12 4.6c2.3 0 3.8 1 4.7 1.8l3.3-3.2C18 1.2 15.2 0 12 0 7.3 0 3.3 2.8 1.3 6.8l3.8 3c.9-3 3.7-5.2 6.9-5.2z"/>
          </svg>
          Google
        </a>
        <a href="/api/auth/oauth/github" className="btn-secondary text-sm">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M12 .5C5.6.5.5 5.6.5 12c0 5.1 3.3 9.4 7.9 10.9.6.1.8-.2.8-.6v-2c-3.2.7-3.9-1.4-3.9-1.4-.5-1.3-1.3-1.7-1.3-1.7-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.7 1.3 3.4 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.4-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.2 1.2a11 11 0 0 1 5.8 0C17 4.6 18 4.9 18 4.9c.6 1.6.2 2.8.1 3.1.7.8 1.2 1.8 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.2c0 .3.2.7.8.6 4.6-1.5 7.9-5.8 7.9-10.9C23.5 5.6 18.4.5 12 .5z"/>
          </svg>
          GitHub
        </a>
      </div>
    </div>
  );
}
