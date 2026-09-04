"use client";

import { useEffect, useRef, useState } from "react";
import { Select } from "@/components/Select";
import { useTranslations } from "next-intl";
import { api } from "@/api/client";
import { notify } from "@/lib/notify";
import type { Org, User } from "@/api/types";
import { ConfirmDialog } from "@/components/rowActions";
import { Icon } from "@/components/icons";
import { FormPanel, FormRow, PanelFooter, Skeleton } from "@/components/scaffold";

/**
 * The organization's own settings — name, public face, interface locale
 * (M25, db/0102, db/0103).
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
  const tCommon = useTranslations("common");

  const [me, setMe] = useState<User | null>(null);
  /* NOT `me !== null`: a refused or failed identity read leaves `me` null for
     good, and a frame that waited on it would wait for ever. What is being
     waited for is the ANSWER, and "there is nobody" is one. */
  const [meAnswered, setMeAnswered] = useState(false);
  /** the logo removal awaiting the platform's are-you-sure (dialog at the foot) */
  const [confirmLogoRemove, setConfirmLogoRemove] = useState(false);
  const [org, setOrg] = useState<Org | null>(null);
  /*
   * Has the org row answered — and did it answer with a row (2026-09-03)?
   *
   * A boolean would fold two states together again: `api.org()` carried no
   * `.catch` at all, so a failed read left `org` null and the form's
   * `if (!org) return null` rendered NOTHING, for ever, with no sentence
   * anywhere saying why. That is the same shape as the loading defect one
   * step further on — the frame is missing and so is the reason.
   */
  const [orgAnswer, setOrgAnswer] = useState<"pending" | "ok" | "failed">("pending");
  const [name, setName] = useState("");
  const [locale, setLocale] = useState("");
  /* db/0102 — the organisation's public face. Held as strings because a
     form's empty box is a string; the patch turns "" into an explicit
     null, which is what CLEARS the column (absent would leave it). */
  const [publicEmail, setPublicEmail] = useState("");
  const [description, setDescription] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [location, setLocation] = useState("");
  /**
   * db/0103 — the logo is a FILE now, not an address, so it is not part of
   * the diff-based patch at all: bytes go up the moment one is chosen and
   * come down from their own route. `logoVersion` only busts the browser
   * cache — the URL cannot change when the image does, and without it a
   * fresh upload keeps showing the old picture.
   */
  const [hasLogo, setHasLogo] = useState(false);
  const [logoVersion, setLogoVersion] = useState(0);
  const [logoBusy, setLogoBusy] = useState(false);
  const logoInput = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);

  const isAdmin = me?.role === "admin" || me?.role === "owner";

  useEffect(() => {
    void api.me().then(setMe).catch(() => setMe(null)).finally(() => setMeAnswered(true));
    void api.org()
      .then((row) => {
        setOrg(row);
        setName(row.name);
        setLocale(row.locale);
        setPublicEmail(row.public_email ?? "");
        setDescription(row.description ?? "");
        setWebsiteUrl(row.website_url ?? "");
        setLocation(row.location ?? "");
        setHasLogo(row.has_logo === true);
        setOrgAnswer("ok");
      })
      .catch(() => setOrgAnswer("failed"));
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
  const patch = (): Record<string, unknown> => {
    if (!org) return {};
    const next: Record<string, unknown> = {};
    const trimmed = name.trim();
    if (trimmed !== org.name) next.name = trimmed;
    if (locale !== org.locale) next.locale = locale;
    /* each field sends only when it CHANGED, and sends null when emptied:
       "" and null are one state on the wire (not published), and the
       column's check refuses a blank so they cannot both exist */
    const face = [
      ["public_email", publicEmail, org.public_email],
      ["description", description, org.description],
      ["website_url", websiteUrl, org.website_url],
      ["location", location, org.location],
    ] as const;
    for (const [key, value, saved] of face) {
      const trimmed = value.trim();
      if (trimmed !== (saved ?? "")) {
        (next as Record<string, unknown>)[key] = trimmed === "" ? null : trimmed;
      }
    }
    return next;
  };

  const changes = patch();
  const nothingToSave = Object.keys(changes).length === 0;
  /* An empty name is refused rather than sent: core rejects it, and a
     disabled button explains itself where a 400 does not. */
  const invalid = name.trim() === "";

  /* the logo is NOT in `changes`: it saves on pick, not on Save. See
     pickLogo — an image with no visible draft state cannot honestly share
     a button with six text fields. */
  const save = async () => {
    setBusy(true);
    try {
      const updated = await api.updateOrg(changes as Parameters<typeof api.updateOrg>[0]);
      setOrg(updated);
      setName(updated.name);
      setLocale(updated.locale);
      setPublicEmail(updated.public_email ?? "");
      setDescription(updated.description ?? "");
      setWebsiteUrl(updated.website_url ?? "");
      setLocation(updated.location ?? "");
      setHasLogo(updated.has_logo === true);
      notify(t("orgSaved"));
    } catch {
      notify(t("orgSaveFailed"), "warn");
    } finally {
      setBusy(false);
    }
  };

  /**
   * Choosing a file IS the save — there is no draft state for an image, and
   * a picture sitting in a form waiting for a Save button that governs six
   * text fields is a state nobody can read off the screen.
   *
   * The `accept` filter is a convenience, not the check: a browser's
   * `file.type` comes from the extension and is a claim. Core decides from
   * the BYTES, and its refusal is the one that counts.
   */
  const pickLogo = async (file: File) => {
    setLogoBusy(true);
    try {
      await api.uploadOrgLogo(file);
      setHasLogo(true);
      setLogoVersion((v) => v + 1);
      notify(t("orgLogoSaved"));
    } catch {
      notify(t("orgLogoFailed"), "warn");
    } finally {
      setLogoBusy(false);
      /* clear the input so choosing the SAME file again still fires a
         change event — otherwise a failed upload cannot be retried */
      if (logoInput.current) logoInput.current.value = "";
    }
  };

  const removeLogo = async () => {
    setLogoBusy(true);
    try {
      await api.clearOrgLogo();
      setHasLogo(false);
      setLogoVersion((v) => v + 1);
      notify(t("orgLogoRemoved"));
    } catch {
      notify(t("orgLogoFailed"), "warn");
    } finally {
      setLogoBusy(false);
    }
  };

  /*
   * THE FRAME BEFORE THE DATA (user directive, 2026-09-03: "the skeleton
   * should apply for all sub pages in management and settings as well").
   *
   * `if (!org) return null` stood here, and it is the shape the platform's
   * loading rule was written against: the page's heading rendered from the
   * catalogue, then a gap, then a seven-row panel dropped in and pushed
   * everything below it down. Worse than the movement, "still asking" and
   * "this organization has nothing to show" were the same picture — and a
   * failed read was that picture for ever.
   *
   * A failure gets the sentence rather than the frame: a panel of empty boxes
   * under a heading invites someone to type into fields that will not save.
   */
  if (orgAnswer === "failed") {
    return <p className="text-sm leading-7 text-fg-muted">{t("orgUnreadable")}</p>;
  }

  /*
   * Waiting on BOTH reads, and the second one is not fussiness: the panel has
   * two shapes and `me` decides which. Rendering the editable one first would
   * show a member seven live inputs and then take them away — a claim about
   * their permissions, made before the answer, in the direction that flatters.
   *
   * The placeholder draws the ADMIN shape, which is the branch this screen
   * exists for; a member's shorter panel settles upward once. The labels do
   * NOT wait — they come from the message catalogue and never depended on the
   * network — so what stands in for each field is a bar in `.input`'s own
   * 40px, and the footer keeps the panel's bottom edge where it will be.
   */
  if (org === null || !meAnswered) {
    /* one element, reused: the fields are identical boxes, and naming the
       geometry once is the same argument as `.input` owning the height */
    const field = <Skeleton className="h-10 w-full" />;
    return (
      <FormPanel>
        <FormRow label={tAdmin("orgName")}>{field}</FormRow>
        <FormRow label={t("orgLogo")}>
          {/* the logo row is not a field: a 48px square and a button beside
              it, so a 40px bar here would reserve the wrong space and move
              the rows under it when the real control lands. Its HINT is not
              drawn as a bar — it is catalogue text about what the button
              accepts, true before any request and after every one, and the
              rule is that only what is being fetched waits. */}
          <span className="flex flex-col gap-2">
            <span className="flex items-center gap-3">
              <Skeleton className="h-12 w-12 rounded-lg" />
              <Skeleton className="h-8 w-28" />
            </span>
            <span className="text-[11px] leading-5 text-fg-subtle">{t("orgLogoHint")}</span>
          </span>
        </FormRow>
        <FormRow label={t("orgEmail")}>{field}</FormRow>
        <FormRow label={t("orgDescription")}>{field}</FormRow>
        <FormRow label={t("orgWebsite")}>{field}</FormRow>
        <FormRow label={t("orgLocation")}>{field}</FormRow>
        {/* the locale picker is `input w-auto` — a bar the field's full width
            would reserve a control twice the size of the one arriving */}
        <FormRow label={t("orgLocale")}><Skeleton className="h-10 w-40" /></FormRow>
        <PanelFooter>
          {/* disabled, and it stays disabled the instant the row lands —
              nothing has changed yet, so the control does not flicker */}
          <button className="btn-primary" disabled>
            {t("orgSave")}
          </button>
        </PanelFooter>
      </FormPanel>
    );
  }

  /*
   * A member sees the values and no controls. The READ is open to any active
   * member — core serves it at `/v1/org` precisely so the shell can show the
   * org name — while the write is admin-gated, so hiding the values entirely
   * would withhold something they are allowed to see in order to express a
   * restriction on something else. (The Section above this component is
   * supplied by the management/general page — one heading for both branches.)
   */
  if (me !== null && !isAdmin) {
    return (
      <>
        <FormPanel>
          <FormRow label={tAdmin("orgName")}>
            <span className="text-sm text-fg">{org.name}</span>
          </FormRow>
          <FormRow label={t("orgLocale")}>
            <span className="text-sm text-fg">
              {t(`orgLocale_${org.locale === "en" ? "en" : "fa"}`)}
            </span>
          </FormRow>
        </FormPanel>
        <p className="mt-2 text-detail leading-6 text-fg-muted">{t("orgAdminOnly")}</p>
      </>
    );
  }

  return (
    <>
    <FormPanel>
      <FormRow label={tAdmin("orgName")} htmlFor="org-name">
        <input
          id="org-name"
          className="input"
          value={name}
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
        />
      </FormRow>

      {/* db/0103 — an uploaded FILE. It was a link until this deployment
          grew an image path; the address input is gone rather than kept
          beside the picker, because two ways to set one logo is two states
          that will eventually disagree about which one is showing. */}
      <FormRow label={t("orgLogo")} htmlFor="org-logo">
        <span className="flex flex-col gap-2">
        <span className="flex flex-wrap items-center gap-3">
          {hasLogo ? (
            /* eslint-disable-next-line @next/next/no-img-element -- the
               bytes come from our own BFF, not from a configured host the
               image optimiser could be told about */
            <img
              src={api.orgLogoUrl(logoVersion)}
              alt=""
              className="h-12 w-12 shrink-0 rounded-lg border border-border object-cover"
            />
          ) : (
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg border border-border text-xs text-fg-subtle">
              —
            </span>
          )}
          <input
            id="org-logo"
            ref={logoInput}
            type="file"
            className="sr-only"
            accept="image/png,image/jpeg,image/webp"
            disabled={busy || logoBusy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void pickLogo(file);
            }}
          />
          {/*
            ICONS, NOT WORDS (user directive, 2026-09-03: "remove the text for
            delete the image and just add the delete icon and for change also
            just put a change icon").
            Two labelled buttons beside a picture of the thing they act on were
            saying what the picture already says. The words survive as `title`
            and `aria-label`, so nothing is lost to a screen reader or to a
            hover — what goes is the second telling.
            NO icon while there is no logo: «انتخاب تصویر» is the first thing
            somebody does here and a bare glyph would be a puzzle. A control
            whose meaning comes from the image beside it needs the image to
            exist first.
          */}
          {hasLogo ? (
            <button
              type="button"
              className="btn btn-icon border border-border text-fg-muted hover:text-fg"
              disabled={busy || logoBusy}
              onClick={() => logoInput.current?.click()}
              aria-label={t("orgLogoReplace")}
              title={t("orgLogoReplace")}
            >
              <Icon name="retry" size="sm" />
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-sm border border-border font-medium text-fg"
              disabled={busy || logoBusy}
              onClick={() => logoInput.current?.click()}
            >
              {t("orgLogoChoose")}
            </button>
          )}
          {hasLogo ? (
            <button
              type="button"
              className="btn btn-icon text-danger hover:bg-danger/10"
              disabled={busy || logoBusy}
              onClick={() => setConfirmLogoRemove(true)}
              aria-label={t("orgLogoRemove")}
              title={t("orgLogoRemove")}
            >
              <Icon name="trash" size="sm" />
            </button>
          ) : null}
        </span>
        {/* the hint sits UNDER the control, not under the label (user
            directive, 2026-09-02): it describes the file the button
            accepts, so it belongs beside the button that accepts it */}
        <span className="text-[11px] leading-5 text-fg-subtle">{t("orgLogoHint")}</span>
        </span>
      </FormRow>

      <FormRow label={t("orgEmail")} htmlFor="org-email">
        <input
          id="org-email"
          className="input"
          dir="ltr"
          type="email"
          value={publicEmail}
          disabled={busy}
          onChange={(event) => setPublicEmail(event.target.value)}
        />
      </FormRow>

      <FormRow label={t("orgDescription")} htmlFor="org-description">
        <input
          id="org-description"
          className="input"
          value={description}
          disabled={busy}
          onChange={(event) => setDescription(event.target.value)}
        />
      </FormRow>

      <FormRow label={t("orgWebsite")} htmlFor="org-website">
        <input
          id="org-website"
          className="input"
          dir="ltr"
          placeholder="https://…"
          value={websiteUrl}
          disabled={busy}
          onChange={(event) => setWebsiteUrl(event.target.value)}
        />
      </FormRow>

      <FormRow label={t("orgLocation")} htmlFor="org-location">
        <input
          id="org-location"
          className="input"
          value={location}
          disabled={busy}
          onChange={(event) => setLocation(event.target.value)}
        />
      </FormRow>

      <FormRow label={t("orgLocale")} htmlFor="org-locale">
        {/*
          The platform's dropdown (user directive, 2026-09-04: "when i ask for
          all i mean all"). Only the WIDTH stays local — a locale picker sized
          to its content is a choice about this field, not a re-answer of a
          promise the control already makes.

          An unrecognised locale is labelled as ITSELF: we have no name for it,
          and inventing one would be the silent substitution this list exists
          to prevent — a value stored as `fa-IR` must not render as «فارسی».
        */}
        <Select
          id="org-locale"
          className="w-auto"
          value={locale}
          disabled={busy}
          onChange={setLocale}
          options={localeOptions(org.locale).map((value) => ({
            value,
            label: value === "fa" || value === "en" ? t(`orgLocale_${value}`) : value,
          }))}
        />
      </FormRow>

      {/* THE GLOSSARY ROW LEFT THIS FORM (user directive, 2026-09-02: "remove
          Recognition glossary"). The column and its api stay — the term
          list still shapes transcription — but the surface for editing it is
          gone until it has a home of its own. Its state left with it: a
          draft nothing renders is a writer with no reader. */}

      <PanelFooter>
        {/* save outcomes ride the notification system now (orb toast +
            top bell) — the table/form stays quiet (user directive) */}
        <button
          className="btn-primary"
          /* Disabled when there is nothing to send: core answers an empty
             patch with a 400, and showing someone an error for changing their
             mind back is a worse answer than a button that stays quiet. */
          disabled={busy || nothingToSave || invalid}
          onClick={() => void save()}
        >
          {t("orgSave")}
        </button>
      </PanelFooter>
    </FormPanel>

    {/* The platform's one destructive-action dialog (confirm.guard.test.ts).
        Choosing a file IS the save here, so removing one is a save too —
        there is no draft state to back out of, and the previous image is
        gone the moment this lands. The body says the consequence a person
        cannot see from this form: every surface showing the organization
        falls back to its initial. */}
    {confirmLogoRemove ? (
      <ConfirmDialog
        title={t("orgLogoRemoveTitle")}
        body={t("orgLogoRemoveBody")}
        confirmLabel={t("orgLogoRemove")}
        cancelLabel={tCommon("cancel")}
        busy={logoBusy}
        onCancel={() => setConfirmLogoRemove(false)}
        onConfirm={() => {
          setConfirmLogoRemove(false);
          void removeLogo();
        }}
      />
    ) : null}
    </>
  );
}
