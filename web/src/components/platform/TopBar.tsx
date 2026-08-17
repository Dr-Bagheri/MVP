"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/routing";
import type { User } from "@/api/types";
import { AvatarMenu } from "./AvatarMenu";
import { formatDate } from "@/lib/format";
import { useTimezonePreference } from "@/lib/usePreferences";
import { Breadcrumbs } from "./Breadcrumbs";
import { SearchIcon } from "./icons";

/**
 * The platform top bar (M22): en/fa switcher · global search · avatar.
 *
 * Search moved here from the side menu by user directive — it is global, not a
 * destination among destinations.
 *
 * At 375 three controls plus breathing room do not fit, so the locale switcher
 * folds into the avatar menu (it is a set-once-a-year control) and search
 * collapses to its icon. Both are visible from `md` up.
 */
/**
 * Today's date and the current time, in the bar (user directive). The date
 * follows the CALENDAR preference through the same `formatDate` every other
 * date uses (one formatter, one truth); the time follows the timezone
 * preference. Rendered only after mount: the server has neither the
 * viewer's clock nor their preference, and a hydration mismatch here would
 * be a nightly flicker.
 */
function Clock() {
  const locale = useLocale();
  const timezone = useTimezonePreference();
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);
  if (now === null) return null;
  const time = new Intl.DateTimeFormat(locale === "fa" ? "fa-IR" : "en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    ...(timezone === "auto" ? {} : { timeZone: timezone }),
  }).format(now);
  return (
    <span className="hidden shrink-0 items-center gap-1.5 text-xs text-fg-muted lg:flex">
      <span>{formatDate(now.toISOString(), locale)}</span>
      <span aria-hidden>·</span>
      <span>{time}</span>
    </span>
  );
}

export function TopBar({ me }: { me: User | null }) {
  const t = useTranslations("platform");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  /*
   * Switching locale re-renders the SAME route under the other prefix, so the
   * user stays where they were. Sending them home on a language change would
   * lose their place for a preference toggle.
   */
  const switchTo = (next: "fa" | "en") => router.replace(pathname, { locale: next });

  return (
    <header className="flex items-center gap-2 border-b border-border bg-surface px-4 py-2.5">
      <AvatarMenu me={me} />

      {/* the trail takes the free space rather than a fixed slot: it is the
          only element here whose width is content, and it must be able to
          truncate rather than push the controls off the bar */}
      <Breadcrumbs />

      {/* the spacer stays a separate element: the trail renders NOTHING on the
          hub, and giving it the flex-1 would let the controls slide to the
          start on exactly the screen whose layout the user signed off */}
      <div className="flex-1" />

      {/* Conversations moved UNDER the hub's prompt box (user directive,
          round 2) — the bar carries no twin of it. */}

      <Clock />

      <button
        type="button"
        /* it LOOKED like a search box and did nothing — the missing onClick
           was the whole "search does not work" report */
        onClick={() => router.push("/search")}
        className="tap flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm text-fg-muted transition-colors hover:text-fg"
      >
        <SearchIcon width={17} height={17} />
        <span className="hidden md:inline">{t("search")}</span>
      </button>

      <div className="hidden overflow-hidden rounded-lg border border-border md:flex">
        {(["fa", "en"] as const).map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => switchTo(l)}
            aria-current={l === locale ? "true" : undefined}
            className={`h-9 px-3 text-xs transition-colors ${
              l === locale
                ? "bg-accent-soft font-semibold text-accent"
                : "bg-surface text-fg-muted hover:text-fg"
            }`}
          >
            {l}
          </button>
        ))}
      </div>
    </header>
  );
}
