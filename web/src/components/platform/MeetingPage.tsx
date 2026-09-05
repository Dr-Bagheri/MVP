"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";
import { api } from "@/api/client";
import { Skeleton, SkeletonLines } from "@/components/scaffold";
import { notify } from "@/lib/notify";
import type { Call, CallNote, Me, MeetingAgendaItem, MeetingRecord, MeetingAttachment } from "@/api/types";
import { useCrumbTitle } from "@/components/platform/CrumbTitle";
import { ConfirmDialog } from "@/components/rowActions";
import { Overlay } from "@/components/platform/Overlay";
import { DIALOG_BODY } from "@/components/platform/tasks/panelStyle";
import { InvitePeople } from "@/components/platform/InvitePeople";
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
  IconUsers, IconUpload, IconMailPlus } from "@/components/icons";
import {
  finish, recorderSnapshot, startRecording, subscribeRecorder,
} from "@/lib/recordingEngine";
import { uploadAudioFile } from "@/lib/uploadFile";
import { Avatar } from "@/components/Avatar";
import { digits, formatClock, formatDate, formatDuration, formatTime, personName, instantFromFields } from "@/lib/format";

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
           stage they had not asked for */
        setStage((cur) => cur ?? (m.call_id !== null ? "post" : "pre"));
      })
      .catch((e: unknown) => {
        const status = (e as { status?: number }).status;
        setMeeting(status === 404 ? "missing" : "failed");
      });
  }, [id]);
  useEffect(loadMeeting, [loadMeeting]);
  useEffect(() => { void api.me().then(setMe).catch(() => setMe(null)); }, []);

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
  const beginTake = useCallback(() => {
    if (typeof meeting !== "object" || meeting === null) return;
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
       * THE SHARED TAB, AGAIN — and this is a REVERSAL, recorded as one.
       *
       * 2026-09-02 moved the online lane onto our own room's tracks: no
       * picker, no banner, and whoever was actually in the meeting. Today
       * (user directive): "for the online meetings go with face screen share
       * to get the audio from web for now as well" — the meetings people
       * actually hold are in software we do not host, and a room recording
       * can only ever carry the people who came to OURS.
       *
       * Note "for now". The room branch is not deleted and neither is the
       * tap that feeds it (`Room.tsx`'s AudioTap, `lib/roomAudio.ts`): the
       * switch is one word in this call, so coming back is one word too.
       * Deleting a working path to take a reversal is how the reversal
       * becomes permanent by accident.
       */
      source: meeting.mode === "online" ? "system" : "mic",
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
  }, [meeting, locale, t]);

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
    /*
     * … EXCEPT WHERE STARTING NEEDS A HAND ON THE MOUSE.
     *
     * An online take opens the share picker, and a browser only opens one
     * for a gesture. Walking into the stage is a click, but the picker is
     * reached AFTER the microphone resolves — by then the activation is
     * spent — and a reload straight into a live stage has no gesture at
     * all. The refusal that follows is `NotAllowedError`, which is also
     * what a cancelled picker raises: the person would be told they
     * cancelled a dialog they were never shown.
     *
     * So this lane gets a button, and the button is the gesture. The
     * in-person lane keeps walking in — a microphone needs no picker.
     */
    if (meeting.mode === "online") return;
    /* the upload lane and an already-held meeting are refused by
       `beginTake` itself, at the altitude where a microphone would actually
       be opened. A second copy here read as extra rigour and made the test
       for it vacuous — deleting the effect's guard left the suite green,
       which is how it was found. */
    if (meeting.call_id !== null) return;
    autoStarted.current = true;
    beginTake();
  }, [stage, meeting, beginTake]);

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
  /** a linked record seals the meeting's earlier stages — see stepTab */
  const sealed = held;
  const timePast = new Date(meeting.scheduled_at).getTime() <= Date.now();
  /* live when WE started it this mount, OR when the engine's take IS this
     meeting's linked call — a reload mid-recording must not hide the timer
     and the end button of a take that plainly belongs here */
  const engineOwnsThisMeeting = engine.callId !== null && meeting.call_id === engine.callId;
  const recordingLive = (startedHere.current || engineOwnsThisMeeting)
    && (engine.phase === "recording" || engine.phase === "paused");
  const engineFailed = (startedHere.current || engineOwnsThisMeeting) && engine.phase === "failed";

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

            The quiet half is on screen too, and deliberately: "tab + mic" is
            how somebody confirms they picked the right thing, in the seconds
            when they can still fix it.
          */}
          {recordingLive && meeting.mode === "online" ? (
            <span className={`rounded-xl px-2.5 py-1.5 text-[11px] font-medium ${
              engine.quality === "shareEnded" ? "bg-warning/10 text-warning" : "bg-surface-2 text-fg-muted"
            }`}>
              {engine.quality === "shareEnded" ? t("mixShareEnded") : t("mixShared")}
            </span>
          ) : null}
          {recordingLive ? (
            <button type="button" onClick={end}
              className="btn bg-accent font-semibold text-on-accent shadow-accent hover:opacity-90">
              {t("endAndProcess")}
            </button>
          ) : engineFailed ? (
            <button type="button" onClick={end}
              className="btn bg-danger font-semibold text-on-accent hover:opacity-90">
              {t("retryFinish")}
            </button>
          ) : !held && meeting.mode === "upload" ? (
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
          ) : !held && active === "hold" && meeting.mode === "online" ? (
            /* THE GESTURE (see the auto-start effect). Named for what it
               opens, not just for what it starts: a button that says
               «shuru» and then raises a share dialog is a surprise, and a
               surprised person cancels. */
            <button type="button" onClick={beginTake}
              className="btn bg-accent font-semibold text-on-accent shadow-accent hover:opacity-90">
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
      {/* the one thing the picker gets wrong, said BEFORE it opens: a share
          with the audio box unticked carries no sound, and the engine
          refuses the take for it (`shareNoAudio`). Telling somebody that
          after they have chosen is telling them to do it twice. */}
      {!held && !recordingLive && active === "hold" && meeting.mode === "online" ? (
        <p className="well text-xs text-fg-muted">
          {t("shareHint")}
        </p>
      ) : null}

      {active === "pre" ? (
        <PreStage meeting={meeting} onPatch={patch} locale={locale} />
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
          recordingLive={recordingLive}
          meId={me?.id ?? null}
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
function PreStage({ meeting, onPatch, locale }: {
  meeting: MeetingRecord;
  onPatch: (body: Record<string, unknown>) => void;
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
              {digits(meeting.invitees.length + 1, locale)}
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
            {meeting.invitees.map((name) => (
              <li key={name} className="well flex items-center gap-2 px-2.5 text-sm text-fg">
                {/* 2026-09-03: the platform's avatar, not a fifth hand-drawn one */}
                <Avatar name={name} size="sm" />
                <span className="min-w-0 flex-1 truncate">{name}</span>
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
          invitees={meeting.invitees}
          onChange={(invitees) => onPatch({ invitees })}
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
  const at = new Date(meeting.scheduled_at);
  const [title, setTitle] = useState(meeting.title);
  const [date, setDate] = useState(
    `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`,
  );
  const [time, setTime] = useState(
    `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`,
  );
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
function HoldStage({ meeting, locale, recordingLive, meId }: {
  meeting: MeetingRecord;
  locale: string;
  recordingLive: boolean;
  /* the READER, threaded down for the invite dialog alone. It was `null`
     there, and the server skips the actor when it writes invitations, so
     picking yourself off the list was a control that reads as working and
     does nothing — the count comes back one lower than the picks and
     nothing on screen says why. */
  meId: string | null;
}) {
  const t = useTranslations("meetings");
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
  const [invitingPeople, setInvitingPeople] = useState(false);
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
      {invitingPeople ? (
        <InvitePeople
          kind="meeting"
          targetId={meeting.id}
          meId={meId}
          onClose={() => setInvitingPeople(false)}
          onFailed={() => setInvitingPeople(false)}
        />
      ) : null}
      {/* the stage — the reference puts the media on the START side */}
      <MeetingStage
        meeting={meeting}
        recordingLive={recordingLive}
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
            <div className="flex items-center gap-1.5">
              {/* NOTIFY COLLEAGUES (0189, user directive: "do the same
                  notification if they are invited for an online meeting as
                  well"). Not admin-walled, unlike a room: arranging a meeting
                  is not an administrative act, and the person booking it is
                  the one who knows who should be in it — 0189's insert policy
                  says exactly that, so this button and the wall agree. */}
              <button type="button" onClick={() => setInvitingPeople(true)}
                className="btn btn-sm gap-1.5 border border-border text-fg-muted hover:text-fg">
                <IconMailPlus width={12} height={12} />
                {t("notifyMembers")}
              </button>
              <span className="badge-num rounded-full bg-surface-2 px-2 text-[11px] text-fg-subtle">
                {digits(meeting.invitees.length + (hostName === null ? 0 : 1), locale)}
              </span>
            </div>
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
            {meeting.invitees.map((name) => (
              <li key={name} className="flex items-center gap-2 text-sm text-fg">
                {/* 2026-09-03: the platform's avatar, not a fifth hand-drawn one */}
                <Avatar name={name} size="sm" />
                {name}
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
                  <TranscriptPanel callId={meeting.call_id} onSeek={(ms) => setSeekReq({ ms })} locale={locale} />
                )}
          </div>
          <ItemsPanel meetingId={meeting.id} callId={meeting.call_id} onSeek={(ms) => setSeekReq({ ms })} locale={locale} />
        </div>
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
