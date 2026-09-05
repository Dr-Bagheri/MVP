"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Switch } from "@/components/Switch";
import { api } from "@/api/client";
import { notify } from "@/lib/notify";
import { FormPanel, FormRow, Skeleton } from "@/components/scaffold";

/**
 * Settings·Notifications (user directive, 2026-08-28: "add this setting with
 * their functions for notification in settings") — every switch the platform
 * has that decides whether something gets MADE for you unprompted, on one
 * screen, one row each: a name and a switch at the row's end. Nothing here is
 * decorative — a toggle wired to nothing is worse than absent, so only
 * server-stored facts appear. (The one-line descriptions went with R21 and
 * the user's word on 2026-09-05: "remove the line … just the name".)
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
 *
 * THE FOUR ARRIVE TOGETHER (user, 2026-09-05: "weekly report always loads a
 * little later than the other toggles"). Three rows come from `me` and the
 * digest from its own endpoint, and each row used to adopt its answer the
 * moment it landed — so the digest's skeleton outlived the others by one
 * round trip on every visit, which reads as that one row being broken. The
 * two reads still run in parallel; the rows now wait for BOTH and appear in
 * one frame. A failed read is still its own row's "unreadable", never the
 * group's: the kinds of nothing stay apart (rule 12).
 */

/**
 * One row's truth, four ways — the kinds of nothing kept apart (rule 12):
 * `null`         = still loading — a skeleton the switch's size holds the
 *                  control's place, so the row makes no claim and does not
 *                  move when the answer lands (see NotificationRow);
 * `"absent"`     = the deployment cannot store this yet (capability-gated
 *                  column or feature not migrated) — the honest reason
 *                  renders where the switch would be;
 * `"unreadable"` = the current state could not be READ — a different
 *                  nothing from "not available", and it must not wear that
 *                  costume;
 * `boolean`      = the stored fact, and only then a switch.
 */
type RowState = boolean | "absent" | "unreadable" | null;

type Group = { brief: RowState; autoDraft: RowState; meetingPrep: RowState };

/** the SERVER's answer for the whole assistant group — the same shape
    Settings·Assistant and the workflow pages read */
function fromMe(me: Awaited<ReturnType<typeof api.updateAssistant>>): Group {
  return {
    brief: me.post_call_brief !== false,
    autoDraft: me.auto_draft_replies === undefined ? "absent" : me.auto_draft_replies === true,
    meetingPrep: me.auto_meeting_prep === undefined ? "absent" : me.auto_meeting_prep === true,
  };
}

const ALL = (state: Exclude<RowState, boolean | null>): Group =>
  ({ brief: state, autoDraft: state, meetingPrep: state });

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

  function adopt(group: Group): void {
    setBrief(group.brief);
    setAutoDraft(group.autoDraft);
    setMeetingPrep(group.meetingPrep);
  }

  useEffect(() => {
    const assistant = api.me().then(
      (me) => {
        // no identity is not "the deployment lacks the column"
        if (me === null) return ALL("unreadable");
        if ("assistant_instructions" in me) return fromMe(me);
        // pre-0112 deployment: the whole group has nowhere to live
        return ALL("absent");
      },
      () => ALL("unreadable"),
    );
    const weekly = api.weeklyDigest().then(
      (d): RowState => (d.available ? d.enabled : "absent"),
      (): RowState => "unreadable",
    );
    // both settled, then one frame: neither promise can reject past its own
    // handler above, so this is the arrival, not a failure gate
    void Promise.all([assistant, weekly]).then(([group, digestState]) => {
      adopt(group);
      setDigest(digestState);
    });
  }, []);

  async function saveAssistant(patch: Parameters<typeof api.updateAssistant>[0]): Promise<void> {
    setSaving(true);
    try {
      // save-then-adopt: the switch holds still until the server answers,
      // and what it adopts is the server's value — a refused or normalized
      // write shows as what actually happened, never as what was hoped
      adopt(fromMe(await api.updateAssistant(patch)));
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
        state={brief}
        busy={saving}
        onToggle={(next) => void saveAssistant({ post_call_brief: next })}
      />
      <NotificationRow
        id="notif-digest"
        label={t("notifDigest")}
        state={digest}
        busy={saving}
        onToggle={(next) => void saveDigest(next)}
      />
      <NotificationRow
        id="notif-auto-draft"
        label={t("notifAutoDraft")}
        state={autoDraft}
        busy={saving}
        onToggle={(next) => void saveAssistant({ auto_draft_replies: next })}
      />
      <NotificationRow
        id="notif-meeting-prep"
        label={t("notifMeetingPrep")}
        state={meetingPrep}
        busy={saving}
        onToggle={(next) => void saveAssistant({ auto_meeting_prep: next })}
      />
    </FormPanel>
  );
}

/**
 * One notification row: a name at the row's start, the switch at the row's
 * END (user, 2026-09-05: "their toggles are not in the right place, put them
 * at the end of the row" — the control cell's 380px cap, right for a text
 * field, had parked every switch in the middle of a 1040px row). A
 * non-boolean state renders the REASON in the switch's place — the
 * capability pattern: a switch someone could press against a server with
 * nowhere to store the answer would lie about its state.
 */
function NotificationRow({
  id,
  label,
  state,
  busy,
  onToggle,
}: {
  id: string;
  label: string;
  state: RowState;
  busy: boolean;
  onToggle: (next: boolean) => void;
}) {
  const t = useTranslations("settings");
  return (
    <FormRow label={label} htmlFor={id} controlAtEnd>
      {state === null ? (
        /* 2026-09-03: the frame before the data — loading and "this row has
           no switch" were one picture. The label rendered at once and the
           control cell stayed EMPTY until the answer landed, which is exactly
           what the two non-boolean states look like: a row with no control.
           The bar is the switch's own geometry (44×24, fully round — TRACK.md
           in Switch.tsx), so nothing moves when the answer arrives, and it
           carries `aria-hidden` from Skeleton: a placeholder must not be
           announced as a control that does not exist yet. */
        <Skeleton className="h-6 w-11 rounded-full" />
      ) : typeof state !== "boolean" ? (
        <span className="text-detail text-fg-muted">
          {t(state === "absent" ? "notifUnavailable" : "notifUnreadable")}
        </span>
      ) : (
        /* the theme's switch (2026-09-03): nine of these were hand-drawn, in
           two track sizes with two knob colours and two ideas of what "on"
           looks like. One component, named sizes. */
        <Switch
          id={id}
          checked={state}
          onChange={() => onToggle(!state)}
          label={label}
          disabled={busy}
        />
      )}
    </FormRow>
  );
}
