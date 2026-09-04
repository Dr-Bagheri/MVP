"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Select } from "@/components/Select";
import { Switch } from "@/components/Switch";
import { usePathname, useRouter } from "@/i18n/routing";
import { api, BffError } from "@/api/client";
import type { Me, ModelInfo } from "@/api/types";
import { Avatar } from "@/components/Avatar";
import { AvatarEditor } from "@/components/platform/AvatarEditor";
import { ChangePassword } from "@/components/platform/ChangePassword";
import { ExportAccountData } from "@/components/platform/ExportAccountData";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { FormPanel, FormRow, PageContainer, PageHeader, PanelFooter, Section, Skeleton } from "@/components/scaffold";
import { digits, modelLabel, personName } from "@/lib/format";
import { signOutThisDevice } from "@/lib/signOut";
import { notify } from "@/lib/notify";
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
    try {
      // The response is the SAVED row — adopting it is what makes a
      // lower-cased handle or a trimmed name appear as it actually is, rather
      // than leaving the box showing what was typed and calling it saved.
      adopt(await api.updateProfile(patch));
      notify(t("saved"));
    } catch (cause) {
      setError(toFormError(cause, t));
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
  if (!me)
    return (
      <PlatformShell>
        <PageContainer>
          <section className="tile tile-row mb-4 flex-wrap items-center justify-between gap-4 p-4">
            <div className="flex min-w-0 items-center gap-3">
              {/* 2026-09-03: h-12, because the header's mark is `<Avatar
                  size="lg">` (48) now. A skeleton that reserves the OLD box
                  moves the layout on arrival by exactly the amount it exists
                  to prevent — and it moves it silently, since a 56px grey
                  circle and a 48px one look equally plausible while loading. */}
              <Skeleton className="h-12 w-12 shrink-0 rounded-full" />
              <div className="min-w-0 space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-28" />
              </div>
            </div>
            <dl className="flex shrink-0 items-center gap-6">
              {(["statMeetings", "statTasksDone"] as const).map((key) => (
                <div key={key} className="text-center">
                  {/* the LABEL is not a value — it is the same word before and
                      after the read, so it renders now and only the figure
                      above it waits. `dd`, not a bare span: the loaded tile is
                      a dd/dt pair and a dt with no dd is a different list. */}
                  <dd>
                    <Skeleton className="mx-auto h-6 w-8" />
                  </dd>
                  <dt className="text-[11px] text-fg-muted">{t(key)}</dt>
                </div>
              ))}
            </dl>
          </section>

          <Section title={t("identityTitle")}>
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

          <Section title={t("prefsTitle")} divided>
            <FormPanel>
              {[t("language"), t("theme"), t("model")].map((label) => (
                <FormRow key={label} label={label}>
                  <Skeleton className="h-10 w-full" />
                </FormRow>
              ))}
            </FormPanel>
          </Section>
        </PageContainer>
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
            {/* THE PHOTO, when there is one (user directive: "the profile
                avatar or image should set in the place of it, why its
                empty"). The initial is the FALLBACK, not the design — a
                header showing a letter under a card where the person just
                uploaded their face reads as the upload not having worked.

                2026-09-03: the platform's avatar, not a fifth hand-drawn one.
                `lg` is the token for the page's SUBJECT, and this page had two
                marks for one person — 56px here, 64px in the editor below —
                neither of which was a size anything named. They are both `lg`
                now; converting only one would have widened the gap from 8px to
                16, which is the user's complaint made worse rather than the
                class string made tidier. */}
            {/* no `shrink-0` here: the component already carries it, and a
                second copy is the restated-size defect one utility down */}
            <Avatar name={personName(me, locale)} src={me.avatar_url} size="lg" />
            <span className="min-w-0">
              <span className="block truncate text-lg font-bold text-fg">{personName(me, locale)}</span>
              {/* audit finding, 2026-09-02: `profile.role_owner|admin|member`
                  existed in NEITHER locale, so anyone without a job title read
                  the literal string «profile.role_member» under their own name
                  — the dashboard.widget.ask shape exactly. keys.test skips
                  computed keys, and locale PARITY cannot see a key missing
                  from both, so nothing was ever going to go red. Keys added to
                  fa.json and en.json in the wording tasks.role_* already uses;
                  verified on the rendered page in both directions. */}
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
            <FormRow label={t("photo")}>
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
            {error && error.field === null ? (
              /* audit finding, 2026-09-02 (the FormPanel gutter finding names
                 this line): `md:px-8` was a frozen copy of the panel's OLD
                 32px gutter. FormRow took the fixed-160/380 layout and moved
                 to `px-5`, so from md up this refusal sat 12px inside every
                 label it stands under — the sentence a person is reading
                 indented further than the fields it is about. It shares the
                 rows' gutter now, because it sits among the ROWS. */
              <div className="px-5 py-3">
                <p role="alert" className="text-sm text-danger">
                  {error.message}
                </p>
              </div>
            ) : null}

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

        <Section title={t("prefsTitle")} divided>
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

        {/* Assistant & data (user directive, 2026-08-22, after the sana.ai
            reference): the CONSENT switch — may the assistant see the role
            and about texts above — and the data export. The switch saves
            immediately (a consent that waits for a Save button is a consent
            someone believes they gave and didn't), and adopts the server's
            answer, never optimistic. */}
        {me.assistant_context !== undefined ? (
          <Section title={t("assistantDataTitle")} divided>
            <FormPanel>
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
                      .catch(() => setError({ field: null, message: t("saveFailed") }));
                  }}
                />
              </FormRow>
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
        <Section title={t("passwordTitle")} divided>
          <ChangePassword />
        </Section>

        {/* THE WAY OUT lives on this page too (user directive), beside the
            account it belongs to. It ends THIS session on THIS device — the
            hint says so, because a sign-out that read as "everywhere" would
            be a promise the flow does not make. */}
        <Section title={t("signOutTitle")} divided>
          <FormPanel>
            <FormRow label={tPlatform("signOut")}>
              {/* audit finding, 2026-09-02: this was a hand-rolled 40px button
                  with the 16px TILE corner, one section under a Save button
                  that is `.btn-primary` (38px, 11px) — two button shapes on
                  one page. `.btn` owns height, corner, padding and type (and
                  already composes `.tap`); only the TONE is stated here,
                  because a sign-out is not destructive — it is reversible by
                  signing back in, so it stays the soft danger wash rather
                  than becoming a solid `btn-danger`. */}
              <button
                type="button"
                onClick={() => { void signOutThisDevice(locale); }}
                className="btn bg-danger/10 text-danger hover:bg-danger/20"
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
