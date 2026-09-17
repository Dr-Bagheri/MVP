"use client";

import { Suspense, useEffect } from "react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/routing";
import { IconCheck, IconMoon, IconSun } from "@/components/icons";
import { readStoredTheme, storeTheme } from "@/lib/theme";
import { useTheme } from "@/lib/useTheme";
import { digits } from "@/lib/format";
import { STAGES, STEP_STAGE, progress, type StepId } from "./steps";

/** Public/onboarding counterpart of TopBar: the same chrome and controls,
 * without authenticated search, notifications, or doors out of the flow. */
export function EntryTopBar({ step }: { step?: StepId }) {
  const t = useTranslations("entryChrome");
  const onboarding = useTranslations("onboarding");
  const locale = useLocale();
  const theme = useTheme();
  // A locale navigation replaces <html>; its pre-paint script is inert on
  // client navigation. Reapply the SAME stored preference to that new root.
  useEffect(() => { storeTheme(readStoredTheme()); }, [locale]);
  const stage = step ? STEP_STAGE[step] : null;
  const reached = stage ? STAGES.indexOf(stage) : -1;
  const nextTheme = theme === "light" ? "dark" : "light";
  return (
    <header className="glass-chrome sticky top-0 z-40 shrink-0 text-fg" data-entry-topbar>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-4 md:px-6 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <div className="order-1 flex h-topbar min-w-0 items-center gap-2.5">
          <span className="shrink-0" aria-hidden>
            <Image src="/brand/neurai-mark.png" alt="" width={24} height={24} priority className="neurai-mark-dark h-6 w-6 object-contain" />
            <Image src="/brand/neurai-mark-light-transparent.png" alt="" width={24} height={24} priority className="neurai-mark-light h-6 w-6 object-contain" />
          </span>
          <span className="truncate text-sm font-semibold">{t("brand")}</span>
        </div>

        {step ? (
          <nav className="order-3 col-span-2 min-w-0 pb-3 lg:order-2 lg:col-span-1 lg:pb-0" aria-label={onboarding("progress")}>
            <ol className="flex min-w-0 items-center justify-between gap-1 lg:gap-4">
              {STAGES.map((item, index) => (
                <li key={item} aria-current={item === stage ? "step" : undefined}
                  className={`flex min-w-0 flex-1 flex-col items-center gap-1 text-center text-xs font-semibold lg:flex-initial lg:flex-row lg:gap-2 ${index === reached ? "text-accent" : index < reached ? "text-fg" : "text-fg-subtle"}`}>
                  <span aria-hidden className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs ${index <= reached ? "bg-accent-soft text-accent" : "bg-surface-2 text-fg-subtle"}`}>
                    {index < reached ? <IconCheck width={12} height={12} /> : digits(index + 1, locale)}
                  </span>
                  <span className="whitespace-nowrap">{onboarding(`stage_${item}`)}</span>
                </li>
              ))}
            </ol>
          </nav>
        ) : <span className="order-2 hidden text-xs text-fg-muted lg:block">{t("welcome")}</span>}

        <div className="order-2 flex h-topbar shrink-0 items-center gap-2 justify-self-end lg:order-3">
          <button type="button" className="btn-ghost btn-icon-sm glass-raised"
            onClick={() => storeTheme(nextTheme)} aria-label={t(`switchTo_${nextTheme}`)} title={t(`switchTo_${nextTheme}`)}>
            {theme === "dark" ? <IconSun width={16} height={16} /> : <IconMoon width={16} height={16} />}
          </button>
          <span aria-hidden className="h-4 w-px bg-border" />
          <Suspense fallback={<span className="text-xs text-fg-muted" aria-hidden>فارسی / EN</span>}>
            <EntryLanguages />
          </Suspense>
        </div>
      </div>
      {step && <div className="h-0.5 bg-surface-2" role="progressbar" aria-label={onboarding("progress")}
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress(step) * 100)}>
        <div className="h-full bg-accent transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${progress(step) * 100}%` }} />
      </div>}
    </header>
  );
}

function EntryLanguages() {
  const t = useTranslations("entryChrome");
  const locale = useLocale();
  const pathname = usePathname();
  const query = useSearchParams()?.toString();
  const href = query ? `${pathname}?${query}` : pathname;
  return (
    <nav className="flex items-center gap-1" aria-label={t("language")}>
      {(["fa", "en"] as const).map((language) => (
        <Link key={language} href={href} locale={language} lang={language} hrefLang={language} scroll={false}
          aria-label={language === "fa" ? "فارسی" : "English"} aria-current={locale === language ? "true" : undefined}
          className={`btn btn-sm ${locale === language ? "glass-raised text-fg" : "btn-ghost text-fg-muted"}`}>
          {language === "fa" ? "فارسی" : "EN"}
        </Link>
      ))}
    </nav>
  );
}
