"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/api/client";
import { notify } from "@/lib/notify";
import { forgetVoiceGenders } from "@/lib/voice";
import { Card } from "@/components/ui";

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
  const [prefsReady, setPrefsReady] = useState(false);

  useEffect(() => {
    void api.me().then((me) => {
      if (me && "assistant_instructions" in me) {
        setPrefsReady(true);
        setReplyLanguage(me.assistant_reply_language ?? "");
        setReplyLength(me.assistant_reply_length ?? "");
        setInstructions(me.assistant_instructions ?? "");
        setSavedInstructions(me.assistant_instructions ?? "");
        setVoiceFa(me.assistant_voice_fa ?? "female");
        setVoiceEn(me.assistant_voice_en ?? "female");
      }
    }).catch(() => undefined);
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
      /* the speech module caches the choice — a saved change must reach
         the very next spoken sentence, not the next five-minute window */
      forgetVoiceGenders();
      notify(t("assistantSaved"));
    } catch {
      notify(t("assistantSaveFailed"), "warn");
    }
  }

  return (
    <div className="space-y-5">
      {/* db/0112 - the standing voice. Rendered ONLY when the wire carries
          the group: controls over columns that do not exist would save
          nothing and look saved. */}
      {prefsReady ? (
        <Card>
          <h2 className="text-sm font-semibold text-fg">{t("voiceTitle")}</h2>
          <p className="mt-1 text-xs leading-5 text-fg-muted">{t("voiceHint")}</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block text-xs text-fg-muted">
              {t("replyLanguage")}
              <select
                className="input mt-1 h-9 min-h-0 w-full text-sm"
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
            </label>
            <label className="block text-xs text-fg-muted">
              {t("replyLength")}
              <select
                className="input mt-1 h-9 min-h-0 w-full text-sm"
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
            </label>
          </div>
          {/* 0128 (user directive, 2026-08-28): the gender of the SPOKEN
              voice, chosen per language — the Persian and English voices
              are different models, and one switch for both would decide
              something the person did not say */}
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block text-xs text-fg-muted">
              {t("voiceFa")}
              <select
                className="input mt-1 h-9 min-h-0 w-full text-sm"
                value={voiceFa}
                onChange={(e) => {
                  setVoiceFa(e.target.value);
                  void savePrefs({ assistant_voice_fa: e.target.value });
                }}
              >
                <option value="female">{t("voiceFemale")}</option>
                <option value="male">{t("voiceMale")}</option>
              </select>
            </label>
            <label className="block text-xs text-fg-muted">
              {t("voiceEn")}
              <select
                className="input mt-1 h-9 min-h-0 w-full text-sm"
                value={voiceEn}
                onChange={(e) => {
                  setVoiceEn(e.target.value);
                  void savePrefs({ assistant_voice_en: e.target.value });
                }}
              >
                <option value="female">{t("voiceFemale")}</option>
                <option value="male">{t("voiceMale")}</option>
              </select>
            </label>
          </div>
          <label className="mt-3 block text-xs text-fg-muted">
            {t("customInstructions")}
            <textarea
              className="input mt-1 min-h-24 py-2 text-sm leading-6"
              maxLength={2000}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
            />
          </label>
          {instructions.trim() !== savedInstructions ? (
            <button
              type="button"
              className="btn-primary mt-2 h-8 min-h-0 px-3 text-xs"
              onClick={() => void savePrefs({
                assistant_instructions: instructions.trim() === "" ? null : instructions.trim(),
              })}
            >
              {t("saveInstructions")}
            </button>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
