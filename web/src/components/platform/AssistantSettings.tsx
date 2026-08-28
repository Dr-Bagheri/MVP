"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/api/client";
import { notify } from "@/lib/notify";
import { Card } from "@/components/ui";

/**
 * Settings·Assistant (user directive, 2026-08-21): the weekly-digest
 * subscription and the assistant's voice, MOVED here from the presence
 * dock — a conversation panel is not a place to configure the person
 * having it.
 *
 * [REVISED 2026-08-28, user directive] the autonomy dial LEFT this screen
 * (and the product): "remove watch and act from everywhere in the
 * platform. the only thing that must be in the platform is assist" —
 * assist is pinned server-side (PINNED_AUTONOMY in core) and is not shown
 * or offered anywhere. Saves announce themselves on the notification bus —
 * the orb's head, like every other notice.
 */
export function AssistantSettings() {
  const t = useTranslations("settings");
  /** db/0112 - the standing voice. null = auto; save-on-change, adopt the
      server's answer, never optimistic-and-forget. */
  const [replyLanguage, setReplyLanguage] = useState<string>("");
  const [replyLength, setReplyLength] = useState<string>("");
  const [instructions, setInstructions] = useState<string>("");
  const [savedInstructions, setSavedInstructions] = useState<string>("");
  const [brief, setBrief] = useState<boolean | null>(null);
  /* db/0115. `undefined` from the wire means the deployment has not migrated
     — a different fact from "off", and rendered as absence rather than as a
     switch that would lie about its state. */
  const [autoDraft, setAutoDraft] = useState<boolean | null>(null);
  const [meetingPrep, setMeetingPrep] = useState<boolean | null>(null);
  const [prefsReady, setPrefsReady] = useState(false);
  const [digest, setDigest] = useState<{ enabled: boolean; available: boolean } | null>(null);

  useEffect(() => {
    void api.me().then((me) => {
      if (me && "assistant_instructions" in me) {
        setPrefsReady(true);
        setReplyLanguage(me.assistant_reply_language ?? "");
        setReplyLength(me.assistant_reply_length ?? "");
        setInstructions(me.assistant_instructions ?? "");
        setSavedInstructions(me.assistant_instructions ?? "");
        setBrief(me.post_call_brief !== false);
        setAutoDraft(me.auto_draft_replies === undefined ? null : me.auto_draft_replies === true);
        setMeetingPrep(me.auto_meeting_prep === undefined ? null : me.auto_meeting_prep === true);
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
      setAutoDraft(me.auto_draft_replies === undefined ? null : me.auto_draft_replies === true);
      notify(t("assistantSaved"));
    } catch {
      notify(t("assistantSaveFailed"), "warn");
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
          {autoDraft !== null ? (
            <>
              <label className="mt-4 flex items-center gap-2 text-sm text-fg">
                <input
                  type="checkbox"
                  checked={autoDraft}
                  onChange={(e) => {
                    setAutoDraft(e.target.checked);
                    void savePrefs({ auto_draft_replies: e.target.checked });
                  }}
                />
                {t("autoDraft")}
              </label>
              {/* the sentence has to carry the whole bargain: what gets read,
                  how new is new, and the part people assume wrongly — that
                  something might go out without them */}
              <p className="mt-1 text-xs leading-5 text-fg-subtle">{t("autoDraftHint")}</p>
            </>
          ) : null}
          {meetingPrep !== null ? (
            <>
              <label className="mt-4 flex items-center gap-2 text-sm text-fg">
                <input
                  type="checkbox"
                  checked={meetingPrep}
                  onChange={(e) => {
                    setMeetingPrep(e.target.checked);
                    void savePrefs({ auto_meeting_prep: e.target.checked });
                  }}
                />
                {t("meetingPrep")}
              </label>
              <p className="mt-1 text-xs leading-5 text-fg-subtle">{t("meetingPrepHint")}</p>
            </>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
