import { describe, expect, it } from "vitest";
import { nextRenewal } from "../src/api/tasks.ts";

/**
 * 0186 — when a repeating order comes back, and when it stops.
 *
 * This is the branch the directive is actually about ("unlimited in time …
 * or until this date … it has a gap between each renew"), and it is the one
 * a live test would exercise least: reaching it needs a task, a schedule, a
 * completion and a clock at exactly the wrong moment. Extracted, it is four
 * numbers and a comparison, and the edges are reachable.
 */
describe("nextRenewal", () => {
  const at = (iso: string) => new Date(iso);

  it("adds the gap to the day it was finished", () => {
    expect(nextRenewal({ gap_days: 3, until_date: null }, at("2026-09-04T10:00:00Z")))
      .toBe("2026-09-07");
    /* zero is a real answer, not a missing one: "as soon as it is done" */
    expect(nextRenewal({ gap_days: 0, until_date: null }, at("2026-09-04T10:00:00Z")))
      .toBe("2026-09-04");
  });

  it("crosses months and years without help", () => {
    expect(nextRenewal({ gap_days: 5, until_date: null }, at("2026-08-30T23:59:00Z")))
      .toBe("2026-09-04");
    expect(nextRenewal({ gap_days: 2, until_date: null }, at("2026-12-31T00:00:00Z")))
      .toBe("2027-01-02");
    /* a leap day, which a naive +N*86400000 on a local Date gets wrong once
       every four years in the hour a country changes its clocks */
    expect(nextRenewal({ gap_days: 1, until_date: null }, at("2028-02-28T12:00:00Z")))
      .toBe("2028-02-29");
  });

  it("stops when the next one would fall past the end date", () => {
    expect(nextRenewal({ gap_days: 7, until_date: "2026-09-10" }, at("2026-09-04T10:00:00Z")))
      .toBeNull();
    /* and the CONTROL, without which the line above passes against a
       function that always returns null */
    expect(nextRenewal({ gap_days: 3, until_date: "2026-09-10" }, at("2026-09-04T10:00:00Z")))
      .toBe("2026-09-07");
  });

  it("treats the end date as INCLUSIVE — the day itself still counts", () => {
    /* "until the 10th" that refuses the 10th is the off-by-one every date
       range ships once, and the reading a person means is the generous one */
    expect(nextRenewal({ gap_days: 6, until_date: "2026-09-10" }, at("2026-09-04T00:00:00Z")))
      .toBe("2026-09-10");
    expect(nextRenewal({ gap_days: 7, until_date: "2026-09-10" }, at("2026-09-04T00:00:00Z")))
      .toBeNull();
  });

  it("never ends when there is no end date", () => {
    /* "unlimited in time", the directive's other half — asserted a long way
       out, because a null compared with `>` in a language with loose
       coercion is exactly the shape that silently becomes false */
    expect(nextRenewal({ gap_days: 365, until_date: null }, at("2099-01-01T00:00:00Z")))
      .toBe("2100-01-01");
  });

  it("reads the day in UTC, so the same schedule ends on the same day for everyone", () => {
    /*
     * 22:00 UTC is already tomorrow in Tehran and still yesterday in Los
     * Angeles. If this read the LOCAL day, the same order finished at the
     * same instant would renew on different dates for different colleagues —
     * and the suite would agree with whichever machine ran it.
     */
    expect(nextRenewal({ gap_days: 0, until_date: null }, at("2026-09-04T22:00:00Z")))
      .toBe("2026-09-04");
    expect(nextRenewal({ gap_days: 0, until_date: null }, at("2026-09-04T02:00:00Z")))
      .toBe("2026-09-04");
  });

  it("refuses to be talked into a negative or fractional gap", () => {
    /* the wire is validated before this is reached, and the day somebody
       calls it from somewhere else it must not walk BACKWARDS — a renewal
       due before the completion is a card that is overdue the moment it
       exists */
    expect(nextRenewal({ gap_days: -5, until_date: null }, at("2026-09-04T10:00:00Z")))
      .toBe("2026-09-04");
    expect(nextRenewal({ gap_days: 2.7, until_date: null }, at("2026-09-04T10:00:00Z")))
      .toBe("2026-09-06");
    expect(nextRenewal({ gap_days: NaN, until_date: null }, at("2026-09-04T10:00:00Z")))
      .toBe("2026-09-04");
  });
});
