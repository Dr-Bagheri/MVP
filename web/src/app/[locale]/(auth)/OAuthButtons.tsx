"use client";

import { useTranslations } from "next-intl";
import { IconKey } from "@/components/icons";

/**
 * THE FOUR DOORS (user directive, 2026-09-16: "options that you can connect
 * with these 4 or email") — Google, Apple, Microsoft, SSO — the reference's
 * own stack of outlined buttons, the mark at the start and the sentence
 * beside it.
 *
 * DRAWN WHETHER OR NOT THE PROVIDER IS CONFIGURED, and that is a decision
 * with its reason: the directive is about what the page OFFERS. What keeps
 * it honest is that a press on a door the operator has not switched on
 * (db/0225: every one but Google arrives OFF) answers with the platform's
 * own sentence — `/api/auth/oauth/:provider` reads the switch and comes back
 * with `?oauth=disabled`, and `/api/auth/sso` answers `disabled` — never
 * with a provider's raw error page. The switch lives in Settings · Sign-in
 * methods; the operator flips it after configuring the provider in the
 * Supabase project (docs/ONBOARDING.md §7). Until then the door says so.
 *
 * This component no longer asks `/api/auth-methods` before drawing: a stack
 * that appears half a second after the page is a stack somebody watches
 * arrive, and the answer to "which are on" is given on the press.
 *
 * Plain <a> for the three OAuth doors, not the locale-aware Link: they
 * navigate to BFF routes that leave the app entirely — a locale prefix would
 * 404 them. SSO is a BUTTON: it needs the person's work email first, so it
 * hands the page its own small form (`onSso`).
 *
 * GitHub is not drawn (the directive named four); its route and its switch
 * stay for whoever holds a bookmark.
 */
export function OAuthButtons({ onSso }: { onSso: () => void }) {
  const t = useTranslations("auth");
  const door = "btn-secondary w-full justify-center gap-2";
  return (
    <div className="grid gap-2">
      <a href="/api/auth/oauth/google" className={door}>
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
          <path fill="#4285F4" d="M23.5 12.3c0-.9-.1-1.5-.3-2.2H12v4.1h6.5c-.1 1.1-.8 2.7-2.4 3.8l3.7 2.9c2.2-2.1 3.7-5.1 3.7-8.6z"/>
          <path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.7-2.9c-1 .7-2.4 1.2-4.2 1.2-3.2 0-6-2.2-6.9-5.2H1.3v3C3.3 21.2 7.3 24 12 24z"/>
          <path fill="#FBBC05" d="M5.1 14.2c-.2-.7-.4-1.4-.4-2.2s.1-1.5.4-2.2v-3H1.3C.5 8.4 0 10.1 0 12s.5 3.6 1.3 5.2l3.8-3z"/>
          <path fill="#EA4335" d="M12 4.6c2.3 0 3.8 1 4.7 1.8l3.3-3.2C18 1.2 15.2 0 12 0 7.3 0 3.3 2.8 1.3 6.8l3.8 3c.9-3 3.7-5.2 6.9-5.2z"/>
        </svg>
        {t("google")}
      </a>
      <a href="/api/auth/oauth/apple" className={door}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M16.4 12.7c0-2.4 2-3.6 2.1-3.7-1.1-1.7-2.9-1.9-3.5-1.9-1.5-.2-2.9.9-3.7.9-.8 0-1.9-.9-3.2-.8-1.6 0-3.1 1-4 2.4-1.7 3-.4 7.3 1.2 9.7.8 1.2 1.8 2.5 3 2.4 1.2 0 1.7-.8 3.2-.8s1.9.8 3.2.8c1.3 0 2.2-1.2 3-2.4.9-1.4 1.3-2.7 1.3-2.8 0 0-2.6-1-2.6-3.8zM14 5.5c.7-.8 1.1-2 1-3.1-1 0-2.2.7-2.9 1.5-.6.7-1.2 1.9-1 3 1.1.1 2.2-.6 2.9-1.4z"/>
        </svg>
        {t("providerApple")}
      </a>
      <a href="/api/auth/oauth/azure" className={door}>
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
          <rect x="1" y="1" width="10" height="10" fill="#F25022"/>
          <rect x="13" y="1" width="10" height="10" fill="#7FBA00"/>
          <rect x="1" y="13" width="10" height="10" fill="#00A4EF"/>
          <rect x="13" y="13" width="10" height="10" fill="#FFB900"/>
        </svg>
        {t("providerMicrosoft")}
      </a>
      <button type="button" onClick={onSso} className={door}>
        <IconKey width={16} height={16} />
        {t("providerSso")}
      </button>
    </div>
  );
}
