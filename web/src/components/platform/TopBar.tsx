"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname, useRouter } from "@/i18n/routing";
import { api } from "@/api/client";
import type { AssistantSession, User } from "@/api/types";
import { AvatarMenu } from "./AvatarMenu";
import { formatDate } from "@/lib/format";
import { Breadcrumbs } from "./Breadcrumbs";
import { HistoryIcon, SearchIcon } from "./icons";

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
export function TopBar({ me }: { me: User | null }) {
  const t = useTranslations("platform");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [historyOpen, setHistoryOpen] = useState(false);
  /** `null` = not fetched yet; `[]` = fetched and genuinely empty. */
  const [sessions, setSessions] = useState<AssistantSession[] | null>(null);

  useEffect(() => {
    if (!historyOpen || sessions !== null) return;
    // fetched on first open rather than on mount: most visits never ask for it
    void api.agentSessions().then(setSessions);
  }, [historyOpen, sessions]);

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

      {/*
        Conversation history lives HERE rather than in a permanent sidebar
        (M22): a session list is empty for every new org, so as fixed chrome it
        would cost the first impression to earn nothing. As a top-bar control it
        appears only when someone reaches for it.
      */}
      <div className="relative">
        <button
          type="button"
          className="tap flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm text-fg-muted transition-colors hover:text-fg"
          aria-haspopup="menu"
          aria-expanded={historyOpen}
          onClick={() => setHistoryOpen((v) => !v)}
        >
          <HistoryIcon width={17} height={17} />
          <span className="hidden md:inline">{t("conversations")}</span>
        </button>
        {historyOpen ? (
          <div
            role="menu"
            className="absolute top-11 z-30 w-72 rounded-xl border border-border bg-surface p-1.5 shadow-lg"
            style={{ insetInlineEnd: 0 }}
          >
            {sessions === null ? null : sessions.length === 0 ? (
              /* an honest empty state, not a hidden control: "no conversations
                 yet" is a fact, and hiding the menu would make it a mystery */
              <p className="px-3 py-3 text-sm text-fg-muted">{t("noConversations")}</p>
            ) : (
              sessions.map((s) => (
                <Link
                  key={s.id}
                  href={`/?c=${s.id}`}
                  role="menuitem"
                  className="block rounded-lg px-3 py-2 hover:bg-surface-2"
                  onClick={() => setHistoryOpen(false)}
                >
                  {/* the title is SERVER-derived from the first question and is
                      never rewritten here — re-deriving it would give the same
                      conversation two names */}
                  <span className="block truncate text-sm text-fg">
                    {s.title ?? t("untitledConversation")}
                  </span>
                  <span className="block text-xs text-fg-muted">
                    {formatDate(s.updated_at, locale)}
                  </span>
                </Link>
              ))
            )}
          </div>
        ) : null}
      </div>

      <button
        type="button"
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
