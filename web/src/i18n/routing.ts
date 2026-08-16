import { defineRouting } from "next-intl/routing";
import { createNavigation } from "next-intl/navigation";

/**
 * English is the DEFAULT locale (user ruling, 2026-08-16): a bare URL and
 * the gate land on /en. Persian stays a first-class locale — RTL, digits,
 * calendars all intact — it is simply chosen, not assumed.
 */
export const routing = defineRouting({
  locales: ["fa", "en"],
  defaultLocale: "en",
});

export type Locale = (typeof routing.locales)[number];

export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);

export function dirFor(locale: string): "rtl" | "ltr" {
  return locale === "fa" ? "rtl" : "ltr";
}
