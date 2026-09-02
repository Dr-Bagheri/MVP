"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Select } from "@/components/Select";
import { usePathname, useRouter } from "@/i18n/routing";
import { api, BffError } from "@/api/client";
import type { Me, ModelInfo } from "@/api/types";
import { AvatarEditor } from "@/components/platform/AvatarEditor";
import { ChangePassword } from "@/components/platform/ChangePassword";
import { ExportAccountData } from "@/components/platform/ExportAccountData";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { FormPanel, FormRow, PageContainer, PageHeader, PanelFooter, Section } from "@/components/scaffold";
import { digits, modelLabel, personName } from "@/lib/format";
import { signOutThisDevice } from "@/lib/signOut";
import { storeTheme, type Theme } from "@/lib/theme";
import { useTheme } from "@/lib/useTheme";
import { Chip } from "@/components/ui";

/**
 * Profile, on the M26 scaffold (user directive: "the profile section should
 * not be different from the settings or any other sub sections"). The page is
 * PageContainer → PageHeader → Sections of FormPanel rows — the identical
 * anatomy Settings renders, so adding a field here means adding a FormRow,
 * never inventing a layout.
 *
 * The save button lives in PanelFooter at INLINE-end: logical position, so it
 * mirrors correctly between fa and en instead of sitting on the same physical
 * side in both (the round-3 direction finding).
 */

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
  job_title?: string | null;
  about?: string | null;
}

/** Where a refusal belongs on the form. */
interface FormError {
  field: "username" | null;
  message: string;
}

/**
 * The company's roles, as a closed list plus a way out.
 *
 * Closed because the point of the change is that two people with the same
 * job pick the same value; `other` exists because a list that cannot say
 * what someone does is a form they have to lie on, and it reveals the free
 * text box rather than swallowing the answer.
 */
const JOB_TITLES: string[] = [
  "founder", "ceo", "cto", "coo", "cfo", "product", "engineering", "design",
  "marketing", "sales", "operations", "finance", "hr", "legal", "support",
  "research", "data", "qa", "it", "assistant", "consultant", "intern",
];

export default function ProfilePage() {
  const t = useTranslations("profile");
  const tPlatform = useTranslations("platform");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  /*
   * The theme lives HERE now (user directive, 2026-08-27: the general
   * settings belong in profile settings; Settings · General is the
   * WORKSPACE). Read through the shared hook, never a local useState — the
   * avatar menu writes the same store, and a private copy would go stale
   * the moment the menu changed it and then write the stale value back.
   */
  const theme = useTheme();

  /**
   * `me` is the SAVED state and the drafts are what is typed. Both are needed:
   * "cleared" and "untouched" are only distinguishable by comparing the two,
   * and an empty box alone cannot tell them apart.
   *
   * `Me`, not `User`: on `User` the preference fields are optional (a members
   * row does not carry them), so `me.locale` would be `string | undefined` and
   * the language select would silently become uncontrolled the moment it was.
   */
  const [me, setMe] = useState<Me | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [displayNameEn, setDisplayNameEn] = useState("");
  const [username, setUsername] = useState("");
  /** Profile context (0080) — drafts, same clear-vs-omit rules as the names. */
  const [jobTitle, setJobTitle] = useState("");
  /**
   * The header's two counts, derived from reads this page can already make.
   *
   * `undefined` until both answer — the tiles render «—» there, because a
   * zero shown while the read is still out is a claim about the person that
   * happens to be wrong for a second. A failed read leaves it undefined too:
   * "we could not look" and "there are none" must not be the same number.
   */
  const [stats, setStats] = useState<{ meetings: number; tasksDone: number } | undefined>(undefined);


  const [models, setModels] = useState<ModelInfo[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<FormError | null>(null);

  function adopt(user: Me) {
    setMe(user);
    setDisplayName(user.display_name);
    setDisplayNameEn(user.display_name_en ?? "");
    setUsername(user.username ?? "");
    setJobTitle(user.job_title ?? "");
  }

  useEffect(() => {
    let alive = true;
    void Promise.all([api.meetings(), api.taskBoard()])
      .then(([meetings, board]) => {
        if (!alive) return;
        /* `done` is the task's OWN flag, not "whichever column is last":
           a board can be renamed and reordered, and a count that depended on
           a column's position would change without anyone finishing
           anything. */
        setStats({
          meetings: meetings.length,
          tasksDone: board.tasks.filter((task) => task.done).length,
        });
      })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);

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

    // Profile context (0080): included ONLY when the wire carries the fields
    // (a deployment ahead of its migration must not receive them and 400).
    if (user.assistant_context !== undefined) {
      const role = jobTitle.trim();
      if (role !== (user.job_title ?? "")) patch.job_title = role === "" ? null : role;
      /* «دربارهٔ شما» left this form (2026-09-02). The COLUMN stays and is
         not cleared here: a form that stops showing a field must not also
         delete what somebody wrote in it. */
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
        <PageContainer>{null}</PageContainer>
      </PlatformShell>
    );

  return (
    <PlatformShell>
      <PageContainer>
        <PageHeader title={t("title")} subtitle={t("subtitle")} />

        {/* THE PERSON, AND WHAT THEY HAVE DONE (user directive, after the
            reference's own profile header): avatar, name, role, and the
            three counts. The counts come from the SERVER's own summary —
            deriving them here would be a second arithmetic that disagrees
            with the dashboard's on an ordinary Tuesday — and each renders
            «—» while it is still unknown, never a zero, because "we have
            not looked yet" and "there are none" are different facts. */}
        <section className="tile tile-row mb-4 flex-wrap items-center justify-between gap-4 p-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-accent-soft text-lg font-bold text-accent">
              {personName(me, locale).slice(0, 1)}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-lg font-bold text-fg">{personName(me, locale)}</span>
              <span className="block truncate text-xs text-fg-muted">
                {me.job_title ? me.job_title : t(`role_${me.role ?? "member"}`)}
                {me.org_name ? ` · ${me.org_name}` : ""}
              </span>
            </span>
          </div>
          {/* TWO counts, not three. The reference shows a decisions total as
              well and there is no read for one per person — a tile that can
              only ever show a dash is a promise, not a metric, so it is
              absent rather than permanently empty. */}
          <dl className="flex shrink-0 items-center gap-6">
            {([
              ["statMeetings", stats?.meetings],
              ["statTasksDone", stats?.tasksDone],
            ] as const).map(([key, value]) => (
              <div key={key} className="text-center">
                <dd className="badge-num text-xl font-bold text-fg">
                  {value === undefined ? "—" : digits(value, locale)}
                </dd>
                <dt className="text-[11px] text-fg-muted">{t(key)}</dt>
              </div>
            ))}
          </dl>
        </section>

        <Section title={t("identityTitle")}>
          <FormPanel>
            <FormRow label={t("photo")} description={t("photoHint")}>
              <AvatarEditor me={me} onSaved={adopt} />
            </FormRow>

            <FormRow label={t("displayName")} htmlFor="profile-name">
              <input
                id="profile-name"
                className="input"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </FormRow>

            {/*
             * Both of these hold LATIN text by definition — one is the Latin
             * name, the other is `^[a-z][a-z0-9_]{2,31}$`. `dir="ltr"` is
             * stated rather than inherited: in the Persian UI these boxes
             * inherit RTL, which puts the caret on the wrong side of an
             * English word and moves the trailing underscore of `ali_` to the
             * left of it.
             */}
            <FormRow label={t("displayNameEn")} description={t("clearHint")} htmlFor="profile-name-en">
              <input
                id="profile-name-en"
                className="input"
                dir="ltr"
                value={displayNameEn}
                onChange={(e) => setDisplayNameEn(e.target.value)}
              />
            </FormRow>

            <FormRow label={t("username")} description={t("usernameHint")} htmlFor="profile-username">
              <div className="w-full">
                <input
                  id="profile-username"
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
              </div>
            </FormRow>

            {/* Profile context (0080) — rendered only when the wire carries
                the fields: a form for columns a deployment does not have yet
                would be controls that read as wired and do nothing. */}
            {me.assistant_context !== undefined ? (
              <>
                {/* THE ROLE IS A CHOICE, not free text (user directive):
                    a typed job title is a different string in every row —
                    "CEO", "ceo", "مدیرعامل" — and nothing downstream can
                    group by it. The list is a closed one the whole company
                    shares, and the last entry keeps the door open for a role
                    the list has not learned yet, because a closed list with
                    no exit is a form somebody cannot fill in truthfully.
                    «دربارهٔ شما» is GONE with it, on the same directive. */}
                <FormRow label={t("jobTitle")} description={t("jobTitleHint")} htmlFor="profile-job">
                  <Select
                    id="profile-job"
                    value={JOB_TITLES.includes(jobTitle) ? jobTitle : (jobTitle === "" ? "" : "other")}
                    ariaLabel={t("jobTitle")}
                    placeholder={t("jobTitleNone")}
                    onChange={(value) => setJobTitle(value === "other" ? jobTitle || " " : value)}
                    options={[
                      { value: "", label: t("jobTitleNone") },
                      ...JOB_TITLES.map((key) => ({ value: key, label: t(`job_${key}`) })),
                      { value: "other", label: t("job_other") },
                    ]}
                  />
                </FormRow>
                {/* the free-text box appears only when the list could not say
                    it — an "other" that cannot be typed is a dead end */}
                {jobTitle !== "" && !JOB_TITLES.includes(jobTitle) ? (
                  <FormRow label={t("jobTitleOwnWords")} htmlFor="profile-job-other">
                    <input
                      id="profile-job-other"
                      className="input"
                      value={jobTitle.trim()}
                      onChange={(e) => setJobTitle(e.target.value)}
                      maxLength={120}
                      autoFocus
                    />
                  </FormRow>
                ) : null}
              </>
            ) : null}

            {/* A refusal that names no field belongs where the whole form can
                see it, and it is the SERVER's sentence: core/ owns the
                username rule and is the only thing that knows whether a
                handle is taken or permanently retired. */}
            {error && error.field === null ? (
              <div className="px-5 py-3 md:px-8">
                <p role="alert" className="text-sm text-danger">
                  {error.message}
                </p>
              </div>
            ) : null}

            <PanelFooter>
              {saved ? <Chip tone="success">{t("saved")}</Chip> : null}
              <button className="btn-primary" disabled={!dirty || saving} onClick={() => void save()}>
                {saving ? t("saving") : t("save")}
              </button>
            </PanelFooter>
          </FormPanel>
        </Section>

        <Section title={t("prefsTitle")} divided>
          <FormPanel>
            <FormRow label={t("language")} htmlFor="profile-language">
              <select
                id="profile-language"
                className="input min-h-0 h-11 md:h-control"
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
            </FormRow>

            <FormRow label={t("theme")} description={t("themeHint")} htmlFor="profile-theme">
              <select
                id="profile-theme"
                className="input min-h-0 h-11 md:h-control"
                value={theme}
                onChange={(e) => storeTheme(e.target.value as Theme)}
              >
                <option value="dark">{t("themeDark")}</option>
                <option value="light">{t("themeLight")}</option>
              </select>
            </FormRow>

            {/* The "tool-capable only" hint was REMOVED, not restyled: nothing
                filters on tool support. core/ reports
                `tool_capability_filtered: false` because the catalogue carries
                no such field, so the hint was a safety claim with nothing
                behind it. A missing hint is a gap; a false one is worse. */}
            <FormRow label={t("model")} htmlFor="profile-model">
              <select
                id="profile-model"
                className="input min-h-0 h-11 md:h-control"
                value={me.model_id ?? ""}
                onChange={(e) => {
                  setMe({ ...me, model_id: e.target.value });
                  void api.setPreferredModel(e.target.value);
                }}
              >
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {modelLabel(model.name)}
                  </option>
                ))}
              </select>
            </FormRow>
          </FormPanel>
        </Section>

        {/* Assistant & data (user directive, 2026-08-22, after the sana.ai
            reference): the CONSENT switch — may the assistant see the role
            and about texts above — and the data export. The switch saves
            immediately (a consent that waits for a Save button is a consent
            someone believes they gave and didn't), and adopts the server's
            answer, never optimistic. */}
        {me.assistant_context !== undefined ? (
          <Section title={t("assistantDataTitle")} divided>
            <FormPanel>
              <FormRow label={t("shareWithAssistant")} description={t("shareWithAssistantHint")}>
                <button
                  type="button"
                  role="switch"
                  aria-checked={me.assistant_context}
                  aria-label={t("shareWithAssistant")}
                  className={`tap relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                    me.assistant_context ? "bg-accent" : "border border-border bg-surface-2"
                  }`}
                  onClick={() => {
                    void api
                      .updateProfile({ assistant_context: !me.assistant_context })
                      .then(adopt)
                      .catch(() => setError({ field: null, message: t("saveFailed") }));
                  }}
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                      me.assistant_context ? "end-0.5" : "start-0.5"
                    }`}
                    aria-hidden
                  />
                </button>
              </FormRow>
              <FormRow label={t("exportTitle")} description={t("exportHint")}>
                <ExportAccountData />
              </FormRow>
            </FormPanel>
          </Section>
        ) : null}

        {/* Its own section and its own save. A password change is not another
            profile field: it re-authenticates, it can fail for reasons the
            fields above never can, and folding it into the same submit would
            mean a rejected password discarded a perfectly good rename. */}
        <Section title={t("passwordTitle")} divided>
          <ChangePassword />
        </Section>

        {/* THE WAY OUT lives on this page too (user directive), beside the
            account it belongs to. It ends THIS session on THIS device — the
            hint says so, because a sign-out that read as "everywhere" would
            be a promise the flow does not make. */}
        <Section title={t("signOutTitle")} divided>
          <FormPanel>
            <FormRow label={tPlatform("signOut")} description={t("signOutHint")}>
              <button
                type="button"
                onClick={() => { void signOutThisDevice(locale); }}
                className="tap h-10 rounded-xl bg-danger/10 px-4 text-sm font-medium text-danger hover:bg-danger/20"
              >
                {tPlatform("signOut")}
              </button>
            </FormRow>
          </FormPanel>
        </Section>
      </PageContainer>
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
 * is still a refusal, and the screen falls back to its own wording.
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
