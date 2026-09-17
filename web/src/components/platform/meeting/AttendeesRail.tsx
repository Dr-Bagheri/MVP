"use client";

import { useTranslations } from "next-intl";
import { Avatar } from "@/components/Avatar";
import { digits } from "@/lib/format";
import { meetingPeople } from "@/lib/meetingPeople";
import type { MeetingRecord } from "@/api/types";

/**
 * WHO IS IN THIS MEETING, beside the words they are saying.
 *
 * User directive, 2026-09-16: "the attendances is not a bad idea — how are
 * there and how many". The live stage had one column and a great deal of
 * empty room under it, and the fact most obviously missing from a screen
 * somebody is looking at DURING a meeting is who else is in it.
 *
 * ── WHAT THIS MAY CLAIM, AND WHAT IT MAY NOT ─────────────────────────────
 *
 * `attended` is db/0202's stamp, written by the person THEMSELVES on opening
 * a meeting that is being held — so «در جلسه» is a fact the platform watched
 * happen, not an inference. It is therefore drawn in the AFFIRMATIVE ONLY:
 * somebody without the mark gets no chip at all, never «غایب». A colleague
 * on a phone that never opened this page is exactly as absent from our
 * evidence as somebody who stayed away, and the two must not be rendered as
 * one claim.
 *
 * Nothing here says who is SPEAKING. The live lane hears «گویندهٔ ۱» and has
 * no person behind it — that link is made after the take, on the review tab's
 * picker — and a name attached to a voice here would be the one attribution
 * this product refuses to invent.
 *
 * The roster itself comes from `meetingPeople`, which the meetings list and
 * the summary document also read: one answer to "who is in this meeting",
 * three surfaces, no chance of the rail and the minutes disagreeing about it.
 * Photos come from the ORG ROSTER keyed by `user_id`, the pattern the list
 * already uses — a meeting's attendee rows carry names, not pictures.
 */
export function AttendeesRail({ meeting, photos, locale }: {
  meeting: MeetingRecord;
  /** user_id → photo, read once by the page; a guest misses it and keeps
      their initial, the only mark we have for somebody with no row */
  photos: Map<string, string>;
  locale: string;
}) {
  const t = useTranslations("meetings");
  const people = meetingPeople(meeting, locale);
  const here = people.filter((person) => person.attended).length;

  return (
    <section
      aria-label={t("fieldAttendees")}
      /*
       * `max-h-56` IS LOAD-BEARING, and only a rendered page shows why.
       *
       * `.tile` declares `height: 100%` (globals.css, for the dashboard cards
       * it also dresses), and below `lg` these two panels are a COLUMN — so
       * the rail resolved to the full height of the stage and, being
       * `shrink-0`, kept it: measured at 900px wide, the roster took 534px
       * and the transcript collapsed to 29. The words are the reason the
       * screen is open, and they were the thing that vanished.
       *
       * A height utility does not fix it — `h-auto` loses to the class, which
       * was checked in the browser rather than reasoned about. `max-height`
       * clamps a computed height whatever set it, so it wins: the same
       * measurement then reads 200 for the roster and 323 for the words, with
       * the list scrolling inside itself. Above `lg` the panels are a ROW,
       * `height: 100%` is what makes them equal columns, and the cap lifts.
       */
      className="tile flex min-h-0 max-h-56 shrink-0 flex-col p-4 lg:max-h-none lg:w-60"
    >
      <header className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="h-card">{t("fieldAttendees")}</h3>
        {/* the COUNT is of the people we watched arrive, which is the number
            the heading's question is really asking; the rest of the list is
            the answer to "who else was meant to be here" */}
        <span className="text-caption text-fg-subtle">
          {t("peopleInRoom", { n: digits(here, locale) })}
        </span>
      </header>
      <ul className="scroll-quiet min-h-0 flex-1 space-y-2.5 overflow-y-auto pe-1">
        {people.map((person) => (
          <li key={person.key} className="flex items-center gap-2.5">
            <Avatar name={person.name} src={photos.get(person.key) ?? null} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-fg">{person.name}</p>
              {/* a MEMBER needs no second line: they are the ordinary case,
                  and a word under every name is noise in a 240px column */}
              {person.kind === "member" ? null : (
                <p className="text-caption text-fg-subtle">
                  {person.kind === "host" ? t("memberHost") : t("guestMember")}
                </p>
              )}
            </div>
            {person.attended ? (
              <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-caption font-medium text-accent">
                {t("attendedMark")}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
