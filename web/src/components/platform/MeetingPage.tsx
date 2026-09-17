"use client";

import { SectionTabs } from "./sectionTabs";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";
import { api } from "@/api/client";
import { SectionScroller, Skeleton, SkeletonLines } from "@/components/scaffold";
import { notify, notifyError, notifyWarn } from "@/lib/notify";
import type { Call, CallNote, Me, MeetingRecord } from "@/api/types";
import { useCrumbTitle } from "@/components/platform/CrumbTitle";
import { ConfirmDialog } from "@/components/rowActions";
import { MODE_ICON } from "./Meetings";
import { AudioBar, ProcessingCard, TranscriptPanel } from "./meeting/Review";
import { ItemsPanel } from "./meeting/ItemsPanel";
import { SummaryTab } from "./meeting/Summary";
import { MeetingTasksBoard } from "./meeting/MiniTasks";
import { WaveScope } from "@/components/echo/WaveScope";
import { LiveTranscript } from "./meeting/LiveTranscript";
import { AttendeesRail } from "./meeting/AttendeesRail";
import { RecallCards } from "./meeting/RecallCards";
import { useLiveRecall } from "@/lib/liveRecall";
import { IconPause, IconPlay, IconPlus, IconTrash, IconUpload } from "@/components/icons";
import {
  finish, pause, recorderSnapshot, resume, startRecording, subscribeRecorder,
} from "@/lib/recordingEngine";
import { uploadAudioFile } from "@/lib/uploadFile";
import { takeUpload } from "@/lib/pendingUpload";
import { formatClock, formatDate, formatDuration } from "@/lib/format";

/**
 * THE MEETING'S OWN PAGE — one screen that follows the record, after the
 * 2026-09-08 simplification.
 *
 * ── WHAT WENT, AND WHY ────────────────────────────────────────────────────
 *
 * The three-stage stepper (پیش از جلسه / حین جلسه / پس از جلسه) is gone on
 * the user's word — "we dont need the before during after now" — and the
 * reason it could go is the change that came before it: the new-call wizard
 * no longer writes a meeting for LATER, so there is no longer a moment in a
 * meeting's life where a plan is the thing to show. Every state this page
 * can be in is now decided by the RECORD, which means the page can never
 * disagree with the pipeline and nobody has to press a tab to find the
 * thing that is happening:
 *
 *   live        no record and a microphone lane — the take, which starts
 *               by ARRIVING;
 *   processing  the file is still leaving this browser (the upload lane,
 *               before its record exists);
 *   record      a record exists — the tab set over the real artifacts,
 *               which draws the pipeline's own ladder until it is ready.
 *
 * The live screen is a scope, a clock and one button, and nothing else. The
 * whiteboard, the presentation, the video room and the rail of small cards
 * all went in that cut, along with the plan they
 * were reached from: the roster, the agenda, the attachments and the guest
 * link are no longer editable from this page. That is a real loss and it is
 * written here rather than left to be discovered — the data is untouched
 * and every one of them can come back on the record view if it is wanted.
 *
 * LINKING: this page STARTS the take itself, so it links the callId the
 * engine hands back from ITS OWN start — never the engine's leftover id
 * from an unrelated take (the meetingLink lesson, applied at the source: a
 * start we initiated needs no heuristic, only the startedHere gate).
 */

/**
 * IS THE TAKE STILL BEING MADE?
 *
 * `call_id` is NOT this fact and never was. The recorder links the id the
 * MOMENT the call exists — deliberately, so a dying tab still leaves the
 * meeting pointing at its partial record — so a meeting has a `call_id` from
 * the first second of its recording. Three screens read it as "this meeting
 * is over", and each was wrong for the whole length of every take.
 *
 * The word that means finished is the CALL leaving `recording`, which only
 * `finishCall` writes. It reaches every attendee through db/0204's door,
 * because a call is private by default and the join that used to carry it
 * answers its owner alone.
 *
 * An UNKNOWN status (null on a call_id, from a database without 0204 or a
 * record that has been purged) reads as "not running" — the pre-0204
 * behaviour, so the un-migrated branch lands exactly where it used to.
 */
export function takeIsRunning(m: MeetingRecord): boolean {
  return m.call_id !== null && m.call_status === "recording";
}

/** what this page is showing — DERIVED from the record, never stored */
type View = "live" | "uploading" | "awaitingFile" | "record";

/*
 * THE TABS, AFTER THE 2026-09-08 CUT.
 *
 * «فایل‌ها» listed the recording's parts with their durations and offered
 * nothing to do with them — the bar above says how long the recording is, and
 * saving it is a button on that bar now. «دستیار» was a second door into the
 * assistant, which is the platform's first page and a strip on every other.
 */
type PostTab = "review" | "summary" | "tasks" | "notes";

export function MeetingPage({ id }: { id: string }) {
  const t = useTranslations("meetings");
  const locale = useLocale();
  const router = useRouter();
  const engine = useSyncExternalStore(subscribeRecorder, recorderSnapshot, recorderSnapshot);

  const [meeting, setMeeting] = useState<MeetingRecord | null | "failed" | "missing">(null);
  /* null = still asking; "gone" = the server answered and the record is
     not readable — two different nothings */
  const [call, setCall] = useState<Call | null | "gone">(null);
  const [me, setMe] = useState<Me | null>(null);
  /** true once THIS page started a take for THIS meeting — necessary but
      NOT sufficient for linking: the engine may refuse our start while an
      unrelated take runs, so the link also requires the callId to have
      MOVED off the pre-click baseline (the meetingLink lesson, again) */
  const startedHere = useRef(false);
  const startBaseline = useRef<string | null>(null);
  const linked = useRef(false);
  /** see the retry below: the link failure is announced once, not per attempt */
  const linkAnnounced = useRef(false);
  const [linkNonce, setLinkNonce] = useState(0);
  const [uploading, setUploading] = useState(false);
  const uploadInput = useRef<HTMLInputElement | null>(null);

  useCrumbTitle(typeof meeting === "object" && meeting !== null ? meeting.title : undefined);

  const loadMeeting = useCallback(() => {
    void api.meetingDetail(id)
      .then(setMeeting)
      .catch((e: unknown) => {
        const status = (e as { status?: number }).status;
        setMeeting(status === 404 ? "missing" : "failed");
      });
  }, [id]);
  useEffect(loadMeeting, [loadMeeting]);
  useEffect(() => { void api.me().then(setMe).catch(() => setMe(null)); }, []);

  /*
   * THE FACES FOR THE PEOPLE RAIL, read once.
   *
   * Keyed by `user_id`, which is the key `meetingPeople` gives an account —
   * the pattern the meetings list already uses, and for the reason written
   * there: a meeting's attendee rows carry NAMES, not pictures, because an
   * avatar is ~8 KB of `data:` URL and the wire would repeat the same face
   * for every meeting it appears on.
   *
   * A failed read leaves the map EMPTY rather than the rail broken — a
   * column of initials is what this screen would have shown anyway, so the
   * degradation is the old, correct picture (M21).
   */
  const [photos, setPhotos] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    void api.orgPeople()
      .then((people) => setPhotos(new Map(
        people.filter((p) => p.avatar_url !== null).map((p) => [p.id, p.avatar_url as string]),
      )))
      .catch(() => setPhotos(new Map()));
  }, []);

  /**
   * THE HOST IS THE MEETING'S AUTHOR — and the database says so too.
   *
   * 0202 puts a trigger on `meeting.call_id`: only `created_by` may link or
   * unlink the record. This constant is that same rule one layer up, so the
   * screen and the wall agree instead of the screen offering a button the
   * server refuses. It is deliberately FALSE while `me` is still null — not
   * knowing who you are is not a reason to be handed the host's controls,
   * and the effects below re-run when the identity lands.
   */
  const isHost = typeof meeting === "object" && meeting !== null
    && me !== null && meeting.created_by === me.id;

  /* the linked record, POLLED while the pipeline walks its ladder */
  const callId = typeof meeting === "object" && meeting !== null ? meeting.call_id : null;
  useEffect(() => {
    if (callId === null) { setCall(null); return; }
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const read = () => {
      void api.getCall(callId).then((c) => {
        if (!alive) return;
        setCall(c ?? "gone");
        if (c !== null && c.status !== "ready" && c.status !== "failed") {
          timer = setTimeout(read, 5000);
        }
      }).catch(() => {
        /* a transient failure must not end the watch */
        if (alive) timer = setTimeout(read, 5000);
      });
    };
    read();
    return () => { alive = false; if (timer !== null) clearTimeout(timer); };
  }, [callId, linkNonce]);

  /* LINK THE TAKE THIS PAGE STARTED — and only that one. The baseline
     comparison is the load-bearing half: the engine survives navigation with
     an unrelated take's id still in hand, and our start() may have been
     silently refused while that take runs. A failed PATCH is visible and
     retried (the nonce re-arms the effect — a ref reset alone re-fires
     nothing). */
  useEffect(() => {
    if (!startedHere.current || linked.current) return;
    if (typeof meeting !== "object" || meeting === null || meeting.call_id !== null) return;
    if (!engine.callId || engine.callId === startBaseline.current) return;
    linked.current = true;
    void api.updateMeeting(meeting.id, { call_id: engine.callId })
      .then((m) => { linkAnnounced.current = false; setMeeting(m); })
      .catch(() => {
        linked.current = false;
        /* ONCE PER STREAK, not once per attempt. This retries every four
           seconds until the link takes, and a message that re-raises on
           every attempt is a message that fills the screen with itself —
           the old red strip could re-render the same sentence in place
           forever and nobody noticed, a toast cannot. Cleared on the
           success above, so a second outage says so again. */
        if (!linkAnnounced.current) {
          linkAnnounced.current = true;
          notifyWarn(t("linkFailedRetrying"));
        }
        setTimeout(() => setLinkNonce((n) => n + 1), 4000);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- linkNonce re-arms the retry
  }, [engine.callId, meeting, linkNonce]);

  /*
   * THE FILE THE WIZARD SENT AFTER US (2026-09-08).
   *
   * The upload lane creates the meeting, hands the `File` to
   * lib/pendingUpload and navigates here — so the send happens under the
   * processing card rather than behind a modal's disabled button. Taken
   * ONCE (the module removes it as it answers), because an effect that
   * re-runs on a remount would otherwise upload the same file twice and the
   * second record would replace the first's link.
   */
  const uploadStarted = useRef(false);
  const onUploadFile = useCallback((file: File) => {
    setUploading(true);
    void uploadAudioFile(file).then((outcome) => {
      setUploading(false);
      if (!outcome.ok) {
        notifyError(
          outcome.reason === "notAudio" ? t("uploadNotAudio")
            : outcome.reason === "tooBig" ? t("uploadTooBig")
              : outcome.reason === "tooLong" ? t("uploadTooLong")
                : t("uploadFailed"),
        );
        return;
      }
      void api.updateMeeting(id, { call_id: outcome.callId })
        .then((m) => setMeeting(m))
        .catch(() => notifyWarn(t("linkFailedRetrying")));
    }).catch(() => { setUploading(false); notifyError(t("uploadFailed")); });
  }, [id, t]);

  useEffect(() => {
    if (uploadStarted.current) return;
    const file = takeUpload(id);
    if (file === null) return;
    uploadStarted.current = true;
    onUploadFile(file);
  }, [id, onUploadFile]);

  /*
   * LINK THE RECORD TO THE MEETING, ONCE, and only OUR take's.
   *
   * A `useCallback` above the early returns rather than a plain function
   * below them, because the live screen starts itself: arriving IS the
   * start, so an effect has to be able to call this, and hooks cannot live
   * after a conditional return.
   */
  const beginTake = useCallback(() => {
    if (typeof meeting !== "object" || meeting === null) return;
    /* THE RECORDING IS THE HOST'S. THE ONLY
       WALL on this page, deliberately: every door above comes through here,
       so one of them forgetting the rule cannot open a microphone.

       Silent, because a colleague is not being refused anything they asked
       for: the screen states the rule for as long as they are on it, and a
       banner repeating it would be the same sentence twice. */
    if (me === null || meeting.created_by !== me.id) return;
    if (meeting.mode === "upload" || meeting.call_id !== null) return;
    /* the engine is module-level: an unrelated take may be live right now.
       Starting over it would silently hijack that take (the engine's
       one-take guard RESOLVES, it does not reject) — refuse with the name
       of the situation instead. */
    const before = recorderSnapshot();
    if (before.phase === "recording" || before.phase === "paused" || before.phase === "starting") {
      /* ours already, from this page — not a collision, just a re-entry */
      if (!startedHere.current) notifyWarn(t("engineBusy"));
      return;
    }
    startBaseline.current = before.callId ?? null;
    startedHere.current = true;
    void startRecording({
      micId: "",
      /* the mini pill's way home: the take is
         being recorded HERE, so clicking the pill from anywhere else opens
         this meeting's live take rather than the meetings list */
      returnPath: `/meetings/${meeting.id}`,
      language: locale === "en" ? "en" : "mixed",
      /*
       * THE MICROPHONE, FOR EVERY LANE THAT RECORDS AT ALL (2026-09-08).
       *
       * The online lane's shared tab and then the room's own tracks both
       * lived here, and both went with the video room this screen no longer
       * has. A meeting whose mode is `online` is one somebody created before
       * that mode left the wizard; recording it through the microphone is
       * the honest thing left to do, and it is what the in-person lane —
       * measured at 0.79 against 0.34 for a print — has always done better
       * anyway.
       */
      source: "mic",
      title: meeting.title,
      locale,
      resume: null,
      boost: false,
      noiseSuppression: true,
      /* the TEAM template shapes the summary into the sections the review
         and minutes surfaces slice by heading (تصمیم‌ها، اقدامات بعدی…) —
         without a template the default skill writes free prose and every
         extraction tab reads as empty */
      summaryTemplate: "team",
    }).then(() => {
      /* RESOLUTION IS NOT SUCCESS: the engine resolves on a denied mic and
         on create failure, leaving phase "idle" with a named error. Read
         the verdict. */
      const after = recorderSnapshot();
      if (after.phase !== "recording" && after.phase !== "starting" && after.phase !== "paused") {
        startedHere.current = false;
        const code = (after as { error?: string | null }).error ?? null;
        notifyError(code === "micDenied" ? t("errMicDenied") : t("startFailed"));
        return;
      }
      /* THROUGH THE BUS, like every other outcome (user directive: "another
         notification in the middle of the page — put it where it belongs"). */
      notify(t("recordingStarted"));
    }).catch(() => {
      startedHere.current = false;
      notifyError(t("startFailed"));
    });
  }, [meeting, me, locale, t]);

  /*
   * THE LIVE SCREEN STARTS ITSELF, ONCE.
   *
   * The ref is what makes "once" true: without it a re-render after the
   * engine's first phase change re-enters the effect, and `beginTake`'s own
   * busy check would call that a collision with a stranger's take.
   */
  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoStarted.current) return;
    if (typeof meeting !== "object" || meeting === null) return;
    if (meeting.mode === "upload" || meeting.call_id !== null) return;
    /* WAIT for the identity rather than deciding without it: starting on a
       null `me` would be the page refusing its own host for as long as one
       request takes, and the ref is not set here, so the effect re-enters
       when the answer arrives.

       WHO may start is NOT asked here. `beginTake` asks it, at the altitude
       where a microphone would actually be opened — a second copy read as
       extra rigour and made the test for the real one vacuous (found by
       verify-red, 2026-09-06). */
    if (me === null) return;
    autoStarted.current = true;
    beginTake();
  }, [meeting, me, beginTake]);

  /**
   * THE RECORD APPEARS FOR EVERYONE.
   *
   * The engine is in the HOST's browser; every other page has nothing local
   * to watch, so it asks. What it waits for is the take ENDING — not the
   * record appearing, which is what it used to wait for and which happens
   * when the host presses START.
   */
  const live = typeof meeting === "object" && meeting !== null
    && (meeting.call_id === null || takeIsRunning(meeting))
    && meeting.mode !== "upload";
  useEffect(() => {
    if (!live || isHost) return;
    let alive = true;
    const timer = setInterval(() => {
      void api.meetingDetail(id).then((m) => {
        if (!alive) return;
        setMeeting(m);
      }).catch(() => { /* a failed poll is not an ended meeting */ });
    }, 5000);
    return () => { alive = false; clearInterval(timer); };
  }, [live, isHost, id]);

  /**
   * I AM HERE (db/0202).
   *
   * Stamped once, on opening a meeting that is being HELD — which is the
   * only moment the word means anything. The server walls it to the
   * caller's own row and is SILENT for somebody who is not on the roster,
   * so a colleague who opens a meeting out of interest is a reader and does
   * not become an attendee.
   */
  const stamped = useRef(false);
  useEffect(() => {
    if (!live || stamped.current) return;
    if (typeof meeting !== "object" || meeting === null) return;
    stamped.current = true;
    void api.markMeetingAttended(meeting.id).catch(() => { /* best effort */ });
  }, [live, meeting]);

  /*
   * THE FRAME BEFORE THE RECORD. This was a lone «…»: nothing until the read
   * landed, and then all of it at once — "loading" and "an empty page" were
   * the same picture.
   */
  if (meeting === null) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-4" aria-busy="true">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-control w-32" />
        </div>
        <section className="tile p-4"><SkeletonLines lines={6} /></section>
      </div>
    );
  }
  /* NO PADDING OF THE PAGE'S OWN: the container owns the gutters. */
  if (meeting === "missing") return <p className="text-sm text-fg-muted">{t("notFound")}</p>;
  if (meeting === "failed") return <p className="text-sm text-fg-muted">{t("readFailed")}</p>;

  const held = meeting.call_id !== null;
  const running = takeIsRunning(meeting);
  /* live when WE started it this mount, OR when the engine's take IS this
     meeting's linked call — a reload mid-recording must not hide the timer
     and the end button of a take that plainly belongs here */
  const engineOwnsThisMeeting = engine.callId !== null && meeting.call_id === engine.callId;
  const engineOnThisTake = startedHere.current || engineOwnsThisMeeting;
  const recordingLive = engineOnThisTake
    && (engine.phase === "recording" || engine.phase === "paused");
  /**
   * THE SECONDS BEFORE THE FIRST SECOND.
   *
   * Arriving here opens a microphone, and the browser then asks for
   * permission and a device. For that stretch the phase is `starting`, and
   * the red light used to be off: the person who had just pressed RECORD
   * NOW was looking at a screen with no sign that anything was happening,
   * which is the exact moment they press it again.
   */
  const takeStarting = engineOnThisTake && engine.phase === "starting";
  const engineFailed = engineOnThisTake && engine.phase === "failed";
  /*
   * THE TAKE THAT OUTLIVED ITS ENGINE.
   *
   * A reload destroys the JavaScript realm, and with it the MediaRecorder,
   * the stream and the uploader — but the call is real, its parts are on the
   * server, and it sits at `recording` because nothing has finished it. The
   * host lands back on the live screen and would otherwise find no way out
   * of it: `beginTake` rightly refuses a meeting that already has a record,
   * and the end button hangs off an engine that is gone.
   *
   * So the finish is offered without one. `finishCall` is idempotent and
   * takes no part count — it flips recording→processing for a call the
   * caller may update — so pressing it processes exactly what was captured
   * before the page went away.
   */
  const takeOrphaned = isHost && running && !engineOnThisTake;

  /*
   * THE VIEW, DERIVED. Reading it in one place is what makes the stepper
   * unnecessary: there is no state a person can put this page into that the
   * record does not already decide.
   */
  const view: View = held
    ? (running ? "live" : "record")
    : meeting.mode === "upload"
      ? (uploading ? "uploading" : "awaitingFile")
      : "live";

  /** finish a take whose engine is gone — the reload case, above */
  const finishOrphanedTake = () => {
    if (meeting.call_id === null) return;
    void api.finishCall(meeting.call_id)
      .then(loadMeeting)
      .catch(() => notifyError(t("finishFailed")));
  };

  const end = () => {
    void Promise.resolve(finish()).then(() => {
      /* finish() RESOLVES even when it ended in phase "failed" (a dirty
         upload settle, finishCall refusal, nothing recorded) — walking to
         the record then would show a processing card spinning over a take
         the server never received. Stay, say so, keep the retry. */
      const after = recorderSnapshot();
      if (after.phase === "failed") {
        notifyError(t("finishFailed"));
        return;
      }
      /* the record is what moves this page on — `loadMeeting` re-reads the
         status the derivation above reads, so nothing here decides a view */
      setLinkNonce((n) => n + 1);
      loadMeeting();
    });
  };

  /* WHETHER THERE IS A TOP BAR AT ALL. With the meeting's name gone from it,
     the bar holds only the things that are not part of a running take — the
     host-only sentence, the orphaned finish, the failed retry, the upload
     lane's way back — and on an ordinary meeting that is none of them. */
  const topBarActs = (!isHost && view === "live")
    || takeOrphaned
    || (isHost && (engineFailed || view === "awaitingFile"));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {/*
        ── the page's own top bar: the acts, and nothing else ──────────────
        THE MEETING'S NAME LEFT THIS BAR (user directive, 2026-09-17: "remove
        the name of the meeting from the top inside the page, we don't need it
        there — instead add it in front of overview, into the content").

        It was a heading block above every stage, restating what the trail
        already says one line higher (`useCrumbTitle` puts it there). It is in
        the post stage's tab row now, at the row's start, where it labels the
        four tabs it belongs to.

        The bar renders only when it HAS something: an empty flex child still
        spends the column's `gap-4`, which is 16px of nothing above the stage
        on every ordinary meeting.
      */}
      {topBarActs ? (
      <div className="flex flex-wrap items-center justify-end gap-3">
        <div className="flex items-center gap-2">
          {/*
            THE ON-AIR LIGHT AND THE TWO ACTS LEFT THIS BAR (user directive,
            2026-09-16: "for the sound bar and the buttons use one row, with a
            red alarming recording icon without text and digits on the left
            side of the bar, and the pause and finish on the right side").
            They are in `LiveTake`'s control row now — one row holding the
            light, the clock, the scope and the two buttons.

            This REVERSES the rule written at LiveTake's own head ("the button
            is NOT here: ending a take is the page's one act and lives in its
            top bar"), and the reversal is recorded rather than quietly made:
            that rule was right while the stage was a card of its own, and it
            is wrong now that the instrument and its controls are one strip —
            a clock in this bar and a scope forty pixels below it were two
            readings of the same take, six pixels of chrome apart.

            What did NOT move is every act that is not part of a running take:
            the orphaned finish, the failed retry and the upload lane all sit
            here still, because none of them has a bar to live on.
          */}
          {/*
            EVERY START AND EVERY END IS THE HOST'S (user directive,
            2026-09-06). What a colleague gets instead is the SENTENCE, not a
            disabled button: a greyed «پایان و پردازش» is a promise the
            product will not keep, and pressing it explains nothing. The page
            moves them to the record on its own when the host finishes.
          */}
          {!isHost && view === "live" ? (
            <span className="rounded-xl bg-surface-2 px-2.5 py-1.5 text-caption font-medium text-fg-muted">
              {t("hostOnlyRecord")}
            </span>
          ) : null}
          {takeOrphaned ? (
            /* the same act and therefore the same words — what changed is
               only which side finishes it */
            <button type="button" onClick={finishOrphanedTake}
              className="btn bg-accent font-semibold text-on-accent shadow-accent hover:opacity-90">
              {t("endAndProcess")}
            </button>
          ) : isHost && engineFailed ? (
            <button type="button" onClick={end}
              className="btn bg-danger font-semibold text-on-accent hover:opacity-90">
              {t("retryFinish")}
            </button>
          ) : isHost && view === "awaitingFile" ? (
            /* the UPLOAD lane's way back: the wizard normally sends the file
               with the navigation, so this is what is left when that file
               was refused by the network, or when the page was reloaded
               while it was in flight and the handle went with the realm */
            <button type="button" onClick={() => uploadInput.current?.click()}
              className="btn bg-accent font-semibold text-on-accent shadow-accent hover:opacity-90">
              {MODE_ICON.upload}
              {t("startUpload")}
            </button>
          ) : null}
        </div>
      </div>
      ) : null}

      <input
        ref={uploadInput}
        type="file"
        accept="audio/*,video/mp4,video/webm"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file !== undefined) onUploadFile(file);
        }}
      />
      {/* what pressing the button will actually produce — a CONSEQUENCE, not
          an explanation (R21): the recording stopped when the page did, and
          finishing now processes what was captured up to that moment. */}
      {takeOrphaned ? (
        <p className="well text-xs text-fg-muted">{t("takeInterrupted")}</p>
      ) : null}

      {view === "live" ? (
        <LiveTake
          engine={engine}
          live={recordingLive}
          starting={takeStarting}
          locale={locale}
          /* LIVE RECALL's three inputs, threaded from here because this is
             where the engine and the identity already are. A take component
             that reached for the recorder itself would be a second opinion
             about whether a take is running, and the gate below depends on
             that answer being one answer. The RECORD itself now travels with
             them: the people rail reads the roster off it, and `meeting.id`
             is the same id the recall hook was handed separately before. */
          meeting={meeting}
          photos={photos}
          isHost={isHost}
          /* ending the take is still the PAGE's act — the button moved into
             the control row, the decision did not: `end` re-reads the record,
             which is the only thing that moves this page on */
          onEnd={end}
          /* the FINALS only: an interim caption is rewritten as the recogniser
             hears more, so a window built from it asks the same question again
             with different words on every revision */
          liveText={engine.captions?.finals ?? ""}
        />
      ) : null}
      {view === "uploading" ? (
        /* the SAME card the pipeline continues into — see Review.tsx for why
           a null call is step one rather than an empty screen */
        <ProcessingCard call={null} title={meeting.title} locale={locale} />
      ) : null}
      {view === "awaitingFile" ? (
        <div className="tile grid place-items-center p-10 text-center">
          <IconUpload width={24} height={24} />
          <p className="mt-2 text-sm text-fg-muted">{t("noRecordYet")}</p>
        </div>
      ) : null}
      {view === "record" ? (
        <PostStage
          meeting={meeting}
          call={call}
          me={me}
          locale={locale}
          onBackToMeetings={() => router.push("/meetings")}
        />
      ) : null}
    </div>
  );
}

/**
 * حین جلسه — THE WHOLE LIVE SCREEN.
 *
 * ── THREE SURFACES, NOT ONE (user directive, 2026-09-16) ─────────────────
 *
 * This was a single centred card: a thin scope at the top and, under it, a
 * column of transcript that was empty for the first minute of every meeting
 * — "it feels empty and not well designed and divided". It is three things
 * now, each answering a different question a person has while a meeting is
 * being recorded:
 *
 *   the CONTROL ROW  is it recording, for how long, and how do I stop it;
 *   the TRANSCRIPT   what is being said;
 *   the PEOPLE RAIL  who else is here.
 *
 * ── THE ROW ──────────────────────────────────────────────────────────────
 *
 * One strip holds the light, the clock, the scope and the two acts, in the
 * order the directive names them: "a red alarming recording icon without
 * text and digits on the left side of the bar, and the pause and finish on
 * the right side". It is `dir="ltr"` for the reason the record page's player
 * has it — time runs left to right in both locales, the newest sample is the
 * right edge of the scope, and the clock belongs at the end the sound came
 * from. That is also what makes "left" and "right" here mean the two ends of
 * the instrument rather than the two ends of a Persian sentence.
 *
 * The light carries NO WORDS, which is the directive — and the words are
 * still there for a screen reader, because `role="status"` with nothing in it
 * announces nothing: this is the one event on the page nobody can afford to
 * miss. A PAUSED take keeps the light and loses the pulse; a stopped recorder
 * under a blinking red dot is the one lie this row must never tell.
 *
 * The scope is `WaveScope` — the recorder's own, extracted rather than
 * copied — and it is the honest instrument here: it moves with the sound in
 * the room, so a muted microphone reads as a flat line rather than as a
 * screen that looks like it is working.
 */
function LiveTake({ engine, live, starting, locale, meeting, photos, isHost, liveText, onEnd }: {
  engine: ReturnType<typeof recorderSnapshot>;
  live: boolean;
  starting: boolean;
  locale: string;
  /** the record itself: `id` is what recall is read against, and the rail
      reads its roster — one object rather than a widening list of fields */
  meeting: MeetingRecord;
  /** user_id → photo, read once by the page from the org roster */
  photos: Map<string, string>;
  /** db/0214's reader: recall is the HOST's, like every other act on this
      screen. A prop, not a read of the viewer, for the same reason the rest of
      this page's host gates are props. */
  isHost: boolean;
  /** what has been said so far — the FINALS, handed down by the page */
  liveText: string;
  /** finish the take; the page owns what happens next, because what happens
      next is a re-read of the record */
  onEnd: () => void;
}) {
  const t = useTranslations("meetings");
  /*
   * WHICH NOTHING THE LANE IS IN (rule 12). `captions` is null before the
   * engine has opened it AND after a take ends, so the flag alone cannot
   * tell "not started" from "asked for and refused" — `captionsDown` is the
   * second fact, and the two together are the three states the panel draws.
   */
  const lane = engine.captions !== null ? "on" : engine.captionsDown ? "down" : "off";
  /*
   * THE SECOND BRAIN, MOUNTED. Live recall was built whole — the core
   * door, the hook, the cards, the BFF route, db/0214 — and its only mount
   * point was the meeting stage this page replaced, so nothing rendered it.
   * It belongs HERE and nowhere else on this page: the LIVE take is the only
   * state in which "what did we decide about this last time" is a question
   * somebody is about to need an answer to, and the uploaded-file review path
   * is reading a record that is already finished.
   *
   * The gate is `isHost && live`, which is the gate the stage used
   * (`isHost && recordingLive`, and `live` IS `recordingLive` — the page passes
   * it under that name). Stated once, here, so the hook and the cards cannot
   * disagree about who sees them: a card on ten screens is a broadcast, and a
   * card with no take under way is recall of a room that is not talking.
   */
  const recall = useLiveRecall(meeting.id, liveText, isHost && live);
  /* the same words the retired pill said, for the reader who cannot see a
     red dot — the light is silent on screen and must not be silent here */
  const status = starting
    ? t("recordingStarting")
    : engine.phase === "paused" ? t("recordingPaused") : t("recordingNow");
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3" aria-label={t("stage_hold")}>
      {/*
        THE ROW: light · clock — scope — pause · finish.

        `justify` does the dividing rather than a grid: the scope is the only
        thing here whose width is its content, so it takes the middle and the
        two clusters hold their own ends. `shrink-0` on both of them is what
        keeps a long clock from eating the instrument.
      */}
      <div className="card flex w-full items-center gap-3 px-3 py-2" dir="ltr">
        {live || starting ? (
          <span role="status" className="flex shrink-0 items-center gap-2">
            <span
              aria-hidden
              className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-danger/10"
            >
              <span
                /* a PAUSED take is still a take, but it is not capturing —
                   a pulsing light over a stopped recording is the one lie
                   this row must never tell */
                className={`h-2.5 w-2.5 rounded-full bg-danger ${engine.phase === "paused" ? "" : "animate-pulse"}`}
              />
            </span>
            {/* the words the icon replaced, kept where they are still needed:
                `role="status"` announces this when the take begins */}
            <span className="sr-only">{status}</span>
            {/* the take's own length, in the page's digits — NOT `badge-num`,
                which is `display: inline-grid` and would stack the glyphs
                into a column the moment it sits in a flex row (the pill this
                replaced learned that the hard way) */}
            <span className="text-xs font-semibold tabular-nums text-fg">
              {formatClock(Math.floor(engine.recordedMs / 1000), locale)}
            </span>
          </span>
        ) : null}
        {/*
          THE SCOPE GLOWS FOR `recording`, NOT FOR `live` — a paused take is
          still a take, and `live` says so, but nothing is reaching the
          microphone. A halo over a stopped recorder is the same lie the
          light's pulse is forbidden to tell.
        */}
        <WaveScope
          wave={engine.wave}
          level={engine.level}
          live={engine.phase === "recording"}
          className="wave-scope-strip h-8 min-w-0 flex-1"
        />
        {/* EVERY START AND EVERY END IS THE HOST'S (2026-09-06). A colleague
            gets the row's light and clock and no controls at all — the page's
            top bar carries the sentence that says why. */}
        {isHost && live ? (
          <span className="flex shrink-0 items-center gap-2">
            {/*
              PAUSE IS A SECOND ACT and it sits BEFORE the end button,
              because it is the reversible one — which leaves the page's one
              destructive-shaped act at the far end of the row, the only
              thing here wearing a word.

              Not offered while the take is `starting` — `live` is already
              false there — because pausing a recorder that has not begun is
              a press that does nothing and looks broken.
            */}
            <button
              type="button"
              onClick={engine.phase === "paused" ? resume : pause}
              title={engine.phase === "paused" ? t("resumeTake") : t("pauseTake")}
              aria-label={engine.phase === "paused" ? t("resumeTake") : t("pauseTake")}
              className="btn btn-icon border border-border bg-surface text-fg-muted hover:bg-surface-2 hover:text-fg"
            >
              {engine.phase === "paused"
                ? <IconPlay width={16} height={16} />
                : <IconPause width={16} height={16} />}
            </button>
            <button type="button" onClick={onEnd}
              className="btn btn-sm bg-accent font-semibold text-on-accent shadow-accent hover:opacity-90">
              {t("endAndProcess")}
            </button>
          </span>
        ) : null}
      </div>
      {/*
        «آماده ضبط» — the pre-take gap. The light renders only for a live or
        starting take, so without this line the seconds before the microphone
        opens would say nothing at all.
      */}
      {!live && !starting ? (
        <p className="text-sm font-medium text-fg-muted">{t("statusReady")}</p>
      ) : null}
      {/* THE MIX, said only when it is WRONG. The engine knows when the
          microphone has gone quiet or is clipping, and a red light over a
          recording of nothing is the worst shape a fault can take here. */}
      {live && (engine.quality === "quiet" || engine.quality === "micLost") ? (
        <p className="well text-xs text-warning">
          {engine.quality === "micLost" ? t("recordingMicLost") : t("recordingQuiet")}
        </p>
      ) : null}
      {/*
        THE WORDS, AND WHO IS SAYING THEM — the two columns the stage is for.
        Below `lg` they stack, transcript first: the words are the reason the
        screen is open, and a 240px column of names above them would push the
        first line of the meeting under the fold on a laptop.
      */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
        {/* `relative`: the recall cards float over the TRANSCRIPT's own top
            corner (2026-09-15, moved from the stage's foot — RecallCards.tsx
            says why) and push nothing: not the row above, not the words
            below. The transcript reserves no room for them any more. */}
        <div className="relative flex min-h-0 flex-1 flex-col">
          <LiveTranscript
            rows={engine.captionRows}
            interim={engine.captions?.interim ?? ""}
            speakers={engine.liveSpeakers}
            lane={lane}
            locale={locale}
          />

          {/* ── the second brain (item 7) ─────────────────────────────────
              «این را قبلاً تصمیم گرفته بودیم» — a decision from an earlier
              meeting, surfaced while the room is still talking about it.
              Renders nothing at all when there is nothing to recall, so the
              gate above is the only thing that decides whether this is here. */}
          <RecallCards cards={recall.cards} onDismiss={recall.dismiss} />
        </div>
        <AttendeesRail meeting={meeting} photos={photos} locale={locale} />
      </div>
    </section>
  );
}

/* ═══ پس از جلسه — the tab set over the real artifacts ═══════════════════ */
function PostStage({ meeting, call, me, locale, onBackToMeetings }: {
  meeting: MeetingRecord;
  call: Call | null | "gone";
  me: Me | null;
  locale: string;
  onBackToMeetings: () => void;
}) {
  const t = useTranslations("meetings");
  const [tab, setTab] = useState<PostTab>("review");
  /* a fresh object per click — a raw number hits React's Object.is bailout
     and the second click on the same timestamp would do nothing */
  const [seekReq, setSeekReq] = useState<{ ms: number } | null>(null);

  /*
   * A RECORD IS THE PRECONDITION, not a state this component renders
   * (2026-09-08). The page's own derivation only reaches here with a linked
   * call, so the "no record yet" card that used to stand at the top of this
   * function — with a button back into a stage that no longer exists — is
   * gone. The narrowing is what the tabs below need anyway.
   */
  if (meeting.call_id === null) return null;

  const ready = typeof call === "object" && call !== null && call.status === "ready";
  const tabs: Array<{ key: PostTab; label: string }> = [
    { key: "review", label: t("tabReview") },
    /* THE SUMMARY SITS SECOND. It is the thing somebody
       who missed the meeting opens next, and it stood last while the two
       working surfaces — tasks and notes — came before it. */
    { key: "summary", label: t("tabSummary") },
    { key: "tasks", label: t("tabTasks") },
    { key: "notes", label: t("tabNotes") },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* the audio bar rides above the tabs once the record is ready */}
      {ready ? (
        <AudioBar
          callId={meeting.call_id}
          seekTo={seekReq}
          locale={locale}
          /* the total comes from the WIRE (call.duration_ms, recomputed by
             the worker as max(offset+duration) — never a client sum, which
             under-reports across a gap) */
          durationMs={typeof call === "object" && call !== null ? call.duration_ms : null}
          /* what the SAVED file is called: the record’s own title if it has
             one, the meeting’s otherwise — a download named after a uuid is a
             file nobody can find again */
          title={typeof call === "object" && call !== null ? call.title : meeting.title}
        />
      ) : null}

      {/* THE TOOLBAR SHAPE, not an underlined tab strip (audit finding,
          2026-09-02): every other surface switches sections with `btn btn-sm`
          pills, and this row was the one place still drawing a hairline with
          a 2px underline under the active word */}
      {/* THE KIT'S TRACK (2026-09-15): the same rail and pill every page's
          first sub-menu wears, read from sectionTabs rather than drawn here */}
      {/*
        NO NAME ON THIS ROW — and this REVERSES the same day's own change.
        It was put in front of the tabs this morning («instead add it in front
        of overview»), and on a real meeting it collided with the panel below:
        a long title and a nine-pill track do not share one line, so the
        heading wrapped and sat over «رونوشت جلسه» (user, with two
        screenshots: "remove the name of the meeting that is hanging behind in
        the sub menu on top, we don't need it there").
        The name is not lost — the trail carries it above, and the summary's
        own document names itself. A row of tabs is chrome; a title that has
        to fight it for space is a title in the wrong place.
      */}
      <SectionTabs label={t("stage_post")} tabs={tabs} active={tab} onSelect={setTab} />

      {/*
        THE ITEMS PANEL IS NOT GATED ON A RECORDING (0160). Everything else in
        this tab is a view of the call — the ladder, the transcript — so it
        waits for one. The decisions and action items do not: the complaint
        that produced this table was that they were empty, and they were empty
        because they were slices of a summary that does not exist until the
        audio has been processed. A person planning a meeting must be able to
        write down a decision before anyone has spoken.
      */}
      {tab === "review" ? (
        <>
        {/*
          THE VOICES ARE NAMED IN THE TRANSCRIPT (user directive, 2026-09-07:
          "remove this one and add it to meeting transcription so you can open
          the speaker one and choose one of the people that attended").

          A panel of voices stood here for a day — the same three rows the
          turns below already carry, in a card above them. The name in the
          transcript is the control now: it is where a reader notices the
          wrong name, and one press changes every turn that voice took.
        */}
        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-2">
          <div className="flex min-h-0 flex-col">
            {/* the panel's frame while the call is read (audit finding,
                2026-09-02): a `.tile` in the transcript's shape, not «…» */}
            {call === null ? <div className="tile p-4" aria-busy="true"><SkeletonLines lines={6} /></div>
              : call === "gone" ? <p className="p-4 text-sm text-fg-muted">{t("recordGone")}</p>
                : call.status === "failed" ? (
              <div className="tile grid place-items-center p-10 text-center">
                <p className="text-sm text-danger">{t("processingFailed")}</p>
                {/* BACK TO THE LIST, not into the record (user directive):
                    a failed record has nothing to open — sending someone to
                    the raw call page hands them the same failure wearing a
                    different address. The way out is the table they came
                    from. */}
                {/* `.btn-sm`, not a 36px button of its own (audit finding,
                    2026-09-02) */}
                <button type="button" onClick={onBackToMeetings}
                  className="btn btn-sm mt-3 bg-surface-2 font-medium text-fg hover:bg-border">
                  {t("backToMeetings")}
                </button>
              </div>
                ) : call.status !== "ready" ? (
                  <ProcessingCard call={call} title={meeting.title} locale={locale} />
                ) : (
                  <TranscriptPanel
                    callId={meeting.call_id}
                    meeting={meeting}
                    isHost={me !== null && meeting.created_by === me.id}
                    onSeek={(ms) => setSeekReq({ ms })}
                    locale={locale}
                  />
                )}
          </div>
          <ItemsPanel meetingId={meeting.id} callId={meeting.call_id} onSeek={(ms) => setSeekReq({ ms })} locale={locale} />
        </div>
        </>
      ) : null}
      {tab === "tasks" ? (
        <MeetingTasksBoard callId={meeting.call_id}
          callTitle={typeof call === "object" && call !== null ? call.title : meeting.title} />
      ) : null}
      {/*
        THE TWO TABS THAT DO NOT BOUND THEMSELVES (2026-09-08, with the page's
        move to `PageContainer fill`).

        «نمای کلی» and «تسک‌ها» are columns of panels that each carry their own
        `min-h-0 flex-1 overflow-y-auto` — they were written for a bounded
        page and simply started working when it became one. These two are
        ordinary documents as tall as their content, so in a filling column
        they would be CLIPPED rather than scrolled, which is the failure a
        height model introduces one tab over from the thing it fixed.
        `SectionScroller` is the scaffold's own answer and the only place a
        section's scroll may be spelled.
      */}
      {tab === "notes" ? (
        <SectionScroller>
          <NotesTab callId={meeting.call_id} locale={locale} />
        </SectionScroller>
      ) : null}
      {tab === "summary" ? (
        <SectionScroller>
          <SummaryTab meeting={meeting} callId={meeting.call_id} />
        </SectionScroller>
      ) : null}
    </div>
  );
}

/* ── یادداشت‌های من: call notes as the reference's cards ──────────────── */
function NotesTab({ callId, locale }: { callId: string; locale: string }) {
  const t = useTranslations("meetings");
  const [notes, setNotes] = useState<CallNote[] | null | "failed">(null);
  const [draft, setDraft] = useState("");
  const [condemned, setCondemned] = useState<CallNote | null>(null);

  const load = useCallback(() => {
    void api.callNotes(callId).then(setNotes).catch(() => setNotes("failed"));
  }, [callId]);
  useEffect(load, [load]);

  const add = () => {
    const body = draft.trim();
    if (body === "") return;
    void api.addCallNote(callId, { kind: "note", body })
      .then(() => { setDraft(""); load(); })
      .catch(() => notifyError(t("writeFailed")));
  };

  if (notes === "failed") return <p className="p-4 text-sm text-fg-muted">{t("readFailed")}</p>;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-3">
      {/* THE THEME'S FIELD AND BUTTON (audit finding, 2026-09-02): a 40px
          16px-corner input and a 40px square drawn by hand — the composer
          matched neither the plan's `.input` fields nor any `.btn` on the
          page. `px-3` around the 14px glyph is what makes the `.btn` a
          square, with no size re-stated on top of it. */}
      <div className="flex items-center gap-2">
        <input value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") add(); }}
          placeholder={t("notePlaceholder")}
          className="input min-w-0 flex-1" />
        <button type="button" onClick={add} disabled={draft.trim() === ""}
          aria-label={t("addNote")}
          className="btn shrink-0 bg-accent px-3 text-on-accent">
          <IconPlus width={14} height={14} />
        </button>
      </div>
      {/* THE LIST'S FRAME BEFORE ITS ROWS (audit finding, 2026-09-02): this
          tab was a lone «…» until the notes arrived, and the composer — which
          needs no network to exist — appeared with them. It stands first now;
          two placeholder rows in the rows' own shape hold the list's slot. */}
      {notes === null ? (
        <ul className="space-y-2" aria-busy="true">
          {[0, 1].map((i) => (
            <li key={i} className="tile tile-row p-3.5"><SkeletonLines lines={2} /></li>
          ))}
        </ul>
      ) : notes.length === 0 ? (
        <p className="p-2 text-sm text-fg-muted">{t("noNotes")}</p>
      ) : (
        <ul className="space-y-2">
          {notes.map((note) => (
            <li key={note.id} className="tile tile-row flex items-start gap-3 p-3.5">
              <span className="min-w-0 flex-1">
                <span className="block whitespace-pre-wrap text-sm leading-6 text-fg">{note.body}</span>
                <span className="mt-1 block text-caption text-fg-subtle">
                  {formatDate(note.created_at, locale)}
                  {note.at_ms !== null ? ` · ${formatDuration(Math.round(note.at_ms / 1000), locale)}` : ""}
                </span>
              </span>
              {/* `btn btn-icon`, like the attachment row's trash and the items
                  panel's (audit finding, 2026-09-02): this one had no `.tap`
                  either, so below md its hit area was the 12px glyph */}
              <button type="button" aria-label={t("deleteNote")} onClick={() => setCondemned(note)}
                className="btn btn-icon shrink-0 text-fg-subtle hover:text-danger">
                <IconTrash width={12} height={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {condemned !== null ? (
        <ConfirmDialog
          title={t("deleteNoteTitle")}
          body={t("deleteNoteBody")}
          confirmLabel={t("deleteNote")}
          cancelLabel={t("cancel")}
          onCancel={() => setCondemned(null)}
          onConfirm={() => {
            const target = condemned;
            setCondemned(null);
            void api.deleteCallNote(target.id).then(load).catch(() => undefined);
          }}
        />
      ) : null}
    </div>
  );
}
