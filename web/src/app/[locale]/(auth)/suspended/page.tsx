import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { Card } from "@/components/ui";

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
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-danger/15 text-danger">
        ⛔
      </div>
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
