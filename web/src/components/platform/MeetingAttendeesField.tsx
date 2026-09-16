"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { Me, OrgPersonRecord } from "@/api/types";
import { Select } from "@/components/Select";
import { IconClose, IconPlus } from "@/components/icons";
import { personName } from "@/lib/format";

/**
 * WHO IS COMING, asked when the meeting is made (user, 2026-09-16: "in the
 * pop-up window for new meetings and ahead meetings, add a row for attendees
 * as well that can be chosen from the users or simply just write down a
 * name; the host is the user and present") — as a DROPDOWN, the same one the
 * folder row above it opens (same user, later the same day: "make this one a
 * dropdown as well like the ones above, with the same dropdown style").
 *
 * Three kinds of person, and they are three facts rather than one list:
 *
 *   - THE HOST — the reader. A row in the list, VISIBLE AND UNSELECTABLE,
 *     which is what `SelectOption.disabled` is for: hiding them would answer
 *     "am I on this?" with silence, and offering a toggle would offer a
 *     choice the server ignores (0202: the take is the host's, and they are
 *     the one who presses start).
 *   - A COLLEAGUE — an account on the roster (db/0202's `meeting_attendee`),
 *     chosen here and ADDED after the row exists, in the one request that
 *     also mints their invitation (`api.addMeetingAttendees`).
 *   - A GUEST — a typed name for somebody with no account here, which is
 *     exactly what 0202 left the `invitees` text list for. It keeps its own
 *     box under the dropdown: a name that does not exist yet cannot be a row
 *     in a list of people who do.
 *
 * The closed control names everyone who is coming, host first — the question
 * this field answers is "who will be in the room", and a control that showed
 * only the colleagues would answer a narrower one than it was asked.
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

  const hostName = me === null ? null : personName(me, locale);
  const others = (people ?? []).filter((p) => me === null || p.id !== me.id);

  const addGuest = () => {
    const name = draft.trim();
    /* the same name twice is one guest — and a blank is nobody */
    if (name === "" || guests.includes(name)) { setDraft(""); return; }
    onGuests([...guests, name]);
    setDraft("");
  };

  /* EVERYONE, in the order they became part of the meeting: the host, the
     colleagues, then the typed names. Passed as BOTH `summary` and
     `placeholder` on purpose — the host is always coming, so the closed
     control is never empty, and `placeholder` is this same sentence for the
     case where no colleague has been chosen yet. */
  const coming = [
    ...(hostName === null ? [] : [hostName]),
    ...others.filter((p) => picked.includes(p.id)).map((p) => personName(p, locale)),
    ...guests,
  ].join("، ");

  return (
    <div data-attendees>
      <span className="mb-1 block text-xs font-medium text-fg-muted">{t("fieldAttendees")}</span>
      <Select
        ariaLabel={t("fieldAttendees")}
        values={picked}
        onToggle={(id) => onPicked(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id])}
        summary={coming}
        placeholder={coming}
        options={[
          ...(hostName === null ? [] : [{
            value: "__host",
            label: `${hostName} — ${t("hostYou")}`,
            disabled: true,
          }]),
          ...others.map((person) => ({ value: person.id, label: personName(person, locale) })),
        ]}
      />

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

      {/* the typed names, each with the way back out. They are NOT rows in the
          dropdown: that list is the organisation's people, and a name somebody
          invented belongs beside the box that invented it. */}
      {guests.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {guests.map((name) => (
            <span key={name} data-guest className="btn btn-sm cursor-default bg-accent-soft font-medium text-accent">
              {name}
              <button
                type="button"
                aria-label={t("removeGuest", { name })}
                title={t("removeGuest", { name })}
                onClick={() => onGuests(guests.filter((g) => g !== name))}
                className="tap text-current opacity-70 hover:opacity-100"
              >
                <IconClose width={12} height={12} />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
