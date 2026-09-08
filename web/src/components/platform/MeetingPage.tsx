"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";
import { api } from "@/api/client";
import { Skeleton, SkeletonLines } from "@/components/scaffold";
import { notify } from "@/lib/notify";
import { publishCaptureHandle } from "@/lib/captureHandle";
import type { Call, CallNote, Me, MeetingAgendaItem, MeetingRecord, MeetingAttachment } from "@/api/types";
import { useCrumbTitle } from "@/components/platform/CrumbTitle";
import { ConfirmDialog } from "@/components/rowActions";
import { Overlay } from "@/components/platform/Overlay";
import { DIALOG_BODY } from "@/components/platform/tasks/panelStyle";
import { DateField, TimeField } from "@/components/DateTimeFields";
import { Select } from "@/components/Select";
import { AgendaEditor, MODE_ICON } from "./Meetings";
import { InviteDialog } from "./meeting/InviteDialog";
import { MeetingStage } from "./meeting/Stage";
import { AudioBar, ProcessingCard, TranscriptPanel } from "./meeting/Review";
import { ItemsPanel } from "./meeting/ItemsPanel";
import { MinutesTab } from "./meeting/Minutes";
import { MeetingTasksBoard } from "./meeting/MiniTasks";
import { MeetingAssistant } from "./meeting/MeetingAssistant";
import {
  IconCheck, IconCopy, IconFileText, IconMic, IconPlus, IconRows, IconTrash,
  IconUsers, IconUpload } from "@/components/icons";
import {
  addSharedAudio, finish, recorderSnapshot, startRecording, subscribeRecorder,
} from "@/lib/recordingEngine";
import { uploadAudioFile } from "@/lib/uploadFile";
import { Avatar } from "@/components/Avatar";
import { digits, formatClock, formatDate, formatDuration, formatTime, personName, instantFromFields, nowFields } from "@/lib/format";

/**
 * THE MEETING'S OWN PAGE — the big-milestone round (user directive,
 * 2026-09-01: "copy everything ... it does all echo does but in
 * background"). The reference's flow, whole, with Echo as the invisible
 * engine:
 *
 *   پیش از جلسه — the plan as the reference's cards (مشخصات، حالت
 *     برگزاری، دعوت‌شدگان، دستور جلسه), شروع جلسه in the page's own top
 *     bar (never a popup);
 *   برگزاری — pressing start calls the RECORDING ENGINE directly (online
 *     = system audio) — no recorder screen, just the red timer, the quick
 *     actions, the whiteboard; پایان و پردازش hands the take to the
 *     pipeline;
 *   پس از جلسه — the tab set over the real artifacts: بازبینی (staged
 *     processing → player + transcript + extraction), تسک‌ها (the mini
 *     board), فایل‌ها، دستیار، یادداشت‌های من، صورت‌جلسه (the 0146
 *     lifecycle document).
 *
 * LINKING: this page STARTS the take itself, so it links the callId the
 * engine hands back from ITS OWN start — never the engine's leftover id
 * from an unrelated take (the meetingLink lesson, applied at the source:
 * a start we initiated needs no heuristic, only the startedHere gate).
 */

type Stage = "pre" | "hold" | "post";

/**
 * IS THE TAKE STILL BEING MADE?
 *
 * `call_id` is NOT this fact and never was. The recorder links the id the
 * MOMENT the call exists — deliberately, so a dying tab still leaves the
 * meeting pointing at its partial record — so a meeting has a `call_id` from
 * the first second of its recording. Three screens read it as "this meeting
 * is over", and each was wrong for the whole length of every take: the host
 * reloading landed on «پس از جلسه» with the live stage sealed behind them, a
 * colleague was moved to the record the instant the host pressed start, and
 * the earlier steps sealed while the meeting was still being held.
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

/**
 * The meeting's two columns — TWO ratios, because the two stages are not the
 * same screen, and the reference product uses two as well.
 *
 * On the PLAN the rail carries as much as the main column does (the holding
 * mode, the invitees), so they sit near each other: 604.797 / 403.203 on
 * their own page, exactly 3:2.
 *
 * On the STAGE the main column is a whiteboard or a live room — the thing
 * the meeting IS — and the rail is a strip of small controls beside it. Held
 * at 3:2 the canvas is cramped and the rail is mostly air, which is what
 * "a bigger box for the whiteboard or video, smaller for other" was pointing
 * at. Measured on their stage: 1270 / 330, near enough to 4:1.
 */
const PLAN_COLUMNS = "lg:grid-cols-[1.5fr_1fr]";
const STAGE_COLUMNS = "lg:grid-cols-[4fr_1fr]";
/**
 * The stepper's segmented frame — ONE spelling, worn by the real nav and by
 * its loading stand-in, so the two cannot drift apart (audit finding,
 * 2026-09-02). `rounded-lg` (12) is the concentric fit around 8px-cornered
 * `.btn-sm` steps with 4px of padding; the 20px it wore before was the card
 * radius on a control.
 */
const STEPPER_FRAME = "flex items-center gap-0.5 rounded-lg border border-border bg-surface p-1";
type PostTab = "review" | "tasks" | "files" | "assistant" | "notes" | "minutes";

export function MeetingPage({ id }: { id: string }) {
  const t = useTranslations("meetings");
  const locale = useLocale();
  const router = useRouter();
  const engine = useSyncExternalStore(subscribeRecorder, recorderSnapshot, recorderSnapshot);

  const [meeting, setMeeting] = useState<MeetingRecord | null | "failed" | "missing">(null);
  /* null = still asking; "gone" = the server answered and the record is
     not readable — two different nothings */
  const [call, setCall] = useState<Call | null | "gone">(null);
  const [stage, setStage] = useState<Stage | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** true once THIS page started a take for THIS meeting — necessary but
      NOT sufficient for linking: the engine may refuse our start while an
      unrelated take runs, so the link also requires the callId to have
      MOVED off the pre-click baseline (the meetingLink lesson, again) */
  const startedHere = useRef(false);
  const startBaseline = useRef<string | null>(null);
  const linked = useRef(false);
  const [linkNonce, setLinkNonce] = useState(0);
  const [uploading, setUploading] = useState(false);
  const uploadInput = useRef<HTMLInputElement | null>(null);

  useCrumbTitle(typeof meeting === "object" && meeting !== null ? meeting.title : undefined);

  const loadMeeting = useCallback(() => {
    void api.meetingDetail(id)
      .then((m) => {
        setMeeting(m);
        /* an unrecorded meeting ALWAYS opens on its plan — the
           reference lands on /pre after creation, and a meeting created
           for "now" is already a second in the past by the time this page
           loads, which used to drop the person straight into the live
           stage they had not asked for.

           A meeting whose take is STILL RUNNING opens on the stage it is
           being held in. This is the reload case (user report, 2026-09-07:
           "if you refresh the page it closes the recording and send it to
           the after meeting stage — it should do that only after you press
           finish"): the record exists from the first second, so the old
           `call_id !== null ? "post"` sent the host to the artifacts of a
           meeting that was still happening. */
        setStage((cur) => cur
          ?? (m.call_id === null ? "pre" : takeIsRunning(m) ? "hold" : "post"));
      })
      .catch((e: unknown) => {
        const status = (e as { status?: number }).status;
        setMeeting(status === 404 ? "missing" : "failed");
      });
  }, [id]);
  useEffect(loadMeeting, [loadMeeting]);
  useEffect(() => { void api.me().then(setMe).catch(() => setMe(null)); }, []);

  /* THIS TAB NAMES ITSELF while the meeting is open, so that if the person
     shares it in the recorder's picker the engine can tell — and drop the
     tab's audio in favour of the room's own tracks, which are the same
     voices without a loudspeaker and an encoder in between. */
  useEffect(publishCaptureHandle, []);

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
  }, [callId]);

  /* link the take THIS page started — and only that one. The baseline
     comparison is the load-bearing half: the engine survives navigation
     with an unrelated take's id still in hand, and our start() may have
     been silently refused while that take runs. A failed PATCH is visible
     and retried (the nonce re-arms the effect — a ref reset alone re-fires
     nothing). */
  useEffect(() => {
    if (!startedHere.current || linked.current) return;
    if (typeof meeting !== "object" || meeting === null || meeting.call_id !== null) return;
    if (!engine.callId || engine.callId === startBaseline.current) return;
    linked.current = true;
    void api.updateMeeting(meeting.id, { call_id: engine.callId })
      .then((m) => { setError(null); setMeeting(m); })
      .catch(() => {
        linked.current = false;
        setError(t("linkFailedRetrying"));
        setTimeout(() => setLinkNonce((n) => n + 1), 4000);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- linkNonce re-arms the retry
  }, [engine.callId, meeting, linkNonce]);

  /**
   * BEGIN THE TAKE.
   *
   * A `useCallback` above the early returns rather than a plain function
   * below them, because the live stage starts itself: entering «حین جلسه»
   * IS the start (user directive — "in top bar says mid meet so it should
   * already start the video or the audio"), so an effect has to be able to
   * call this, and hooks cannot live after a conditional return.
   *
   * Everything it refuses is a state where starting would be wrong rather
   * than merely inconvenient: no meeting loaded, a meeting that already has
   * its record, the upload lane (whose "start" is a file picker and must
   * never ask for a microphone), and an engine already running somebody
   * else's take.
   */
  const beginTake = useCallback((shareInstead = false) => {
    if (typeof meeting !== "object" || meeting === null) return;
    /* THE RECORDING IS THE HOST'S (user directive, 2026-09-06: "only the
       host should have the ability to start the recording and share the
       screen for audio ... no, all that come to the meeting have a ability
       to get it for themselves as well and its a bug").

       THE ONLY WALL on this page, deliberately: every door above — the
       auto-start, the share button, the upload picker — comes through here,
       so one of them forgetting the rule cannot open a microphone.

       Silent, because a colleague is not being refused anything they asked
       for: the top bar states the rule for as long as they are in the
       stage, and a banner repeating it would be the same sentence twice on
       one screen. */
    if (me === null || meeting.created_by !== me.id) return;
    if (meeting.mode === "upload" || meeting.call_id !== null) return;
    /* the engine is module-level: an unrelated take may be live right now.
       Starting over it would silently hijack that take (the engine's
       one-take guard RESOLVES, it does not reject) — refuse with the name
       of the situation instead. */
    const before = recorderSnapshot();
    if (before.phase === "recording" || before.phase === "paused" || before.phase === "starting") {
      /* ours already, from this page — not a collision, just a re-entry */
      if (!startedHere.current) setError(t("engineBusy"));
      return;
    }
    setError(null);
    startBaseline.current = before.callId ?? null;
    startedHere.current = true;
    void startRecording({
      micId: "",
      language: locale === "en" ? "en" : "mixed",
      /*
       * BACK TO THE ROOM'S OWN TRACKS, and this time with the numbers
       * (2026-09-07, third report on one meeting).
       *
       * 2026-09-04 pointed the online lane at a SHARED TAB, because "the
       * meetings people actually hold are in software we do not host". That
       * reasoning still stands for a meeting held elsewhere and it cost two
       * things for a meeting held HERE, both measured rather than argued:
       *
       *  · a colleague's voice reached the recording only if the right
       *    surface was picked — a two-person meeting came back with one
       *    speaker and no transcript of the far end;
       *  · the recorded voice stopped being the person's. The same speaker,
       *    the same day, the same enrolled print: 0.79 on a microphone take
       *    and 0.34 on an online one, with a DIFFERENT person scoring higher
       *    (0.38). The take carries one consistent voice (self-similarity
       *    0.77) that is spectrally tilted — 3.5 dB down where a voice is
       *    identified, 5.5 dB up above 4 kHz. It is not loudness, noise,
       *    rate, echo, the mono downmix, the device, or the WebAudio round
       *    trip; each was measured and ruled out. What is left is the second
       *    SOURCE summed into the take.
       *
       * A meeting held in our room does not need that sum: everyone in it is
       * already a track in this page. So the room is the source again, and
       * the share is an explicit act for the case it was reversed back for —
       * one button, named for what it is, instead of a picker in front of
       * everybody.
       */
      source: meeting.mode !== "online" ? "mic" : shareInstead ? "system" : "room",
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
      /* RESOLUTION IS NOT SUCCESS: the engine resolves on a denied mic, a
         cancelled share picker, share-without-audio and create failure,
         leaving phase "idle" with a named error. Read the verdict. */
      const after = recorderSnapshot();
      if (after.phase !== "recording" && after.phase !== "starting" && after.phase !== "paused") {
        startedHere.current = false;
        const code = (after as { error?: string | null }).error ?? null;
        setError(
          code === "micDenied" ? t("errMicDenied")
            : code === "shareDenied" ? t("errShareDenied")
              : code === "shareNoAudio" ? t("errShareNoAudio")
                : t("startFailed"),
        );
        return;
      }
      /* THROUGH THE BUS, like every other outcome (user directive: "another
         notification in the middle of the page — put it where it belongs").
         What stood here was a pill floating in the column between the
         controls and the stage: it moved the layout while it was up, it
         cleared itself after four seconds, and the bell never learned that
         a recording had started. */
      notify(t("recordingStarted"));
    }).catch(() => {
      startedHere.current = false;
      setError(t("startFailed"));
    });
  }, [meeting, me, locale, t]);

  /*
   * THE LIVE STAGE STARTS ITSELF, ONCE.
   *
   * The ref is what makes "once" true: without it a re-render after the
   * engine's first phase change re-enters the effect, and `beginTake`'s own
   * busy check would call that a collision with a stranger's take. It is
   * never reset — walking back to the plan and forward again does not start
   * a second take, because the first one is still running and this page has
   * an end button for it.
   */
  const autoStarted = useRef(false);
  useEffect(() => {
    if (stage !== "hold" || autoStarted.current) return;
    if (typeof meeting !== "object" || meeting === null) return;
    /* WAIT for the identity rather than deciding without it: starting on a
       null `me` would be the page refusing its own host for as long as one
       request takes, and the ref is not set here, so the effect re-enters
       when the answer arrives.

       WHO may start is NOT asked here. `beginTake` asks it, at the altitude
       where a microphone would actually be opened — the same verdict this
       effect already carries for the upload and held cases, and for the same
       reason: a second copy read as extra rigour and made the test for the
       real one vacuous (found by verify-red, 2026-09-06). */
    if (me === null) return;
    /*
     * … AND THE ONLINE LANE WALKS IN AGAIN (2026-09-07).
     *
     * It needed a button only because it opened the SHARE PICKER, and a
     * browser opens one for a gesture: the picker is reached after the
     * microphone resolves, by which time the activation is spent, and the
     * refusal that follows is `NotAllowedError` — the same error a cancelled
     * picker raises, so the person was told they cancelled a dialog they had
     * never been shown. With the room as the source there is no picker, so
     * there is nothing to hold a gesture for. Sharing another app's audio is
     * still a button, and still the gesture it needs.
     */
    /* the upload lane and an already-held meeting are refused by
       `beginTake` itself, at the altitude where a microphone would actually
       be opened. A second copy here read as extra rigour and made the test
       for it vacuous — deleting the effect's guard left the suite green,
       which is how it was found. */
    if (meeting.call_id !== null) return;
    autoStarted.current = true;
    beginTake();
  }, [stage, meeting, me, isHost, beginTake]);

  /**
   * THE ROOM CLOSES FOR EVERYONE (user directive: "only the host must have
   * the ability to finish it and after it finishes the session should be
   * close for all").
   *
   * The engine is in the HOST's browser; every other page has nothing local
   * to watch, so it asks. What it waits for is the take ENDING — not the
   * record appearing, which is what it used to wait for and which happens
   * when the host presses START. Every colleague was being sent to the
   * artifacts one second into the meeting, which is the exact opposite of
   * the directive this poll was built for.
   */
  useEffect(() => {
    if (stage !== "hold" || isHost) return;
    let alive = true;
    const timer = setInterval(() => {
      void api.meetingDetail(id).then((m) => {
        if (!alive) return;
        setMeeting(m);
        if (m.call_id !== null && !takeIsRunning(m)) setStage("post");
      }).catch(() => { /* a failed poll is not an ended meeting */ });
    }, 5000);
    return () => { alive = false; clearInterval(timer); };
  }, [stage, isHost, id]);

  /**
   * I AM HERE (db/0202).
   *
   * Stamped once, on opening a meeting that is being HELD — which is the
   * only moment the word means anything. The server walls it to the
   * caller's own row and is SILENT for somebody who is not on the roster,
   * so a colleague who opens a meeting out of interest is a reader and does
   * not become an attendee. It is what lets the transcript name who was in
   * the room instead of numbering voices.
   */
  const stamped = useRef(false);
  useEffect(() => {
    if (stage !== "hold" || stamped.current) return;
    if (typeof meeting !== "object" || meeting === null) return;
    stamped.current = true;
    void api.markMeetingAttended(meeting.id).catch(() => { /* best effort */ });
  }, [stage, meeting]);

  /*
   * THE FRAME BEFORE THE RECORD (audit finding, 2026-09-02). This was a lone
   * «…»: no stepper, no top bar, no cards until the read landed, and then
   * all of it at once — "loading" and "an empty page" were the same picture.
   * The stepper and the plan's two columns are structure, known before the
   * network, so they render now and only their contents wait. The pills are
   * `.btn-sm` tall and the action slot is `.btn` tall, so nothing moves when
   * the real controls take their place. loading.guard.test.ts cannot see an
   * early `return <p>…</p>`, which is why it never fired here; the page test
   * is the instrument instead.
   */
  if (meeting === null) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-4" aria-busy="true">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <nav aria-label={t("stages")} className={STEPPER_FRAME}>
            <Skeleton className="h-[34px] w-24" />
            <Skeleton className="h-[34px] w-24" />
            <Skeleton className="h-[34px] w-24" />
          </nav>
          <Skeleton className="h-control w-32" />
        </div>
        <div className={`grid items-start gap-4 ${PLAN_COLUMNS}`}>
          <div className="space-y-4">
            <section className="tile p-4"><SkeletonLines lines={4} /></section>
            <section className="tile p-4"><SkeletonLines lines={3} /></section>
          </div>
          <div className="space-y-4">
            <section className="tile p-4"><SkeletonLines lines={2} /></section>
            <section className="tile p-4"><SkeletonLines lines={2} /></section>
            <section className="tile p-4"><SkeletonLines lines={3} /></section>
          </div>
        </div>
      </div>
    );
  }
  /* NO PADDING OF THE PAGE'S OWN (audit finding, 2026-09-02, the same
     verdict as the frame above): the container owns the gutters, and the
     `p-6` these two sentences wore was the loading branch's — it moved a
     one-line answer 24px off the column every other state sits on. */
  if (meeting === "missing") return <p className="text-sm text-fg-muted">{t("notFound")}</p>;
  if (meeting === "failed") return <p className="text-sm text-fg-muted">{t("readFailed")}</p>;

  const active: Stage = stage ?? "pre";
  const held = meeting.call_id !== null;
  const running = takeIsRunning(meeting);
  /** a FINISHED record seals the meeting's earlier stages — see stepTab.
      While the take is still running they stay doors, or a host who
      reloaded would be locked out of the stage they are standing in. */
  const sealed = held && !running;
  const timePast = new Date(meeting.scheduled_at).getTime() <= Date.now();
  /* live when WE started it this mount, OR when the engine's take IS this
     meeting's linked call — a reload mid-recording must not hide the timer
     and the end button of a take that plainly belongs here */
  const engineOwnsThisMeeting = engine.callId !== null && meeting.call_id === engine.callId;
  const engineOnThisTake = startedHere.current || engineOwnsThisMeeting;
  const recordingLive = engineOnThisTake
    && (engine.phase === "recording" || engine.phase === "paused");
  const engineFailed = engineOnThisTake && engine.phase === "failed";
  /*
   * THE TAKE THAT OUTLIVED ITS ENGINE.
   *
   * A reload destroys the JavaScript realm, and with it the MediaRecorder,
   * the stream and the uploader — but the call is real, its parts are on the
   * server, and it sits at `recording` because nothing has finished it. The
   * host lands back in the live stage (above) and would otherwise find no
   * way out of it: `beginTake` rightly refuses a meeting that already has a
   * record, and the end button hangs off an engine that is gone.
   *
   * So the finish is offered without one. `finishCall` is idempotent and
   * takes no part count — it flips recording→processing for a call the
   * caller may update — so pressing it processes exactly what was captured
   * before the page went away. `startedHere` keeps a take that is merely
   * STARTING from reading as abandoned.
   */
  const takeOrphaned = isHost && running && !engineOnThisTake;

  /*
   * IS THERE A SHARE TO OFFER?
   *
   * An online take carries this room from the moment somebody walks in, so
   * the share is no longer the way in — it is the answer to one question:
   * "this meeting is happening in another app". It is worth offering while
   * no take is running (the way in, if the auto-start was refused) and while
   * one IS running and carries no shared audio yet — including after a share
   * has ENDED, which is the moment a person most needs the door back.
   */
  const shareOffered = isHost && meeting.mode === "online" && active === "hold"
    && (!held || (recordingLive && (!engine.shared || engine.quality === "shareEnded")));

  /* a PLAIN function, deliberately: everything from here down runs after the
     page's early returns for a record still loading or missing, so a hook
     here changes the hook ORDER between renders — React says so out loud and
     the page renders nothing at all, which arrives as "the stepper is
     missing" rather than as "somebody added a hook below a return". */
  const addShare = () => {
    setError(null);
    void addSharedAudio().then((result) => {
      if (result === "ok") return;
      setError(
        result === "shareDenied" ? t("errShareDenied")
          : result === "shareNoAudio" ? t("errShareNoAudio")
            : result === "ownTab" ? t("errOwnTab")
              : t("startFailed"),
      );
    });
  };

  const patch = (body: Record<string, unknown>) => {
    void api.updateMeeting(meeting.id, body)
      .then((m) => setMeeting(m))
      .catch(() => setError(t("writeFailed")));
  };

  const onUploadFile = (file: File) => {
    setUploading(true);
    setError(null);
    void uploadAudioFile(file).then((outcome) => {
      setUploading(false);
      if (!outcome.ok) {
        setError(
          outcome.reason === "notAudio" ? t("uploadNotAudio")
            : outcome.reason === "tooBig" ? t("uploadTooBig")
              : outcome.reason === "tooLong" ? t("uploadTooLong")
                : t("uploadFailed"),
        );
        return;
      }
      void api.updateMeeting(meeting.id, { call_id: outcome.callId })
        .then((m) => { setMeeting(m); setStage("post"); })
        .catch(() => setError(t("linkFailedRetrying")));
    }).catch(() => { setUploading(false); setError(t("uploadFailed")); });
  };

  /** finish a take whose engine is gone — the reload case, above */
  const finishOrphanedTake = () => {
    if (meeting.call_id === null) return;
    void api.finishCall(meeting.call_id)
      .then(() => { setError(null); loadMeeting(); setStage("post"); })
      .catch(() => setError(t("finishFailed")));
  };

  const end = () => {
    void Promise.resolve(finish()).then(() => {
      /* finish() RESOLVES even when it ended in phase "failed" (a dirty
         upload settle, finishCall refusal, nothing recorded) — walking to
         the post stage then would show a processing card spinning over a
         take the server never received. Stay, say so, keep the retry. */
      const after = recorderSnapshot();
      if (after.phase === "failed") {
        setError(t("finishFailed"));
        return;
      }
      setError(null);
      loadMeeting();
      setStage("post");
    });
  };

  /*
   * ONCE A RECORD EXISTS, THE EARLIER STAGES ARE HISTORY (user directive).
   * The plan and the stage are things you do BEFORE there is a record; with
   * one linked, walking back offers a recording that would start a second
   * take over a finished meeting, and a plan whose editing changes nothing
   * about what was already said. They stay VISIBLE — the stepper is the
   * shape of the meeting and hiding two thirds of it would be a different
   * screen — and stop being doors.
   */
  const stepTab = (s: Stage, n: number, label: string, done: boolean) => (
    <button
      key={s}
      type="button"
      aria-current={active === s ? "step" : undefined}
      /*
       * A SEALED step is inert, and says so QUIETLY (user directive,
       * 2026-09-02: "the mouse should not look like disabled when it goes to
       * before and in meeting — just not working").
       *
       * `cursor-not-allowed` is a refusal animation: it tells someone their
       * pointer is unwelcome, on a control that is simply finished. The
       * stepper is the SHAPE of the meeting — a past stage still says where
       * this one has been — so the right register is "this is behind you",
       * which the check mark and the muted tone already say.
       *
       * `aria-disabled` without `disabled` is deliberate and is the pair that
       * makes this work: a screen reader still hears that the step is not
       * actionable, the button stays in the tab order (so a keyboard user is
       * not silently skipped past a third of the stepper), and the press does
       * nothing because the handler returns.
       */
      aria-disabled={sealed && s !== "post" ? true : undefined}
      title={sealed && s !== "post" ? t("stageSealed") : undefined}
      onClick={() => { if (!(sealed && s !== "post")) setStage(s); }}
      /* THE THEME'S CONTROL, not a 36px lozenge with the 16px tile radius
         (audit finding, 2026-09-02: the stepper was "a third idiom" beside
         the list page's pills and this page's own tabs). `.btn-sm` inside
         the segmented frame; the ink stays the stepper's — a step is a
         place, not the accent's action colour. control.guard.test.ts reads
         only literal className strings, so this template never showed. */
      className={`btn btn-sm gap-1.5 font-medium ${
        active === s ? "bg-fg text-bg" : "text-fg-muted hover:text-fg"
      } ${sealed && s !== "post" ? "opacity-60 hover:text-fg-muted" : ""}`}
    >
      <span
        className={`grid min-h-[18px] min-w-[18px] place-items-center rounded-full text-[10px] ${
          active === s ? "bg-bg/20 text-bg" : done ? "bg-accent-soft text-accent" : "bg-surface-2 text-fg-subtle"
        }`}
        aria-hidden
      >
        {done ? <IconCheck width={12} height={12} /> : digits(n, locale)}
      </span>
      {label}
    </button>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {/* ── the page's OWN top bar: the stepper and the stage's action ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label={t("stages")} className={STEPPER_FRAME}>
          {stepTab("pre", 1, t("stage_pre"), timePast || held)}
          {stepTab("hold", 2, t("stage_hold"), held)}
          {stepTab("post", 3, t("stage_post"), held && typeof call === "object" && call?.status === "ready")}
        </nav>

        <div className="flex items-center gap-2">
          {recordingLive ? (
            <span className="badge-num flex items-center gap-1.5 rounded-xl bg-danger/10 px-3 py-1.5 text-xs font-bold text-danger" dir="ltr">
              <span className="h-2 w-2 animate-pulse rounded-full bg-danger" aria-hidden />
              {formatClock(Math.floor(engine.recordedMs / 1000), locale)}
            </span>
          ) : null}
          {/*
            IS THE OTHER SIDE STILL IN THE MIX?

            A share can end without the recording ending: the person presses
            the browser's own "stop sharing" bar, or closes the tab they
            picked, and the take carries on with a microphone in a room where
            nobody is speaking. The engine knows (`quality: "shareEnded"`) and
            nothing on this page said so — which is the worst shape a fault
            can take here, because the red light stays red and the clock keeps
            counting while half the meeting stops being recorded.

            The quiet half is on screen too, and deliberately: naming the mix
            is how somebody confirms they are recording what they think they
            are, in the seconds when they can still fix it — which is why the
            chip reads the TAKE (`engine.shared`) and not the meeting's mode.
            It said "tab + microphone" for every online take, and on
            2026-09-07 the lane stopped opening a tab: a chip that describes
            the lane rather than the take is a stale claim waiting for the
            next reversal.
          */}
          {recordingLive && meeting.mode === "online" ? (
            <span className={`rounded-xl px-2.5 py-1.5 text-[11px] font-medium ${
              engine.quality === "shareEnded" ? "bg-warning/10 text-warning" : "bg-surface-2 text-fg-muted"
            }`}>
              {engine.quality === "shareEnded" ? t("mixShareEnded")
                : engine.shared ? t("mixShared") : t("mixRoom")}
            </span>
          ) : null}
          {/* the share as an ADDITION, beside the mix it changes rather than
              in the action slot, which the end button owns while a take is
              live. It never restarts anything: what is already recorded stays
              recorded and the app's audio joins from here on. */}
          {shareOffered && recordingLive ? (
            <button type="button" onClick={addShare}
              className="btn btn-sm border border-border font-medium text-fg hover:bg-surface-2">
              {MODE_ICON.online}
              {t("addShare")}
            </button>
          ) : null}
          {/*
            EVERY START AND EVERY END IS THE HOST'S (user directive,
            2026-09-06). What a colleague gets instead is the SENTENCE, not a
            disabled button: a greyed «پایان و پردازش» is a promise the
            product will not keep, and pressing it explains nothing. The
            page moves them to the record on its own when the host finishes
            — see the poll above — so there is nothing here for them to do.

            This is the screen's half of a rule the DATABASE holds (0202's
            trigger on `call_id`). Neither is the wall on its own: without
            the trigger the button was merely hidden, and without this the
            product offered an act the server refuses.
          */}
          {/* `!held` used to gate this, which meant the sentence vanished the
              instant the host pressed start — the one moment it is most in
              force. It went with the colleague's ejection to the post stage
              (2026-09-07): while they stayed in the live stage there was
              nothing left in the slot to tell them whose the recording is. */}
          {!isHost && active === "hold" ? (
            <span className="rounded-xl bg-surface-2 px-2.5 py-1.5 text-[11px] font-medium text-fg-muted">
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
            <button type="button" onClick={end}
              className="btn bg-accent font-semibold text-on-accent shadow-accent hover:opacity-90">
              {t("endAndProcess")}
            </button>
          ) : isHost && engineFailed ? (
            <button type="button" onClick={end}
              className="btn bg-danger font-semibold text-on-accent hover:opacity-90">
              {t("retryFinish")}
            </button>
          ) : isHost && !held && meeting.mode === "upload" ? (
            /* the UPLOAD lane keeps its button, and it is a FILE PICKER —
               there is nothing to start by walking into a stage, and a
               button labelled «آپلود فایل» must never open a microphone.
               Every other mode starts by ARRIVING: «حین جلسه» is the start
               (user directive), so a second button promising to start what
               is already running would be the screen disagreeing with
               itself. */
            <button type="button" onClick={() => uploadInput.current?.click()}
              className="btn bg-accent font-semibold text-on-accent shadow-accent hover:opacity-90">
              {MODE_ICON.upload}
              {t("startUpload")}
            </button>
          ) : shareOffered && !held ? (
            /* THE OTHER MEETING (2026-09-07). Walking into the stage already
               records this room; this is for a meeting being held in software
               we do not host, where the only way to its audio is a shared
               surface. Still a button because it still raises the picker, and
               a picker needs the gesture — but it is now an explicit act for
               an explicit case rather than the door everybody walks through.
               Named for what it OPENS, not for what it starts: a button that
               says «start» and raises a share dialog is a surprise, and a
               surprised person cancels. */
            <button type="button" onClick={() => beginTake(true)}
              className="btn border border-border font-medium text-fg hover:bg-surface-2">
              {MODE_ICON.online}
              {t("startShared")}
            </button>
          ) : !held && active === "pre" ? (
            /* the way IN, named for what it does — the plan's own step
               forward, which is where the recording begins */
            <button type="button" onClick={() => setStage("hold")}
              className="btn bg-accent font-semibold text-on-accent shadow-accent hover:opacity-90">
              {MODE_ICON[meeting.mode]}
              {t("enterStage")}
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
      {uploading ? (
        <p className="card-row mx-auto px-4 py-1.5 text-xs font-medium text-fg">
          {t("uploading")}
        </p>
      ) : null}
      {error !== null ? (
        <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </p>
      ) : null}
      {/* what pressing the button will actually produce — a CONSEQUENCE, not
          an explanation (R21): the recording stopped when the page did, and
          finishing now processes what was captured up to that moment rather
          than the whole meeting. Saying it after the fact would be telling
          somebody about a choice they no longer have. */}
      {takeOrphaned && active === "hold" ? (
        <p className="well text-xs text-fg-muted">{t("takeInterrupted")}</p>
      ) : null}
      {/* the one thing the picker gets wrong, said BEFORE it opens: a share
          with the audio box unticked carries no sound, and the engine
          refuses the take for it (`shareNoAudio`). Telling somebody that
          after they have chosen is telling them to do it twice. */}
      {shareOffered ? (
        <p className="well text-xs text-fg-muted">
          {t("shareHint")}
        </p>
      ) : null}

      {active === "pre" ? (
        <PreStage
          meeting={meeting}
          onPatch={patch}
          onMeeting={setMeeting}
          onInviteFailed={() => setError(t("writeFailed"))}
          locale={locale}
        />
      ) : null}
      {active === "hold" ? (
        /* `me` is gone from here (2026-09-03): the live stage's only use of
           the signed-in person was labelling them the meeting's HOST, which is
           a fact about the record. A prop that nothing reads is the next
           person's invitation to reach for it again.

           NOTE the comment form. A braced JSX comment is a syntax error in a
           ternary's expression slot — it belongs in a CHILDREN slot — so this
           is a plain block comment. Two agents hit that within the hour, and
           so did I; then this comment broke a second time because spelling the
           braced form out loud put a comment terminator inside a comment. */
        <HoldStage
          meeting={meeting}
          locale={locale}
          isHost={isHost}
          onMeeting={setMeeting}
          recordingLive={recordingLive}
          liveText={engine.captions?.finals ?? ""}
        />
      ) : null}
      {active === "post" ? (
        <PostStage
          meeting={meeting}
          call={call}
          me={me}
          locale={locale}
          onGoHold={() => setStage("hold")}
          onChanged={(m) => setMeeting(m)}
          onBackToMeetings={() => router.push("/meetings")}
        />
      ) : null}
    </div>
  );
}

/* ═══ پیش از جلسه — the reference's plan cards ═══════════════════════════ */
function PreStage({ meeting, onPatch, onMeeting, onInviteFailed, locale }: {
  meeting: MeetingRecord;
  onPatch: (body: Record<string, unknown>) => void;
  /** the roster dialog writes through the api and hands back the SERVER's
      record — adopted, never merged with a local guess */
  onMeeting: (next: MeetingRecord) => void;
  onInviteFailed: () => void;
  locale: string;
}) {
  const t = useTranslations("meetings");
  const tCommon = useTranslations("common");
  const [editing, setEditing] = useState(false);
  /** the attachment awaiting the platform's are-you-sure (dialog at the foot) */
  const [condemnedFile, setCondemnedFile] = useState<{ id: string; name: string } | null>(null);
  const [removingFile, setRemovingFile] = useState(false);
  const hostName = personName(
    { display_name: meeting.host_name ?? "", display_name_en: meeting.host_name_en },
    locale,
  );
  /* the HOST is the meeting's author and has their own row above: a person
     who is both would be counted twice and listed twice */
  const roster = meeting.attendees.filter((a) => a.user_id !== meeting.created_by);
  /** minting the guest capability is a network act — the button says so */
  const [guestBusy, setGuestBusy] = useState(false);
  /** the meeting's documents — null while the read is in flight */
  const [files, setFiles] = useState<MeetingAttachment[] | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const loadFiles = useCallback(() => {
    void api.meetingAttachments(meeting.id).then(setFiles).catch(() => setFiles([]));
  }, [meeting.id]);
  useEffect(loadFiles, [loadFiles]);

  /** the invite window, and whether a guest link has been handed out */
  const [inviting, setInviting] = useState(false);
  const [guestCopied, setGuestCopied] = useState(false);

  /* ONE implementation, two callers (the panel's button and the invite
     window's) — two copies of "mint a capability and put it on the
     clipboard" is two places for the revocation note to go stale */
  const copyGuestLink = () => {
    if (guestBusy) return;
    setGuestBusy(true);
    void api.setMeetingJoinCode(meeting.id, true)
      .then(({ join_code }) => {
        if (join_code === null) return;
        void navigator.clipboard?.writeText(
          `${window.location.origin}/${locale}/join/${join_code}`,
        ).catch(() => undefined);
        setGuestCopied(true);
        notify(t("guestLinkCopied"));
      })
      .catch(() => notify(t("guestLinkFailed"), "warn"))
      .finally(() => setGuestBusy(false));
  };
  const totalMinutes = meeting.agenda.reduce((sum, item) => sum + (item.minutes ?? 0), 0);

  return (
    /* ONE column rhythm across the whole meeting — the plan and the stage
       share `MEETING_COLUMNS`, so the rail does not change width under the
       person as they walk from step 1 to step 2. The ratio is the reference
       product's own, measured on its pre page: 604.8 / 403.2 = 3:2. */
    <div className={`grid items-start gap-4 ${PLAN_COLUMNS}`}>
      <div className="space-y-4">
        {/* مشخصات جلسه */}
        <section className="tile p-4" aria-label={t("detailsTitle")}>
          <header className="mb-2 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
              <IconFileText width={14} height={14} className="text-fg-subtle" aria-hidden />
              {t("detailsTitle")}
            </h2>
            <button type="button" onClick={() => setEditing(true)}
              className="btn btn-sm border border-border font-medium text-fg hover:bg-border">
              {t("edit")}
            </button>
          </header>
          {/*
            A LABELLED TABLE, not a row with the label at one edge and the
            value at the other (user directive, 2026-09-02: "the headers and
            details close to each other, not far").
            `justify-between` pushed them apart by the full width of the card,
            so reading a field meant crossing empty space and hoping the thing
            on the far side belonged to the label you started from — which is
            the failure a wide row makes worse the wider the card gets.
            The reference pairs them: a narrow label column, the value
            immediately beside it, and a hairline between rows so the pairing
            is visible rather than inferred.
          */}
          <dl className="-mx-1 divide-y divide-border text-sm">
            <div className="flex items-baseline gap-3 px-1 py-2">
              <dt className="w-16 shrink-0 text-xs text-fg-subtle">{t("fieldTitle")}</dt>
              <dd className="min-w-0 font-medium text-fg">{meeting.title}</dd>
            </div>
            <div className="flex items-baseline gap-3 px-1 py-2">
              <dt className="w-16 shrink-0 text-xs text-fg-subtle">{t("fieldDate")}</dt>
              <dd className="min-w-0 text-fg">
                {formatDate(meeting.scheduled_at, locale)}
                {t("dateAtTime", { time: formatTime(meeting.scheduled_at, locale) })}
              </dd>
            </div>
            <div className="flex items-baseline gap-3 px-1 py-2">
              <dt className="w-16 shrink-0 text-xs text-fg-subtle">{t("fieldTopic")}</dt>
              <dd className="min-w-0 text-fg">{meeting.topic ?? t("noTopic")}</dd>
            </div>
            {meeting.description.trim() !== "" ? (
              <div className="pt-1">
                <dt className="text-fg-muted">{t("fieldDescription")}</dt>
                <dd className="mt-0.5 whitespace-pre-wrap leading-6 text-fg">{meeting.description}</dd>
              </div>
            ) : null}
          </dl>
        </section>

        {/* دستور جلسه */}
        <section className="tile p-4" aria-label={t("fieldAgenda")}>
          <header className="mb-2 flex items-baseline justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
              <IconRows width={14} height={14} className="text-fg-subtle" aria-hidden />
              {t("fieldAgenda")}
            </h2>
            <span className="text-[11px] text-fg-subtle">
              {t("agendaTotal", { n: digits(totalMinutes, locale) })}
            </span>
          </header>
          {meeting.agenda.length === 0 ? (
            <p className="mb-2 text-sm text-fg-muted">{t("agendaEmpty")}</p>
          ) : null}
          <AgendaEditor
            value={meeting.agenda}
            onChange={(agenda: MeetingAgendaItem[]) => onPatch({ agenda })}
          />
        </section>
      </div>

      <div className="space-y-4">
        {/* حالت برگزاری */}
        <section className="tile p-4" aria-label={t("fieldMode")}>
          <header className="mb-2 flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent-soft text-accent" aria-hidden>
              {MODE_ICON[meeting.mode]}
            </span>
            <h2 className="text-sm font-semibold text-fg">{t("fieldMode")} — {t(`mode_${meeting.mode}`)}</h2>
          </header>
          {/* THE EXPLANATION IS GONE (user directive, 2026-09-02: "remove the
              lines … and just put the link for guests here"). It described the
              mechanism — system audio, which tab to share, whose server the
              room runs on — to somebody who has already chosen the mode and
              wants the link. A card that explains itself before it does
              anything is a card read once and skipped forever. */}
          {meeting.mode === "online" ? (
            /*
             * THE LINK IS THIS PAGE. Under LiveKit the room is not an address
             * on somebody else's host — it is a name inside our project that
             * only a server-minted token opens, so what an invitee needs is
             * the meeting's own page, where the token is issued to them.
             * Handing out a room name would be handing out something nobody
             * can use.
             */
            <div className="mt-2.5 space-y-2">
              {/*
                TWO LINKS, because they are for two different people (user
                directive, 2026-09-02: "how should anyone from outside come to
                the online meeting").
                The page's own address is for COLLEAGUES — it needs an account
                in this organisation, and for them that is the right door
                because it carries the agenda and the record.
                The GUEST link needs no account at all. It is a capability
                minted on request, so a meeting is closed to outsiders until
                somebody decides otherwise, and pressing it again mints a new
                one — which revokes every link already handed out, the only
                thing "revoke" can honestly mean for something pasted into a
                chat.
              */}
              {/* ONE LINK (user directive, 2026-09-02: "remove the copy link,
                  just the guest is enough"). The page's own address only
                  worked for colleagues, who reach the meeting from the list
                  anyway — so of the two links, the one that was always
                  offered was the one nobody needed. */}
              <button
                type="button"
                disabled={guestBusy}
                onClick={copyGuestLink}
                className="btn w-full border border-border bg-surface font-medium text-fg hover:bg-border"
              >
                <IconCopy width={12} height={12} />
                {t("copyGuestLink")}
              </button>

            </div>
          ) : null}
        </section>

        {/*
          پیوست‌ها — the meeting's documents (0159). Deferred twice on purpose
          and built once its home existed: a dropzone is ten minutes, and
          giving files a home an organisation can be DELETED from is the work.
          The bytes go browser → Storage on a one-shot signed URL; this list
          is the record of them.
        */}
        <section className="tile p-4" aria-label={t("attachments")}>
          <header className="mb-2 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
              <IconFileText width={14} height={14} className="text-fg-subtle" aria-hidden />
              {t("attachments")}
            </h2>
          </header>
          {files === null ? (
            <SkeletonLines lines={2} />
          ) : files.length === 0 ? (
            <p className="py-2 text-xs text-fg-subtle">{t("attachmentsEmpty")}</p>
          ) : (
            <ul className="mb-2 space-y-1.5">
              {files.map((file) => (
                <li key={file.id} className="well flex items-center gap-2 px-2.5 text-sm">
                  <IconFileText width={14} height={14} className="shrink-0 text-fg-subtle" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-fg" title={file.name}>{file.name}</span>
                  <button
                    type="button"
                    aria-label={t("attachmentRemove", { name: file.name })}
                    /* the press ASKS; the write lives in the dialog at the
                       foot of this stage (the platform's destructive-action
                       rule — confirm.guard.test.ts) */
                    onClick={() => setCondemnedFile({ id: file.id, name: file.name })}
                    /* THE THEME'S ICON BUTTON (audit finding, 2026-09-02): a
                       bare glyph with `.tap` was a third shape for the same
                       control — the items panel's trash on this very page is
                       `btn btn-icon`, and an icon-only control is that class
                       everywhere else. `.btn` composes `.tap`, so nothing is
                       lost below md. */
                    className="btn btn-icon shrink-0 text-fg-subtle hover:text-danger"
                  >
                    <IconTrash width={12} height={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <input
            ref={fileInput}
            type="file"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file === undefined) return;
              setUploadingFile(true);
              void api.uploadMeetingAttachment(meeting.id, file)
                .then(loadFiles)
                .catch(() => notify(tCommon("actionFailed"), "warn"))
                .finally(() => setUploadingFile(false));
            }}
          />
          <button
            type="button"
            disabled={uploadingFile}
            onClick={() => fileInput.current?.click()}
            className="btn w-full justify-center border border-dashed border-border font-medium text-fg-muted hover:border-border-strong hover:text-fg"
          >
            <IconUpload width={12} height={12} />
            {uploadingFile ? t("attachmentUploading") : t("attachmentAdd")}
          </button>
        </section>

        {/* دعوت‌شدگان — the reference's own shape: the count beside the
            title, the people LISTED rather than only typeable, and the way to
            change them behind one control. A card that showed a text box and
            no list answered "who is coming" with an empty rectangle. */}
        <section className="tile p-4" aria-label={t("fieldInvitees")}>
          <header className="mb-2 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
              <IconUsers width={14} height={14} className="text-fg-subtle" aria-hidden />
              {t("fieldInvitees")}
            </h2>
            <span className="badge-num rounded-full bg-accent-soft px-2 text-[11px] text-accent">
              {digits(roster.length + meeting.invitees.length + 1, locale)}
            </span>
          </header>
          {/* EACH PERSON IN THEIR OWN BOX (user directive, 2026-09-02: "for
              invite make as same as the 3rd image, with name and the host —
              e.g. go to one box"). A bare list of names reads as text; a
              bordered row reads as a person who is in this meeting, which is
              what the reference's card is doing. */}
          <ul className="mb-2 space-y-1.5">
            <li className="well flex items-center gap-2 px-2.5 text-sm text-fg">
              {/* THE MEETING'S HOST, from the wire — not the signed-in viewer
                  (user report, 2026-09-02). `me` here meant a colleague
                  opening somebody else's meeting saw their OWN name in the
                  host row, which is a confident lie about who ran it. */}
              {/* 2026-09-03: the platform's avatar, not a fifth hand-drawn one.
                  The accent FILL is deliberately not carried over — a filled
                  accent circle reads as SELECTED rather than as a person, and
                  hostness is already said by the «میزبان» pill at the end of
                  this same row, in words, where a colour cannot be misread. */}
              <Avatar name={hostName} size="sm" />
              <span className="min-w-0 flex-1 truncate font-medium">
                {meeting.host_name === null ? t("unknownPerson") : hostName}
              </span>
              <span className="shrink-0 rounded-full border border-border bg-surface px-2 py-0.5 text-[10px] text-fg-subtle">
                {t("memberHost")}
              </span>
            </li>
            {/* THE COLLEAGUES, by their USER MANAGEMENT name (db/0202, user
                directive: "the user name and member name in user management
                should be used"). These are rows keyed by an account, so one
                person can appear only once however they were added — the
                screenshot that started this showed «drbagheri» and «دکتر
                باقری» as two people because a name was all the record had. */}
            {roster.map((a) => (
              <li key={a.user_id} className="well flex items-center gap-2 px-2.5 text-sm text-fg">
                <Avatar name={personName(a, locale)} size="sm" />
                <span className="min-w-0 flex-1 truncate">{personName(a, locale)}</span>
                {a.username !== null ? (
                  <span className="shrink-0 text-[10px] text-fg-subtle" dir="ltr">@{a.username}</span>
                ) : null}
              </li>
            ))}
            {/* and the people with NO account — all that is left of 0145's
                text array, and the reason it exists */}
            {meeting.invitees.map((name) => (
              <li key={name} className="well flex items-center gap-2 px-2.5 text-sm text-fg">
                {/* 2026-09-03: the platform's avatar, not a fifth hand-drawn one */}
                <Avatar name={name} size="sm" />
                <span className="min-w-0 flex-1 truncate">{name}</span>
                <span className="shrink-0 rounded-full border border-border bg-surface px-2 py-0.5 text-[10px] text-fg-subtle">
                  {t("guestMember")}
                </span>
              </li>
            ))}
          </ul>
          {/* ONE DOOR to adding people (user directive, 2026-09-02: "when you
              press on invite this window must pop up"). The inline field is
              gone: it could only take a typed name, so a person's own
              colleagues — the list the platform already has — were the one
              group it could not offer. */}
          {/* DASHED, like the reference's «مدیریت دعوت‌شدگان» — a dashed edge
              says "somewhere to add", which is a different promise from a
              solid button that performs something */}
          <button
            type="button"
            onClick={() => setInviting(true)}
            className="btn w-full justify-center border border-dashed border-border font-medium text-fg-muted hover:border-border-strong hover:text-fg"
          >
            <IconUsers width={12} height={12} />
            {t("inviteOpen")}
          </button>
        </section>
      </div>

      {editing ? (
        <EditMeetingDialog meeting={meeting} onPatch={onPatch} onClose={() => setEditing(false)} />
      ) : null}
      {inviting ? (
        <InviteDialog
          meeting={meeting}
          onMeeting={onMeeting}
          onFailed={onInviteFailed}
          onClose={() => setInviting(false)}
          guestLinkCopied={guestCopied}
          onCopyGuestLink={copyGuestLink}
        />
      ) : null}

      {/* THE PLATFORM'S ONE DESTRUCTIVE DIALOG for an attachment (audit
          finding, 2026-09-02). The trash press used to call the delete
          DIRECTLY — the exact shape confirm.guard.test.ts forbids — and the
          guard did not fire because the press was a multi-line arrow its
          pattern never matched. A document somebody attached has no undo;
          the dialog names the file so the person can see what they are
          about to lose. */}
      {condemnedFile !== null ? (
        <ConfirmDialog
          title={t("attachmentRemove", { name: condemnedFile.name })}
          body={t("attachmentRemoveBody")}
          confirmLabel={tCommon("delete")}
          cancelLabel={tCommon("cancel")}
          busy={removingFile}
          onCancel={() => setCondemnedFile(null)}
          onConfirm={() => {
            const file = condemnedFile;
            setRemovingFile(true);
            void api.deleteMeetingAttachment(meeting.id, file.id)
              .then(() => { setCondemnedFile(null); loadFiles(); })
              .catch(() => notify(tCommon("actionFailed"), "warn"))
              .finally(() => setRemovingFile(false));
          }}
        />
      ) : null}
    </div>
  );
}

/** the ویرایش dialog for the plan's basics */
function EditMeetingDialog({ meeting, onPatch, onClose }: {
  meeting: MeetingRecord;
  onPatch: (body: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const t = useTranslations("meetings");
  const [title, setTitle] = useState(meeting.title);
  /*
   * THE PLATFORM'S CLOCK ON THE WAY IN AS WELL AS OUT (2026-09-06, the
   * check-up). These fields were prefilled from `at.getHours()` — the
   * BROWSER's zone — and saved through `instantFromFields`, which reads them
   * in the STORED zone. On a machine outside that zone, opening this dialog
   * and pressing save with nothing changed moved the meeting by the offset:
   * a write the person never made, on the one field they did not touch. The
   * create dialog took `nowFields` on 2026-09-02; this is its sibling, found
   * four days later, because a laptop already in the stored zone cannot
   * show it. Same helper, same zone, so the round trip is the identity.
   */
  const [date, setDate] = useState(() => nowFields(new Date(meeting.scheduled_at)).date);
  const [time, setTime] = useState(() => nowFields(new Date(meeting.scheduled_at)).time);
  /*
   * THE TOPIC IS AN ID, and this dialog used to send the NAME.
   *
   * User report, 2026-09-04: editing a meeting answered «این تغییر ذخیره
   * نشد.» — every time, on every field. `topic` is a READ field: the wire
   * derives it by joining `meeting_topic` for the row's `topic_id`, and the
   * patch route knows only `topic_id`, so a body carrying `topic` hit the
   * `default:` branch and the whole PATCH was refused as `unknown_fields`.
   * One derived field in the body, and the title, the date and the time went
   * down with it.
   *
   * A free-text box could never have worked either: a topic is an org ENTITY
   * (a row people filter and count by, the folders on the meetings list), and
   * a name typed into a box cannot become one without quietly minting
   * duplicates. So it is the list, and what leaves here is the id.
   */
  const [topicId, setTopicId] = useState(meeting.topic_id ?? "");
  const [topics, setTopics] = useState<{ id: string; name: string }[]>([]);
  const [description, setDescription] = useState(meeting.description);

  useEffect(() => {
    void api.meetingTopics().then(setTopics).catch(() => setTopics([]));
  }, []);

  const save = () => {
    onPatch({
      title: title.trim(),
      /* the same zone the fields were written in — see nowFields */
      scheduled_at: instantFromFields(date, time).toISOString(),
      topic_id: topicId === "" ? null : topicId,
      description,
    });
    onClose();
  };

  /*
   * THE PLATFORM'S ONE DIALOG SHELL (audit finding, 2026-09-02). This was a
   * hand-rolled fixed overlay — a backdrop div with onClick, a div wearing
   * role="dialog" — which is the shape Overlay's own header lists as
   * lacking a focus trap, focus return, an inert background, scroll lock and
   * Escape. NewMeetingDialog and InviteDialog both wear Overlay; this one now
   * does too, and its fields are the theme's `.input` rather than five
   * hand-written 40px boxes.
   */
  return (
    <Overlay onClose={onClose} label={t("edit")} size="md">
      <h2 className="mb-3 text-base font-bold text-fg">{t("edit")}</h2>
      <div className={DIALOG_BODY}>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-fg-muted">{t("fieldTitle")}</span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <div className="grid grid-cols-2 gap-2">
          {/*
            THE PLATFORM'S FIELDS, not the browser's (user report, 2026-09-04:
            "the design of the hours dropdown is not the default of the
            platform theme").

            `<input type="date">` and `<input type="time">` hand the whole
            control to Chrome: its own blue list, its own AM/PM column, its own
            Gregorian month grid, in the browser's locale and reading
            direction, ignoring every token this product has. It is also the
            one place a Persian-first product would show a Latin calendar to
            somebody who has chosen the Jalali one. DateField and TimeField are
            what the new-meeting dialog next door already uses — the same two
            controls, the same theme, and the same 24-hour minutes.
          */}
          <div>
            <span className="mb-1 block text-xs font-medium text-fg-muted">{t("fieldDate")}</span>
            <DateField value={date} onChange={setDate} />
          </div>
          <div>
            <span className="mb-1 block text-xs font-medium text-fg-muted">{t("fieldTime")}</span>
            <TimeField value={time} onChange={setTime} />
          </div>
        </div>
        <div>
          <span className="mb-1 block text-xs font-medium text-fg-muted">{t("fieldTopic")}</span>
          <Select
            value={topicId}
            onChange={setTopicId}
            ariaLabel={t("fieldTopic")}
            options={[
              { value: "", label: t("noTopic") },
              ...topics.map((row) => ({ value: row.id, label: row.name })),
            ]}
          />
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-fg-muted">{t("fieldDescription")}</span>
          <textarea className="input min-h-[84px] py-2" value={description} rows={3}
            onChange={(e) => setDescription(e.target.value)} />
        </label>
      </div>
      <div className="mt-4 flex justify-end gap-2 border-t border-border pt-4">
        <button type="button" onClick={onClose} className="btn border border-border font-medium text-fg">
          {t("cancel")}
        </button>
        <button type="button" onClick={save} disabled={title.trim() === ""}
          className="btn bg-accent font-semibold text-on-accent disabled:opacity-50">
          {t("save")}
        </button>
      </div>
    </Overlay>
  );
}

/* ═══ برگزاری — the live room: engine in the background, whiteboard in
       front ═══════════════════════════════════════════════════════════════ */
function HoldStage({ meeting, locale, isHost, onMeeting, recordingLive, liveText }: {
  meeting: MeetingRecord;
  locale: string;
  /** db/0206: the stage — the board and what is presented — is the host's */
  isHost: boolean;
  onMeeting: (m: MeetingRecord) => void;
  recordingLive: boolean;
  /** what has been said so far, for live recall (item 7). Threaded from the
      page, which owns the engine — a stage that reached for the recorder
      itself would be a second opinion about whether a take is running. */
  liveText: string;
  /* `meId` is gone with the invite dialog it was threaded down for (0202,
     2026-09-06): people are added on the PLAN now, in the one act that also
     tells them. A prop that nothing reads is the next person's invitation
     to reach for it again. */
}) {
  const t = useTranslations("meetings");
  /* the HOST has their own row below — a person who is both would be listed
     twice and counted twice */
  const roster = meeting.attendees.filter((a) => a.user_id !== meeting.created_by);
  /* the host is a fact about the MEETING, read from the wire — never the
     signed-in viewer (see the members card below) */
  const hostName = meeting.host_name === null
    ? null
    : personName(
        { display_name: meeting.host_name, display_name_en: meeting.host_name_en },
        locale,
      );
  const [noteDraft, setNoteDraft] = useState("");
  const [taskDraft, setTaskDraft] = useState("");
  /* every outcome goes to the NOTIFICATION bus (platform rule): a banner
     that lives in this card is a second place to look, and it disappears
     before someone who glanced away can read it */
  const say = (msg: string) => notify(msg);

  const addNote = () => {
    const body = noteDraft.trim();
    if (body === "" || meeting.call_id === null) return;
    void api.addCallNote(meeting.call_id, { kind: "note", body })
      .then(() => { setNoteDraft(""); say(t("noteAdded")); })
      .catch(() => say(t("writeFailed")));
  };
  const addTask = () => {
    const title = taskDraft.trim();
    if (title === "") return;
    void api.taskBoard().then((board) => {
      const col = board.columns[0];
      if (col === undefined) throw new Error("no column");
      return api.createTask({
        title, column_id: col.id,
        ...(meeting.call_id !== null ? { call_id: meeting.call_id } : {}),
      });
    })
      .then(() => { setTaskDraft(""); say(t("taskAdded")); })
      .catch(() => say(t("writeFailed")));
  };

  return (
    <div className={`grid min-h-0 flex-1 gap-4 ${STAGE_COLUMNS}`}>
      {/* the stage — the reference puts the media on the START side */}
      <MeetingStage
        meeting={meeting}
        isHost={isHost}
        onMeeting={onMeeting}
        recordingLive={recordingLive}
        /* the FINALS only (item 7): an interim caption is rewritten as the
           recogniser hears more, so a window built from it changes under the
           throttle and asks the same question with different words */
        liveText={liveText}
      />

      {/* self-start: a grid item stretches by default, and `.tile` sets
          height:100%, so every rail card grew to the whiteboard's height and
          sat mostly empty. Left to its content the column hugs its cards,
          which is how the reference's rail reads. */}
      <div className="space-y-3 self-start">

        {/* اقدام‌های سریع */}
        <section className="tile p-3.5" aria-label={t("quickActions")}>
          <h3 className="mb-2 text-sm font-semibold text-fg">{t("quickActions")}</h3>
          {/* THE THEME'S FIELD AND BUTTON (audit finding, 2026-09-02): this
              row hand-rolled a 36px/12px-corner input and a 36px square, so
              the rail's composer matched nothing else on the page — the
              plan's dialog fields are `.input`, its actions `.btn`. `px-3`
              around the 14px glyph is what makes the `.btn` a square, with
              no size re-stated on top of it; `items-center` holds the 38 on
              the 40px field's midline. */}
          <div className="flex items-center gap-1.5">
            <input value={taskDraft} onChange={(e) => setTaskDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addTask(); }}
              placeholder={t("quickTaskPlaceholder")}
              className="input min-w-0 flex-1" />
            <button type="button" onClick={addTask} disabled={taskDraft.trim() === ""}
              aria-label={t("quickTaskAdd")}
              className="btn shrink-0 bg-accent px-3 text-on-accent">
              <IconPlus width={14} height={14} />
            </button>
          </div>
        </section>

        {/* اعضای جلسه */}
        <section className="tile p-3.5" aria-label={t("membersTitle")}>
          <header className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-fg">{t("membersTitle")}</h3>
            {/*
              NO ADD DOOR HERE, and the button that stood in this slot is
              gone with the model under it (db/0202, 2026-09-06).

              «دعوت اعضا» minted invitations while the دعوت‌شدگان card on the
              PLAN wrote names — two buttons for one act, which is how
              somebody came to be on a meeting nobody told them about, and
              how one person came to be listed twice under two spellings.
              Adding a colleague now IS inviting them, in one request, on
              the plan where the meeting is arranged.

              What this card does instead is the thing only it can: it says
              who was actually IN THE ROOM. That is a fact about a meeting
              that has happened, and it is what the transcript's roster
              reads.
            */}
            <span className="badge-num rounded-full bg-surface-2 px-2 text-[11px] text-fg-subtle">
              {digits(roster.length + meeting.invitees.length + (hostName === null ? 0 : 1), locale)}
            </span>
          </header>
          <ul className="space-y-1.5">
            {hostName !== null ? (
              <li className="flex items-center gap-2 text-sm text-fg">
                {/*
                 * THE HOST COMES FROM THE WIRE (2026-09-03). This row rendered
                 * `me` — the signed-in VIEWER — under the «میزبان» badge, so
                 * everyone who opened a colleague's meeting was shown as its
                 * host, and the count added one for whoever was looking. The
                 * badge is a claim about a ROLE, and a role is a fact about the
                 * record, never about who is reading it.
                 *
                 * PreStage twenty lines up already resolved `meeting.host_name`
                 * correctly, and Minutes.tsx carries a comment saying the name
                 * comes from the wire "not from the signed-in" viewer. Two
                 * siblings had the rule and this one had the bug — fixing one
                 * instance does not fix its siblings.
                 *
                 * The avatar is the platform's, and at the list-row size: this
                 * card and the دعوت‌شدگان card above it list the same people and
                 * drew them at 24 and 28, which is "one is small, one is big" on
                 * a single screen.
                 */}
                <Avatar name={hostName} size="sm" />
                {hostName}
                <span className="ms-auto rounded-md bg-surface-2 px-1.5 py-0.5 text-[10px] text-fg-subtle">{t("memberHost")}</span>
              </li>
            ) : null}
            {roster.map((a) => (
              <li key={a.user_id} className="flex items-center gap-2 text-sm text-fg">
                {/* 2026-09-03: the platform's avatar, not a fifth hand-drawn one */}
                <Avatar name={personName(a, locale)} size="sm" />
                <span className="min-w-0 flex-1 truncate">{personName(a, locale)}</span>
                {/* WHO WAS ACTUALLY HERE (db/0202's `attended_at`). Said only
                    in the affirmative: a mark reading «نیامد» on somebody who
                    joined from a phone the platform never saw would be a
                    confident lie, where a missing mark is only silence. */}
                {a.attended ? (
                  <span className="shrink-0 rounded-md bg-accent-soft px-1.5 py-0.5 text-[10px] text-accent">
                    {t("attendedMark")}
                  </span>
                ) : null}
              </li>
            ))}
            {meeting.invitees.map((name) => (
              <li key={name} className="flex items-center gap-2 text-sm text-fg">
                {/* 2026-09-03: the platform's avatar, not a fifth hand-drawn one */}
                <Avatar name={name} size="sm" />
                <span className="min-w-0 flex-1 truncate">{name}</span>
                <span className="shrink-0 rounded-md bg-surface-2 px-1.5 py-0.5 text-[10px] text-fg-subtle">
                  {t("guestMember")}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* دستور جلسه */}
        <section className="tile p-3.5" aria-label={t("fieldAgenda")}>
          <h3 className="mb-2 text-sm font-semibold text-fg">{t("fieldAgenda")}</h3>
          {meeting.agenda.length === 0 ? (
            <p className="text-xs text-fg-muted">{t("agendaEmpty")}</p>
          ) : (
            <ol className="space-y-1">
              {meeting.agenda.map((item, i) => (
                <li key={i} className="flex items-baseline gap-2 text-sm text-fg">
                  <span className="badge-num text-[11px] text-fg-subtle">{digits(i + 1, locale)}.</span>
                  <span className="min-w-0 flex-1">{item.title}</span>
                  {item.minutes !== null ? (
                    <span className="badge-num shrink-0 text-[11px] text-fg-subtle">
                      {t("agendaMinutes", { n: digits(item.minutes, locale) })}
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* یادداشت‌های من */}
        <section className="tile p-3.5" aria-label={t("tabNotes")}>
          <h3 className="mb-2 text-sm font-semibold text-fg">{t("tabNotes")}</h3>
          {meeting.call_id === null && !recordingLive ? (
            <p className="text-xs text-fg-muted">{t("notesNeedRecording")}</p>
          ) : (
            /* the same composer as the quick task above — `.input` and a
               `.btn` square (audit finding, 2026-09-02) */
            <div className="flex items-center gap-1.5">
              <input value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") addNote(); }}
                placeholder={t("quickNotePlaceholder")}
                disabled={meeting.call_id === null}
                className="input min-w-0 flex-1 disabled:opacity-60" />
              <button type="button" onClick={addNote} disabled={noteDraft.trim() === "" || meeting.call_id === null}
                aria-label={t("addNote")}
                className="btn shrink-0 bg-accent px-3 text-on-accent">
                <IconPlus width={14} height={14} />
              </button>
            </div>
          )}
        </section>
      </div>

    </div>
  );
}

/* ═══ پس از جلسه — the tab set over the real artifacts ═══════════════════ */
function PostStage({ meeting, call, me, locale, onGoHold, onChanged, onBackToMeetings }: {
  meeting: MeetingRecord;
  call: Call | null | "gone";
  me: Me | null;
  locale: string;
  onGoHold: () => void;
  onChanged: (m: MeetingRecord) => void;
  onBackToMeetings: () => void;
}) {
  const t = useTranslations("meetings");
  const [tab, setTab] = useState<PostTab>("review");
  /* a fresh object per click — a raw number hits React's Object.is bailout
     and the second click on the same timestamp would do nothing */
  const [seekReq, setSeekReq] = useState<{ ms: number } | null>(null);

  if (meeting.call_id === null) {
    return (
      <div className="tile grid place-items-center p-10 text-center">
        <IconMic width={24} height={24} />
        <p className="mt-2 text-sm text-fg-muted">{t("noRecordYet")}</p>
        {/* the way BACK to the stage — walking in is what starts a take, so
            this hands over to the stage rather than starting anything here */}
        <button type="button" onClick={onGoHold}
          className="btn mt-3 bg-accent font-semibold text-on-accent">
          {MODE_ICON[meeting.mode]}
          {meeting.mode === "upload" ? t("startUpload") : t("enterStage")}
        </button>
      </div>
    );
  }

  const ready = typeof call === "object" && call !== null && call.status === "ready";
  const tabs: Array<{ key: PostTab; label: string }> = [
    { key: "review", label: t("tabReview") },
    { key: "tasks", label: t("tabTasks") },
    { key: "files", label: t("tabFiles") },
    { key: "assistant", label: t("tabAssistant") },
    { key: "notes", label: t("tabNotes") },
    { key: "minutes", label: t("tabMinutes") },
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
        />
      ) : null}

      {/* THE TOOLBAR SHAPE, not an underlined tab strip (audit finding,
          2026-09-02): every other surface switches sections with `btn btn-sm`
          pills, and this row was the one place still drawing a hairline with
          a 2px underline under the active word */}
      <div role="tablist" aria-label={t("stage_post")} className="flex flex-wrap items-center gap-1">
        {tabs.map((entry) => (
          <button
            key={entry.key}
            type="button"
            role="tab"
            aria-selected={tab === entry.key}
            onClick={() => setTab(entry.key)}
            className={`btn btn-sm font-medium ${
              tab === entry.key ? "bg-accent text-on-accent" : "text-fg-muted hover:bg-surface-2 hover:text-fg"
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

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
      {tab === "files" ? <FilesTab call={call} locale={locale} /> : null}
      {tab === "assistant" ? (
        <MeetingAssistant callId={meeting.call_id} title={meeting.title} />
      ) : null}
      {tab === "notes" ? <NotesTab callId={meeting.call_id} locale={locale} /> : null}
      {tab === "minutes" ? (
        <MinutesTab meeting={meeting} callId={meeting.call_id}
          myName={me !== null ? personName(me, locale) : ""}
          myId={me !== null ? me.id : null} onChanged={onChanged} />
      ) : null}
    </div>
  );
}

/* ── فایل‌ها: the recording's parts — the meeting's real files ────────── */
function FilesTab({ call, locale }: { call: Call | null | "gone"; locale: string }) {
  const t = useTranslations("meetings");
  /* THE LIST'S FRAME BEFORE ITS ROWS (audit finding, 2026-09-02): «…»
     stood here until the call was read. Two rows in the real row's shape —
     the icon square, a name line, a duration line — so the tab has the same
     silhouette loading as loaded. */
  if (call === null) {
    return (
      <ul className="mx-auto w-full max-w-2xl space-y-2" aria-busy="true">
        {[0, 1].map((i) => (
          <li key={i} className="tile tile-row flex items-center gap-3 p-3">
            <Skeleton className="h-9 w-9 shrink-0" />
            <span className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-1/5" />
            </span>
          </li>
        ))}
      </ul>
    );
  }
  if (call === "gone") return <p className="p-4 text-sm text-fg-muted">{t("recordGone")}</p>;
  const parts = call.parts ?? [];
  if (parts.length === 0) return <p className="p-4 text-sm text-fg-muted">{t("noFiles")}</p>;
  return (
    <ul className="mx-auto w-full max-w-2xl space-y-2">
      {[...parts].sort((a, b) => a.idx - b.idx).map((part) => (
        <li key={part.id} className="tile tile-row flex items-center gap-3 p-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent" aria-hidden>
            <IconMic width={14} height={14} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm text-fg">{t("filePart", { n: digits(part.idx + 1, locale) })}</span>
            <span className="block text-[11px] text-fg-muted">
              {part.missing
                ? t("fileMissing")
                : part.duration_ms !== null
                  ? formatDuration(Math.round(part.duration_ms / 1000), locale)
                  : t("fileDurationUnknown")}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ── یادداشت‌های من: call notes as the reference's cards ──────────────── */
function NotesTab({ callId, locale }: { callId: string; locale: string }) {
  const t = useTranslations("meetings");
  const [notes, setNotes] = useState<CallNote[] | null | "failed">(null);
  const [draft, setDraft] = useState("");
  const [writeError, setWriteError] = useState(false);
  const [condemned, setCondemned] = useState<CallNote | null>(null);

  const load = useCallback(() => {
    void api.callNotes(callId).then(setNotes).catch(() => setNotes("failed"));
  }, [callId]);
  useEffect(load, [load]);

  const add = () => {
    const body = draft.trim();
    if (body === "") return;
    setWriteError(false);
    void api.addCallNote(callId, { kind: "note", body })
      .then(() => { setDraft(""); load(); })
      .catch(() => setWriteError(true));
  };

  if (notes === "failed") return <p className="p-4 text-sm text-fg-muted">{t("readFailed")}</p>;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-3">
      {writeError ? <p role="alert" className="text-xs text-danger">{t("writeFailed")}</p> : null}
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
                <span className="mt-1 block text-[11px] text-fg-subtle">
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
