"use client";

import { use, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Select } from "@/components/Select";
import { Switch } from "@/components/Switch";
import { usePathname, useRouter } from "@/i18n/routing";
import { api, BffError } from "@/api/client";
import type { Me, ModelInfo } from "@/api/types";
import { AvatarEditor } from "@/components/platform/AvatarEditor";
import { SignatureEditor } from "@/components/platform/SignatureEditor";
import { ChangePassword } from "@/components/platform/ChangePassword";
import { TelegramLink } from "@/components/platform/TelegramLink";
import { ExportAccountData } from "@/components/platform/ExportAccountData";
import { TwoPane, type PaneGroup } from "@/components/platform/TwoPane";
import { TAB_TRACK, sectionTabClass } from "@/components/platform/sectionTabs";
import { IconLogout } from "@/components/icons";
import { FormPanel, FormRow, PageHeader, PanelFooter, Section, Skeleton } from "@/components/scaffold";
import { modelLabel } from "@/lib/format";
import { signOutThisDevice } from "@/lib/signOut";
import { notify, notifyError } from "@/lib/notify";
import { storeTheme, type Theme } from "@/lib/theme";
import { useTheme } from "@/lib/useTheme";

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


/**
 * THE FOUR SUB-PAGES, in the order the user gave (directive, 2026-09-04:
 * "add a sub menu on top for it with order like this: Identity, Preferences,
 * Assistant & data, Change password").
 *
 * This screen was one long scroll of five stacked sections while every other
 * surface — Settings, Management, Echo, Help — had already become a top
 * toolbar over one section's content. It is the same component now, so the
 * profile stops being the page that reads differently from the rest.
 *
 * REAL ROUTES rather than local tab state, deliberately: `/profile/password`
 * can be linked to and come back to, the breadcrumb has something to say, and
 * the route-tree instruments (rule 13.5 — every href the shell renders must
 * resolve) can see these at all. A tab set living in `useState` is invisible
 * to every one of them.
 *
 * SESSION IS NOT A SECTION. It was a fifth heading over a single button; the
 * way out now sits at the foot of Identity, beside the account it ends.
 */
const PROFILE_SECTIONS = ["identity", "preferences", "assistant", "telegram", "password"] as const;
type ProfileSection = (typeof PROFILE_SECTIONS)[number];

/** each section's heading — the menu item, the page title and the breadcrumb
    all read this, so a section cannot end up called two things */
const SECTION_LABEL: Record<ProfileSection, string> = {
  identity: "identityTitle",
  preferences: "prefsTitle",
  assistant: "assistantDataTitle",
  /* the person's own phone (db/0212) — beside the assistant's data and above
     the password, because it is the same kind of fact as a voiceprint: a
     personal device this account speaks through */
  telegram: "telegramTitle",
  password: "passwordTitle",
};

/** the section this URL means; an unknown tail lands on Identity, which is
    also what a bare /profile means */
function sectionFor(tail: string[] | undefined): ProfileSection {
  const slug = tail?.[0];
  return PROFILE_SECTIONS.find((entry) => entry === slug) ?? "identity";
}

export default function ProfilePage({
  params,
}: {
  params: Promise<{ section?: string[] }>;
}) {
  const t = useTranslations("profile");
  const tPlatform = useTranslations("platform");
  const { section } = use(params);
  const active = sectionFor(section);
  /* ONE group, no title: four items that are all "your account" need no
     heading above them to say so — SectionMenu's own rule for a group whose
     label would only repeat its items. */
  const groups: PaneGroup[] = [{
    key: "profile",
    items: PROFILE_SECTIONS.map((slug) => ({
      slug,
      href: slug === "identity" ? "/profile" : `/profile/${slug}`,
      label: t(SECTION_LABEL[slug]),
    })),
  }];
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
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [saving, setSaving] = useState(false);
  /* FIELD ERRORS ONLY, from 2026-09-08. A refusal that names an input
     (`username` is taken) belongs ON that input — a sentence in the middle
     of the screen cannot point at which of eight boxes to change. Everything
     the server refuses WITHOUT naming a field is a toast now, like every
     other refused write on the platform. */
  const [error, setError] = useState<FormError | null>(null);

  function adopt(user: Me) {
    setMe(user);
    setDisplayName(user.display_name);
    setDisplayNameEn(user.display_name_en ?? "");
    setUsername(user.username ?? "");
    setJobTitle(user.job_title ?? "");
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
    try {
      // The response is the SAVED row — adopting it is what makes a
      // lower-cased handle or a trimmed name appear as it actually is, rather
      // than leaving the box showing what was typed and calling it saved.
      adopt(await api.updateProfile(patch));
      notify(t("saved"));
    } catch (cause) {
      const refusal = toFormError(cause, t);
      if (refusal.field !== null) setError(refusal);
      else notifyError(refusal.message);
    } finally {
      setSaving(false);
    }
  }

  /*
   * audit finding, 2026-09-02: this returned an EMPTY column while `me` was
   * out, then dropped the identity tile and four panels in at once. The
   * platform's loading rule says the frame is STRUCTURE and structure is known
   * before the network — the tile, the panels and every label are the same
   * whatever the server answers, so only the VALUES wait, and while they wait
   * they occupy the space they are about to fill.
   *
   * It reserves the identity tile and the two panels that always land; the
   * assistant/password/sign-out sections below are deliberately absent,
   * because reserving space for something that turns out to be a different
   * size moves the layout exactly as much as reserving none.
   */
  /* «خروج» ON THE FIRST ROW, AT ITS OTHER END (user, 2026-09-16: "put the
     log out on the first row on the other end, small button, same style as
     the row does"). It wears the row's own pill — `sectionTabClass`, in its
     own rail — through TwoPane's `actions` slot, which is where every page
     puts the control that belongs to row one and is not a section. It had
     been a full-width danger button at the foot of the identity section,
     which is where nobody looks for a way out. */
  const signOut = (
    <div className={TAB_TRACK}>
      <button
        type="button"
        onClick={() => { void signOutThisDevice(locale); }}
        className={sectionTabClass(false)}
      >
        <IconLogout width={14} height={14} />
        {tPlatform("signOut")}
      </button>
    </div>
  );

  if (!me)
    return (
      <TwoPane navLabel={t("title")} groups={groups} activeSlug={active} width="small" actions={signOut}>

          <Section>
            <FormPanel>
              {[t("photo"), t("displayName"), t("displayNameEn"), t("username")].map((label) => (
                <FormRow key={label} label={label}>
                  {/* h-10 = `.input`'s own height, so the row does not resize
                      under the pointer when the real field arrives */}
                  <Skeleton className="h-10 w-full" />
                </FormRow>
              ))}
            </FormPanel>
          </Section>

          <Section divided>
            <FormPanel>
              {[t("language"), t("theme"), t("model")].map((label) => (
                <FormRow key={label} label={label}>
                  <Skeleton className="h-10 w-full" />
                </FormRow>
              ))}
            </FormPanel>
          </Section>
      </TwoPane>
    );

  return (
    <TwoPane navLabel={t("title")} groups={groups} activeSlug={active} width="small" actions={signOut}>
      {/* the SECTION's name, not the page's — the breadcrumb and the toolbar
          already say "profile", and a third copy of the word is the heading
          this product spent a round removing everywhere else */}
      <PageHeader
        title={t(SECTION_LABEL[active])}
        {...(active === "identity" ? { subtitle: t("subtitle") } : {})}
      />

      {active === "identity" ? (
        <>


        <Section>
          <FormPanel>
            {/* `wide`: the picture control, a divider and eight avatars
                (2026-09-17) are wider than a text field, and under the
                row's 380px cap the avatars wrapped under the picture on
                production — the divider ended a line with nothing beside
                it. The cap keeps a text field readable; this row has none. */}
            <FormRow label={t("photo")} wide>
              <AvatarEditor me={me} onSaved={adopt} />
            </FormRow>

            {/* THE SIGNATURE ON FILE (db/0229): the picture of their hand that
                signs a meeting's minutes from the summary tab. Beside the
                photo because it is the same kind of thing — a picture of the
                person, changed in place — and nowhere else, because nobody but
                its owner may ever fetch it. */}
            <FormRow label={t("signature")}>
              <SignatureEditor />
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
            <FormRow label={t("displayNameEn")} htmlFor="profile-name-en">
              <input
                id="profile-name-en"
                className="input"
                dir="ltr"
                value={displayNameEn}
                onChange={(e) => setDisplayNameEn(e.target.value)}
              />
            </FormRow>

            <FormRow label={t("username")} htmlFor="profile-username">
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
                <FormRow label={t("jobTitle")} htmlFor="profile-job">
                  <Select
                    id="profile-job"
                    value={JOB_TITLES.includes(jobTitle) ? jobTitle : (jobTitle === "" ? "" : "other")}
                    ariaLabel={t("jobTitle")}
                    placeholder={t("jobTitleNone")}
                    onChange={setJobTitle}
                    options={[
                      { value: "", label: t("jobTitleNone") },
                      ...JOB_TITLES.map((key) => ({ value: key, label: t(`job_${key}`) })),
                      { value: "other", label: t("job_other") },
                    ]}
                  />
                </FormRow>
                {/* «به بیان خودت» is GONE (user directive, 2026-09-02). The
                    list is the answer now; `other` records that the list did
                    not have one rather than opening a second field. */}
              </>
            ) : null}

            {/* A refusal that names no field belongs where the whole form can
                see it, and it is the SERVER's sentence: core/ owns the
                username rule and is the only thing that knows whether a
                handle is taken or permanently retired. */}
            <PanelFooter>
              {/* the outcome rides the NOTIFICATION bus (platform rule,
                  2026-09-02): a pill beside the button is a second place to
                  look for the same fact, and it is gone before anyone who
                  looked away comes back. The bell keeps it. */}
              <button className="btn-primary" disabled={!dirty || saving} onClick={() => void save()}>
                {saving ? t("saving") : t("save")}
              </button>
            </PanelFooter>
          </FormPanel>
        </Section>

        {/*
          THE WAY OUT LEFT THE FOOT OF IDENTITY (2026-09-16): it is the pill
          at the end of the first row now (`signOut`, above), on every
          section rather than only this one. From 2026-09-04 to then it stood
          here as a full-width soft-danger button, after the «نشست» section
          that had held it went — that history is in git.
        */}
        </>
      ) : null}

      {active === "preferences" ? (
        <Section>
          <FormPanel>
            {/*
              THE PLATFORM'S DROPDOWN, not the browser's (user directive,
              2026-09-04: "i asked to change all dropdowns in the platform to
              our theme … when i ask for all i mean all").

              These three were the last native controls on a settings screen,
              and the reason they were easy to miss is the reason they had to
              go: a native `<select>` wearing `.input` matches the theme
              exactly while it is CLOSED. Only the open list gives it away —
              the browser paints that on its own popup sheet, in white with a
              Windows-blue row, and no stylesheet of ours reaches it. On a dark
              screen it is the one thing on the page that is not ours.
            */}
            <FormRow label={t("language")} htmlFor="profile-language">
              <Select
                id="profile-language"
                value={me.locale}
                onChange={(next) => {
                  const locale = next as "fa" | "en";
                  setMe({ ...me, locale });
                  void api.setLocale(locale);
                  router.replace(pathname, { locale });
                }}
                options={[
                  { value: "fa", label: "فارسی" },
                  { value: "en", label: "English" },
                ]}
              />
            </FormRow>

            <FormRow label={t("theme")} htmlFor="profile-theme">
              <Select
                id="profile-theme"
                value={theme}
                onChange={(next) => storeTheme(next as Theme)}
                options={[
                  { value: "dark", label: t("themeDark") },
                  { value: "light", label: t("themeLight") },
                ]}
              />
            </FormRow>

            {/* The "tool-capable only" hint was REMOVED, not restyled: nothing
                filters on tool support. core/ reports
                `tool_capability_filtered: false` because the catalogue carries
                no such field, so the hint was a safety claim with nothing
                behind it. A missing hint is a gap; a false one is worse. */}
            <FormRow label={t("model")} htmlFor="profile-model">
              <Select
                id="profile-model"
                value={me.model_id ?? ""}
                onChange={(next) => {
                  setMe({ ...me, model_id: next });
                  void api.setPreferredModel(next);
                }}
                options={models.map((model) => ({
                  value: model.id, label: modelLabel(model.name),
                }))}
              />
            </FormRow>
          </FormPanel>
        </Section>
      ) : null}

      {active === "assistant" ? (
        /* Assistant & data (user directive, 2026-08-22, after the sana.ai
            reference): the CONSENT switch — may the assistant see the role
            and about texts above — and the data export. The switch saves
            immediately (a consent that waits for a Save button is a consent
            someone believes they gave and didn't), and adopts the server's
            answer, never optimistic. */
        <Section>
            <FormPanel>
              {/* the consent row needs the column; the EXPORT below does not,
                  so a deployment without db/0080 gets a section that still
                  does something rather than an empty page behind a menu item */}
              {me.assistant_context !== undefined ? (
              <FormRow label={t("shareWithAssistant")}>
                {/* 2026-09-03, control sweep: this stays hand-drawn, on
                    purpose. It is a SWITCH, not a button — the 24×44 track and
                    the 20px knob that slides between `start-0.5` and `end-0.5`
                    inside it are not decoration on a control, they ARE the
                    control, and `.btn`'s 38px box with centred content has
                    nowhere to put the knob. It is also not an invented shape:
                    the same track is written in NotificationsSettings and
                    SignInMethods letter for letter. The real finding here is
                    one nobody can fix from inside this file — the platform has
                    nine of these and two track sizes (24×44 and 20×36), with
                    no shared Switch to settle it. That is a component to cut,
                    not a resize to make on one page. */}
                <Switch
                  checked={me.assistant_context}
                  label={t("shareWithAssistant")}
                  onChange={() => {
                    void api
                      .updateProfile({ assistant_context: !me.assistant_context })
                      .then(adopt)
                      .catch(() => notifyError(t("saveFailed")));
                  }}
                />
              </FormRow>
              ) : null}
              <FormRow label={t("exportTitle")}>
                <ExportAccountData />
              </FormRow>
            </FormPanel>
        </Section>
      ) : null}

        {/* Its own section and its own save. A password change is not another
            profile field: it re-authenticates, it can fail for reasons the
            fields above never can, and folding it into the same submit would
            mean a rejected password discarded a perfectly good rename. */}
      {active === "telegram" ? (
        <Section>
          <TelegramLink />
        </Section>
      ) : null}

      {active === "password" ? (
        <Section>
          <ChangePassword />
        </Section>
      ) : null}

    </TwoPane>
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
