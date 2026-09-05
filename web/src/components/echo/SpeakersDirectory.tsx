"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import { notify } from "@/lib/notify";
import { useRefreshEpoch } from "@/lib/refreshBus";
import type { Me, Person, User } from "@/api/types";
import { EmptyState } from "@/components/ui";
import { ConfirmDialog, IconAction, SelectMenu } from "@/components/rowActions";
import { DataTable, StatusDot } from "@/components/DataTable";
import { Avatar } from "@/components/Avatar";
import {
  IconMicOff, IconMicPlus, IconPencil, IconPlus, IconTeam, IconTrash, IconUser,
} from "@/components/icons";
import { digits, personName } from "@/lib/format";

/** 2026-08-24 cleanup: popup-confirmed deletes; the ledger's fixed line. */
const UI_DELETE_REASON = "حذف با تأیید کاربر در پنجرهٔ تأیید";
import {
  ENROLLMENT_SCRIPTS,
  MAX_ENROLL_SECONDS,
  MIN_ENROLL_SECONDS,
  type EnrollmentLang,
} from "@/lib/enrollmentScript";

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
 * The org chart's BANDS. Titles carry seniority, never a reporting line —
 * so the chart draws ranks, and says so. Inventing edges ("who reports to
 * whom") from data we do not have would be the most confident lie on the
 * page.
 */
const CHART_BANDS = [
  { key: "bandExec", codes: ["ceo", "cto", "coo", "cmo", "cfo"] as string[] },
  { key: "bandLead", codes: ["vp", "director", "manager", "lead"] as string[] },
  { key: "bandTeam", codes: ["employee", "other", ""] as string[] },
] as const;

export function SpeakersDirectory() {
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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmBulk, setConfirmBulk] = useState(false);
  /**
   * Withdrawing an enrolled voice asks too (the platform's destructive-action
   * rule; confirm.guard.test.ts). It is the same act Settings · Security
   * already asks about when a person withdraws their OWN print — doing it to
   * somebody else, from an admin's table, is not the lighter version of that.
   * A voiceprint cannot be handed back: restoring one means recording it
   * again, with the person present.
   */
  const [confirmVoiceClear, setConfirmVoiceClear] = useState<Person | null>(null);
  const [confirmVoiceBulk, setConfirmVoiceBulk] = useState(false);
  /**
   * The 2026-08-25 batch: three views of one directory, a team filter, and
   * presence. (The merge door left the UI on 2026-08-26 — see the kebab.)
   *
   * `view` — table (dense), cards (the bento reading of the same rows), or
   * chart (the org tree the stored titles already describe).
   * `teamFilter` — null = everyone; "" = the people with no team yet.
   * `identifying` — the person whose platform account is being decided.
   * `presence` — person id → how many of the RECENT records they appear in,
   * read bounded (the dashboard's rule: a directory page must not fan out
   * one request per record in the org).
   */
  const [view, setView] = useState<"table" | "cards" | "chart">("table");
  const [teamFilter, setTeamFilter] = useState<string | null>(null);
  /** the identify dialog: which person, and the account being proposed */
  const [identifying, setIdentifying] = useState<Person | null>(null);
  const [identifyTo, setIdentifyTo] = useState("");
  /** org members, fetched when the dialog first opens (admin-only route) */
  const [members, setMembers] = useState<User[] | null>(null);
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [teamDraft, setTeamDraft] = useState("");
  /* null until the read lands — "we have not counted" renders as a dash,
     never as a zero someone would read as "never in a meeting" */
  const [presence, setPresence] = useState<Record<string, number> | null>(null);
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
      enrollControls.finish = null;
      enrollControls.cancel = null;
      if (rec.state !== "inactive") rec.stop();
    };
    enrollControls.cancel = () => {
      clearInterval(tick);
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


  /**
   * One action over every selected row. Failures are COUNTED, not hidden,
   * and the list reloads from the server afterwards — so what the screen
   * shows next is what actually survived, not what we hoped happened.
   */
  async function bulk(perRow: (person: Person) => Promise<unknown>): Promise<void> {
    if (busy || selected.size === 0) return;
    setBusy(true);
    const targets = (people ?? []).filter((person) => selected.has(person.id));
    const results = await Promise.allSettled(targets.map((person) => perRow(person)));
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed > 0) {
      notify(t("bulkFailed", { n: String(failed), total: String(targets.length) }), "warn");
    }
    setSelected(new Set());
    setConfirmBulk(false);
    await api.directory().then(setPeople).catch(() => undefined);
    setBusy(false);
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
   * IDENTIFY (db/0005's column, written since 2026-08-26): this directory
   * person IS this platform member. `""` means "not a member" and CLEARS
   * the link — a real answer, not a missing one, which is why the patch
   * sends an explicit null rather than omitting the field.
   */
  async function doIdentify(): Promise<void> {
    if (!identifying) return;
    setBusy(true);
    try {
      await api.updatePerson(identifying.id, { app_user_id: identifyTo || null });
      setPeople(await api.directory());
      notify(identifyTo ? t("identifyDone") : t("identifyCleared"));
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
      setIdentifying(null);
      setIdentifyTo("");
      setBusy(false);
    }
  }

  /** the members list is admin-only, so it is fetched on first need */
  function openIdentify(person: Person): void {
    /* the SUGGESTION is the server's — it folded the two names with the
       same function the name index is built on. It is pre-selected, never
       applied: a common Persian surname must not silently attach a
       colleague's identity to a voice. */
    setIdentifyTo(person.app_user_id ?? person.suggested_app_user_id ?? "");
    setIdentifying(person);
    if (members === null) {
      void api.members().then(setMembers).catch(() => setMembers([]));
    }
  }

  /**
   * PRESENCE — how many of the recent records each person appears in.
   * Bounded to the newest 8 records: a per-record request each, and a
   * directory page that fans out over an org's whole history is the reason
   * someone's API is slow. The footnote says how deep it looked.
   */
  const PRESENCE_DEPTH = 8;
  useEffect(() => {
    let live = true;
    void api.listCalls({ includeArchived: false })
      .then((calls) => calls
        .filter((c) => c.deleted_at === null && c.status === "ready")
        .sort((a, b) => b.started_at.localeCompare(a.started_at))
        .slice(0, PRESENCE_DEPTH))
      .then((recent) => Promise.all(
        recent.map((call) => api.getSpeakers(call.id).catch(() => []))))
      .then((rosters) => {
        if (!live) return;
        const counts: Record<string, number> = {};
        for (const roster of rosters) {
          const inThis = new Set(
            roster.map((s) => s.person_id).filter((id): id is string => id !== null));
          for (const id of inThis) counts[id] = (counts[id] ?? 0) + 1;
        }
        setPresence(counts);
      })
      .catch(() => undefined);
    return () => { live = false; };
  }, [speakersEpoch]);

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
      {/* the bulk bar — present only while a selection exists, and only on
          the table, which is the only view that can make one */}
      {view === "table" && selected.size > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-4 py-2 text-sm">
          <span className="text-fg">{t("selectedCount", { n: String(selected.size) })}</span>
          {/* 2026-09-03: `.btn-sm`, the theme's compact control. Both of these
              carried `h-8 min-h-0 px-3 text-xs` ON TOP of the class that
              exists to decide exactly those four things — a hand-rolled
              control wearing `.btn`'s own name, which is why the control
              guard never counted them: it skips any string containing `btn`,
              so re-answering `.btn` is the one way to hand-roll invisibly. */}
          {voiceReady ? (
            <button
              className="btn-secondary btn-sm"
              disabled={busy}
              onClick={() => setConfirmVoiceBulk(true)}
            >
              {t("voiceRemove")}
            </button>
          ) : null}
          <button
            className="btn-danger btn-sm"
            disabled={busy}
            onClick={() => setConfirmBulk(true)}
          >
            {t("delete")}
          </button>
          <button
            className="text-xs text-fg-muted underline-offset-2 hover:underline"
            onClick={() => {
              setSelected(new Set());
              setConfirmBulk(false);
            }}
          >
            {t("clearSelection")}
          </button>
        </div>
      ) : null}

      {/* the directory's own controls (2026-08-25): three readings of one
          list, and the team filter the labels make possible */}
      {/*
        2026-09-03: ONE FAMILY IN ONE ROW. This row held three shapes — a 32px
        bordered segment group, a 28px `rounded-full` filter pill and a 32px
        bordered ＋ — and they sit inches apart, which is the directive at its
        smallest legible scale. All three wear the theme's compact control
        now, in the spelling Meetings.tsx and TaskBoard.tsx already use for
        the same toolbar: view chips, a hairline, filter chips. Two boards and
        a directory rendering the same row must not disagree about what a
        filter looks like.
      */}
      {people !== null && (people.length > 0 || canManage) ? (
        <div className="flex flex-wrap items-center gap-1">
          <span
            className={`flex flex-wrap items-center gap-1 ${
              people.length === 0 ? "hidden" : ""
            }`}
            role="group"
            aria-label={t("viewLabel")}
          >
            {(["table", "cards", "chart"] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                className={`btn btn-sm gap-1.5 font-medium ${
                  view === v
                    ? "bg-accent text-on-accent"
                    : "text-fg-muted hover:bg-surface-2 hover:text-fg"
                }`}
                onClick={() => {
                  setView(v);
                  /* a selection made in the table cannot be acted on from
                     cards or the chart — leaving it alive would keep a bar
                     on screen governing rows nobody can see */
                  if (v !== "table") setSelected(new Set());
                }}
              >
                {t(`view.${v}` as "view.table")}
              </button>
            ))}
          </span>
          {teamsAvailable && teams.length > 0 ? (
            <>
              {/* Meetings.tsx's own separator: the row carries two questions
                  (which reading, which team) and a hairline says so without
                  giving the second group a second shape */}
              <span className="mx-1 h-5 w-px bg-border" aria-hidden />
              <span className="flex flex-wrap items-center gap-1">
                {[null, ...teams].map((team) => (
                  <button
                    key={team ?? "__all"}
                    type="button"
                    aria-pressed={teamFilter === team}
                    className={`btn btn-sm gap-1.5 font-medium ${
                      teamFilter === team
                        ? "bg-accent text-on-accent"
                        : "text-fg-muted hover:bg-surface-2 hover:text-fg"
                    }`}
                    onClick={() => setTeamFilter(teamFilter === team ? null : team)}
                  >
                    {team === null ? t("allTeams") : team === "" ? t("noTeam") : team}
                  </button>
                ))}
              </span>
            </>
          ) : null}
          {/* the ＋ sits WITH the table's own controls (user directive,
              2026-08-26: "the plus for the add must be on the table") and
              opens a row INSIDE the table, where the new person will land */}
          {canManage && (view === "table" || people.length === 0) ? (
            <button
              type="button"
              /* 2026-09-03: the theme's compact control. It was 32px with a
                 12px corner beside the chips it shares this row with; `.btn`
                 composes `.tap`, so the hit-area class goes with the
                 geometry. `.btn`/`.btn-sm` draw no border, so the quiet
                 bordered face this button has always had stays explicit —
                 and it stays quiet: making the ＋ a solid accent button is a
                 decision about emphasis, not about shape. */
              className="btn btn-sm ms-auto border border-border text-fg-muted hover:border-accent hover:text-fg"
              aria-expanded={adding}
              onClick={() => {
                setAdding(true);
                setName("");
                setTitle("");
              }}
            >
              <span aria-hidden className="text-base leading-none"><IconPlus width={14} height={14} /></span>
              {t("add")}
            </button>
          ) : null}
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
        ) : view === "cards" ? (
          /* the BENTO reading of the same rows — a face, a title, a team,
             the voice state, and how present they have been lately */
          <div className="grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3">
            {shown.map((person) => (
              <div key={person.id} className="glass-tile group rounded-xl p-3">
                <div className="flex items-start gap-3">
                  {/* 2026-09-03: the platform's avatar, not a fifth hand-drawn
                      one. This card drew 40px and the chart below drew 28 —
                      two marks for the same person, two views of one list, and
                      40 is not a size the theme has a name for (the same
                      sentence this file already carries about its 28px/32px
                      buttons). `md` is 36: four pixels, in exchange for the
                      directory agreeing with the roster and with itself.
                      `display_name` and not `personName`: a directory Person
                      has ONE name, so there is no locale choice to make. */}
                  <Avatar name={person.display_name} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-fg">{person.display_name}</p>
                    <p className="truncate text-xs text-fg-muted">
                      {person.title ? tTitles(person.title) : t("noTitle")}
                      {person.team ? ` · ${person.team}` : ""}
                    </p>
                  </div>
                  {canManage ? (
                    <IconAction
                      label={t("delete")}
                      danger
                      className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
                      onClick={() => setConfirmDelete(person)}
                    >
                      <IconTrash width={14} height={14} />
                    </IconAction>
                  ) : null}
                </div>
                <div className="mt-3 flex items-center justify-between gap-2 text-xs">
                  {person.voice_enrolled_at ? (
                    <span className="inline-flex items-center gap-1.5 text-fg-muted">
                      <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
                      {person.voice_samples && person.voice_samples > 1
                        ? t("voiceSamples", { n: digits(person.voice_samples, locale) })
                        : t("voiceOn")}
                    </span>
                  ) : (
                    <span className="text-fg-subtle">{t("voiceNone")}</span>
                  )}
                  {/* presence: the bar is the reading, the number is the
                      fact — and until the read lands there is neither */}
                  {presence === null ? (
                    <span className="text-fg-subtle">—</span>
                  ) : (
                    <span
                      className="flex items-center gap-1.5 text-fg-subtle"
                      title={t("presenceIn", {
                        n: digits(presence[person.id] ?? 0, locale),
                        of: digits(PRESENCE_DEPTH, locale),
                      })}
                    >
                      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                        <span
                          className="block h-full rounded-full bg-accent"
                          style={{ width: `${Math.min(100, ((presence[person.id] ?? 0) / PRESENCE_DEPTH) * 100)}%` }}
                        />
                      </span>
                      {digits(presence[person.id] ?? 0, locale)}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : view === "chart" ? (
          /* the ORG CHART the titles already describe: rank bands, not an
             invented reporting line — we know seniority, never who reports
             to whom, and drawing edges we cannot know would be fiction */
          <div className="space-y-4 p-4">
            {CHART_BANDS.map((band) => {
              const inBand = shown.filter((p) => band.codes.includes(p.title));
              if (inBand.length === 0) return null;
              return (
                <div key={band.key}>
                  <p className="mb-2 text-group-label font-medium text-fg-subtle">{t(band.key)}</p>
                  <div className="flex flex-wrap gap-2">
                    {inBand.map((person) => (
                      <span
                        key={person.id}
                        className="flex items-center gap-2 rounded-xl border border-border bg-surface-2/50 px-3 py-2"
                      >
                        {/* 2026-09-03: the platform's avatar at `sm` — 28px,
                            the size this chip already drew, so the picture is
                            unchanged and it gains `shrink-0`, which a mark in
                            a flex row beside a name that can be long wanted
                            anyway. */}
                        <Avatar name={person.display_name} size="sm" />
                        <span className="text-sm text-fg">{person.display_name}</span>
                        <span className="text-xs text-fg-subtle">
                          {person.title ? tTitles(person.title) : ""}
                          {person.team ? ` · ${person.team}` : ""}
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <DataTable<Person>
            hideHeader
            loading={people === null}
            rows={shown}
            rowKey={(person) => person.id}
            /* only somebody who may MANAGE the directory can select a row:
               a checkbox that ticks and then offers nothing is a control
               that lies about what the viewer is allowed to do */
            selected={canManage ? selected : undefined}
            onSelect={canManage ? setSelected : undefined}
            selectableRow={() => canManage}
            selectLabel={(person) => t("selectRow", { name: person.display_name })}
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
                /* MERGE left this menu (user directive, 2026-08-26) and
                   this took its place: who, on the platform, is this
                   voice? The server op for merging survives for support —
                   the product simply no longer offers it. */
                key: "identify",
                label: person.app_user_id ? t("identifyChange") : t("identify"),
                icon: <IconUser />,
                /* the server's wall is requireAdmin, and the members list
                   this dialog needs is admin-only too — offering the row
                   to a member would be a promise that 403s on press */
                disabled: busy || !canManage,
                onSelect: () => openIdentify(person),
              },
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

      {confirmBulk ? (
        <ConfirmDialog
          title={t("bulkDeleteConfirmTitle", { n: String(selected.size) })}
          body={t("deleteConfirmBody")}
          confirmLabel={t("delete")}
          cancelLabel={t("voiceCancel")}
          busy={busy}
          onCancel={() => setConfirmBulk(false)}
          onConfirm={() => void bulk((person) => api.deletePerson(person.id, UI_DELETE_REASON))}
        />
      ) : null}

      {/* withdrawing an enrolled voice — one person, and the whole selection.
          Two dialogs rather than one parameterised: the bulk title counts and
          the single one NAMES, and a title that says «۱ نفر» where a name
          belongs is how a bulk action gets confirmed for the wrong row. */}
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

      {confirmVoiceBulk ? (
        <ConfirmDialog
          title={t("voiceRemoveBulkTitle", { n: String(selected.size) })}
          body={t("voiceRemoveBody")}
          confirmLabel={t("voiceRemove")}
          cancelLabel={t("voiceCancel")}
          busy={busy}
          onCancel={() => setConfirmVoiceBulk(false)}
          onConfirm={() => {
            setConfirmVoiceBulk(false);
            void bulk((person) => api.clearVoice(person.id));
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

      {/* IDENTIFY: which platform account is this person? The suggestion
          arrives pre-selected and SAYS it is a suggestion — the admin is
          the one who decides, because a link made on a name match is a
          claim about who someone is. */}
      {identifying !== null ? (
        <ConfirmDialog
          title={t("identifyTitle", { name: identifying.display_name })}
          body={
            <div className="space-y-3">
              <p className="text-sm text-fg-muted">{t("identifyBody")}</p>
              <SelectMenu
                ariaLabel={t("identifyPick")}
                value={identifyTo}
                onChange={setIdentifyTo}
                options={[
                  { value: "", label: t("identifyNobody") },
                  ...(members ?? []).map((m) => ({
                    value: m.id,
                    label: m.username
                      ? `${personName(m, locale)} · ${m.username}`
                      : personName(m, locale),
                  })),
                ]}
              />
              {identifying.suggested_app_user_id
                && identifyTo === identifying.suggested_app_user_id
                && identifying.app_user_id !== identifying.suggested_app_user_id ? (
                <p className="text-xs text-accent">
                  {t("identifySuggested", {
                    name: identifying.suggested_member_name ?? "",
                  })}
                </p>
              ) : null}
              {members !== null && members.length === 0 ? (
                <p className="text-xs text-warning">{t("identifyNoMembers")}</p>
              ) : null}
            </div>
          }
          confirmLabel={t("identifySave")}
          cancelLabel={t("voiceCancel")}
          danger={false}
          busy={busy}
          onCancel={() => {
            setIdentifying(null);
            setIdentifyTo("");
          }}
          onConfirm={() => void doIdentify()}
        />
      ) : null}
    </div>
  );
}
