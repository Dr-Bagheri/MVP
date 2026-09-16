import { defineRouting } from "next-intl/routing";
import { createNavigation } from "next-intl/navigation";

/**
 * PERSIAN IS THE DEFAULT locale (user ruling, 2026-09-16: "the default
 * language is persian") — REVERSING the 2026-08-16 ruling that made English
 * the default, recorded as a reversal rather than quietly flipped. A bare
 * URL and the gate land on /fa.
 *
 * `localeDetection: false` is the half that makes "default" TRUE: with
 * detection on, next-intl reads the browser's Accept-Language and sends an
 * English-configured browser to /en before the person has chosen anything —
 * a default that only applies to browsers already set to Persian is not a
 * default. The choice is made in Settings · General and travels in the URL
 * prefix, which every internal link carries.
 */
export const routing = defineRouting({
  locales: ["fa", "en"],
  defaultLocale: "fa",
  localeDetection: false,
});

export type Locale = (typeof routing.locales)[number];

export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);

export function dirFor(locale: string): "rtl" | "ltr" {
  return locale === "fa" ? "rtl" : "ltr";
}
