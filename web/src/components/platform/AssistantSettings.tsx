"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/api/client";
import { notify } from "@/lib/notify";
import { Card } from "@/components/ui";

/**
 * Settings·Assistant (user directive, 2026-08-21): the autonomy dial and
 * the weekly-digest subscription, MOVED here from the presence dock — a
 * conversation panel is not a place to configure the person having it.
 *
 * The dial's initial value is the STORED one (/v1/me serves `autonomy`
 * since the same batch); an older core omits the field and the control
 * shows the schema default (assist) without claiming it was read. Saves
 * announce themselves on the notification bus — the orb's head, like
 * every other notice.
 */
export function AssistantSettings() {
  const t = useTranslations("settings");
  const [autonomy, setAutonomy] = useState<"watch" | "assist" | "act">("assist");
  /** db/0112 - the standing voice. null = auto; save-on-change, adopt the
      server's answer, never optimistic-and-forget. */
  const [replyLanguage, setReplyLanguage] = useState<string>("");
  const [replyLength, setReplyLength] = useState<string>("");
  const [instructions, setInstructions] = useState<string>("");
  const [savedInstructions, setSavedInstructions] = useState<string>("");
  const [brief, setBrief] = useState<boolean | null>(null);
  const [prefsReady, setPrefsReady] = useState(false);
  const [digest, setDigest] = useState<{ enabled: boolean; available: boolean } | null>(null);
  const [notReady, setNotReady] = useState(false);

  useEffect(() => {
    void api.me().then((me) => {
      if (me?.autonomy) setAutonomy(me.autonomy);
      if (me && "assistant_instructions" in me) {
        setPrefsReady(true);
        setReplyLanguage(me.assistant_reply_language ?? "");
        setReplyLength(me.assistant_reply_length ?? "");
        setInstructions(me.assistant_instructions ?? "");
        setSavedInstructions(me.assistant_instructions ?? "");
        setBrief(me.post_call_brief !== false);
      }
    }).catch(() => undefined);
    void api.weeklyDigest()
      .then((d) => setDigest(d.available ? d : null))
      .catch(() => setDigest(null));
  }, []);

  async function savePrefs(patch: Parameters<typeof api.updateAssistant>[0]) {
    try {
      const me = await api.updateAssistant(patch);
      setReplyLanguage(me.assistant_reply_language ?? "");
      setReplyLength(me.assistant_reply_length ?? "");
      setInstructions(me.assistant_instructions ?? "");
      setSavedInstructions(me.assistant_instructions ?? "");
      setBrief(me.post_call_brief !== false);
      notify(t("assistantSaved"));
    } catch {
      notify(t("assistantSaveFailed"), "warn");
    }
  }

  async function saveAutonomy(next: "watch" | "assist" | "act") {
    const prev = autonomy;
    setAutonomy(next);
    setNotReady(false);
    try {
      await api.setAutonomy(next);
      notify(t("assistantSaved"));
    } catch (cause) {
      setAutonomy(prev);
      const { status, detail } = cause as { status?: number; detail?: string };
      const missing = status === 409 || detail === "not_migrated";
      setNotReady(missing);
      notify(missing ? t("assistantNotReady") : t("assistantSaveFailed"), "warn");
    }
  }

  function saveDigest(enabled: boolean) {
    setDigest({ available: true, enabled });
    void api.setWeeklyDigest(enabled)
      .then(() => notify(t("assistantSaved")))
      .catch(() => {
        setDigest({ available: true, enabled: !enabled });
        notify(t("assistantSaveFailed"), "warn");
      });
  }

  return (
    <div className="space-y-5">
      <Card>
        <h2 className="text-sm font-semibold text-fg">{t("assistantAutonomy")}</h2>
        <p className="mt-1 text-xs leading-5 text-fg-muted">{t("assistantAutonomyHint")}</p>
        <select
          aria-label={t("assistantAutonomy")}
          className="input mt-3 h-9 min-h-0 w-full max-w-xs text-sm"
          value={autonomy}
          onChange={(e) => void saveAutonomy(e.target.value as "watch" | "assist" | "act")}
        >
          <option value="watch">{t("assistantWatch")}</option>
          {/* assist = the schema default (db/0073) */}
          <option value="assist">{t("assistantAssist")}</option>
          {/* act: write-effect surface actions run without the consent card.
              The org's ceiling (db/0075) still caps the EFFECT server-side. */}
          <option value="act">{t("assistantAct")}</option>
        </select>
        {notReady ? (
          <p role="status" className="mt-2 text-xs text-warning">{t("assistantNotReady")}</p>
        ) : null}
      </Card>

      <Card>
        <h2 className="text-sm font-semibold text-fg">{t("assistantDigest")}</h2>
        <p className="mt-1 text-xs leading-5 text-fg-muted">{t("assistantDigestHint")}</p>
        {digest === null ? (
          /* db/0074 absent or unreadable — an honest "not available", never
             a checkbox that silently discards its write */
          <p className="mt-3 text-xs text-fg-muted">{t("assistantNotReady")}</p>
        ) : (
          <label className="mt-3 flex items-center gap-2 text-sm text-fg">
            <input
              type="checkbox"
              checked={digest.enabled}
              onChange={(e) => saveDigest(e.target.checked)}
            />
            {t("assistantDigest")}
          </label>
        )}
      </Card>

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
          {brief !== null ? (
            <label className="mt-4 flex items-center gap-2 text-sm text-fg">
              <input
                type="checkbox"
                checked={brief}
                onChange={(e) => {
                  setBrief(e.target.checked);
                  void savePrefs({ post_call_brief: e.target.checked });
                }}
              />
              {t("postCallBrief")}
            </label>
          ) : null}
          <p className="mt-1 text-xs leading-5 text-fg-subtle">{t("postCallBriefHint")}</p>
        </Card>
      ) : null}
    </div>
  );
}
