/**
 * M33 — the live recorder's controls, published for the agent surface.
 *
 * The Recorder registers its pause/resume (and current phase) here while a
 * take is live, and clears on teardown. The agent's pause_recording /
 * resume_recording client tools reach the REAL controls — the same
 * functions the buttons call — or get an honest "nothing is recording on
 * this screen" refusal when the recorder isn't mounted. A module ref, not a
 * store: nothing re-renders on it; it is a capability handle, not state.
 */
export interface RecorderHandle {
  phase: () => "recording" | "paused" | "other";
  pause: () => void;
  resume: () => void;
}

export const recorderControls: { current: RecorderHandle | null } = { current: null };
