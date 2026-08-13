"use client";

import { useSyncExternalStore } from "react";
import {
  getCalendarPreference,
  getTimezonePreference,
  subscribePreferences,
  type CalendarPreference,
  type TimezonePreference,
} from "./preferences";

/**
 * Calendar and timezone as React state.
 *
 * `useSyncExternalStore` rather than a provider: the controls may live in more
 * than one home (the avatar menu today, Settings · General next) and must be
 * ONE state. A provider would work too; this needs no wrapper and cannot be
 * forgotten around a subtree.
 *
 * The server snapshot returns the default, so the first client render matches
 * the server's and the stored value arrives on the next one.
 */
export function useCalendarPreference(): CalendarPreference {
  return useSyncExternalStore(subscribePreferences, getCalendarPreference, () => "auto");
}

export function useTimezonePreference(): TimezonePreference {
  return useSyncExternalStore(subscribePreferences, getTimezonePreference, () => "auto");
}
