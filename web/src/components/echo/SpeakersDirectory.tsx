"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import { notify } from "@/lib/notify";
import { useRefreshEpoch } from "@/lib/refreshBus";
import type { Me, Person, User } from "@/api/types";
import { EmptyState } from "@/components/ui";
import { ConfirmDialog, IconAction, SelectMenu } from "@/components/rowActions";
import { DataTable, StatusDot } from "@/components/DataTable";
import {
  IconMicOff, IconMicPlus, IconPencil, IconTeam, IconTrash,
} from "@/components/icons";
import { filterChipClass } from "@/components/platform/sectionTabs";
import { digits, personName } from "@/lib/format";

/** 2026-08-24 cleanup: popup-confirmed deletes; the ledger's fixed line. */
const UI_DELETE_REASON = "حذف با تأیید کاربر در پنجرهٔ تأیید";
import {
  ENROLLMENT_SCRIPTS,
  MAX_ENROLL_SECONDS,
  MIN_ENROLL_SECONDS,
  type EnrollmentLang,
} from "@/lib/enrollmentScript";
import { HEARD_MS_FLOOR, startMicMeter, wasHeard } from "@/lib/micMeter";

/**
 * The people directory as an Echo section (user directive, 2026-08-17):
 * a table of speakers-as-people with org-chart titles (CEO … employee),
 * addable here, and offered as the dropdown on every call's speaker card.
 *
 * TITLES are codes from db/0062's closed constraint; this file only
 * localizes them. The person's NAME renders as authored — the same verdict
 * as every other name in the product.
 */

export const TITLE_CODES = [
  "ceo", "cto", "coo", "cmo", "cfo",
  "vp", "director", "manager", "lead", "employee", "other",
] as const;

/**
 * ONE READING OF THE LIST (user directive, 2026-09-08: "from speakers remove
 * chart, card and table button from the second sub-menu — just keep the first
 * sub-menu on top, and in the same row the add button, and the table").
 *
 * There were three: a table, a bento of cards, and an org chart drawn from the
 * stored titles. The chips that chose between them were the whole of row two,
 * and two of the three views were second drawings of rows the table already
 * carried — which is how a directory came to have two avatar sizes and two
 * spellings of "voice on file". The table is the one that can be edited, so it
 * is the one that stays; `＋` moved up into the section's own toolbar, where
 * every other create button in the product sits (R3).
 *
 * What went with the cards: PRESENCE, the "in n of the last 8 records" bar.
 * Nothing else read it, and it cost one request per record on every load of
 * this page. Said out loud rather than buried: that number is not shown
 * anywhere now.
 */

export function SpeakersDirectory({ addSignal = 0, onCanAdd }: {
  /**
   * The ＋ lives in the toolbar row, which belongs to the PAGE — this is how
   * the press reaches the row it opens. A counter rather than a boolean: two
   * presses in a row are two openings, and a boolean cannot say that.
   */
  addSignal?: number;
  /**
   * Whether that button should be there at all. The role is read HERE, with
   * the directory, so there is one answer to "may this person add somebody"
   * rather than a second `me()` on the page that could disagree with it.
   */
  onCanAdd?: (can: boolean) => void;
} = {}) {
  const t = useTranslations("speakersDir");
  const tTitles = useTranslations("titles");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const [people, setPeople] = useState<Person[] | null>(null);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  /** the ＋ form's visibility (2026-08-25: the permanent add card retired) */
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  /** role wall (user ruling, 2026-08-22): members ADD and SEE; edit,
      retitle and delete are the admins' and the owner's. The real wall is
      the server's (requireAdmin + db/0076's definer door) — hiding the
      controls here just keeps the screen honest about it. */
  const [me, setMe] = useState<Me | null>(null);
  const canManage = me?.role === "admin" || me?.role === "owner";
  /** inline rename: which row is being edited, and the draft name */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  /** popup-confirmed delete (2026-08-24) — the dialog is the second click */
  const [confirmDelete, setConfirmDelete] = useState<Person | null>(null);
  /**
   * Selection, the records table's shape (user directive, 2026-08-27: "the
   * records table is the default version so all the other tables should
   * look like it"). The checkbox column, the ⌘-less multi-select and the
   * bulk bar all come from DataTable — this file supplies only what a
   * SPEAKER row can be selected FOR.
   */
  /**
   * Withdrawing an enrolled voice asks too (the platform's destructive-action
   * rule; confirm.guard.test.ts). It is the same act Settings · Security
   * already asks about when a person withdraws their OWN print — doing it to
   * somebody else, from an admin's table, is not the lighter version of that.
   * A voiceprint cannot be handed back: restoring one means recording it
   * again, with the person present.
   */
  const [confirmVoiceClear, setConfirmVoiceClear] = useState<Person | null>(null);
  /**
   * `teamFilter` — null = everyone; "" = the people with no team yet.
   *
   * (The merge door left the UI on 2026-08-26 — see the kebab. The three
   * views and the presence bar left on 2026-09-08 — see the header.)
   */
  const [teamFilter, setTeamFilter] = useState<string | null>(null);
  /** org members, for the account column — admin-only route, read once */
  const [members, setMembers] = useState<User[] | null>(null);
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [teamDraft, setTeamDraft] = useState("");
  /**
   * Voice enrollment (M39; scripted 2026-08-23 by user directive): pressing
   * enroll opens a compact panel with a PLATFORM-PROVIDED passage to read
   * aloud — written for phoneme coverage so the sample carries the full
   * weight of the voice — in Persian or English (both always offered,
   * reading ONE is enough), with Start and Finish & save. Only the VECTOR
   * is stored server-side. The column renders only when the wire carries
   * `voice_enrolled_at` (db/0081 has run) — a control for a column that
   * does not exist would read as wired and do nothing.
   */
  const [enroll, setEnroll] = useState<
    null | {
      personId: string;
      lang: EnrollmentLang;
      phase: "ready" | "recording" | "sending";
      seconds: number;
    }
  >(null);
  const enrollControls = useState<{ finish: (() => void) | null; cancel: (() => void) | null }>(
    { finish: null, cancel: null },
  )[0];
  /*
   * THE METER (user report, 2026-09-07: "i did 2 samples in it and never it
   * realise i am talking to it").
   *
   * The bar is written to the DOM rather than to state on purpose: it moves
   * twelve times a second, and putting that through `setEnroll` would
   * re-render the whole directory — a table of every colleague — at the same
   * rate, to animate one div. `heard` DOES go through state, because it
   * changes at most once per take and the sentence beside the bar depends on
   * it.
   */
  const meterBar = useRef<HTMLDivElement | null>(null);
  const heardMs = useRef(0);
  const [heard, setHeard] = useState(false);
  const voiceReady =
    people !== null && people.length > 0 && people[0] !== undefined
    && "voice_enrolled_at" in people[0];
  /* db/0096's columns, by the same capability shape: absent field = the
     migration has not run here, so no team control is offered at all */
  const teamsAvailable =
    people !== null && people.length > 0 && people[0] !== undefined && "team" in people[0];
  const teams = [...new Set((people ?? []).map((p) => p.team ?? ""))]
    .filter((team, _i, all) => team !== "" || all.length > 1)
    .sort((a, b) => a.localeCompare(b));
  const shown = (people ?? []).filter(
    (p) => teamFilter === null || (p.team ?? "") === teamFilter);

  function openEnroll(person: Person): void {
    if (enroll) return;
    heardMs.current = 0;
    setHeard(false);
    setEnroll({
      personId: person.id,
      lang: locale === "fa" ? "fa" : "en",
      phase: "ready",
      seconds: 0,
    });
  }

  function closeEnroll(): void {
    enrollControls.cancel?.();
    enrollControls.finish = null;
    enrollControls.cancel = null;
    setEnroll(null);
  }

  async function startEnrollRecording(person: Person): Promise<void> {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      notify(t("voiceMicDenied"), "warn");
      return;
    }
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus" : "audio/webm";
    const rec = new MediaRecorder(stream, { mimeType: mime });
    const chunks: BlobPart[] = [];
    /* Cancel must DISCARD: MediaRecorder only hands over data through
       onstop, so the flag is how "finish and save" and "stop and forget"
       share one stop path without the forgotten take being sent anyway. */
    let discard = false;
    rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    rec.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      if (discard) return;
      const blob = new Blob(chunks, { type: mime.split(";")[0]! });
      setEnroll((prev) =>
        prev?.personId === person.id ? { ...prev, phase: "sending" } : prev);
      void api
        .enrollVoice(person.id, blob)
        .then(async () => {
          notify(t("voiceEnrolled", { name: person.display_name }));
          setPeople(await api.directory());
        })
        .catch(() => notify(t("voiceFailed"), "warn"))
        .finally(() => setEnroll(null));
    };
    /* the same stream the recorder has: one microphone, one graph, so the
       bar cannot disagree with what is being written to the clip */
    heardMs.current = 0;
    setHeard(false);
    const stopMeter = startMicMeter(stream, (m) => {
      heardMs.current = m.heardMs;
      if (meterBar.current !== null) {
        meterBar.current.style.width = `${Math.round(m.level * 100)}%`;
      }
      if (m.heardMs >= HEARD_MS_FLOOR) setHeard(true);
    });

    rec.start();
    setEnroll((prev) =>
      prev?.personId === person.id ? { ...prev, phase: "recording", seconds: 0 } : prev);
    let elapsed = 0;
    const tick = setInterval(() => {
      elapsed += 1;
      setEnroll((prev) =>
        prev?.personId === person.id ? { ...prev, seconds: elapsed } : prev);
      // walking away with the mic open must not become an unbounded upload
      if (elapsed >= MAX_ENROLL_SECONDS) enrollControls.finish?.();
    }, 1000);
    enrollControls.finish = () => {
      clearInterval(tick);
      stopMeter();
      enrollControls.finish = null;
      enrollControls.cancel = null;
      /*
       * A TAKE NOTHING WAS HEARD IN IS NOT SENT.
       *
       * ml/ refuses a silent clip by name now, so this is not the wall — it
       * is the sentence said where the person can still act on it, with the
       * microphone in front of them and the panel still open. Uploading it to
       * be refused a network round trip later would tell them the same thing
       * in a worse place, and before 2026-09-07 it told them nothing at all:
       * the clip was accepted and became a signature that never matched.
       */
      if (!wasHeard(heardMs.current)) {
        discard = true;
        notify(t("voiceNothingHeard"), "warn");
        setEnroll((prev) => (prev?.personId === person.id ? { ...prev, phase: "ready", seconds: 0 } : prev));
      }
      if (rec.state !== "inactive") rec.stop();
    };
    enrollControls.cancel = () => {
      clearInterval(tick);
      stopMeter();
      discard = true;
      enrollControls.finish = null;
      enrollControls.cancel = null;
      if (rec.state !== "inactive") rec.stop();
    };
  }

  async function clearVoiceFor(person: Person): Promise<void> {
    setBusy(true);
    try {
      await api.clearVoice(person.id);
      setPeople(await api.directory());
    } catch {
      notify(t("voiceFailed"), "warn");
    } finally {
      setBusy(false);
    }
  }

  const speakersEpoch = useRefreshEpoch("speakers");
  useEffect(() => {
    void api.directory().then(setPeople).catch(() => setPeople([]));
  }, [speakersEpoch]);

  useEffect(() => {
    void api.me().then(setMe).catch(() => undefined);
  }, []);

  /**
   * The members list, once. It is an admin-only route and the account column
   * needs it for EVERY row, so it is read with the directory rather than on a
   * press — a select that has to fetch before it can open is a select that
   * looks broken for a moment.
   */
  useEffect(() => {
    if (!canManage) return undefined;
    let live = true;
    void api.members()
      .then((rows) => { if (live) setMembers(rows); })
      .catch(() => { if (live) setMembers([]); });
    return () => { live = false; };
  }, [canManage]);

  /* the toolbar's ＋ belongs to the page (R3); this is the wire between them */
  useEffect(() => { onCanAdd?.(canManage); }, [canManage, onCanAdd]);
  useEffect(() => {
    /* 0 is the mount, not a press */
    if (addSignal === 0) return;
    setAdding(true);
    setName("");
    setTitle("");
  }, [addSignal]);

  async function renameFor(person: Person): Promise<void> {
    const next = editName.trim();
    setEditingId(null);
    if (!next || next === person.display_name || busy) return;
    setBusy(true);
    try {
      await api.updatePerson(person.id, { display_name: next });
      notify(t("renamed"));
      setPeople(await api.directory());
    } catch {
      notify(t("addFailed"), "warn");
    } finally {
      setBusy(false);
    }
  }

  async function deleteFor(person: Person, reason: string): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      await api.deletePerson(person.id, reason);
      notify(t("personDeleted", { name: person.display_name }));
      setPeople(await api.directory());
    } catch (cause) {
      const { status, detail } = cause as { status?: number; detail?: string };
      const notMigrated = status === 409 || detail === "not_migrated";
      notify(notMigrated ? t("deleteNotReady") : t("deleteFailed"), "warn");
    } finally {
      setBusy(false);
    }
  }



  async function add(): Promise<void> {
    if (busy || !name.trim()) return;
    setBusy(true);
    try {
      await api.createPerson(name.trim(), title);
      setName("");
      setTitle("");
      setAdding(false); // the row landed — the form's work is done
      setPeople(await api.directory());
    } catch {
      notify(t("addFailed"), "warn");
    } finally {
      setBusy(false);
    }
  }

  /** the team label — "" clears it (db/0096's contract, kept at the client) */
  async function saveTeam(person: Person): Promise<void> {
    setEditingTeamId(null);
    if ((person.team ?? "") === teamDraft.trim()) return;
    setBusy(true);
    try {
      await api.updatePerson(person.id, { team: teamDraft.trim() });
      setPeople(await api.directory());
    } catch {
      notify(t("editFailed"), "warn");
    } finally {
      setBusy(false);
    }
  }

  /**
   * WHICH ACCOUNT THIS PERSON IS (db/0005's column, written since 2026-08-26,
   * on the row itself since 2026-09-08: "for each speaker put the ability to
   * be connected to each user").
   *
   * It used to be a dialog behind the row's ⋯ menu, which meant the one fact
   * that makes a voice nameable in a meeting was the one fact this table did
   * not show. `""` means "not a member" and CLEARS the link — a real answer,
   * not a missing one, which is why the patch sends an explicit null rather
   * than omitting the field.
   */
  async function connectTo(person: Person, memberId: string): Promise<void> {
    if ((person.app_user_id ?? "") === memberId) return;
    setBusy(true);
    try {
      await api.updatePerson(person.id, { app_user_id: memberId || null });
      setPeople(await api.directory());
      notify(memberId ? t("identifyDone") : t("identifyCleared"));
    } catch (cause) {
      /* the server's refusals are CODES, and two of them mean something a
         person can act on: another row already claims this account, or the
         account is not in this org at all */
      const code = (cause as { code?: string }).code;
      notify(
        code === "account_already_linked"
          ? t("identifyTaken")
          : code === "not_a_member"
            ? t("identifyNotMember")
            : t("editFailed"),
        "warn",
      );
    } finally {
      setBusy(false);
    }
  }


  async function retitle(person: Person, nextTitle: string): Promise<void> {
    setBusy(true);
    try {
      await api.updatePerson(person.id, { title: nextTitle });
      setPeople(await api.directory());
    } catch {
      notify(t("addFailed"), "warn");
    } finally {
      setBusy(false);
    }
  }

  /**
   * The scripted enrollment panel, rendered under its own row. It lives in
   * a function rather than inline because the table now owns row layout —
   * and because reading it beside the columns made both harder to follow.
   */
  function enrollPanel(person: Person) {
    if (!enroll || enroll.personId !== person.id) return null;
    return (
      <div className="max-w-xl space-y-2" data-enroll-panel>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-medium text-fg">{t("voiceScriptTitle")}</span>
          {/* both languages ALWAYS offered, small — reading one of them is
              enough to save */}
          {/*
            2026-09-03: this is a fa/en segmented pair, and the platform has
            exactly one — TopBar renders the same two letters as `.btn btn-sm`
            with a border carrying the active state. It was a 28px pair fused
            inside an `overflow-hidden` group; counted, this file drew its
            buttons at 28 and at 32, and neither is a size the theme has a
            name for. The group's shared border becomes each button's own,
            which is what lets them be the theme's control instead of two
            corner-less halves of a box; `role="group"` and its label stay,
            because that part was never the problem.
            `.btn` also gives `disabled` a face: these gate on the take being
            underway and, until now, looked identical either way.
          */}
          <span
            className="flex items-center gap-1"
            role="group"
            aria-label={t("voiceScriptTitle")}
          >
            {(["fa", "en"] as const).map((l) => (
              <button
                key={l}
                type="button"
                disabled={enroll.phase !== "ready"}
                aria-pressed={enroll.lang === l}
                className={`btn btn-sm border font-medium ${
                  enroll.lang === l
                    ? "border-accent bg-accent-soft font-semibold text-accent"
                    : "border-border text-fg-muted hover:text-fg"
                }`}
                onClick={() => setEnroll((prev) => (prev ? { ...prev, lang: l } : prev))}
              >
                {l === "fa" ? "فارسی" : "English"}
              </button>
            ))}
          </span>
        </div>
        <p
          dir={enroll.lang === "fa" ? "rtl" : "ltr"}
          className="rounded-lg border border-border bg-surface p-3 text-sm leading-7 text-fg"
        >
          {ENROLLMENT_SCRIPTS[enroll.lang]}
        </p>
        {/*
          WHAT A SECOND SAMPLE IS FOR (db/0207) — a CONSTRAINT, said at the
          moment it becomes actionable and not before.
          
          A print is now a list of takes and a match scores the best of them,
          so a second reading of this script at the same desk with the same
          headset adds a near-duplicate and changes no verdict. A take from
          the room they actually sit in, or the laptop they actually dial in
          on, is what makes the voice recognisable there — this is the whole
          difference between "more samples" and a better print, and the
          person holding the microphone is the only one who can supply it.
          Shown only to somebody who already has a print: on a first
          enrolment it would be advice about a decision not yet in front of
          them.
        */}
        {person.voice_enrolled_at ? (
          <p className="text-[11px] leading-5 text-fg-muted">{t("voiceAnotherRoom")}</p>
        ) : null}
        {/*
          WHAT THE MICROPHONE IS HEARING, while there is still time to fix it.
          Rendered only during the take: a bar sitting at zero on a panel
          nobody has started is a broken meter, which is the very reading this
          exists to make trustworthy.
        */}
        {enroll.phase === "recording" ? (
          <div className="space-y-1">
            <div
              className="h-1.5 overflow-hidden rounded-full bg-surface-2"
              role="meter"
              aria-label={t("voiceLevel")}
            >
              <div
                ref={meterBar}
                className={`h-full w-0 rounded-full transition-[width] duration-100 ${
                  heard ? "bg-accent" : "bg-fg-subtle"
                }`}
              />
            </div>
            <p className={`text-[11px] ${heard ? "text-fg-muted" : "text-warning"}`}>
              {heard ? t("voiceHearing") : t("voiceNoSound")}
            </p>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-3 text-xs">
          {enroll.phase === "ready" ? (
            <>
              {/* 2026-09-03: `.btn-sm` — the size was restated on top of
                  `.btn-primary`, so the guard could not see it and the panel
                  had two control heights of its own */}
              <button
                type="button"
                className="btn-primary btn-sm"
                onClick={() => void startEnrollRecording(person)}
              >
                {t("voiceStart")}
              </button>
              <button
                type="button"
                className="text-fg-muted underline-offset-2 hover:text-fg hover:underline"
                onClick={closeEnroll}
              >
                {t("voiceCancel")}
              </button>
            </>
          ) : enroll.phase === "recording" ? (
            <>
              <span className="flex items-center gap-2">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-danger" aria-hidden />
                <span className="ltr tabular-nums text-fg">
                  {t("voiceRecording", { s: enroll.seconds })}
                </span>
              </span>
              <button
                type="button"
                className="btn-primary btn-sm"
                disabled={enroll.seconds < MIN_ENROLL_SECONDS}
                title={
                  enroll.seconds < MIN_ENROLL_SECONDS
                    ? t("voiceKeepReading", { s: MIN_ENROLL_SECONDS - enroll.seconds })
                    : undefined
                }
                onClick={() => enrollControls.finish?.()}
              >
                {t("voiceFinish")}
              </button>
              <button
                type="button"
                className="text-fg-muted underline-offset-2 hover:text-fg hover:underline"
                onClick={closeEnroll}
              >
                {t("voiceCancel")}
              </button>
            </>
          ) : (
            <span className="text-fg-muted">{t("voiceSending")}</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ROW TWO IS A FILTER AND NOTHING ELSE (user directive, 2026-09-08).
          The three view chips are gone with the two views they chose, and the
          ＋ moved up into the section's own toolbar — R3's rule, which every
          other create button in the product already follows. What is left is
          the one question this row can still answer: which team.
          The chip is the platform's own (R3 row two): an outlined chip with an
          icon, so a filter here and a filter on the task board are the same
          control. */}
      {people !== null && teamsAvailable && teams.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {[null, ...teams].map((team) => (
            <button
              key={team ?? "__all"}
              type="button"
              aria-pressed={teamFilter === team}
              className={filterChipClass(teamFilter === team)}
              onClick={() => setTeamFilter(teamFilter === team ? null : team)}
            >
              <IconTeam width={12} height={12} />
              {team === null ? t("allTeams") : team === "" ? t("noTeam") : team}
            </button>
          ))}
        </div>
      ) : null}

      {/* NO OUTER BOX (user directive, 2026-09-02: "make it look like the
          meetings table, with no header and outer box"). The rows are cards
          of their own; a card around cards is a box in a box. */}
      <div>
        {people !== null && people.length === 0 && !adding ? (
          <div className="p-4">
            <EmptyState text={t("empty")} />
          </div>
        ) : (
          <DataTable<Person>
            hideHeader
            loading={people === null}
            rows={shown}
            rowKey={(person) => person.id}
            /* NO SELECTION COLUMN (user, 2026-09-05: "remove check points for
               speakers table") — every act lives on the row's own menu; the
               bulk bar and its two dialogs left with the checkboxes */
            rowDetail={(person) =>
              enroll?.personId === person.id ? enrollPanel(person) : null
            }
            /* the ＋ opens a real ROW at the top of the body (user directive,
               2026-08-26: "when pressed a new row appears … the row is in the
               table not on top of it") */
            leadRow={
              adding && canManage ? (
                <tr className="border-b border-border bg-surface-2/40">
                  <td className="px-4 py-2.5">
                    {/* 2026-09-03: `.input-sm`, the theme's compact field. It
                        was `h-9 min-h-0 py-0 text-sm` — the four things that
                        class exists to decide, restated on top of `.input`,
                        because until now the theme had a compact BUTTON and no
                        compact FIELD. Only the width is this site's. */}
                    <input
                      className="input-sm w-48"
                      placeholder={t("namePlaceholder")}
                      value={name}
                      autoFocus
                      onChange={(e) => setName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void add();
                        if (e.key === "Escape") setAdding(false);
                      }}
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    {/* 2026-09-03: `.input-sm`. SelectMenu's trigger IS
                        `.input` (variant="input"), so this className was
                        re-answering it from outside — the same four utilities
                        as the fields either side of it, on a control the guard
                        cannot see because a select is not pressable. */}
                    <SelectMenu
                      className="input-sm w-40"
                      ariaLabel={t("colTitle")}
                      value={title}
                      onChange={setTitle}
                      options={[
                        { value: "", label: t("noTitle") },
                        ...TITLE_CODES.map((code) => ({ value: code, label: tTitles(code) })),
                      ]}
                    />
                  </td>
                  {/* the ACCOUNT cell, empty on purpose: a person has to
                      exist before an account can be attached to them, and a
                      cell missing here would slide every later cell one
                      column left */}
                  <td className="px-4 py-2.5" />
                  {teamsAvailable ? <td className="px-4 py-2.5" /> : null}
                  {voiceReady ? <td className="px-4 py-2.5" /> : null}
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-3 text-xs">
                      {/* 2026-09-03: `.btn-sm`, the theme's compact control —
                          the restated `h-8 min-h-0 px-3 text-xs` made this
                          the fifth hand-drawn height in one file */}
                      <button
                        className="btn-primary btn-sm"
                        disabled={busy || !name.trim()}
                        onClick={() => void add()}
                      >
                        {t("add")}
                      </button>
                      <button
                        className="text-fg-muted underline-offset-2 hover:underline"
                        onClick={() => setAdding(false)}
                      >
                        {tCommon("cancel")}
                      </button>
                    </span>
                  </td>
                </tr>
              ) : null
            }
            menuItems={(person) => (!canManage ? [] : [
              {
                key: "rename",
                label: t("edit"),
                icon: <IconPencil />,
                onSelect: () => {
                  setEditingId(person.id);
                  setEditName(person.display_name);
                },
              },
              ...(teamsAvailable
                ? [{
                    key: "team",
                    label: t("setTeam"),
                    icon: <IconTeam />,
                    onSelect: () => {
                      setEditingTeamId(person.id);
                      setTeamDraft(person.team ?? "");
                    },
                  }]
                : []),
              /* the voice actions moved OFF the row (user directive,
                 2026-08-26): the red ✕ and the add-a-sample link were two
                 more things in a cell that only ever needed to say whether
                 a voice is on file */
              ...(voiceReady
                ? [
                    {
                      key: "voice",
                      label: person.voice_enrolled_at
                        ? t("voiceImprove")
                        : t("voiceEnroll"),
                      icon: <IconMicPlus />,
                      disabled: enroll !== null,
                      onSelect: () => openEnroll(person),
                    },
                    ...(person.voice_enrolled_at
                      ? [{
                          key: "voiceClear",
                          label: t("voiceRemove"),
                          icon: <IconMicOff />,
                          danger: true,
                          disabled: busy,
                          onSelect: () => setConfirmVoiceClear(person),
                        }]
                      : []),
                  ]
                : []),
              {
                key: "delete",
                label: t("delete"),
                icon: <IconTrash />,
                danger: true,
                disabled: busy,
                onSelect: () => setConfirmDelete(person),
              },
            ])}
            columns={[
              {
                key: "name",
                header: t("colName"),
                className: "font-medium text-fg",
                stopClick: true,
                cell: (person) =>
                  editingId === person.id ? (
                    /* 2026-09-03: `.input-sm` — the inline rename opens IN a
                       row, which is the case that class was measured for */
                    <input
                      className="input-sm w-48"
                      value={editName}
                      autoFocus
                      disabled={busy}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void renameFor(person);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      onBlur={() => void renameFor(person)}
                    />
                  ) : (
                    <span className="flex items-center gap-1.5">
                      <span>{person.display_name}</span>
                      {/* rename ON the name — pencil on hover (2026-08-24) */}
                      {canManage ? (
                        <IconAction
                          label={t("edit")}
                          className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
                          disabled={busy}
                          onClick={() => {
                            setEditingId(person.id);
                            setEditName(person.display_name);
                          }}
                        >
                          <IconPencil width={14} height={14} />
                        </IconAction>
                      ) : null}
                    </span>
                  ),
              },
              {
                key: "title",
                header: t("colTitle"),
                stopClick: true,
                cell: (person) =>
                  canManage ? (
                    /* 2026-09-03: `.input-sm` — the title picker sits in the
                       row beside the name editor and must be level with it */
                    <SelectMenu
                      className="input-sm w-40"
                      ariaLabel={t("colTitle")}
                      value={person.title}
                      disabled={busy}
                      onChange={(next) => void retitle(person, next)}
                      options={[
                        { value: "", label: t("noTitle") },
                        ...TITLE_CODES.map((code) => ({ value: code, label: tTitles(code) })),
                      ]}
                    />
                  ) : (
                    /* members SEE, never edit (user ruling, 2026-08-22) */
                    <span className="text-fg-muted">
                      {person.title ? tTitles(person.title) : t("noTitle")}
                    </span>
                  ),
              },
              {
                /**
                 * WHO THIS IS ON THE PLATFORM (user directive, 2026-09-08:
                 * "for each speaker put the ability to be connected to each
                 * user, so when we are choosing the speakers in the overview
                 * it does not need me to say this account is which speaker").
                 *
                 * This was a dialog behind the row's ⋯ menu — so the one fact
                 * that lets a meeting name a voice by itself was the one fact
                 * the directory did not show, and on this deployment not a
                 * single row had it set. On the row, in the same select the
                 * title uses, it is a thing somebody does while reading the
                 * table rather than a thing they have to go looking for.
                 *
                 * The SUGGESTION is still only a suggestion: the server folds
                 * the two names with the same function the name index is
                 * built on, and it is MARKED in the list rather than applied.
                 * A common Persian surname must not quietly attach a
                 * colleague's identity to somebody else's voice.
                 */
                key: "member",
                header: t("colMember"),
                className: "text-xs",
                stopClick: true,
                cell: (person: Person) =>
                  canManage ? (
                    <SelectMenu
                      className="input-sm w-44"
                      ariaLabel={t("colMember")}
                      value={person.app_user_id ?? ""}
                      /* the list is admin-only and read once; until it lands
                         there is nothing to choose FROM, and an open menu
                         holding one row reads as "there are no colleagues" */
                      disabled={busy || members === null}
                      onChange={(next) => void connectTo(person, next)}
                      options={[
                        { value: "", label: t("identifyNobody") },
                        ...(members ?? []).map((m) => ({
                          value: m.id,
                          label:
                            person.app_user_id === null
                            && m.id === person.suggested_app_user_id
                              ? t("identifySuggested", { name: personName(m, locale) })
                              : m.username
                                ? `${personName(m, locale)} · ${m.username}`
                                : personName(m, locale),
                        })),
                      ]}
                    />
                  ) : (
                    /* members SEE, never edit — and they see the NAME the
                       server resolved, because the id alone is not
                       renderable and their own members list is admin-only */
                    <span className="text-fg-muted">
                      {person.linked_member_name ?? t("identifyNobody")}
                    </span>
                  ),
              },
              ...(teamsAvailable
                ? [{
                    key: "team",
                    header: t("colTeam"),
                    className: "text-xs",
                    stopClick: true,
                    cell: (person: Person) =>
                      editingTeamId === person.id ? (
                        /* 2026-09-03: `.input-sm`. This one was `h-8` where
                           the two above were `h-9` — the same inline editor,
                           in the same table, at two heights */
                        <input
                          className="input-sm w-32"
                          value={teamDraft}
                          autoFocus
                          maxLength={60}
                          placeholder={t("teamPlaceholder")}
                          onChange={(e) => setTeamDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void saveTeam(person);
                            if (e.key === "Escape") setEditingTeamId(null);
                          }}
                          onBlur={() => void saveTeam(person)}
                        />
                      ) : canManage ? (
                        <button
                          type="button"
                          className="text-fg-muted underline-offset-2 hover:text-fg hover:underline"
                          onClick={() => {
                            setEditingTeamId(person.id);
                            setTeamDraft(person.team ?? "");
                          }}
                        >
                          {person.team || t("noTeam")}
                        </button>
                      ) : (
                        <span className="text-fg-muted">{person.team || t("noTeam")}</span>
                      ),
                  }]
                : []),
              ...(voiceReady
                ? [{
                    key: "voice",
                    header: t("colVoice"),
                    className: "text-xs",
                    cell: (person: Person) =>
                      enroll?.personId === person.id ? (
                        <span className="text-fg-muted">{t("voiceRecording", { s: enroll.seconds })}</span>
                      ) : person.voice_enrolled_at ? (
                        /* the same quiet dot READY wears — an ordinary good
                           state, said once, softly, with the SAMPLE COUNT
                           when there is more than one because that is the
                           number that says how sharp the match is */
                        <StatusDot
                          label={
                            person.voice_samples && person.voice_samples > 1
                              ? t("voiceSamples", { n: digits(person.voice_samples, locale) })
                              : t("voiceOn")
                          }
                        />
                      ) : (
                        <span className="text-fg-subtle">{t("voiceNone")}</span>
                      ),
                  }]
                : []),
              {
                key: "actions",
                header: t("colActions"),
                srOnly: true,
                cell: () => null,
              },
            ]}
          />
        )}
      </div>

      {/* withdrawing an enrolled voice — one person, named in the title */}
      {confirmVoiceClear !== null ? (
        <ConfirmDialog
          title={t("voiceRemoveTitle", { name: confirmVoiceClear.display_name })}
          body={t("voiceRemoveBody")}
          confirmLabel={t("voiceRemove")}
          cancelLabel={t("voiceCancel")}
          busy={busy}
          onCancel={() => setConfirmVoiceClear(null)}
          onConfirm={() => {
            const person = confirmVoiceClear;
            setConfirmVoiceClear(null);
            void clearVoiceFor(person);
          }}
        />
      ) : null}

      {confirmDelete !== null ? (
        <ConfirmDialog
          title={t("deleteConfirmTitle", { name: confirmDelete.display_name })}
          body={t("deleteConfirmBody")}
          confirmLabel={t("delete")}
          cancelLabel={t("voiceCancel")}
          busy={busy}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => {
            const person = confirmDelete;
            setConfirmDelete(null);
            void deleteFor(person, UI_DELETE_REASON);
          }}
        />
      ) : null}

    </div>
  );
}
