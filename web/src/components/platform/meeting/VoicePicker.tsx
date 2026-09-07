"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { Person, Speaker } from "@/api/types";
import { ConfirmDialog, SelectMenu, type SelectMenuOption } from "@/components/rowActions";
import type { VoiceCandidate } from "@/lib/voiceCandidates";

/** the "add them to the directory" row, kept out of the id space on purpose */
const NEW_PERSON = "__new__";

/**
 * NAMING A VOICE WHERE THE VOICE IS READ.
 *
 * User directive, 2026-09-07: "remove this one and add it to meeting
 * transcription so you can open the speaker one and choose one of the people
 * that attended in case the enrolment is fail."
 *
 * The panel this replaces sat ABOVE the transcript as a list of voices with a
 * dropdown each — a second reading of the same three rows, in a card that
 * repeated what the turns below already said. The name in the transcript IS
 * the control now: press «گویندهٔ ۱» and the meeting's people are offered.
 *
 * ── THE STEP THAT MAKES IT WORK AT ALL ────────────────────────────────────
 *
 * A candidate is an ACCOUNT and a link is to a DIRECTORY PERSON, and on this
 * deployment not one of the fourteen accounts is linked to one of the five
 * directory people (measured 2026-09-07; the directory is Persian and the
 * accounts are Latin, so the server's folded-name suggestion cannot bridge
 * them). Offering only the resolvable half would have shown an empty menu on
 * every meeting — "the platform does not know these people", which is not
 * what a person reads it as.
 *
 * So an unresolved candidate opens ONE question — which directory person is
 * this? — and the answer is REMEMBERED on the person row (`app_user_id`, the
 * same field the directory's own identify box writes). Asked once per
 * colleague, ever: after it, every later meeting resolves without asking, and
 * so does the voiceprint suggestion that reads the same column.
 *
 * The remembering is best-effort and SAID when it fails: writing that column
 * is admin work on the directory surface, and a member host who names a voice
 * still gets the link they asked for — they are simply asked again next time.
 * A silent failure here would look like the platform forgetting on purpose.
 */
export function VoicePicker({
  callId, speaker, name, candidates, people, onLinked,
}: {
  callId: string;
  speaker: Speaker;
  /** what the transcript calls this voice right now — never the option's label */
  name: string;
  candidates: readonly VoiceCandidate[];
  /** the directory, for the question an unresolved candidate asks */
  people: readonly Person[];
  onLinked: () => void;
}) {
  const t = useTranslations("meetings");
  const [asking, setAsking] = useState<VoiceCandidate | null>(null);
  const [pick, setPick] = useState("");
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [forgot, setForgot] = useState(false);

  /* the row the check sits on. The menu is keyed by ACCOUNT and the record
     stores a PERSON, so the current value is found through the pairing rather
     than read off the speaker — and a voice linked to somebody the meeting
     never recorded (the matcher's own work) still shows its name below. */
  const current = candidates.find((c) => c.personId !== null && c.personId === speaker.person_id);

  async function link(personId: string | null): Promise<void> {
    setBusy(true);
    setFailed(false);
    try {
      await api.linkSpeaker(callId, speaker.id, personId);
      onLinked();
    } catch {
      /* the refusal stays where the press was: a link that did not happen
         must not leave a name on the transcript as though it had */
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  function choose(value: string): void {
    if (value === "") { void link(null); return; }
    const candidate = candidates.find((c) => c.memberId === value);
    if (candidate === undefined) {
      /* the already-linked person, offered so the check has a row to sit on */
      void link(value);
      return;
    }
    if (candidate.personId !== null) { void link(candidate.personId); return; }
    setForgot(false);
    setPick(people.length > 0 ? "" : NEW_PERSON);
    setNewName(candidate.name);
    setAsking(candidate);
  }

  async function answerWho(): Promise<void> {
    if (asking === null) return;
    setBusy(true);
    setFailed(false);
    setForgot(false);
    try {
      let personId = pick;
      if (pick === NEW_PERSON) {
        const created = await api.createPerson(newName.trim() || asking.name, "");
        personId = created.id;
      }
      /*
       * REMEMBER, THEN LINK — in that order, and the link is not conditional
       * on it. The pairing is the durable half (it answers for every later
       * meeting), the link is what was asked for, and the one that may be
       * refused must not be able to cost the other.
       */
      try {
        await api.updatePerson(personId, { app_user_id: asking.memberId });
      } catch {
        setForgot(true);
      }
      await api.linkSpeaker(callId, speaker.id, personId);
      setAsking(null);
      onLinked();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  const options: SelectMenuOption[] = [
    { value: "", label: t("unknownPerson") },
    ...candidates.map((c) => ({
      value: c.memberId,
      label: c.isHost ? t("voiceHost", { name: c.name }) : c.name,
    })),
    /* somebody the matcher named who is not on this meeting's roster: their
       row exists so the check is visible and the choice is reversible, and it
       is never a NEW option — it is where this voice already points */
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
        onChange={choose}
        disabled={busy}
        ariaLabel={t("speakerPick", { voice: name })}
        panelHeading={t("speakersTitle")}
        className="text-xs font-semibold text-fg"
      />
      {failed ? (
        <span role="alert" className="text-[11px] text-danger">{t("writeFailed")}</span>
      ) : null}
      {forgot ? (
        <span role="status" className="text-[11px] text-warning">{t("voiceNotRemembered")}</span>
      ) : null}

      {asking !== null ? (
        <ConfirmDialog
          title={t("voiceWhoTitle", { name: asking.name })}
          body={(
            <div className="space-y-3">
              {/* a CONSEQUENCE, said before the press rather than after it:
                  this answer is kept, and the question does not come back */}
              <p className="text-xs leading-6 text-fg-muted">{t("voiceWhoBody")}</p>
              <SelectMenu
                ariaLabel={t("voiceWhoPick")}
                value={pick}
                onChange={setPick}
                options={[
                  ...people.map((p) => ({ value: p.id, label: p.display_name })),
                  { value: NEW_PERSON, label: t("voiceWhoNew") },
                ]}
                className="w-full"
              />
              {pick === NEW_PERSON ? (
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold text-fg-muted">
                    {t("voiceWhoName")}
                  </span>
                  <input
                    className="input w-full"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                  />
                </label>
              ) : null}
            </div>
          )}
          confirmLabel={t("voiceWhoSave")}
          cancelLabel={t("cancel")}
          danger={false}
          busy={busy}
          confirmDisabled={pick === "" || (pick === NEW_PERSON && newName.trim() === "")}
          onConfirm={() => void answerWho()}
          onCancel={() => setAsking(null)}
        />
      ) : null}
    </>
  );
}
