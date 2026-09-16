"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { Person, Speaker } from "@/api/types";
import { SelectMenu, type SelectMenuOption } from "@/components/rowActions";
import type { VoiceCandidate } from "@/lib/voiceCandidates";
import { notifyError } from "@/lib/notify";

/**
 * NAMING A VOICE WHERE THE VOICE IS READ.
 *
 * User directive, 2026-09-07: "remove this one and add it to meeting
 * transcription so you can open the speaker one and choose one of the people
 * that attended in case the enrolment is fail." The panel this replaced sat
 * ABOVE the transcript as a list of voices with a dropdown each — a second
 * reading of the same rows. The name in the transcript IS the control: press
 * «گویندهٔ ۱» and the meeting's people are offered.
 *
 * ── ONE PRESS, NO SECOND QUESTION (user directive, 2026-09-08) ─────────────
 *
 * "Also remove that pop up for that as well, it should handle it itself."
 *
 * A candidate is an ACCOUNT and a link is to a DIRECTORY PERSON, and the two
 * are joined by `person.app_user_id` — which the speakers table now shows and
 * edits on every row. Where that join already exists this picker never had a
 * question to ask; where it does not, it used to open a dialog asking which
 * directory person the account is. That dialog is gone.
 *
 * ── NOTHING IS CREATED FOR A COLLEAGUE (user directive, 2026-09-16) ────────
 *
 * "When we added the speaker back in transcription after recording it
 * created a new person on the speakers page; it should not." The 2026-09-08
 * version resolved an unlearned colleague by creating a directory row named
 * as the option said — which is exactly a new person on the speakers page,
 * every time a colleague the directory had not learned was named. So:
 *
 *   · WHO a colleague is in the directory is decided by `voiceCandidates`
 *     (the admin's link, the server's suggestion, or a name that matches in
 *     either script) — the picker no longer matches names itself, and the
 *     fold lives in one module rather than two;
 *   · a colleague the directory does not know is OFFERED, DISABLED, and
 *     says why («در فهرست گویندگان نیست») — a door that refuses is worse
 *     than none, but a colleague who silently vanishes from the list reads
 *     as "the platform does not know they were here";
 *   · linking a name-resolved colleague still WRITES the pairing, best
 *     effort and said when it fails: `app_user_id` is admin work (the
 *     server's PATCH is requireAdmin), so a member host still gets the link
 *     they asked for and the platform is simply asked again next time.
 *
 * The one place a row is still made is the guest field below — a person
 * TYPED BY NAME is somebody the directory should learn, which is the
 * 2026-09-08 ask and not the 2026-09-16 objection.
 *
 * ── SOMEBODY WHO IS NOT A COLLEAGUE ───────────────────────────────────────
 *
 * "Also here add the option to type the unknown not user as well as a
 * speaker." A meeting has guests: a client, a candidate, somebody's
 * colleague from another company. They have no account, so no candidate can
 * ever offer them — the field at the foot of the panel makes a directory
 * person by name alone and links the voice to it. That row is a real member
 * of the speakers directory afterwards, which is what makes the SECOND
 * meeting with the same guest a choice rather than a retype.
 */
export function VoicePicker({
  callId, speaker, name, candidates, people, onLinked,
}: {
  callId: string;
  speaker: Speaker;
  /** what the transcript calls this voice right now — never the option's label */
  name: string;
  candidates: readonly VoiceCandidate[];
  /** the directory: what a name can be reused from, and what a guest joins */
  people: readonly Person[];
  onLinked: () => void;
}) {
  const t = useTranslations("meetings");
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [guest, setGuest] = useState("");

  /* the row the check sits on. The menu is keyed by ACCOUNT and the record
     stores a PERSON, so the current value is found through the pairing rather
     than read off the speaker — and a voice linked to somebody the meeting
     never recorded (the matcher's own work) still shows its name below. */
  const current = candidates.find((c) => c.personId !== null && c.personId === speaker.person_id);

  /** the directory row for an account — the one `voiceCandidates` resolved,
      and NEVER a new one (2026-09-16). A candidate the resolver could not
      place is offered disabled below, so this is only ever reached with a
      person id in hand; the throw is the floor for the day that stops
      being true, and it fails the press loudly rather than creating a row. */
  async function personFor(candidate: VoiceCandidate): Promise<string> {
    if (candidate.personId === null) throw new Error("voice candidate has no directory person");
    const person = people.find((p) => p.id === candidate.personId);
    if (person && person.app_user_id !== candidate.memberId) {
      try {
        /* the durable half: after this, every later meeting resolves through
           the link rather than through a name */
        await api.updatePerson(person.id, { app_user_id: candidate.memberId });
      } catch {
        setForgot(true);
      }
    }
    return candidate.personId;
  }

  async function pick(value: string): Promise<void> {
    setBusy(true);
    /* a fresh press starts from nothing said: the "not remembered" note from a
       previous attempt must not be read as this one's outcome. (An inline
       `failed` flag was reset here too; that flag is gone — a refused link is
       a toast now, which expires on its own.) */
    setForgot(false);
    try {
      const candidate = candidates.find((c) => c.memberId === value);
      const personId = value === ""
        ? null
        : candidate === undefined
          /* not one of the meeting's accounts: the person row this voice
             already points at, offered so the choice is reversible */
          ? value
          : await personFor(candidate);
      await api.linkSpeaker(callId, speaker.id, personId);
      onLinked();
    } catch {
      /* the refusal stays where the press was: a link that did not happen
         must not leave a name on the transcript as though it had */
      notifyError(t("writeFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function addGuest(): Promise<void> {
    const named = guest.trim();
    if (named === "" || busy) return;
    setBusy(true);
    setForgot(false);
    try {
      /* the same exact-string reuse the accounts get: typing a guest's name
         twice must not put two of them in the directory */
      const person = people.find((p) => p.display_name.trim() === named)
        ?? await api.createPerson(named, "");
      await api.linkSpeaker(callId, speaker.id, person.id);
      setGuest("");
      onLinked();
    } catch {
      notifyError(t("writeFailed"));
    } finally {
      setBusy(false);
    }
  }

  const options: SelectMenuOption[] = [
    { value: "", label: t("unknownPerson") },
    ...candidates.map((c) => ({
      value: c.memberId,
      /* a colleague the directory does not know is listed and cannot be
         pressed, with the reason on the row — the host learns where the
         answer is (the speakers page) instead of getting a new row there */
      label: c.personId === null
        ? `${c.isHost ? t("voiceHost", { name: c.name }) : c.name} · ${t("voiceNotInDirectory")}`
        : c.isHost ? t("voiceHost", { name: c.name }) : c.name,
      disabled: c.personId === null,
    })),
    /* somebody the matcher named who is not on this meeting's roster — a
       guest linked earlier, or the matcher's own work. Their row exists so
       the check is visible and the choice is reversible, and it is never a
       NEW option: it is where this voice already points */
    ...(speaker.person_id !== null && current === undefined
      ? [{ value: speaker.person_id, label: speaker.person_name ?? t("unknownPerson") }]
      : []),
  ];
  if (candidates.length <= 1) {
    /* WHICH NOTHING: a menu holding only the host is not a broken picker, it
       is a meeting nobody was added to — and the way out is a different
       button on a different tab, so it is said here rather than left to be
       guessed */
    options.push({ value: "__none__", label: t("voiceNoRoster"), disabled: true });
  }

  return (
    <>
      <SelectMenu
        variant="inline"
        value={current?.memberId ?? (current === undefined && speaker.person_id !== null ? speaker.person_id : "")}
        triggerLabel={name}
        options={options}
        onChange={(value) => void pick(value)}
        disabled={busy}
        ariaLabel={t("speakerPick", { voice: name })}
        panelHeading={t("speakersTitle")}
        className="text-xs font-semibold text-fg"
        panelFooter={(
          /* IN THE PANEL, not in a dialog: a guest is one of the answers to
             "who is this voice", so it belongs in the list of answers */
          <div className="flex items-center gap-1.5">
            <input
              className="input-sm min-w-0 flex-1"
              value={guest}
              disabled={busy}
              placeholder={t("voiceGuest")}
              aria-label={t("voiceGuest")}
              onChange={(e) => setGuest(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                void addGuest();
              }}
            />
            <button
              type="button"
              className="btn btn-sm shrink-0 border border-border text-fg-muted hover:border-accent hover:text-fg"
              disabled={busy || guest.trim() === ""}
              onClick={() => void addGuest()}
            >
              {t("voiceGuestAdd")}
            </button>
          </div>
        )}
      />
      {forgot ? (
        <span role="status" className="text-caption text-warning">{t("voiceNotRemembered")}</span>
      ) : null}
    </>
  );
}
