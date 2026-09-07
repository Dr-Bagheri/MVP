"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { MeetingRecord, Person, Speaker } from "@/api/types";
import { Select } from "@/components/Select";
import { SkeletonLines } from "@/components/scaffold/Skeleton";
import { speakerNaming } from "@/lib/speakerNaming";
import { digits } from "@/lib/format";

/**
 * WHO WAS SPEAKING — chosen by a person when the machine could not tell.
 *
 * User directive, 2026-09-07: "in overview give option to choose the
 * speakers from the attendance in case it does not detect our voice".
 *
 * The matcher is deliberately conservative — a wrong name on a transcript is
 * worse than no name — so it refuses more often than it errs, and every
 * refusal used to end the story: the record kept «گویندهٔ ۱» and the only way
 * to fix it was the raw call page, which is not where anybody reads their
 * meeting. This panel is the human half of the same decision, in the place
 * the meeting is read.
 *
 * ── THE CANDIDATES ARE RANKED BY WHO WAS IN THE ROOM ──────────────────────
 *
 * db/0202 records the roster as ACCOUNTS and stamps `attended` for whoever
 * opened the meeting while it was being held. A voice on this recording is
 * overwhelmingly one of those people, so they are offered first.
 *
 * The chain from an account to a directory person is `person.app_user_id`,
 * and it is EMPTY on this deployment: five directory people, twelve members,
 * zero links (read at owner altitude, 2026-09-07). A ranking that depended on
 * it would quietly offer nothing and read as "the platform does not know
 * these people". So the fallback is the server's OWN suggestion —
 * `suggested_app_user_id`, a folded-name match that the directory query
 * already computes and only fills when EXACTLY ONE member matches. Using it
 * rather than re-matching names here keeps one rule in one place: a second
 * spelling of "this person is probably that member" is how two surfaces come
 * to disagree about the same pair.
 *
 * ── WHOSE DECISION IT IS ──────────────────────────────────────────────────
 *
 * db/0093: only the call's OWNER may move `person_id` — an admin who can read
 * the record may rename a voice and may not name it, because "org scope
 * shares the recording, not the right to name its voices" (M11). The owner of
 * a meeting's record is its host (0202). So a colleague gets the SENTENCE and
 * not a control the server would refuse, which is the same shape the end
 * button and the whiteboard already take on this page.
 */
export function MeetingSpeakers({ callId, meeting, isHost, locale }: {
  callId: string;
  meeting: MeetingRecord;
  isHost: boolean;
  locale: string;
}) {
  const t = useTranslations("meetings");
  const [speakers, setSpeakers] = useState<Speaker[] | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    let live = true;
    void Promise.all([
      api.getSpeakers(callId).catch(() => [] as Speaker[]),
      api.directory().catch(() => [] as Person[]),
    ]).then(([rows, dir]) => {
      if (!live) return;
      setSpeakers(rows);
      setPeople(dir);
    });
    return () => { live = false; };
  }, [callId]);
  useEffect(load, [load]);

  /*
   * WHO WAS IN THE ROOM, as a set of account ids: the roster plus the host,
   * who is an attendee of their own meeting and is not in `attendees` (the
   * minutes learned the same thing on 2026-09-07).
   */
  const inRoom = new Set<string>([
    meeting.created_by,
    ...meeting.attendees.map((a) => a.user_id),
  ]);
  const wasHere = (p: Person): boolean => {
    const account = p.app_user_id ?? p.suggested_app_user_id ?? null;
    return account !== null && inRoom.has(account);
  };

  /* the roster first, each side alphabetical — a list whose order changes
     between two readings of the same record is a list nobody learns */
  const byName = (a: Person, b: Person) => a.display_name.localeCompare(b.display_name, "fa");
  const here = people.filter(wasHere).sort(byName);
  const elsewhere = people.filter((p) => !wasHere(p)).sort(byName);
  const options = [
    { value: "", label: t("unknownPerson") },
    ...here.map((p) => ({ value: p.id, label: `${p.display_name} · ${t("speakerInMeeting")}` })),
    ...elsewhere.map((p) => ({ value: p.id, label: p.display_name })),
  ];

  async function choose(speakerId: string, personId: string): Promise<void> {
    setSaving(speakerId);
    setFailed(false);
    try {
      await api.linkSpeaker(callId, speakerId, personId === "" ? null : personId);
      setSpeakers(await api.getSpeakers(callId));
    } catch {
      /* the refusal stays ON the panel: a link that did not happen must not
         leave a name sitting in the box as though it had */
      setFailed(true);
    } finally {
      setSaving(null);
    }
  }

  if (speakers === null) {
    return (
      <div className="card" aria-busy="true" data-meeting-speakers>
        <SkeletonLines lines={3} />
      </div>
    );
  }
  if (speakers.length === 0) return null;

  return (
    <div className="card" data-meeting-speakers>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-fg">{t("speakersTitle")}</h3>
        {/* not a control a colleague can press and watch refuse (db/0093) */}
        {isHost ? null : (
          <span className="text-[11px] font-medium text-fg-muted">{t("speakersHostOnly")}</span>
        )}
      </div>
      <ul className="divide-y divide-border">
        {speakers.map((speaker) => {
          const naming = speakerNaming(speaker.id, speakers);
          const called = naming.kind === "person" ? naming.name
            : naming.kind === "ordinal" ? t("speakerNamed", { n: digits(naming.n, locale) })
              : t("unattributed");
          return (
            <li key={speaker.id} className="flex flex-wrap items-center gap-2 py-2">
              <span className="min-w-0 flex-1 truncate text-sm text-fg">{called}</span>
              {isHost ? (
                <Select
                  value={speaker.person_id ?? ""}
                  options={options}
                  onChange={(next) => void choose(speaker.id, next)}
                  disabled={saving !== null}
                  ariaLabel={t("speakerPick", { voice: called })}
                  className="w-56"
                />
              ) : (
                <span className="text-sm text-fg-muted">
                  {speaker.person_name ?? t("unknownPerson")}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {failed ? (
        <p role="alert" className="mt-2 text-xs text-danger">{t("writeFailed")}</p>
      ) : null}
    </div>
  );
}
