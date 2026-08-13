"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { Org, User } from "@/api/types";

/**
 * The organization's own settings — name and interface locale (M25).
 *
 * ── What it deliberately does not include ───────────────────────────────────
 *
 * **The model allow-list**, even though `PATCH /v1/admin/org` accepts
 * `allowed_models` and this form could send it. Curation already has a home at
 * Management · Models, and Settings' own rule is that a feature living
 * elsewhere gets linked, never duplicated: two homes for one setting is two
 * states that will eventually disagree, and the disagreement surfaces as an
 * admin turning a model on in one place and finding it off in the other.
 *
 * **`status`.** It is on `OrgRecord` and it is read-only by core's own
 * comment. Org status is vendor-only at the database guard (D27), because a
 * transition that removes the actor's power to reverse it needs its exit built
 * with its entrance — an admin suspending their own org could not then
 * un-suspend it. If this form ever shows status, it shows it disabled with the
 * reason; never as a control.
 *
 * ── The patch rule, and why it is comparison rather than touched-ness ───────
 *
 * Only fields whose value DIFFERS from the loaded row are sent. That is FE1's
 * shape from the profile form, adopted rather than re-derived, and the insight
 * is worth restating: **emptiness is not the signal — difference from the
 * saved value is.** A form that infers intent from an empty input cannot tell
 * "I cleared this" from "I never touched it", because in the DOM those are the
 * same thing.
 *
 * Comparison buys three properties a `touched` set does not: typing a value
 * and reverting it sends nothing; a stale load cannot overwrite a field
 * somebody else changed meanwhile, because only this person's actual edits
 * travel; and an unchanged field never produces a no-op write that would show
 * up in the audit trail as an org update that changed nothing.
 *
 * **`null` is NOT part of this contract, and that is the opposite of
 * `PATCH /v1/me`.** Core updates these columns with
 * `coalesce($2::text, name)` and they are NOT NULL — so null already means
 * "leave alone" and there is no clear operation to express. A nullable field
 * here would be a second spelling of omission. On the profile form null DOES
 * clear, because those columns are nullable and "I have no Latin name" is a
 * real state. Same-shaped API, opposite answer, and neither can be inferred
 * from the other — which is exactly why it was worth asking rather than
 * pattern-matching.
 */

/**
 * The product's interface locales — what this form OFFERS, which is not the
 * set core will accept.
 *
 * `PATCH /v1/admin/org` validates by SHAPE
 * (`/^[a-z]{2}(-[A-Za-z0-9]{2,8})?$/`), so `fa-IR` and `en-GB` are legal
 * stored values that an admin can set through the api today. B1 declined to
 * narrow that deliberately: the product is two languages now and a third
 * should not need a change in a file with no opinion about languages.
 *
 * Which makes the widening this form's to absorb — see `localeOptions`.
 */
const LOCALES = ["fa", "en"] as const;

/**
 * The offered locales, plus the stored one when it is not among them.
 *
 * **A `<select>` whose value matches no option does not render that value** —
 * it shows blank or the first option. So an org set to `fa-IR` would display
 * as Persian, and the screen would be claiming a locale the organization does
 * not have, with nothing to suggest otherwise.
 *
 * The stored value is therefore always present as an option, labelled as
 * itself. That is the honest rendering: the admin sees what the row actually
 * holds, can move it to an offered locale deliberately, and nothing is
 * normalised behind their back.
 *
 * The data was never at risk — the patch sends only fields that DIFFER from
 * the loaded row, so an untouched locale produces no key at all. This is a
 * display fix, and the distinction is worth keeping: a silent substitution on
 * screen is a lie about the record even when the record survives it.
 */
const localeOptions = (stored: string): readonly string[] =>
  (LOCALES as readonly string[]).includes(stored) ? LOCALES : [stored, ...LOCALES];

export function OrgFields() {
  const t = useTranslations("settings");
  const tAdmin = useTranslations("admin");

  const [me, setMe] = useState<User | null>(null);
  const [org, setOrg] = useState<Org | null>(null);
  const [name, setName] = useState("");
  const [locale, setLocale] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);

  const isAdmin = me?.role === "admin" || me?.role === "owner";

  useEffect(() => {
    void api.me().then(setMe);
    void api.org().then((row) => {
      setOrg(row);
      setName(row.name);
      setLocale(row.locale);
    });
  }, []);

  /**
   * The patch: only what actually differs from the loaded row.
   *
   * `name` is trimmed before comparison because core trims it too and refuses
   * an empty one — comparing untrimmed would make trailing whitespace look
   * like an edit and produce a save that reports success while nothing moves.
   * Compare in the server's terms, or the comparison is about a different
   * value than the one being stored.
   */
  const patch = (): { name?: string; locale?: string } => {
    if (!org) return {};
    const next: { name?: string; locale?: string } = {};
    const trimmed = name.trim();
    if (trimmed !== org.name) next.name = trimmed;
    if (locale !== org.locale) next.locale = locale;
    return next;
  };

  const changes = patch();
  const nothingToSave = Object.keys(changes).length === 0;
  /* An empty name is refused rather than sent: core rejects it, and a
     disabled button explains itself where a 400 does not. */
  const invalid = name.trim() === "";

  const save = async () => {
    setBusy(true);
    setFailed(false);
    setSaved(false);
    try {
      const updated = await api.updateOrg(changes);
      setOrg(updated);
      setName(updated.name);
      setLocale(updated.locale);
      setSaved(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  if (!org) return null;

  /*
   * A member sees the values and no controls. The READ is open to any active
   * member — core serves it at `/v1/org` precisely so the shell can show the
   * org name — while the write is admin-gated, so hiding the values entirely
   * would withhold something they are allowed to see in order to express a
   * restriction on something else.
   */
  if (me !== null && !isAdmin) {
    return (
      <div>
        <h3 className="mb-1 text-sm font-semibold text-fg">{t("orgTitle")}</h3>
        <dl className="mb-2 space-y-2 text-sm">
          <div>
            <dt className="text-xs text-fg-muted">{tAdmin("orgName")}</dt>
            <dd className="text-fg">{org.name}</dd>
          </div>
          <div>
            <dt className="text-xs text-fg-muted">{t("orgLocale")}</dt>
            <dd className="text-fg">{t(`orgLocale_${org.locale === "en" ? "en" : "fa"}`)}</dd>
          </div>
        </dl>
        <p className="text-xs leading-6 text-fg-muted">{t("orgAdminOnly")}</p>
      </div>
    );
  }

  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold text-fg">{t("orgTitle")}</h3>

      <label className="mb-3 block">
        <span className="mb-1 block text-xs text-fg-muted">{tAdmin("orgName")}</span>
        <input
          className="input"
          value={name}
          disabled={busy}
          onChange={(event) => {
            setName(event.target.value);
            setSaved(false);
          }}
        />
      </label>

      <label className="mb-4 block">
        <span className="mb-1 block text-xs text-fg-muted">{t("orgLocale")}</span>
        <select
          className="input h-11 min-h-0 w-auto py-0 text-sm md:h-10"
          value={locale}
          disabled={busy}
          onChange={(event) => {
            setLocale(event.target.value);
            setSaved(false);
          }}
        >
          {localeOptions(org.locale).map((value) => (
            <option key={value} value={value}>
              {/* an unrecognised locale is labelled as ITSELF — we have no
                  name for it, and inventing one would be the substitution
                  this option exists to prevent */}
              {value === "fa" || value === "en" ? t(`orgLocale_${value}`) : value}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-xs text-fg-muted">{t("orgLocaleHint")}</span>
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button
          className="btn-primary h-10 min-h-0 px-4 text-sm"
          /* Disabled when there is nothing to send: core answers an empty
             patch with a 400, and showing someone an error for changing their
             mind back is a worse answer than a button that stays quiet. */
          disabled={busy || nothingToSave || invalid}
          onClick={() => void save()}
        >
          {t("orgSave")}
        </button>
        {saved ? <span className="text-xs text-success">{t("orgSaved")}</span> : null}
        {failed ? <span className="text-xs text-danger">{t("orgSaveFailed")}</span> : null}
      </div>
    </div>
  );
}
