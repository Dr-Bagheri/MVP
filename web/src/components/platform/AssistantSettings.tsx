"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/api/client";
import { notify } from "@/lib/notify";
import { clearSpeechCache } from "@/lib/voice";
import { Card, Field } from "@/components/ui";
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
      {/* db/0112 - the standing voice. The card is structure and renders with
          the page; what waits for the wire is the body (see PrefsState). */}
      <Card>
        {/* audit finding, 2026-09-02: the sibling sections (General,
            Security) title their cards with .h-section and hint in
            text-sm leading-6 — this card's 13px title and 11.5px hint made
            the heading shrink when switching General → Assistant */}
        <h2 className="h-section">{t("voiceTitle")}</h2>
        <p className="mt-1 text-sm leading-6 text-fg-muted">{t("voiceHint")}</p>
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
                <select
                  className="input"
                  value={replyLanguage}
                  onChange={(e) => {
                    setReplyLanguage(e.target.value);
                    void savePrefs({ assistant_reply_language: e.target.value === "" ? null : e.target.value });
                  }}
                >
                  <option value="">{t("replyAuto")}</option>
                  <option value="fa">فارسی</option>
                  <option value="en">English</option>
                </select>
              </Field>
              <Field label={t("replyLength")}>
                <select
                  className="input"
                  value={replyLength}
                  onChange={(e) => {
                    setReplyLength(e.target.value);
                    void savePrefs({ assistant_reply_length: e.target.value === "" ? null : e.target.value });
                  }}
                >
                  <option value="">{t("replyAuto")}</option>
                  <option value="short">{t("replyShort")}</option>
                  <option value="detailed">{t("replyDetailed")}</option>
                </select>
              </Field>
            </div>
            {/* 0128 (user directive, 2026-08-28): the gender of the SPOKEN
                voice, chosen per language — the Persian and English voices
                are different models, and one switch for both would decide
                something the person did not say */}
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label={t("voiceFa")}>
                <select
                  className="input"
                  value={voiceFa}
                  onChange={(e) => {
                    setVoiceFa(e.target.value);
                    void savePrefs({ assistant_voice_fa: e.target.value });
                  }}
                >
                  <option value="female">{t("voiceFemale")}</option>
                  <option value="male">{t("voiceMale")}</option>
                </select>
              </Field>
              <Field label={t("voiceEn")}>
                <select
                  className="input"
                  value={voiceEn}
                  onChange={(e) => {
                    setVoiceEn(e.target.value);
                    void savePrefs({ assistant_voice_en: e.target.value });
                  }}
                >
                  <option value="female">{t("voiceFemale")}</option>
                  <option value="male">{t("voiceMale")}</option>
                </select>
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
