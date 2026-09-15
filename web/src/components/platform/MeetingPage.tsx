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

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {/* ── the page's own top bar: the meeting, and the one act ────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="min-w-0 truncate text-base font-bold text-fg">{meeting.title}</h1>

        <div className="flex items-center gap-2">
          {/*
            THE ON-AIR LIGHT. `role="status"` announces the change when the
            take
            begins, which is the one event on this page nobody can afford to
            miss.
          */}
          {recordingLive || takeStarting ? (
            /*
              ONE LINE.
              It wrapped because of `badge-num`, which is `display:
              inline-grid` — a number in a CIRCLE, one item per row — and it
              beat the `flex` written beside it, so the dot, the word and the
              clock stacked into three rows. Two utilities on one property,
              resolved by their order in the stylesheet and not in the class
              string: the class list read as a row and rendered as a column.
              `shrink-0` is the other half — this pill sits beside a button
              that does not shrink, so without it the flex row takes the
              width out of the words.
            */
            <span
              role="status"
              className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl bg-danger/10 px-3.5 py-2 text-xs font-bold tabular-nums text-danger"
            >
              <span
                /* a PAUSED take is still a take, but it is not capturing —
                   a pulsing light over a stopped recording is the one lie
                   this pill must never tell */
                className={`h-2 w-2 rounded-full bg-danger ${engine.phase === "paused" ? "" : "animate-pulse"}`}
                aria-hidden
              />
              {takeStarting
                ? t("recordingStarting")
                : engine.phase === "paused" ? t("recordingPaused") : t("recordingNow")}
              {recordingLive ? (
                <span dir="ltr">
                  {formatClock(Math.floor(engine.recordedMs / 1000), locale)}
                </span>
              ) : null}
            </span>
          ) : null}
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
          ) : isHost && recordingLive ? (
            <>
              {/*
                PAUSE IS A SECOND ACT, and it is the host's like every other
                . It sits BEFORE the end button
                because it is the reversible one, and it is icon-only: the
                page's one destructive-shaped act should stay the only thing
                here wearing a word.

                Not offered while the take is `starting` — `recordingLive`
                is already false there — because pausing a recorder that has
                not begun is a press that does nothing and looks broken.
              */}
              <button
                type="button"
                onClick={engine.phase === "paused" ? resume : pause}
                title={engine.phase === "paused" ? t("resumeTake") : t("pauseTake")}
                aria-label={engine.phase === "paused" ? t("resumeTake") : t("pauseTake")}
                className="btn btn-icon-lg border border-border bg-surface text-fg-muted hover:bg-surface-2 hover:text-fg"
              >
                {engine.phase === "paused"
                  ? <IconPlay width={18} height={18} />
                  : <IconPause width={18} height={18} />}
              </button>
              <button type="button" onClick={end}
                className="btn bg-accent font-semibold text-on-accent shadow-accent hover:opacity-90">
                {t("endAndProcess")}
              </button>
            </>
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
             that answer being one answer. */
          meetingId={meeting.id}
          isHost={isHost}
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
 * The button is NOT here: ending a take is the page's one act and lives in
 * its top bar with every other act, which is where somebody who has used any
 * other screen in this product will look for it. Putting a second «پایان»
 * inside the card would be two buttons for one thing.
 *
 * The scope is `WaveScope` — the recorder's own, extracted rather than
 * copied — and it is the honest instrument here: it moves with the sound in
 * the room, so a muted microphone reads as a flat line rather than as a
 * screen that looks like it is working.
 */
function LiveTake({ engine, live, starting, locale, meetingId, isHost, liveText }: {
  engine: ReturnType<typeof recorderSnapshot>;
  live: boolean;
  starting: boolean;
  locale: string;
  /** which meeting is being recalled AGAINST — the organisation's ledger is
      read for decisions relevant to this one */
  meetingId: string;
  /** db/0214's reader: recall is the HOST's, like every other act on this
      screen. A prop, not a read of the viewer, for the same reason the rest of
      this page's host gates are props. */
  isHost: boolean;
  /** what has been said so far — the FINALS, handed down by the page */
  liveText: string;
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
  const recall = useLiveRecall(meetingId, liveText, isHost && live);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <section className="tile flex min-h-0 flex-1 flex-col items-center gap-3 p-5" aria-label={t("stage_hold")}>
        {/*
          THE LIGHT IS SAID ONCE.
          It was said twice — the top bar's on-air pill and a second line
          directly above the scope, six pixels apart and always agreeing,
          which is how a person learns to read past both. The pill stays
          because it is where the CLOCK and the end button are; the scope
          says the same thing better anyway, by moving.

          What was NOT here before and had to be kept is «آماده ضبط»: the
          pill renders only for a live or starting take, so with this line
          gone the pre-take screen had nothing at all on it. It renders
          exactly in that gap and never beside the pill.
        */}
        {!live && !starting ? (
          <p className="text-sm font-medium text-fg-muted">{t("statusReady")}</p>
        ) : null}
        {/*
          THE BAR, NOT THE HALL (user directive, 2026-09-15: "the recording
          bar … make it smaller like the last image, something small and
          clean"). The scope stood 112px tall over a 30px clock, and the
          transcript got whatever was left — on a laptop, three lines. It
          wears the record page's own player bar now (Review.tsx: play ·
          label · strip · time, one `.card` row): a 32px strip with the clock
          inline at its end, so the two instruments read as ONE thing across
          the finish line, and the words get the height the scope was
          spending on itself. `dir="ltr"` for the reason the player has it —
          time runs left-to-right in both locales, and the newest bar is the
          right edge.

          THE SCOPE GLOWS FOR `recording`, NOT FOR `live` — a paused take is
          still a take, and `live` says so, but nothing is reaching the
          microphone. A halo over a stopped recorder is the same lie the
          pill's pulsing dot is forbidden to tell.
        */}
        <div className="card flex w-full max-w-3xl items-center gap-3 px-3 py-2" dir="ltr">
          <WaveScope
            wave={engine.wave}
            level={engine.level}
            live={engine.phase === "recording"}
            className="wave-scope-strip h-8 min-w-0 flex-1"
          />
          {/* the clock is the take's own length, in the page's digits; ONE
              LINE, the way the player's time is (`badge-num`) */}
          <span className="badge-num shrink-0 text-xs font-medium tabular-nums text-fg">
            {formatClock(Math.floor(engine.recordedMs / 1000), locale)}
          </span>
        </div>
        {/* THE MIX, said only when it is WRONG. The engine knows when the
            microphone has gone quiet or is clipping, and a red light over a
            recording of nothing is the worst shape a fault can take here. */}
        {live && (engine.quality === "quiet" || engine.quality === "micLost") ? (
          <p className="well text-xs text-warning">
            {engine.quality === "micLost" ? t("recordingMicLost") : t("recordingQuiet")}
          </p>
        ) : null}
        {/*
          THE WORDS AS THEY ARRIVE, IN THIS CARD. It takes the rest of the
          card
          and scrolls inside itself — the scope and the clock hold still above
          it, which is what makes the pair readable while somebody is talking,
          and it is what fills the empty half the card used to show.
        */}
        {/* `relative`: the recall cards float over the TRANSCRIPT's own top
            corner (2026-09-15, moved from the stage's foot — RecallCards.tsx
            says why) and push nothing: not the bar above, not the words
            below. The transcript reserves no room for them any more. */}
        <div className="relative flex min-h-0 w-full max-w-3xl flex-1 flex-col">
          <LiveTranscript
            rows={engine.captionRows}
            interim={engine.captions?.interim ?? ""}
            speakers={engine.liveSpeakers}
            lane={lane}
            locale={locale}
            embedded
          />

          {/* ── the second brain (item 7) ─────────────────────────────────
              «این را قبلاً تصمیم گرفته بودیم» — a decision from an earlier
              meeting, surfaced while the room is still talking about it.
              Renders nothing at all when there is nothing to recall, so the
              gate above is the only thing that decides whether this is here. */}
          <RecallCards cards={recall.cards} onDismiss={recall.dismiss} />
        </div>
      </section>
    </div>
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
