import { defineRouting } from "next-intl/routing";
import { createNavigation } from "next-intl/navigation";

/** fa is the default locale and the product's primary language (M9/M6). */
export const routing = defineRouting({
  locales: ["fa", "en"],
  defaultLocale: "fa",
});

export type Locale = (typeof routing.locales)[number];

export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);

export function dirFor(locale: string): "rtl" | "ltr" {
  return locale === "fa" ? "rtl" : "ltr";
}
