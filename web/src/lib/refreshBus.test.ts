import { afterEach, describe, expect, it, vi } from "vitest";
import {
  announceChange, announceWrite, refreshEpoch, resetRefreshBus, subscribeChanges,
} from "./refreshBus";

describe("the table-refresh bus", () => {
  afterEach(() => resetRefreshBus());

  it("an announcement bumps the epoch and reaches subscribers", () => {
    const seen = vi.fn();
    subscribeChanges("members", seen);
    announceChange("members");
    expect(seen).toHaveBeenCalledTimes(1);
    expect(refreshEpoch("members")).toBe(1);
    // other topics untouched — a members write must not refetch every table
    expect(refreshEpoch("calls")).toBe(0);
  });

  it("unsubscribe stops delivery", () => {
    const seen = vi.fn();
    const off = subscribeChanges("calls", seen);
    off();
    announceChange("calls");
    expect(seen).not.toHaveBeenCalled();
  });

  it("announceWrite derives topics from the REAL client paths", () => {
    // these are the paths the client actually calls — checked against its
    // bff() call sites, not invented (rule 10)
    announceWrite("/api/admin/members/u-1");
    expect(refreshEpoch("members")).toBe(1);
    announceWrite("/api/admin/invitations");
    expect(refreshEpoch("invitations")).toBe(1);
    expect(refreshEpoch("members")).toBe(2); // an invitation changes the roster
    announceWrite("/api/calls/c-1/archive");
    expect(refreshEpoch("calls")).toBe(1);
    announceWrite("/api/assistant/sessions/s-1/archive");
    expect(refreshEpoch("sessions")).toBe(1);
    announceWrite("/api/directory");
    expect(refreshEpoch("speakers")).toBe(1);
  });

  it("answering a join invitation refreshes the ROOMS, and never the roster", () => {
    /*
     * 0189. Accepting is what puts the room in your own list, so the room
     * chips have to refetch — but `/api/invites` and `/api/admin/invitations`
     * are two different features whose names are one letter apart, and a rule
     * that caught both would refetch the member table on every accepted room
     * invitation while looking entirely reasonable.
     */
    announceWrite("/api/invites/i-1/respond");
    expect(refreshEpoch("chat")).toBe(1);
    expect(refreshEpoch("invitations")).toBe(0);
    expect(refreshEpoch("members")).toBe(0);

    /* and the pair pointed the other way: the org's invitations must not
       reach the chat */
    announceWrite("/api/admin/invitations");
    expect(refreshEpoch("chat")).toBe(1);
  });

  it("negative control: a path outside the map announces NOTHING", () => {
    announceWrite("/api/auth/sign-in");
    announceWrite("/api/me/autonomy");
    for (const topic of ["members", "calls", "sessions"] as const) {
      expect(refreshEpoch(topic)).toBe(0);
    }
  });
});
