import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { Card } from "@/components/ui";
import { IconWarn } from "@/components/icons";

/**
 * The org-suspended wall — **the screen whose strings existed for weeks with
 * nothing to render them.**
 *
 * `suspendedTitle`, `suspendedBody` and `suspendedContact` were written,
 * translated and reachable by nothing: core/ has always been able to answer
 * `403 kind:"suspended"`, and every client collapsed it into "forbidden" or an
 * unhandled rejection. A copy key with no screen is the mirror of a screen
 * with no data — both look finished from the side you happen to be looking at.
 *
 * It is deliberately NOT the pending screen with different words. The two
 * differ in who can help:
 *
 *   pending    → an admin in your organisation can accept you
 *   suspended  → your organisation is switched off; no admin there can undo
 *                it, and telling them to ask one would send them to someone
 *                guaranteed to fail
 *
 * So this offers support, not patience, and it does not invite a retry: a
 * suspension does not lift because you signed in again.
 */
export default function SuspendedPage() {
  const t = useTranslations("auth");
  return (
    <Card>
      {/* audit finding, 2026-09-03: the mark was a ⛔ character in a
          rounded-full well — an emoji doing icon work, which is the exact
          drift icons.tsx exists to end (a text glyph shares none of the
          set's stroke, weight or box, and paints in the OS emoji font in
          both themes, ignoring the tone beside it). This is the platform's
          own 40px well instead — the spelling Meetings and AgentEditor
          already use — carrying a set icon at 16. The tone stays `danger`:
          pending waits in warning, a suspension is a stop. Decorative, so
          aria-hidden — the heading under it is what says this. */}
      <span
        className="mb-4 grid h-10 w-10 place-items-center rounded-xl bg-danger/15 text-danger"
        aria-hidden
      >
        <IconWarn width={16} height={16} />
      </span>
      <h1 className="text-lg font-bold text-fg">{t("suspendedTitle")}</h1>
      <p className="mt-2 text-sm leading-7 text-fg-muted">{t("suspendedBody")}</p>
      <a href="mailto:support@neurai.example" className="btn-primary mt-5 w-full">
        {t("suspendedContact")}
      </a>
      <Link href="/sign-in" className="btn-secondary mt-2 w-full">
        {t("backToSignIn")}
      </Link>
    </Card>
  );
}
