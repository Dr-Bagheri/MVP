"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useTranslations, useLocale } from "next-intl";
import { usePathname } from "next/navigation";
import { Link } from "@/i18n/routing";
import { AssistantPane } from "./AssistantPane";

const NAV = [
  { href: "/calls", key: "calls" },
  { href: "/capture", key: "capture" },
  { href: "/search", key: "search" },
  { href: "/skills", key: "skills" },
  { href: "/connectors", key: "connectors" },
  { href: "/admin", key: "admin" },
] as const;

export function AppShell({
  children,
  page,
  presetCallId,
}: {
  children: ReactNode;
  page: string;
  presetCallId?: string;
}) {
  const t = useTranslations("nav");
  const locale = useLocale();
  const pathname = usePathname();
  const [assistantOpen, setAssistantOpen] = useState(true);
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const stored = (localStorage.getItem("echo-theme") as "light" | "dark") ?? "light";
    setTheme(stored);
    document.documentElement.dataset.theme = stored;
  }, []);

  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem("echo-theme", next);
  }

  return (
    <div className="flex h-dvh bg-bg">
      {/* sidebar */}
      <nav className="hidden w-56 shrink-0 flex-col gap-1 border-e border-border bg-surface p-3 md:flex">
        <Link href="/calls" className="mb-4 flex items-center gap-2 px-2 py-1">
          <span className="grid h-8 w-8 place-items-center rounded-md bg-accent text-sm font-bold text-white">
            E
          </span>
          <span className="text-lg font-bold text-fg">
            {locale === "fa" ? "اکو" : "Echo"}
          </span>
        </Link>
        {NAV.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-md px-3 py-2 text-sm transition-colors ${
                active
                  ? "bg-accent-soft font-medium text-accent"
                  : "text-fg-muted hover:bg-surface-2 hover:text-fg"
              }`}
            >
              {t(item.key)}
            </Link>
          );
        })}
        <div className="flex-1" />
        <Link
          href="/profile"
          className="rounded-md px-3 py-2 text-sm text-fg-muted hover:bg-surface-2 hover:text-fg"
        >
          {t("profile")}
        </Link>
        <button
          className="rounded-md px-3 py-2 text-start text-sm text-fg-muted hover:bg-surface-2 hover:text-fg"
          onClick={toggleTheme}
        >
          {t("theme")}: {theme === "light" ? "☀" : "☾"}
        </button>
      </nav>

      {/* main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-border bg-surface px-5 py-3">
          <div className="flex items-center gap-2 md:hidden">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-accent text-xs font-bold text-white">
              E
            </span>
          </div>
          <div className="flex-1" />
          {!assistantOpen ? (
            <button className="btn-secondary h-9 min-h-0 px-3 text-xs" onClick={() => setAssistantOpen(true)}>
              {t("assistant")}
            </button>
          ) : null}
        </header>
        <main className="flex-1 overflow-y-auto p-5">{children}</main>
      </div>

      {/* dockable assistant — present on every screen */}
      <AssistantPane
        page={page}
        presetCallId={presetCallId}
        open={assistantOpen}
        onClose={() => setAssistantOpen(false)}
      />
    </div>
  );
}
