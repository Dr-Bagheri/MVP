"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/api/client";
import { notify } from "@/lib/notify";
import { clearSpeechCache } from "@/lib/voice";
import { Card, Field } from "@/components/ui";
import { Select } from "@/components/Select";
import { Switch } from "@/components/Switch";
import {
  setVoicePref, subscribeVoicePrefs, voicePrefs, voicePrefsServer,
} from "@/lib/voicePrefs";
import {
  isBindableKey, pushToTalkKey, pushToTalkLabel, pushToTalkServer,
  setPushToTalkKey, subscribePushToTalk,
} from "@/lib/pushToTalk";
import { Skeleton } from "@/components/scaffold";

/**
 * Settings·Assistant (user directive, 2026-08-21): the assistant's voice,
 * MOVED here from the presence dock — a conversation panel is not a place
 * to configure the person having it.
 *
 * [REVISED 2026-08-28, user directive] the autonomy dial LEFT this screen
 * (and the product): "remove watch and act from everywhere in the
 * platform. the only thing that must be in the platform is assist" —
 * assist is pinned server-side (PINNED_AUTONOMY in core) and is not shown
 * or offered anywhere. Saves announce themselves on the notification bus —
 * the orb's head, like every other notice.
 *
 * [REVISED 2026-08-28, user directive] the notification switches LEFT this
 * screen too: post-call brief, weekly digest, auto-draft replies and
 * meeting prep are Settings·Notifications rows now (NotificationsSettings,
 * same wire CONSUMED there, not forked — two editable copies of one fact
 * on two pages is the drift this repo keeps burying). What stays here is
 * the VOICE: reply language, reply length, standing instructions.
 */

/**
 * audit finding, 2026-09-02: the card used to be gated on ONE boolean, so
 * "the wire has not answered yet" and "this deployment has no assistant
 * columns" were the same nothing — a blank area that turned into a card
 * once the network came back, and stayed blank forever if it did not. The
 * kinds of nothing are named now, and the FRAME (card, heading, hint) does
 * not wait for any of them; only the controls do.
 *
 *  - `pending`    = api.me() has not answered → skeleton in the form's place
 *  - `absent`     = the wire lacks the group (db/0112 not on this deployment)
 *                   → an honest sentence, never controls over columns that do
 *                   not exist (they would save nothing and look saved)
 *  - `unreadable` = api.me() rejected → the current values could not be read;
 *                   controls would show defaults as if they were the person's
 *  - `ready`      = the form, adopting the server's answer
 */
type PrefsState = "pending" | "absent" | "unreadable" | "ready";

/**
 * One `Field`'s reserved space, 2026-09-03.
 *
 * The card already refused to wait for the wire (the finding above), but what
 * stood in the form's place was three blocks of `SkeletonLines` — two 16px
 * bars where a field is a 20px label, a 6px gap and a 40px control (44 below
 * md, `.input`'s touch floor). Roughly 76px short across the five fields, so
 * the card still grew when the answer landed: the reserved space was a promise
 * about the size of the thing, and a promise that is wrong moves the layout
 * anyway — the exact caveat on SkeletonLines' own `lines` prop.
 *
 * So the placeholder is built from `Field`'s geometry rather than from a
 * generic paragraph: `h-5` is the label's line box, `mt-1.5` is its own
 * `mb-1.5`, and the control bar wears `.input`'s two heights and its corner.
 */
function FieldSkeleton({
  className = "",
  /** the control's height — `.input`'s 44/40 by default, the textarea's
      `min-h-24` where the standing instructions land */
  control = "h-11 md:h-10",
}: {
  className?: string;
  control?: string;
}) {
  return (
    <div className={className}>
      <Skeleton className="h-5 w-24" />
      <Skeleton className={`mt-1.5 w-full rounded-md ${control}`} />
    </div>
  );
}

export function AssistantSettings() {
  const t = useTranslations("settings");
  /** db/0112 - the standing voice. null = auto; save-on-change, adopt the
      server's answer, never optimistic-and-forget. */
  const [replyLanguage, setReplyLanguage] = useState<string>("");
  const [replyLength, setReplyLength] = useState<string>("");
  const [instructions, setInstructions] = useState<string>("");
  const [savedInstructions, setSavedInstructions] = useState<string>("");
  /* 0128: the SPOKEN voice, per language — 'female' | 'male' */
  const [voiceFa, setVoiceFa] = useState<string>("female");
  const [voiceEn, setVoiceEn] = useState<string>("female");
  const [prefs, setPrefs] = useState<PrefsState>("pending");
  /**
   * db/0169 — may this person's agents search the open web.
   *
   * THREE states, not two. `undefined` means the deployment predates the
   * column, and it renders as "not available here" rather than as an off
   * switch: a toggle that saves nothing is the defect this repo has shipped
   * twice, and the wire deliberately distinguishes absent from false so the
   * screen can tell them apart.
   */
  const [agentsWeb, setAgentsWeb] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    void api.me().then((me) => {
      if (me && "assistant_instructions" in me) {
        setPrefs("ready");
        setReplyLanguage(me.assistant_reply_language ?? "");
        setReplyLength(me.assistant_reply_length ?? "");
        setInstructions(me.assistant_instructions ?? "");
        setSavedInstructions(me.assistant_instructions ?? "");
        setVoiceFa(me.assistant_voice_fa ?? "female");
        setVoiceEn(me.assistant_voice_en ?? "female");
        setAgentsWeb(me.agents_web);
      } else {
        /* audit finding, 2026-09-02: a wire without the group used to leave
           the same nothing as a wire still in flight — say which it is */
        setPrefs("absent");
      }
    }).catch(() => setPrefs("unreadable"));
  }, []);

  async function savePrefs(patch: Parameters<typeof api.updateAssistant>[0]) {
    try {
      const me = await api.updateAssistant(patch);
      setReplyLanguage(me.assistant_reply_language ?? "");
      setReplyLength(me.assistant_reply_length ?? "");
      setInstructions(me.assistant_instructions ?? "");
      setSavedInstructions(me.assistant_instructions ?? "");
      setVoiceFa(me.assistant_voice_fa ?? "female");
      setVoiceEn(me.assistant_voice_en ?? "female");
      /* adopt the SERVER's answer, never the click: if core normalised it,
         that is the value, and the switch shows what is actually in force */
      setAgentsWeb(me.agents_web);
      /* cached short phrases wear the voice they were spoken in — a saved
         gender change must reach the very next ack, not outlive it */
      clearSpeechCache();
      notify(t("assistantSaved"));
    } catch {
      notify(t("assistantSaveFailed"), "warn");
    }
  }

  return (
    <div className="space-y-5">
      <VoiceSwitches />
      <PushToTalk />
      <AgentsWebCard
        state={prefs}
        value={agentsWeb}
        onChange={(next) => void savePrefs({ agents_web: next })}
      />
      {/* db/0112 - the standing voice. The card is structure and renders with
          the page; what waits for the wire is the body (see PrefsState). */}
      <Card>
        {/* audit finding, 2026-09-02: the sibling sections (General,
            Security) title their cards with .h-section and hint in
            text-sm leading-6 — this card's 13px title and 11.5px hint made
            the heading shrink when switching General → Assistant */}
        <h2 className="h-section">{t("voiceTitle")}</h2>
        {prefs === "pending" ? (
          /* audit finding, 2026-09-02: the loading rule — a skeleton in the
             form's shape (two rows of two fields, then the instructions
             box), so the card does not grow when the answer lands */
          <div className="mt-4" aria-busy="true">
            <div className="grid gap-4 sm:grid-cols-2">
              <FieldSkeleton />
              <FieldSkeleton />
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <FieldSkeleton />
              <FieldSkeleton />
            </div>
            <FieldSkeleton className="mt-4" control="h-24" />
          </div>
        ) : prefs !== "ready" ? (
          <p className="mt-4 text-detail text-fg-muted">
            {t(prefs === "absent" ? "voiceUnavailable" : "voiceUnreadable")}
          </p>
        ) : (
          <>
            {/* audit finding, 2026-09-02: labels through the theme's Field
                (one spelling of a form label across General / Assistant /
                Notifications), and the selects wear .input UNMODIFIED — the
                h-9 min-h-0 text-sm overrides made these four dropdowns
                36px beside General's 40px, and threw away the sub-md 44px
                hit area .input carries */}
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label={t("replyLanguage")}>
                <Select
                  value={replyLanguage}
                  onChange={(next) => {
                    setReplyLanguage(next);
                    void savePrefs({ assistant_reply_language: next === "" ? null : next });
                  }}
                  options={[
                    { value: "", label: t("replyAuto") },
                    { value: "fa", label: "فارسی" },
                    { value: "en", label: "English" },
                  ]}
                />
              </Field>
              <Field label={t("replyLength")}>
                <Select
                  value={replyLength}
                  onChange={(next) => {
                    setReplyLength(next);
                    void savePrefs({ assistant_reply_length: next === "" ? null : next });
                  }}
                  options={[
                    { value: "", label: t("replyAuto") },
                    { value: "short", label: t("replyShort") },
                    { value: "detailed", label: t("replyDetailed") },
                  ]}
                />
              </Field>
            </div>
            {/* 0128 (user directive, 2026-08-28): the gender of the SPOKEN
                voice, chosen per language — the Persian and English voices
                are different models, and one switch for both would decide
                something the person did not say */}
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label={t("voiceFa")}>
                <Select
                  value={voiceFa}
                  onChange={(next) => {
                    setVoiceFa(next);
                    void savePrefs({ assistant_voice_fa: next });
                  }}
                  options={[
                    { value: "female", label: t("voiceFemale") },
                    { value: "male", label: t("voiceMale") },
                  ]}
                />
              </Field>
              <Field label={t("voiceEn")}>
                <Select
                  value={voiceEn}
                  onChange={(next) => {
                    setVoiceEn(next);
                    void savePrefs({ assistant_voice_en: next });
                  }}
                  options={[
                    { value: "female", label: t("voiceFemale") },
                    { value: "male", label: t("voiceMale") },
                  ]}
                />
              </Field>
            </div>
            <div className="mt-4">
              <Field label={t("customInstructions")}>
                {/* audit finding, 2026-09-02: .input owns the type size; the
                    textarea keeps only what a multi-line box needs on top of
                    it (a floor for its height, vertical padding, prose
                    leading — .input's leading-tight is a one-line field's) */}
                <textarea
                  className="input min-h-24 py-2 leading-6"
                  maxLength={2000}
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                />
              </Field>
            </div>
            {instructions.trim() !== savedInstructions ? (
              <button
                type="button"
                /* audit finding, 2026-09-02: was h-8 min-h-0 px-3 text-xs —
                   a 32px control no theme size has; .btn-sm is the 34px the
                   toolbar above this card already uses */
                className="btn-primary btn-sm mt-3"
                onClick={() => void savePrefs({
                  assistant_instructions: instructions.trim() === "" ? null : instructions.trim(),
                })}
              >
                {t("saveInstructions")}
              </button>
            ) : null}
          </>
        )}
      </Card>
    </div>
  );
}


/**
 * THE PUSH-TO-TALK KEY (user directive, 2026-09-04: "add a hot key section in
 * the settings in the assistant section for the mic of the assistant … you
 * click and it asks you to press the key and after that it will record and
 * submit the first key you strike; it must have an option to change as well").
 *
 * The flow the directive describes, exactly: press Choose, the card asks for a
 * key, the FIRST key struck is the binding. Not a dropdown — a list of every
 * key on a keyboard is unreadable, and the one thing a person definitely knows
 * is which key they want to press.
 *
 * CAPTURE IS A MODE, and it says so. While it is on, the card listens on the
 * window and swallows the keystroke, because the key being bound might be
 * Space on a page that scrolls: the gesture that BINDS a key must not also
 * perform the thing the key does.
 *
 * Escape leaves capture without binding, which is why it is refused as a
 * binding: a hotkey you cannot escape from is a trap, and the way out has to
 * be a key nobody can accidentally assign.
 */
function PushToTalk() {
  const t = useTranslations("settings");
  const key = useSyncExternalStore(subscribePushToTalk, pushToTalkKey, pushToTalkServer);
  const [capturing, setCapturing] = useState(false);

  useEffect(() => {
    if (!capturing) return;
    function onKey(event: KeyboardEvent) {
      event.preventDefault();
      event.stopPropagation();
      if (event.code === "Escape") { setCapturing(false); return; }
      if (!isBindableKey(event.code)) {
        /* a refusal that NAMES itself: silently ignoring the press reads as a
           card that stopped listening, and then the person presses harder */
        notify(t("hotkeyRefused"), "warn");
        return;
      }
      setPushToTalkKey(event.code);
      setCapturing(false);
      notify(t("hotkeySet", { key: pushToTalkLabel(event.code) ?? event.code }));
    }
    /* capture phase, so a field or a menu that also listens cannot eat the
       keystroke before this sees it */
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturing, t]);

  const label = pushToTalkLabel(key);
  return (
    <Card>
      <h2 className="h-section">{t("hotkeyTitle")}</h2>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {capturing ? (
          <span className="chip animate-pulse bg-accent-soft text-sm text-accent">
            {t("hotkeyPress")}
          </span>
        ) : label === null ? (
          /* "none chosen" is its own sentence, never an empty box — an empty
             control here reads as a key that failed to load */
          <span className="text-sm text-fg-muted">{t("hotkeyNone")}</span>
        ) : (
          <kbd
            className="rounded-lg border border-border-strong bg-surface-2 px-2.5 py-1 text-sm font-semibold text-fg"
            dir="ltr"
          >
            {label}
          </kbd>
        )}
        <span className="flex items-center gap-2">
          <button
            type="button"
            className="btn btn-sm border border-border bg-surface text-fg"
            onClick={() => setCapturing((on) => !on)}
          >
            {capturing ? t("hotkeyCancel") : label === null ? t("hotkeyChoose") : t("hotkeyChange")}
          </button>
          {label !== null && !capturing ? (
            <button
              type="button"
              className="btn btn-sm text-fg-muted hover:text-fg"
              onClick={() => { setPushToTalkKey(null); notify(t("hotkeyCleared")); }}
            >
              {t("hotkeyClear")}
            </button>
          ) : null}
        </span>
      </div>
    </Card>
  );
}

/**
 * «شنیدن و گفتن» — the two switches that moved off the composer (user
 * directive, 2026-09-03: "remove the items in side bar menu and put them into
 * the setting in assistant section").
 *
 * The only per-DEVICE preferences on a screen where everything else is stored
 * on the account, and that is the point rather than an inconsistency: "do not
 * listen on this machine" is a fact about a machine — a shared meeting-room
 * laptop, a desk with a dead microphone — and syncing it would carry one
 * room's decision to every other. The hint says so, because a preference that
 * silently fails to follow you to your phone is worse than one that says it
 * will not.
 *
 * No skeleton and no wire: these answer from storage, so there is no moment
 * where the card is waiting for anything.
 */
function VoiceSwitches() {
  const t = useTranslations("settings");
  const prefs = useSyncExternalStore(subscribeVoicePrefs, voicePrefs, voicePrefsServer);
  return (
    <Card>
      <h2 className="h-section">{t("voiceSwitchesTitle")}</h2>
      {/* ROWS DIVIDED BY A HAIRLINE, not boxes inside the card (user,
          2026-09-05: "remove the extra box border in the assistant settings
          for شنیدن دستیار, پاسخ با صدا, دسترسی عامل‌ها به وب"). A bordered row
          inside a bordered card is a box in a box — the same shape the
          notifications rows already refused. */}
      <div className="mt-2 divide-y divide-border">
        <SwitchRow
          label={t("earsLabel")}
          hint={t("earsHint")}
          checked={prefs.ears}
          onChange={() => {
            const next = !prefs.ears;
            setVoicePref("ears", next);
            notify(next ? t("earsOn") : t("earsOff"));
          }}
        />
        <SwitchRow
          /* the SWITCH reads "speaks its answers", not "silent" — a toggle
             whose ON position means the assistant does LESS is one everybody
             reads backwards once. The store keeps `silent` because that is
             what the voice loop asks it; the screen asks the question the
             way a person would. */
          label={t("speakLabel")}
          checked={!prefs.silent}
          onChange={() => {
            const speaking = prefs.silent;   // about to become true
            setVoicePref("silent", !speaking);
            notify(speaking ? t("silentOff") : t("silentOn"));
          }}
        />
      </div>
    </Card>
  );
}

function SwitchRow({ label, hint, checked, onChange }: {
  /* R21 (2026-09-05): a row is its NAME; a hint is the exception, one
     sentence, kept only where the name cannot carry it (the wake word) */
  label: string; hint?: string; checked: boolean; onChange: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-fg">{label}</span>
        {hint ? <span className="mt-0.5 block text-xs leading-6 text-fg-muted">{hint}</span> : null}
      </span>
      <Switch checked={checked} onChange={onChange} label={label} />
    </div>
  );
}

/**
 * «دسترسی عامل‌ها به وب» (user directive, 2026-09-03: "they must have option of
 * even using the internet if needed that can be turn on in the setting in
 * assistant section, agents web access").
 *
 * DEFAULT OFF, and the person's own. Reaching the open web is the one thing
 * these agents do that spends money outside the building and reads text nobody
 * in the organization wrote, so it is opt-in — and it is the individual's
 * opt-in rather than an admin default, because the person who pays attention
 * to an answer is the one who should decide how it was found.
 *
 * The switch is ANDed with each agent's own `web` flag on the server: either
 * off is off. That is not visible here on purpose — a settings screen
 * explaining a boolean conjunction is a settings screen nobody reads — but it
 * is why turning this on may still leave one colleague offline, and the hint
 * says "may" rather than "will".
 *
 * THREE STATES. `undefined` is a deployment without the column, and it renders
 * as an absence with a reason rather than as an off switch: a toggle that
 * saves nothing is the exact defect this repo has now shipped twice.
 */
function AgentsWebCard({ state, value, onChange }: {
  state: PrefsState;
  value: boolean | undefined;
  onChange: (next: boolean) => void;
}) {
  const t = useTranslations("settings");
  return (
    <Card>
      <h2 className="h-section">{t("agentsWebTitle")}</h2>
      <div className="mt-2">
        {state === "pending" ? (
          <Skeleton className="h-10 w-full" />
        ) : value === undefined ? (
          /* named, not hidden: a person who was told this setting exists and
             finds nothing would look for it forever */
          <p className="text-sm text-fg-muted">{t("agentsWebUnavailable")}</p>
        ) : (
          <div className="flex items-start justify-between gap-4 py-3">
            <span className="min-w-0">
              <span className="block text-sm font-medium text-fg">{t("agentsWebLabel")}</span>
            </span>
            <Switch checked={value} onChange={() => onChange(!value)} label={t("agentsWebLabel")} />
          </div>
        )}
      </div>
    </Card>
  );
}
