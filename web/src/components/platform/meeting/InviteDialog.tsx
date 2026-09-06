"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { MeetingRecord, OrgPersonRecord } from "@/api/types";
import { Overlay } from "@/components/platform/Overlay";
import { Avatar } from "@/components/Avatar";
import { IconCheck, IconClose, IconCopy, IconSearch } from "@/components/icons";
import { personName } from "@/lib/format";
import { Skeleton } from "@/components/scaffold";

/**
 * WHO IS COMING — and being told about it is the SAME ACT (db/0202).
 *
 * ── What was wrong, and why this is a rewrite rather than a patch ─────────
 *
 * A colleague used to be added as a NAME: the picker wrote `personName(...)`
 * into `meeting.invitees`, a text array. Three consequences, all of them
 * visible in the user's own screenshot of a three-person meeting:
 *
 *   · the same person appeared twice under two spellings («drbagheri» beside
 *     «دکتر باقری»), because a name typed on one surface and a name resolved
 *     on another are two different strings about one person — the
 *     two-spellings defect, wearing a roster;
 *   · nobody was TOLD. A second dialog («دعوت همکاران») minted the
 *     invitations, so being put on a meeting and hearing about it were two
 *     buttons and could come apart in either direction;
 *   · and the platform threw away the one fact it had: WHICH ACCOUNT. A name
 *     cannot be matched to a speaker, to a notification, or to an attendance.
 *
 * So the model changed underneath: a colleague is a ROW keyed by their
 * account (0202), and adding them mints the invitation in the same request —
 * the bell carries accept and reject exactly as it does for a chat room
 * (0189's cards, which already knew the meeting kind).
 *
 * ── Two kinds of person, still ────────────────────────────────────────────
 *
 *   COLLEAGUES are picked from the directory. `orgPeople` is the same list
 *   every picker on the platform uses — user management's own rows — and it
 *   returns names and roles and NEVER emails.
 *
 *   EVERYONE ELSE is typed, and stays in `invitees`. That is all the text
 *   array is for now, which is what 0145 wrote it down for in the first
 *   place: a person outside the platform has no row to pick, and the guest
 *   link sits in this window because "how does this person actually get in"
 *   is only useful beside the place you add them.
 *
 * MEMBERS AND ADMINS ALIKE, and there is no role check here on purpose: the
 * meeting's own policies decide who may edit it. A check in a dialog is a
 * check the server does not have.
 */
export function InviteDialog({
  meeting,
  onMeeting,
  onFailed,
  onClose,
  guestLinkCopied,
  onCopyGuestLink,
}: {
  meeting: MeetingRecord;
  /** the server's answer, adopted — never an optimistic local roster */
  onMeeting: (next: MeetingRecord) => void;
  onFailed: () => void;
  onClose: () => void;
  /** true once a link has been minted and put on the clipboard this session */
  guestLinkCopied: boolean;
  onCopyGuestLink: () => void;
}) {
  const t = useTranslations("meetings");
  const locale = useLocale();
  const [people, setPeople] = useState<OrgPersonRecord[] | null>(null);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  /** the ids in flight, so one row cannot be pressed twice into two requests */
  const [busy, setBusy] = useState<string[]>([]);

  useEffect(() => {
    void api.orgPeople().then(setPeople).catch(() => setPeople([]));
  }, []);

  const onMeetingIds = useMemo(
    () => new Set(meeting.attendees.map((a) => a.user_id)),
    [meeting.attendees],
  );
  /**
   * WHO CANNOT BE TAKEN OFF: the people who actually came.
   *
   * Adding and removing here are a PLAN being corrected — a mis-picked
   * colleague, a change of mind — and a plan is not a record. But db/0202's
   * row also carries `attended_at`, so once somebody has been in the room,
   * removing them would erase the platform's own evidence of it: the fact
   * the transcript's roster reads, and the one this whole migration exists
   * to keep. That is a delete, and this dialog is not where a record gets
   * deleted.
   *
   * It is also what makes the removal above genuinely non-destructive, and
   * therefore what the confirm guard's entry says (confirm.guard.test.ts):
   * this control can only ever unmake a plan.
   *
   * Read by the two CONTROLS and nowhere else. A third copy inside `toggle`
   * would be a wall no press could reach — which reads as rigour, cannot
   * fail, and is how the rule that matters ends up untested (found by
   * verify-red on exactly that line).
   */
  const wasHere = useMemo(
    () => new Set(meeting.attendees.filter((a) => a.attended).map((a) => a.user_id)),
    [meeting.attendees],
  );

  const shown = useMemo(() => {
    const rows = people ?? [];
    const q = query.trim().toLowerCase();
    if (q === "") return rows;
    /* BOTH NAMES AND THE HANDLE — the way every other search on this platform
       matches a person. A colleague findable by one of their two names and
       not the other is a colleague the search says does not exist, and the
       username is what somebody types when they know it. */
    return rows.filter((p) =>
      [p.display_name, p.display_name_en ?? "", p.username ?? ""]
        .some((s) => s.toLowerCase().includes(q)));
  }, [people, query]);

  const toggle = (userId: string) => {
    if (busy.includes(userId)) return;
    setBusy((cur) => [...cur, userId]);
    const call = onMeetingIds.has(userId)
      ? api.removeMeetingAttendee(meeting.id, userId)
      : api.addMeetingAttendees(meeting.id, [userId]);
    void call
      .then(onMeeting)
      .catch(onFailed)
      .finally(() => setBusy((cur) => cur.filter((v) => v !== userId)));
  };

  /* the typed half writes the TEXT list, which is the only thing it can
     honestly write: somebody with no account here has no row to add */
  const addTyped = () => {
    const name = draft.trim();
    if (name === "" || meeting.invitees.includes(name)) { setDraft(""); return; }
    setDraft("");
    void api.updateMeeting(meeting.id, { invitees: [...meeting.invitees, name] })
      .then(onMeeting).catch(onFailed);
  };

  const removeTyped = (name: string) => {
    void api.updateMeeting(meeting.id, { invitees: meeting.invitees.filter((v) => v !== name) })
      .then(onMeeting).catch(onFailed);
  };

  return (
    <Overlay onClose={onClose} label={t("inviteTitle")} size="md">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-fg">{t("inviteTitle")}</h2>
        </div>
        <button
          type="button"
          aria-label={t("close")}
          onClick={onClose}
          className="btn btn-icon shrink-0 border border-border text-fg-subtle hover:text-fg"
        >
          <IconClose width={14} height={14} />
        </button>
      </div>

      {/* WHAT PRESSING A ROW DOES, said once. 0189's own rule: an invitation
          grants nothing — a meeting is org-readable already — so the honest
          sentence is that the person is put on the meeting and told about
          it, which is a CONSEQUENCE and not an explanation (R21). */}
      <p className="mb-2 text-xs text-fg-muted">{t("inviteNotifies")}</p>

      <label className="relative block">
        <span className="sr-only">{t("inviteSearch")}</span>
        <input
          className="input ps-9"
          placeholder={t("inviteSearch")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="pointer-events-none absolute top-1/2 -translate-y-1/2 text-fg-subtle" style={{ insetInlineStart: "0.75rem" }}>
          <IconSearch width={14} height={14} />
        </span>
      </label>

      <div className="mt-2 max-h-64 overflow-y-auto">
        {people === null ? (
          /* the list's own frame with placeholder rows — the platform's
             loading rule, so the dialog does not change height when the
             directory lands under the pointer */
          <div className="space-y-1.5 py-1">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="flex items-center gap-2 px-1 py-1.5">
                <Skeleton className="h-7 w-7 rounded-full" />
                <Skeleton className="h-4 w-40" />
              </div>
            ))}
          </div>
        ) : shown.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-fg-subtle">{t("inviteNoPeople")}</p>
        ) : (
          <ul className="space-y-1">
            {shown.map((person) => {
              const name = personName(person, locale);
              const chosen = onMeetingIds.has(person.id);
              const isHost = person.id === meeting.created_by;
              return (
                <li key={person.id}>
                  <button
                    type="button"
                    aria-pressed={chosen}
                    /* THE HOST IS ALREADY IN THE MEETING — they made it. A
                       row that could add them would mint an invitation to
                       their own meeting, and one that could remove them
                       would promise something the record does not have. */
                    disabled={isHost || wasHere.has(person.id) || busy.includes(person.id)}
                    onClick={() => toggle(person.id)}
                    className={`flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-start transition-colors disabled:opacity-60 ${
                      chosen
                        ? "border-accent bg-accent-soft"
                        : "border-transparent hover:border-border hover:bg-surface-2"
                    }`}
                  >
                    {/* NOT `<Avatar>`, deliberately (2026-09-03 sweep). This
                        well is the row's SELECTION control, not a person mark:
                        pressing it swaps the initial for a tick, and `Avatar`
                        has no prop for that. Converting only the unchosen half
                        would be worse than either — `Avatar` carries a hairline
                        ring and this does not, so the well would visibly change
                        its edge on press. If the person mark and the tick are
                        ever wanted as one thing, the fix is a prop on `Avatar`,
                        not a fifth circle drawn here. Its 28px matches
                        `size="sm"`, and the Skeleton above stands in at the
                        same 28, so the list does not jump when people land. */}
                    <span
                      className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-bold ${
                        chosen ? "bg-accent text-on-accent" : "bg-surface-2 text-fg-muted"
                      }`}
                      aria-hidden
                    >
                      {chosen ? <IconCheck width={12} height={12} /> : name.slice(0, 1)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-fg">{name}</span>
                      <span className="block text-[10px] text-fg-subtle">
                        {/* the HANDLE beside the role: it is what makes two
                            colleagues with one display name tellable apart,
                            and it is the name user management shows */}
                        {person.username === null ? person.role : `@${person.username} · ${person.role}`}
                      </span>
                    </span>
                    {isHost ? (
                      <span className="shrink-0 rounded-full border border-border bg-surface px-2 py-0.5 text-[10px] text-fg-subtle">
                        {t("memberHost")}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="mt-3 border-t border-border pt-3">
        <p className="mb-1.5 text-xs font-semibold text-fg">{t("inviteOutside")}</p>
        <div className="flex gap-1.5">
          <input
            className="input"
            placeholder={t("inviteePlaceholder")}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTyped(); } }}
          />
          <button
            type="button"
            className="btn shrink-0 bg-accent text-on-accent"
            disabled={draft.trim() === ""}
            onClick={addTyped}
          >
            {t("addInvitee")}
          </button>
        </div>
        <button
          type="button"
          onClick={onCopyGuestLink}
          className="btn btn-sm mt-2 w-full border border-border font-medium text-fg-muted hover:text-fg"
        >
          <IconCopy width={12} height={12} />
          {guestLinkCopied ? t("guestLinkCopied") : t("copyGuestLink")}
        </button>
      </div>

      {/* THE PEOPLE ON THE MEETING, in one place — colleagues by their user
          management name, then the typed guests. Two lists would ask the
          reader to work out which half somebody is in; one list with a
          removable chip each answers "who is coming" the way the card on the
          page behind this dialog does. */}
      {meeting.attendees.length + meeting.invitees.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border pt-3">
          {meeting.attendees.map((a) => (
            <span key={a.user_id} className="flex items-center gap-1 rounded-lg bg-surface-2 px-2 py-0.5 text-xs text-fg">
              <Avatar name={personName(a, locale)} size="xs" />
              {personName(a, locale)}
              {/* the person who was in the room keeps their place, and the
                  chip says why rather than offering a control that refuses */}
              {a.attended ? (
                <span className="text-[10px] text-accent">{t("attendedMark")}</span>
              ) : (
                <button
                  type="button"
                  aria-label={t("removeInvitee", { name: personName(a, locale) })}
                  disabled={busy.includes(a.user_id)}
                  onClick={() => toggle(a.user_id)}
                  className="text-fg-subtle hover:text-danger disabled:opacity-50"
                >
                  <IconClose width={12} height={12} />
                </button>
              )}
            </span>
          ))}
          {meeting.invitees.map((name) => (
            <span key={name} className="flex items-center gap-1 rounded-lg bg-surface-2 px-2 py-0.5 text-xs text-fg">
              {name}
              <button
                type="button"
                aria-label={t("removeInvitee", { name })}
                onClick={() => removeTyped(name)}
                className="text-fg-subtle hover:text-danger"
              >
                <IconClose width={12} height={12} />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </Overlay>
  );
}
