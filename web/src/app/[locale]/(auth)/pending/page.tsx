import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { Card } from "@/components/ui";

/**
 * The pending-until-accepted wall (M15/SPEC): nothing in the product is
 * reachable from here — no trial, no preview.
 */
export default function PendingPage() {
  const t = useTranslations("auth");
  return (
    <Card>
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-warning/15 text-warning">
        ⏳
      </div>
      <h1 className="text-lg font-bold text-fg">{t("pendingTitle")}</h1>
      <p className="mt-2 text-sm leading-7 text-fg-muted">{t("pendingBody")}</p>
      <p className="mt-3 rounded-md bg-surface-2 p-3 text-xs text-fg-muted">
        {t("pendingHint")}
      </p>
      <Link href="/sign-in" className="btn-secondary mt-5 w-full">
        {t("backToSignIn")}
      </Link>
    </Card>
  );
}
