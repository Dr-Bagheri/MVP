"use client";

/**
 * The recording ENGINE — module-level, like voice.ts (user directive,
 * 2026-08-22: "floating mini recorder", recording continues across pages).
 *
 * Everything that must SURVIVE navigation lives here: the stream, the
 * MediaRecorder(s), the uploader, the crash buffer, the clock, the caption
 * lane, the meter. React components — the Recorder screen and the floating
 * pill — are VIEWS over this one state, bound via subscribe/getSnapshot.
 *
 * This SUPERSEDES the 2026-08-20 leave-pauses-the-take model: in-app
 * navigation no longer touches a rolling take at all (the floating pill is
 * how it stays visible and controllable). What remains:
 *  - tab hidden → pause (the mic must not roll while nobody is looking);
 *  - tab close / hard reload → the browser's leave prompt (the crash
 *    buffer bounds the loss to ~a second plus a recovery step, but "you
 *    are still recording" is worth one confirmation).
 *
 * Errors surface as CODES (the capture.* message keys) — the engine speaks
 * no language; the views translate.
 *
 * M33: the agent's pause/resume/finish controls are published by the
 * ENGINE on every phase change now, so the assistant can drive a take from
 * any page — previously the controls existed only while the recorder
 * screen was mounted.
 */

import { api } from "@/api/client";
import { appendCaptionRow, type CaptionRow } from "@/lib/captionRows";
import { announceRecordingLive } from "@/lib/assistantBus";
import { nextMeetingTitle } from "@/lib/meetingTitle";
import { PartUploader, type UploaderProgress } from "@/lib/callUpload";
import { bufferChunk, clearPart, clearTake, markPart } from "@/lib/takeBuffer";
import { SAFETY_PART_BYTES } from "@/components/echo/uploadRules";
import { recorderControls } from "@/components/echo/recorderControls";

export type RecorderPhase =
  | "idle" | "starting" | "recording" | "paused" | "finishing" | "done" | "failed";

export type RecorderErrorCode =
  | "micDenied" | "shareDenied" | "shareNoAudio" | "createFailed"
  | "finishFailed" | "nothingRecorded";

export interface RecorderSnapshot {
  phase: RecorderPhase;
  callId: string | null;
  /** The take's resolved title — the pill and the crash buffer name it. */
  title: string;
  recordedMs: number;
  level: number;
  wave: number[];
  /** Where this session's waveform starts (resume offset) — marker math. */
  waveStartMs: number;
  chapterMarks: number[];
  quality: null | "quiet" | "clipping" | "shareEnded" | "micLost";
  progress: UploaderProgress;
  error: RecorderErrorCode | null;
  captions: { finals: string; interim: string } | null;
  /** the finals broken into stamped rows — the transcript's lines */
  captionRows: CaptionRow[];
  /**
   * DISTINCT speaker labels the live lane has attached so far, in the
   * order they first spoke (M38 + 2026-08-26 diarization). Empty means
   * the lane attached none — a UI must read it as "nothing to say about
   * speakers", never as zero people in the room.
   */
  liveSpeakers: string[];
  captionsDown: boolean;
  previews: { idx: number; url: string }[];
}

export interface StartOptions {
  micId: string;
  language: "fa" | "en" | "mixed";
  source: "mic" | "system";
  title: string;
  locale: string;
  resume: { callId: string; title: string | null; nextIdx: number; offsetMs: number } | null;
  /** 0094: the summary template chosen on the form — a ruled key, or a
      custom template's name + prompt; the pipeline's summarize applies it */
  summaryTemplate?: string | undefined;
  summaryInstruction?: string | undefined;
  /** 0099: the model for this meeting's summaries — "" / undefined = the
      worker's own ladder (owner pref → org first choice → operator) */
  summaryModel?: string | undefined;
  /**
   * LOUDNESS ENHANCE (user directive, 2026-08-25): a quiet room, a far
   * microphone. The mic is routed through a gain stage before it reaches
   * the recorder — off by default, because amplifying a healthy signal
   * only amplifies its noise floor with it.
   */
  boost?: boolean | undefined;
}

/** the enhance stage's gain — ~+7dB, enough for a far mic, short of clipping */
export const BOOST_GAIN = 2.2;

// ---- module state -----------------------------------------------------------

let snapshot: RecorderSnapshot = {
  phase: "idle", callId: null, title: "", recordedMs: 0, level: 0,
  wave: [], waveStartMs: 0, chapterMarks: [], quality: null,
  progress: { done: 0, pending: 0, failed: 0 }, error: null,
  captions: null, captionRows: [], liveSpeakers: [], captionsDown: false, previews: [],
};

const listeners = new Set<() => void>();

function patch(part: Partial<RecorderSnapshot>): void {
  snapshot = { ...snapshot, ...part };
  for (const listener of [...listeners]) listener();
}

export function subscribeRecorder(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function recorderSnapshot(): RecorderSnapshot {
  return snapshot;
}

// non-view internals
let stream: MediaStream | null = null;
let recorder: MediaRecorder | null = null;
let uploader: PartUploader | null = null;
let audioCtx: AudioContext | null = null;
let meterRaf = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let lastTick = 0;
let recordedMs = 0;
let partStartMs = 0;
let partIdx = 0;
let mimeType = "audio/webm";
let rawTracks: MediaStreamTrack[] = [];
let waveSamples: number[] = [];
let lastWaveAt = 0;
let quietSince: number | null = null;
let clipUntil = 0;
let shareEnded = false;
let flushDone: (() => void) | null = null;
let partsEnqueued = 0;
let priorParts = false;
/** a discard in progress: the final onstop must NOT enqueue its blob */
let discarding = false;
/** the mic vanished mid-take (unplugged headset): paused until reacquired */
let micLost = false;
/** the system-audio mixing node — where a replacement mic must connect */
let mixDest: MediaStreamAudioDestinationNode | null = null;
// caption lane
let liveId: string | null = null;
let liveRec: MediaRecorder | null = null;
let liveEs: EventSource | null = null;
let liveFinals = "";
let liveRows: CaptionRow[] = [];
let liveSpeakers: string[] = [];

// ---- phase + the things that ride on it ------------------------------------

function setPhase(phase: RecorderPhase): void {
  const wasLive = snapshot.phase === "recording" || snapshot.phase === "paused";
  patch({ phase });
  const isLive = phase === "recording" || phase === "paused";

  // M33: the agent's controls exist exactly while a take is live
  if (isLive) {
    recorderControls.current = {
      phase: () => (snapshot.phase === "recording" ? "recording"
        : snapshot.phase === "paused" ? "paused" : "other"),
      pause,
      resume,
      finish,
    };
  } else if (wasLive) {
    recorderControls.current = null;
  }
  // the assistant's ears follow the take (user rule, 2026-08-21)
  announceRecordingLive(phase === "recording");

  if (phase === "recording") attachPageListeners();
  else detachPageListeners();
}

function onVisibility(): void {
  if (document.hidden && snapshot.phase === "recording") pause();
}
function onBeforeUnload(e: BeforeUnloadEvent): void {
  if (snapshot.phase === "recording") pause();
  e.preventDefault();
  e.returnValue = "";
}
let pageListeners = false;
function attachPageListeners(): void {
  if (pageListeners) return;
  pageListeners = true;
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("beforeunload", onBeforeUnload);
}
function detachPageListeners(): void {
  if (!pageListeners) return;
  pageListeners = false;
  document.removeEventListener("visibilitychange", onVisibility);
  window.removeEventListener("beforeunload", onBeforeUnload);
}

// ---- caption lane (M38) -----------------------------------------------------

async function startLiveCaptions(mime: string): Promise<void> {
  try {
    const { session_id } = await api.liveSttStart();
    liveId = session_id;
  } catch {
    // the lane is optional; its ABSENCE is said out loud (M21), once
    patch({ captionsDown: true });
    return;
  }
  liveFinals = "";
  liveRows = [];
  liveSpeakers = [];
  patch({
    captions: { finals: "", interim: "" },
    captionRows: [],
    liveSpeakers: [],
    captionsDown: false,
  });
  const rec = new MediaRecorder(stream!, { mimeType: mime });
  rec.ondataavailable = (event) => {
    if (event.data.size > 0 && liveId) {
      void api.liveSttAudio(liveId, event.data).catch(() => undefined);
    }
  };
  rec.start(1000);
  liveRec = rec;
  const es = new EventSource(`/api/live-stt/${encodeURIComponent(liveId)}/events`);
  es.onmessage = (event) => {
    try {
      const body = JSON.parse(event.data as string) as {
        type: string;
        tokens?: { text: string; is_final: boolean; speaker?: string }[];
      };
      if (body.type === "closed" || body.type === "error") {
        es.close();
        if (body.type === "error") patch({ captionsDown: true });
        return;
      }
      if (body.type === "tokens" && body.tokens) {
        const interim = body.tokens.filter((t) => !t.is_final).map((t) => t.text).join("");
        /*
         * Finals are folded ONE TOKEN AT A TIME, not joined first: a frame
         * can carry two people's words, and joining before the row rule
         * sees them would glue a handover into a single stamped line
         * attributed to whoever spoke last.
         */
        for (const token of body.tokens) {
          if (!token.is_final) continue;
          liveFinals += token.text;
          // stamped with the take's clock as the fragment ARRIVES — the
          // lane itself carries no timestamps (see lib/captionRows)
          liveRows = appendCaptionRow(liveRows, token.text, recordedMs, token.speaker);
          if (token.speaker !== undefined && !liveSpeakers.includes(token.speaker)) {
            liveSpeakers = [...liveSpeakers, token.speaker];
          }
        }
        patch({
          captions: { finals: liveFinals, interim },
          captionRows: liveRows,
          liveSpeakers,
        });
      }
    } catch { /* not a caption frame */ }
  };
  liveEs = es;
}

function stopLiveCaptions(): void {
  if (liveRec && liveRec.state !== "inactive") liveRec.stop();
  liveRec = null;
  if (liveId) void api.liveSttStop(liveId).catch(() => undefined);
  liveId = null;
  // leave the EventSource open briefly — the provider flushes finals on
  // stop; the relay's `closed` event (or its idle reaper) ends it
  const es = liveEs;
  liveEs = null;
  if (es) setTimeout(() => es.close(), 5000);
}

// ---- one part-recorder ------------------------------------------------------

/**
 * One complete part-recorder on the shared stream. `idx`/`offsetMs` and the
 * chunk list are CLOSED OVER, not shared: at a roll the next recorder starts
 * before the old one's `onstop` fires. Chunks arrive every second
 * (`start(1000)`) — that feeds the crash buffer AND the byte counter; the
 * only roll is the silent storage ceiling (the 30-minute rule is retired).
 */
function startPartRecorder(idx: number, offsetMs: number): void {
  const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : MediaRecorder.isTypeSupported("audio/webm")
      ? "audio/webm"
      : "audio/mp4"; // Safari
  mimeType = mime.split(";")[0]!;
  const localChunks: BlobPart[] = [];
  let localBytes = 0;
  let rolled = false;
  const rec = new MediaRecorder(stream!, {
    mimeType: mime,
    audioBitsPerSecond: 48_000,
  });
  void markPart({
    callId: snapshot.callId!,
    partIdx: idx,
    offsetMs,
    mime: mimeType,
    title: snapshot.title,
  });
  rec.ondataavailable = (e) => {
    if (e.data.size === 0) return;
    localChunks.push(e.data);
    localBytes += e.data.size;
    // the crash copy — best-effort, never blocking the take
    void bufferChunk(snapshot.callId!, idx, e.data);
    if (localBytes >= SAFETY_PART_BYTES && !rolled && rec.state === "recording") {
      // the storage byte ceiling: roll silently — same stream, next idx,
      // offset where the audio actually is. Nothing on screen changes.
      rolled = true;
      rec.stop();
      partIdx = idx + 1;
      partStartMs = recordedMs;
      startPartRecorder(partIdx, partStartMs);
    }
  };
  rec.onstop = () => {
    const blob = new Blob(localChunks, { type: mimeType });
    if (blob.size > 0 && !discarding) {
      patch({ previews: [...snapshot.previews, { idx, url: URL.createObjectURL(blob) }] });
      uploader?.enqueue({ idx, offsetMs, blob, contentType: mimeType });
      partsEnqueued += 1;
    }
    /*
     * ALWAYS resolve the flush, even for an empty tail — and only AFTER the
     * enqueue above. `finish()` awaits this before settling the barrier:
     * `stop()` returns before `onstop` fires, and without the handshake the
     * barrier settled on an EMPTY queue while the only part arrived too
     * late to a call that no longer accepts audio.
     */
    flushDone?.();
    flushDone = null;
  };
  recorder = rec;
  rec.start(1000);
}

// ---- meter + waveform + quality --------------------------------------------

function startMeter(): void {
  const ctx = audioCtx ?? new AudioContext();
  audioCtx = ctx;
  const source = ctx.createMediaStreamSource(stream!);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const data = new Uint8Array(analyser.fftSize);
  let last = 0;
  const loop = (now: number) => {
    meterRaf = requestAnimationFrame(loop);
    if (now - last < 80) return; // ~12fps is plenty for a meter
    last = now;
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    let clipped = 0;
    for (let i = 0; i < data.length; i += 1) {
      const centered = (data[i]! - 128) / 128;
      sum += centered * centered;
      if (centered > 0.97 || centered < -0.97) clipped += 1;
    }
    const rms = Math.sqrt(sum / data.length);
    // RMS of speech sits low; the sqrt-of-RMS curve spreads it over the bar
    patch({ level: Math.min(1, Math.sqrt(rms) * 1.4) });

    if (recorder?.state === "recording") {
      if (now - lastWaveAt >= 500) {
        lastWaveAt = now;
        waveSamples.push(Math.min(1, Math.sqrt(rms) * 1.4));
        if (waveSamples.length > 600) {
          // merge pairs — the timeline keeps its shape, not its density
          const merged: number[] = [];
          for (let i = 0; i < waveSamples.length; i += 2) {
            merged.push(Math.max(waveSamples[i]!, waveSamples[i + 1] ?? 0));
          }
          waveSamples = merged;
        }
        patch({ wave: [...waveSamples] });
      }
      if (clipped / data.length > 0.02) clipUntil = now + 3000;
      if (rms < 0.01) {
        if (quietSince === null) quietSince = now;
      } else {
        quietSince = null;
      }
      const isQuiet = quietSince !== null && now - quietSince > 8000;
      patch({
        quality: shareEnded
          ? "shareEnded"
          : now < clipUntil
            ? "clipping"
            : isQuiet
              ? "quiet"
              : null,
      });
    }
  };
  meterRaf = requestAnimationFrame(loop);
}

// ---- mic-loss guard ---------------------------------------------------------

/**
 * A disconnected microphone (headset unplugged, Bluetooth died) must not
 * roll silence while the screen says Recording: the take auto-PAUSES and
 * the quality line names the reason. Resume first reacquires a mic — the
 * browser's current default — and splices it into the live stream, so the
 * person plugs back in (or falls to the laptop mic) and continues.
 */
function watchMicTrack(track: MediaStreamTrack): void {
  track.addEventListener("ended", () => {
    if (snapshot.phase !== "recording" && snapshot.phase !== "paused") return;
    micLost = true;
    if (snapshot.phase === "recording") pause();
    patch({ quality: "micLost" });
  });
}

async function reacquireMic(): Promise<boolean> {
  let fresh: MediaStream;
  try {
    fresh = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
  } catch {
    patch({ error: "micDenied" });
    return false;
  }
  const newTrack = fresh.getAudioTracks()[0];
  if (!newTrack) return false;
  if (mixDest && audioCtx) {
    // system-audio path: the recorded stream is the mixer's output — the
    // replacement mic joins as a new source, the dead one just goes quiet
    audioCtx.createMediaStreamSource(new MediaStream([newTrack])).connect(mixDest);
  } else if (stream) {
    // pure-mic path: splice the track in the recorded stream itself
    stream.getAudioTracks()
      .filter((track) => track.readyState === "ended")
      .forEach((track) => stream!.removeTrack(track));
    stream.addTrack(newTrack);
  }
  rawTracks = rawTracks.filter((track) => track.readyState !== "ended");
  rawTracks.push(newTrack);
  watchMicTrack(newTrack);
  micLost = false;
  patch({ quality: null });
  return true;
}

// ---- the controls -----------------------------------------------------------

export async function startRecording(opts: StartOptions): Promise<void> {
  if (snapshot.phase !== "idle" && snapshot.phase !== "done" && snapshot.phase !== "failed") {
    return; // one take at a time — the pill is how you find the live one
  }
  patch({ error: null });
  setPhase("starting");
  let micStream: MediaStream;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(opts.micId ? { deviceId: { exact: opts.micId } } : {}),
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
  } catch {
    setPhase("idle");
    patch({ error: "micDenied" });
    return;
  }
  rawTracks = [...micStream.getTracks()];
  shareEnded = false;
  micLost = false;
  mixDest = null;
  micStream.getAudioTracks().forEach(watchMicTrack);
  if (opts.source === "system") {
    /*
     * Tab/system audio: both sides of an online meeting in one take. The
     * browser requires a video track in the share picker; we stop it
     * immediately. A share WITHOUT audio refuses the start (M21: fail on
     * what was told); the share ending mid-take degrades with a warning.
     */
    let display: MediaStream;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    } catch {
      micStream.getTracks().forEach((track) => track.stop());
      rawTracks = [];
      setPhase("idle");
      patch({ error: "shareDenied" });
      return;
    }
    display.getVideoTracks().forEach((track) => track.stop());
    const shareAudio = display.getAudioTracks();
    if (shareAudio.length === 0) {
      micStream.getTracks().forEach((track) => track.stop());
      rawTracks = [];
      setPhase("idle");
      patch({ error: "shareNoAudio" });
      return;
    }
    rawTracks.push(...shareAudio);
    shareAudio[0]!.addEventListener("ended", () => { shareEnded = true; });
    const ctx = new AudioContext();
    audioCtx = ctx;
    const dest = ctx.createMediaStreamDestination();
    mixDest = dest;
    const micNode = ctx.createMediaStreamSource(micStream);
    if (opts.boost) {
      const gain = ctx.createGain();
      gain.gain.value = BOOST_GAIN;
      micNode.connect(gain).connect(dest);
    } else {
      micNode.connect(dest);
    }
    // the shared audio is NOT boosted: it arrives at the sender's own level
    ctx.createMediaStreamSource(new MediaStream(shareAudio)).connect(dest);
    stream = dest.stream;
  } else if (opts.boost) {
    /* mic-only WITH the enhance stage: one node between the device and the
       recorder, so the raw track keeps living in rawTracks for cleanup */
    const ctx = new AudioContext();
    audioCtx = ctx;
    const dest = ctx.createMediaStreamDestination();
    const gain = ctx.createGain();
    gain.gain.value = BOOST_GAIN;
    ctx.createMediaStreamSource(micStream).connect(gain).connect(dest);
    stream = dest.stream;
  } else {
    stream = micStream;
  }

  let callId: string;
  let title: string;
  if (opts.resume) {
    // RESUME: the call exists — adopt it and continue after its last audio
    callId = opts.resume.callId;
    title = opts.resume.title ?? "";
  } else {
    try {
      /*
       * A record NEVER goes untitled (user rule, 2026-08-22): a blank
       * title auto-names as «جلسه ۱ / Meeting 1, 2, 3 …». The list fetch
       * is best-effort: an unreachable list still yields "Meeting 1".
       */
      const typed = opts.title.trim();
      title = typed || nextMeetingTitle(
        await api.listCalls({ includeArchived: true }).catch(() => []),
        opts.locale,
      );
      const created = await api.createCall({
        title,
        source: "web",
        language: opts.language,
        ...(opts.summaryTemplate ? { summary_template: opts.summaryTemplate } : {}),
        ...(opts.summaryInstruction ? { summary_instruction: opts.summaryInstruction } : {}),
        ...(opts.summaryModel ? { summary_model: opts.summaryModel } : {}),
      });
      callId = created.id;
    } catch {
      rawTracks.forEach((track) => track.stop());
      rawTracks = [];
      stream = null;
      setPhase("idle");
      patch({ error: "createFailed" });
      return;
    }
  }
  uploader = new PartUploader(
    api,
    callId,
    (progress) => patch({ progress }),
    // a registered part's server copy is the record — drop the crash copy
    (idx) => void clearPart(callId, idx),
  );
  /* on resume the clock and part math START at the existing audio's end —
     resumePoint's two guarantees, computed by the caller */
  const base = opts.resume ?? { nextIdx: 0, offsetMs: 0 };
  priorParts = opts.resume !== null && base.nextIdx > 0;
  recordedMs = base.offsetMs;
  partStartMs = base.offsetMs;
  partIdx = base.nextIdx;
  partsEnqueued = 0;
  waveSamples = [];
  quietSince = null;
  clipUntil = 0;
  patch({
    callId, title, recordedMs: base.offsetMs, previews: [], wave: [],
    chapterMarks: [], waveStartMs: base.offsetMs, quality: null,
  });
  startMeter();
  startPartRecorder(base.nextIdx, base.offsetMs);
  // best-effort live captions on the same stream (M38)
  void startLiveCaptions(
    MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm",
  );
  lastTick = Date.now();
  timer = setInterval(() => {
    // the clock counts RECORDED time: it advances only while recording
    if (recorder?.state === "recording") {
      const now = Date.now();
      recordedMs += now - lastTick;
      lastTick = now;
      patch({ recordedMs });
    } else {
      lastTick = Date.now();
    }
  }, 500);
  setPhase("recording");
}

export function pause(): void {
  if (recorder?.state === "recording") {
    recorder.pause();
    if (liveRec?.state === "recording") liveRec.pause();
    setPhase("paused");
  }
}

export function resume(): void {
  void (async () => {
    // a lost mic must be replaced BEFORE the take rolls again — resuming
    // onto a dead track records silence that looks like recording
    if (micLost && !(await reacquireMic())) return;
    if (recorder?.state === "paused") {
      recorder.resume();
      if (liveRec?.state === "paused") liveRec.resume();
      lastTick = Date.now();
      setPhase("recording");
    }
  })();
}

export function addChapterMark(atMs: number): void {
  patch({ chapterMarks: [...snapshot.chapterMarks, atMs] });
}

export async function finish(): Promise<void> {
  setPhase("finishing");
  stopLiveCaptions();
  if (timer) clearInterval(timer);
  timer = null;
  cancelAnimationFrame(meterRaf);
  patch({ level: 0 });
  // WAIT for onstop to enqueue the final part before settling the barrier
  await new Promise<void>((resolve) => {
    if (!recorder || recorder.state === "inactive") {
      resolve();
      return;
    }
    flushDone = resolve;
    recorder.stop();
  });
  stream?.getTracks().forEach((track) => track.stop());
  rawTracks.forEach((track) => track.stop());
  rawTracks = [];
  stream = null;
  void audioCtx?.close();
  audioCtx = null;
  mixDest = null;
  micLost = false;

  if (partsEnqueued === 0 && !priorParts) {
    // no audio ever reached the uploader — finishing would create a call
    // stuck at "processing" forever
    setPhase("failed");
    patch({ error: "nothingRecorded" });
    return;
  }

  const settled = await uploader!.settle();
  if (!settled.clean) {
    // finish is BLOCKED: a missing part would transcribe as a silent hole
    setPhase("failed");
    return;
  }
  try {
    // M40: the caption lane's finals ride the finish as the instant
    // preview — the pipeline's checked transcript replaces it at 'ready'
    await api.finishCall(snapshot.callId!, liveFinals || undefined);
  } catch {
    setPhase("failed");
    patch({ error: "finishFailed" });
    return;
  }
  // finished clean — every part registered; the crash copy has no job left
  void clearTake(snapshot.callId!);
  setPhase("done");
}

/**
 * Stop WITHOUT saving (user directive, 2026-08-23: the red stop-and-delete
 * button; the view confirms before calling this). Everything local is torn
 * down and forgotten — the final blob never reaches the uploader, the
 * crash copy is cleared — and the call row is soft-deleted server-side
 * with a platform-authored ledger reason (0085; the on-screen confirm was
 * the consent). If that delete is refused (e.g. the ledger migration has
 * not run), the recording has STILL stopped and nothing will process —
 * the caller is told so it can say so.
 */
export async function discardRecording(): Promise<{ deleted: boolean }> {
  if (snapshot.phase !== "recording" && snapshot.phase !== "paused") {
    return { deleted: false };
  }
  const callId = snapshot.callId;
  discarding = true;
  setPhase("finishing");
  stopLiveCaptions();
  if (timer) clearInterval(timer);
  timer = null;
  cancelAnimationFrame(meterRaf);
  patch({ level: 0 });
  await new Promise<void>((resolve) => {
    if (!recorder || recorder.state === "inactive") {
      resolve();
      return;
    }
    flushDone = resolve;
    recorder.stop();
  });
  stream?.getTracks().forEach((track) => track.stop());
  rawTracks.forEach((track) => track.stop());
  rawTracks = [];
  stream = null;
  void audioCtx?.close();
  audioCtx = null;
  mixDest = null;
  micLost = false;
  discarding = false;

  let deleted = false;
  if (callId) {
    void clearTake(callId);
    try {
      await api.deleteCall(callId, "ضبط ناتمام — توقف و حذف توسط کاربر");
      deleted = true;
    } catch {
      // said out loud by the view; the stop itself already succeeded
    }
  }
  // straight back to the start form — there is nothing to review
  patch({
    phase: "idle", callId: null, title: "", recordedMs: 0, level: 0,
    wave: [], waveStartMs: 0, chapterMarks: [], quality: null,
    progress: { done: 0, pending: 0, failed: 0 }, error: null,
    captions: null, captionRows: [], liveSpeakers: [], captionsDown: false, previews: [],
  });
  return { deleted };
}

export async function retryUploads(): Promise<void> {
  if (partsEnqueued === 0) {
    // nothing was ever recorded — there is nothing to retry; start over
    setPhase("idle");
    patch({ error: null });
    return;
  }
  setPhase("finishing");
  patch({ error: null });
  uploader!.retryFailed();
  const settled = await uploader!.settle();
  if (!settled.clean) {
    setPhase("failed");
    return;
  }
  try {
    await api.finishCall(snapshot.callId!, liveFinals || undefined);
    void clearTake(snapshot.callId!);
    setPhase("done");
  } catch {
    setPhase("failed");
    patch({ error: "finishFailed" });
  }
}

/** Back to the start form ("record another"). Only from a settled phase. */
export function resetRecorder(): void {
  if (snapshot.phase !== "done" && snapshot.phase !== "failed" && snapshot.phase !== "idle") return;
  patch({
    phase: "idle", callId: null, title: "", recordedMs: 0, level: 0,
    wave: [], waveStartMs: 0, chapterMarks: [], quality: null,
    progress: { done: 0, pending: 0, failed: 0 }, error: null,
    captions: null, captionRows: [], liveSpeakers: [], captionsDown: false, previews: [],
  });
}
