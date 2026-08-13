"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/routing";
import { api, BffError } from "@/api/client";
import type { Me, ModelInfo } from "@/api/types";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { Card, Chip, Field, PageHeader } from "@/components/ui";

/**
 * The patch this screen sends, and the reason it is not `Partial<User>`.
 *
 * `undefined` and `null` are DIFFERENT INSTRUCTIONS on this route: absent
 * means "leave it alone", `null` means "clear it". `Partial<>` would let the
 * two be written interchangeably and the compiler would never object, which is
 * exactly how "remove my Latin name" becomes a save that reports success and
 * changes nothing.
 */
interface ProfilePatch {
  display_name?: string;
  display_name_en?: string | null;
  username?: string | null;
}

/** Where a refusal belongs on the form. */
interface FormError {
  field: "username" | null;
  message: string;
}

export default function ProfilePage() {
  const t = useTranslations("profile");
  const router = useRouter();
  const pathname = usePathname();

  /**
   * `me` is the SAVED state and the drafts are what is typed. Both are needed:
   * "cleared" and "untouched" are only distinguishable by comparing the two,
   * and an empty box alone cannot tell them apart.
   */
  /*
   * `Me`, not `User`: on `User` the preference fields are optional (a members
   * row does not carry them), so `me.locale` would be `string | undefined` and
   * the language select would silently become uncontrolled the moment it was.
   * The type that says what `/v1/me` actually returns is the one to hold here.
   */
  const [me, setMe] = useState<Me | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [displayNameEn, setDisplayNameEn] = useState("");
  const [username, setUsername] = useState("");

  const [models, setModels] = useState<ModelInfo[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<FormError | null>(null);

  function adopt(user: Me) {
    setMe(user);
    setDisplayName(user.display_name);
    setDisplayNameEn(user.display_name_en ?? "");
    setUsername(user.username ?? "");
  }

  useEffect(() => {
    // `null` is "no identity" (401), not "an empty profile" — adopting it
    // would blank the form's saved-state baseline and make every field look
    // cleared, which is the one thing this screen must never infer wrongly.
    void api.me().then((identity) => {
      if (identity) adopt(identity);
    });
    // no client-side filtering: core/ has already applied the org allow-list,
    // and nothing filters on tool support (see ModelsResponse)
    void api.models().then((res) => setModels(res.models));
  }, []);

  /**
   * Build the instruction, not a snapshot.
   *
   * Each optional field resolves to one of three things, and the empty box is
   * the interesting case: empty where something was saved means CLEAR IT
   * (`null`), empty where nothing was saved means nothing happened at all
   * (omit). Sending `null` in the second case would be a write that changes
   * nothing — harmless here, but it turns "I opened the page and pressed save"
   * into an edit in any audit that watches this route.
   *
   * Returns null when there is nothing to say. core/ refuses an empty patch
   * with a 400 rather than performing a no-op UPDATE, so an unconditional call
   * would show the user an error for having changed their mind.
   */
  function buildPatch(user: Me): ProfilePatch | null {
    const patch: ProfilePatch = {};

    const name = displayName.trim();
    // NOT nullable — the column is NOT NULL. Empty is sent as empty so core/
    // answers with its own sentence rather than this screen inventing one.
    if (name !== user.display_name) patch.display_name = displayName;

    const en = displayNameEn.trim();
    const savedEn = user.display_name_en ?? "";
    if (en !== savedEn) patch.display_name_en = en === "" ? null : en;

    /*
     * Compared case-INSENSITIVELY because core/ lower-cases rather than
     * refusing: typing "Ali" over a saved "ali" is not an edit, and sending it
     * would produce a save that reports success while the value is untouched.
     */
    const handle = username.trim();
    const savedHandle = user.username ?? "";
    if (handle.toLowerCase() !== savedHandle.toLowerCase()) {
      patch.username = handle === "" ? null : handle;
    }

    return Object.keys(patch).length === 0 ? null : patch;
  }

  const patch = me ? buildPatch(me) : null;
  const dirty = patch !== null;

  async function save() {
    if (!me || !patch || saving) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      // The response is the SAVED row — adopting it is what makes a
      // lower-cased handle or a trimmed name appear as it actually is, rather
      // than leaving the box showing what was typed and calling it saved.
      adopt(await api.updateProfile(patch));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (cause) {
      setError(toFormError(cause, t));
    } finally {
      setSaving(false);
    }
  }

  if (!me)
    return (
      <PlatformShell>
        <div className="p-5">{null}</div>
      </PlatformShell>
    );

  return (
    <PlatformShell>
      <div className="p-5">
        <PageHeader title={t("title")} />

        <Card className="max-w-xl space-y-4">
          <div className="flex items-center gap-4">
            <div className="grid h-16 w-16 place-items-center rounded-full bg-accent-soft text-xl font-bold text-accent">
              {me.display_name.slice(0, 1)}
            </div>
            <button className="btn-secondary h-10 min-h-0 px-3 text-xs">{t("avatar")}</button>
          </div>

          <Field label={t("displayName")}>
            <input
              className="input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </Field>

          {/*
           * Both of these hold LATIN text by definition — one is the Latin
           * name, the other is `^[a-z][a-z0-9_]{2,31}$`. `dir="ltr"` is stated
           * rather than inherited: in the Persian UI these boxes inherit RTL,
           * which puts the caret on the wrong side of an English word and
           * moves the trailing underscore of `ali_` to the left of it.
           */}
          <Field label={t("displayNameEn")} hint={t("clearHint")}>
            <input
              className="input"
              dir="ltr"
              value={displayNameEn}
              onChange={(e) => setDisplayNameEn(e.target.value)}
            />
          </Field>

          <Field label={t("username")} hint={t("usernameHint")}>
            <input
              className="input"
              dir="ltr"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              aria-invalid={error?.field === "username" || undefined}
              aria-describedby={error?.field === "username" ? "username-error" : undefined}
            />
            {error?.field === "username" ? (
              <span id="username-error" className="mt-1 block text-xs text-danger">
                {error.message}
              </span>
            ) : null}
          </Field>

          <Field label={t("language")}>
            <select
              className="input"
              value={me.locale}
              onChange={(e) => {
                const locale = e.target.value as "fa" | "en";
                setMe({ ...me, locale });
                void api.setLocale(locale);
                router.replace(pathname, { locale });
              }}
            >
              <option value="fa">فارسی</option>
              <option value="en">English</option>
            </select>
          </Field>

          {/* The "tool-capable only" hint was REMOVED, not restyled: nothing
              filters on tool support. core/ reports
              `tool_capability_filtered: false` because the catalogue carries no
              such field, so the hint was a safety claim with nothing behind it.
              A missing hint is a gap; a false one is worse. */}
          <Field label={t("model")}>
            <select
              className="input"
              value={me.model_id ?? ""}
              onChange={(e) => {
                setMe({ ...me, model_id: e.target.value });
                void api.setPreferredModel(e.target.value);
              }}
            >
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>
          </Field>

          {/* A refusal that names no field belongs where the whole form can
              see it, and it is the SERVER's sentence: core/ owns the username
              rule and is the only thing that knows whether a handle is taken
              or permanently retired. */}
          {error && error.field === null ? (
            <p role="alert" className="text-sm text-danger">
              {error.message}
            </p>
          ) : null}

          <div className="flex items-center gap-3">
            <button className="btn-primary" disabled={!dirty || saving} onClick={() => void save()}>
              {saving ? t("saving") : t("save")}
            </button>
            {saved ? <Chip tone="success">{t("saved")}</Chip> : null}
          </div>
        </Card>
      </div>
    </PlatformShell>
  );
}

/**
 * Refusal → where it goes on the form.
 *
 * `conflict` is the username and nothing else: this route's only 409 is the
 * unique index on the handle. `invalid` is shown verbatim wherever the form
 * can see it, because core/ states the rule in the message — mirroring the
 * regex here to decide which field to blame would be a copy of someone else's
 * rule that goes stale the day the constraint moves, and it would go stale
 * silently.
 *
 * Anything else is a failure of the CALL, not of what was typed, and gets the
 * generic sentence. `detail` may be absent — a refusal with an unreadable body
 * is still a real refusal — so every branch has its own wording to fall back on.
 */
function toFormError(cause: unknown, t: (key: string) => string): FormError {
  if (cause instanceof BffError) {
    if (cause.kind === "conflict") {
      return { field: "username", message: cause.detail ?? t("usernameTaken") };
    }
    if (cause.kind === "invalid") {
      return { field: null, message: cause.detail ?? t("saveFailed") };
    }
  }
  return { field: null, message: t("saveFailed") };
}
