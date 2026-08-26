"use client";

/**
 * THE GUIDED TOUR (user directive, 2026-08-26): the menu offers three
 * suggestions that TEACH Echo — "press this, choose this, start" — by
 * dimming the screen and highlighting one real control at a time, with a
 * sentence beside it.
 *
 * A module-level store, not context: a step may navigate ("go to the
 * records page"), and a provider would remount across the route change and
 * lose the tour mid-sentence. The overlay component subscribes from the
 * locale layout, which never remounts.
 *
 * Targets are `data-tour` attributes on the real controls — never CSS
 * selectors into someone else's markup. A selector reaches across a file
 * boundary and breaks silently when that file is restyled; an attribute is
 * a declared, greppable contract ("this element is a tour stop").
 */

export interface TourStep {
  /** the data-tour value to highlight; the overlay waits briefly for it */
  target: string;
  /** what to SAY at this stop — already localized by the starter */
  text: string;
  /** navigate here before looking for the target */
  href?: string;
}

export interface TourState {
  steps: TourStep[];
  /** index into steps; -1 = no tour running */
  at: number;
}

let state: TourState = { steps: [], at: -1 };
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

export function subscribeTour(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function tourSnapshot(): TourState {
  return state;
}

export function startTour(steps: TourStep[]): void {
  if (steps.length === 0) return;
  state = { steps, at: 0 };
  emit();
}

export function nextTourStep(): void {
  if (state.at < 0) return;
  const next = state.at + 1;
  state = next >= state.steps.length ? { steps: [], at: -1 } : { ...state, at: next };
  emit();
}

export function endTour(): void {
  if (state.at < 0) return;
  state = { steps: [], at: -1 };
  emit();
}
