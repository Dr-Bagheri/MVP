"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { Me, OrgPersonRecord } from "@/api/types";
import { Avatar } from "@/components/Avatar";
import { IconCheck, IconClose, IconPlus } from "@/components/icons";
import { personName, personPhoto } from "@/lib/format";

/**
 * WHO IS COMING, asked when the meeting is made (user, 2026-09-16: "in the
 * pop-up window for new meetings and ahead meetings, add a row for attendees
 * as well that can be chosen from the users or simply just write down a
 * name; the host is the user and present").
 *
 * Three kinds of row, and they are three facts rather than one list:
 *
 *   - THE HOST — the reader, fixed at the top and said to be them. The
 *     person making the meeting is on it and is the one who presses start
 *     (0202: the take is the host's), so there is nothing to choose.
 *   - A COLLEAGUE — an account on the roster (db/0202's `meeting_attendee`),
 *     picked here and ADDED after the row exists, in the one request that
 *     also mints their invitation (`api.addMeetingAttendees`).
 *   - A GUEST — a typed name for somebody with no account here, which is
 *     exactly what 0202 left the `invitees` text list for.
 *
 * The field holds the picks; the writes happen with the create, in the
 * dialog that owns the meeting, because a meeting has to exist before
 * anybody can be on it. The roster row is the project dialog's (2026-09-05),
 * because a person who has learned one people-picker has learned both.
 */
export function MeetingAttendeesField({ me, people, picked, onPicked, guests, onGuests }: {
  /** the reader — null while the identity read is in flight */
  me: Me | null;
  /** the organisation's people — null while the roster read is in flight */
  people: OrgPersonRecord[] | null;
  picked: string[];
  onPicked: (ids: string[]) => void;
  guests: string[];
  onGuests: (names: string[]) => void;
}) {
  const t = useTranslations("meetings");
  const locale = useLocale();
  const [draft, setDraft] = useState("");
  const others = (people ?? []).filter((p) => me === null || p.id !== me.id);

  const addGuest = () => {
    const name = draft.trim();
    /* the same name twice is one guest — and a blank is nobody */
    if (name === "" || guests.includes(name)) { setDraft(""); return; }
    onGuests([...guests, name]);
    setDraft("");
  };

  return (
    <div>
      <span className="mb-1 block text-xs font-medium text-fg-muted">{t("fieldAttendees")}</span>
      <div className="well max-h-48 space-y-1 overflow-y-auto p-1.5" data-attendees>
        {me !== null ? (
          <div className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-fg" data-host>
            <Avatar name={personName(me, locale)} src={me.avatar_url} size="xs" />
            <span className="min-w-0 flex-1 truncate">{personName(me, locale)}</span>
            <span className="text-micro text-fg-muted">{t("hostYou")}</span>
          </div>
        ) : null}
        {people !== null && others.length === 0 && guests.length === 0 ? (
          <p className="px-1 py-2 text-xs text-fg-subtle">{t("noColleagues")}</p>
        ) : null}
        {others.map((person) => {
          const on = picked.includes(person.id);
          return (
            <button
              key={person.id}
              type="button"
              aria-pressed={on}
              onClick={() => onPicked(on ? picked.filter((id) => id !== person.id) : [...picked, person.id])}
              className={`tap flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start text-xs ${
                on ? "bg-accent-soft text-accent" : "text-fg-muted hover:bg-surface-2"
              }`}
            >
              <Avatar name={personName(person, locale)} src={personPhoto(person)} size="xs" />
              <span className="min-w-0 flex-1 truncate">{personName(person, locale)}</span>
              {on ? <IconCheck width={12} height={12} /> : null}
            </button>
          );
        })}
        {guests.map((name) => (
          <div key={name} className="flex items-center gap-2 rounded-lg bg-accent-soft px-2 py-1.5 text-xs text-accent" data-guest>
            {/* a guest is a typed NAME — no account, no row, no photo to be
                handed; said with an explicit null rather than an omission,
                which is what the photo guard reads as "forgot" */}
            <Avatar name={name} src={null} size="xs" />
            <span className="min-w-0 flex-1 truncate">{name}</span>
            <button
              type="button"
              aria-label={t("removeGuest", { name })}
              title={t("removeGuest", { name })}
              onClick={() => onGuests(guests.filter((g) => g !== name))}
              className="btn btn-icon text-current opacity-70 hover:opacity-100"
            >
              <IconClose width={12} height={12} />
            </button>
          </div>
        ))}
      </div>
      {/* A NAME for somebody with no account: Enter or the button adds it.
          `preventDefault` on Enter, because the dialog's primary is not this
          box's business — a typed name must not start a recording. */}
      <div className="mt-1.5 flex items-center gap-1.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addGuest(); } }}
          placeholder={t("guestNamePlaceholder")}
          aria-label={t("guestNamePlaceholder")}
          className="input input-sm min-w-0 flex-1"
        />
        <button
          type="button"
          onClick={addGuest}
          disabled={draft.trim() === ""}
          className="btn btn-sm border border-border text-fg-muted hover:text-fg"
        >
          <IconPlus width={12} height={12} />
          {t("addGuest")}
        </button>
      </div>
    </div>
  );
}
