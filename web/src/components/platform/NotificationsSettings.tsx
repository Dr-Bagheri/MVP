"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/api/client";
import { notify } from "@/lib/notify";
import { FormPanel, FormRow } from "@/components/scaffold";

/**
 * Settings·Notifications (user directive, 2026-08-28: "add this setting with
 * their functions for notification in settings") — every switch the platform
 * has that decides whether something gets MADE for you unprompted, on one
 * screen, one row each: title, one line saying what the notification IS, a
 * switch. Nothing here is decorative — a toggle wired to nothing is worse
 * than absent, so only server-stored facts appear.
 *
 * The post-call brief and the weekly digest MOVED here out of
 * Settings·Assistant (which keeps the voice: reply language/length and
 * standing instructions). Same store, same calls — CONSUMED, not forked:
 * two editable copies of one fact on two pages is exactly the drift this
 * repo keeps burying.
 *
 * Auto-draft replies and meeting preparation ALSO have switches on their
 * workflow detail pages, and that deliberately stays: both read and write
 * the same `me` columns through `api.updateAssistant` and adopt the
 * server's answer, so the two surfaces cannot disagree — two doors to one
 * room, not two rooms.
 *
 * Save-then-adopt, never optimistic: a switch does not move until the
 * server holds the fact, and a failed save says so.
 */

/**
 * One row's truth, four ways — the kinds of nothing kept apart (rule 12):
 * `null`         = still loading (no control, no claim);
 * `"absent"`     = the deployment cannot store this yet (capability-gated
 *                  column or feature not migrated) — the honest reason
 *                  renders where the switch would be;
 * `"unreadable"` = the current state could not be READ — a different
 *                  nothing from "not available", and it must not wear that
 *                  costume;
 * `boolean`      = the stored fact, and only then a switch.
 */
type RowState = boolean | "absent" | "unreadable" | null;

export function NotificationsSettings() {
  const t = useTranslations("settings");
  /** db/0112 — a card after each processed recording */
  const [brief, setBrief] = useState<RowState>(null);
  /** db/0115 — drafted replies for new mail (needs a connected mailbox) */
  const [autoDraft, setAutoDraft] = useState<RowState>(null);
  /** db/0117 — a pre-read before each meeting */
  const [meetingPrep, setMeetingPrep] = useState<RowState>(null);
  /** db/0074 — the Saturday summary card */
  const [digest, setDigest] = useState<RowState>(null);
  /**
   * ONE save in flight at a time: every assistant save adopts the whole
   * group from the returned `me`, so two concurrent PATCHes could adopt
   * each other's stale reads. Holding all switches during a save costs a
   * moment and removes the race.
   */
  const [saving, setSaving] = useState(false);

  /** adopt the SERVER's answer for the whole assistant group — the same
      shape Settings·Assistant and the workflow pages read */
  function adopt(me: Awaited<ReturnType<typeof api.updateAssistant>>): void {
    setBrief(me.post_call_brief !== false);
    setAutoDraft(me.auto_draft_replies === undefined ? "absent" : me.auto_draft_replies === true);
    setMeetingPrep(me.auto_meeting_prep === undefined ? "absent" : me.auto_meeting_prep === true);
  }

  useEffect(() => {
    void api
      .me()
      .then((me) => {
        if (me === null) {
          // no identity is not "the deployment lacks the column"
          setBrief("unreadable");
          setAutoDraft("unreadable");
          setMeetingPrep("unreadable");
        } else if ("assistant_instructions" in me) {
          adopt(me);
        } else {
          // pre-0112 deployment: the whole group has nowhere to live
          setBrief("absent");
          setAutoDraft("absent");
          setMeetingPrep("absent");
        }
      })
      .catch(() => {
        setBrief("unreadable");
        setAutoDraft("unreadable");
        setMeetingPrep("unreadable");
      });
    void api
      .weeklyDigest()
      .then((d) => setDigest(d.available ? d.enabled : "absent"))
      .catch(() => setDigest("unreadable"));
  }, []);

  async function saveAssistant(patch: Parameters<typeof api.updateAssistant>[0]): Promise<void> {
    setSaving(true);
    try {
      // save-then-adopt: the switch holds still until the server answers,
      // and what it adopts is the server's value — a refused or normalized
      // write shows as what actually happened, never as what was hoped
      adopt(await api.updateAssistant(patch));
      notify(t("assistantSaved"));
    } catch {
      notify(t("assistantSaveFailed"), "warn");
    } finally {
      setSaving(false);
    }
  }

  async function saveDigest(next: boolean): Promise<void> {
    setSaving(true);
    try {
      await api.setWeeklyDigest(next);
      // this write returns no body: the accepted value IS the answer
      setDigest(next);
      notify(t("assistantSaved"));
    } catch {
      // the switch never moved — nothing to roll back, only to say
      notify(t("assistantSaveFailed"), "warn");
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormPanel>
      <NotificationRow
        id="notif-post-call-brief"
        label={t("notifPostCallBrief")}
        description={t("notifPostCallBriefDesc")}
        state={brief}
        busy={saving}
        onToggle={(next) => void saveAssistant({ post_call_brief: next })}
      />
      <NotificationRow
        id="notif-digest"
        label={t("notifDigest")}
        description={t("notifDigestDesc")}
        state={digest}
        busy={saving}
        onToggle={(next) => void saveDigest(next)}
      />
      <NotificationRow
        id="notif-auto-draft"
        label={t("notifAutoDraft")}
        description={t("notifAutoDraftDesc")}
        state={autoDraft}
        busy={saving}
        onToggle={(next) => void saveAssistant({ auto_draft_replies: next })}
      />
      <NotificationRow
        id="notif-meeting-prep"
        label={t("notifMeetingPrep")}
        description={t("notifMeetingPrepDesc")}
        state={meetingPrep}
        busy={saving}
        onToggle={(next) => void saveAssistant({ auto_meeting_prep: next })}
      />
    </FormPanel>
  );
}

/**
 * One notification row: the reference anatomy (title, one-line description,
 * switch at inline-end) on the blueprint's FormRow. A non-boolean state
 * renders the REASON in the switch's place — the capability pattern: a
 * switch someone could press against a server with nowhere to store the
 * answer would lie about its state.
 */
function NotificationRow({
  id,
  label,
  description,
  state,
  busy,
  onToggle,
}: {
  id: string;
  label: string;
  description: string;
  state: RowState;
  busy: boolean;
  onToggle: (next: boolean) => void;
}) {
  const t = useTranslations("settings");
  return (
    <FormRow label={label} description={description} htmlFor={id}>
      {state === null ? null : typeof state !== "boolean" ? (
        <span className="text-detail text-fg-muted">
          {t(state === "absent" ? "notifUnavailable" : "notifUnreadable")}
        </span>
      ) : (
        <button
          id={id}
          type="button"
          role="switch"
          aria-checked={state}
          disabled={busy}
          className={`tap relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60 ${
            state ? "bg-accent" : "border border-border bg-surface-2"
          }`}
          onClick={() => onToggle(!state)}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
              state ? "end-0.5" : "start-0.5"
            }`}
            aria-hidden
          />
        </button>
      )}
    </FormRow>
  );
}
