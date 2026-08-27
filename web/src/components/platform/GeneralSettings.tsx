"use client";

import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/routing";
import { FormPanel, FormRow, Section } from "@/components/scaffold";
import { storeTheme, type Theme } from "@/lib/theme";
import { useTheme } from "@/lib/useTheme";

/**
 * Settings · General (M25, anatomy M26): two scaffold Sections — preferences,
 * then the organization — each a FormPanel of label-start/control-end rows.
 *
 * **The panel is split by what is actually true, not by topic.**
 *
 * - **Preferences are REAL.** Language and the calendar/timezone pair are
 *   wire-backed on `PATCH /v1/me` and follow the person to their next device;
 *   the theme is a `data-theme` attribute plus one local store, deliberately,
 *   because it is a property of the screen you are looking at.
 * - **Organisation fields LEFT this screen** (user directive, 2026-08-26):
 *   who the organisation IS belongs to Management · General. Settings is
 *   where a person configures the product for themselves; one home each.
 *   The old note said `OrgFields` writes through
 *   `PATCH /v1/admin/org`. This line said "read-only for now, and the notice
 *   says so" after the notice had been deleted and the fields made live, i.e.
 *   the file's header contradicted its own body seventy lines down. Corrected
 *   rather than deleted, because a stale caveat is the failure this whole
 *   panel is a case study in: the amber notice below it was itself a
 *   description that outlived the thing it described.
 *
 * ---
 *
 * **A correction on the record, because the wrong version of it shipped here.**
 *
 * This header used to state: "`/v1/org` and `/v1/admin/org` do not exist — both
 * 404 for an authenticated admin". **The 404 was real and the conclusion was
 * wrong.** core/ registers `GET /v1/org` (any active member) and
 * `PATCH /v1/admin/org` (admin-gated), and deliberately does NOT register
 * `GET /v1/admin/org` — its own comment explains why: the read would return the
 * same row with the same columns as `/v1/org`. Our BFF asked for the one path
 * core never registered, got a truthful 404, and that became "the feature is
 * not built" in this file for weeks.
 *
 * **"No such route" and "no such feature" are different nothings**, and a 404
 * from our own BFF looks identical whichever it is. Found by FE3 reading core's
 * source rather than trusting the note.
 */
export function GeneralSettings() {
  const t = useTranslations("settings");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  /*
   * ONE state with the avatar menu's theme control (user directive). A local
   * `useState` here would go stale the moment the menu changed the theme while
   * this page was open — and then write its stale value back on the next
   * change.
   */
  const theme = useTheme();

  /*
   * No `api.org()` here: the org row moved to Management · General with the
   * form that edits it. (The older note read: `OrgFields` fetches its own row; keeping
   * a copy in this component would be two reads of one row on one screen, which
   * disagree for as long as either is in flight — and this panel had nothing
   * left to show from it.
   */

  return (
    <>
      <Section title={t("prefsTitle")}>
        <FormPanel>
          <FormRow label={t("language")} description={t("languageHint")} htmlFor="pref-language">
            <select
              id="pref-language"
              /* a replaced element: `.tap` draws nothing on it, so its VISUAL
                 height is its hit area — 44 below md, control height above */
              className="input min-h-0 h-11 md:h-control"
              value={locale}
              onChange={(e) => router.replace(pathname, { locale: e.target.value as "fa" | "en" })}
            >
              <option value="fa">فارسی</option>
              <option value="en">English</option>
            </select>
          </FormRow>
          <FormRow label={t("theme")} description={t("themeHint")} htmlFor="pref-theme">
            <select
              id="pref-theme"
              className="input min-h-0 h-11 md:h-control"
              value={theme}
              onChange={(e) => storeTheme(e.target.value as Theme)}
            >
              <option value="dark">{t("themeDark")}</option>
              <option value="light">{t("themeLight")}</option>
            </select>
          </FormRow>
        </FormPanel>
      </Section>
    </>
  );
}
