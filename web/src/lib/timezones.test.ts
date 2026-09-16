import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import fa from "@/messages/fa.json";
import { TIMEZONES, timezoneLabelKey } from "./timezones";

/**
 * Every zone the picker offers has a WORD for it in both catalogues (user,
 * 2026-09-16: "this dropdown still is in english, translate it"). The
 * coverage list is the producer's own — `TIMEZONES` — so a zone added there
 * without its labels goes red here rather than rendering as a raw
 * identifier; and the Persian label must be Persian, because a label that
 * is the identifier again would satisfy "a key exists" and defeat the point.
 *
 * `keys.test` cannot see this: the component reads the key through
 * `timezoneLabelKey`, which is computed, and computed keys are skipped there.
 */
const platform = (table: unknown) => (table as { platform: Record<string, unknown> }).platform;

describe("the time-zone picker's words", () => {
  it("derives one key per zone", () => {
    expect(timezoneLabelKey("Asia/Tehran")).toBe("tz_Asia_Tehran");
    expect(timezoneLabelKey("America/New_York")).toBe("tz_America_New_York");
    expect(timezoneLabelKey("UTC")).toBe("tz_UTC");
  });

  it.each(TIMEZONES)("%s is named in both catalogues, and in Persian on the Persian one", (zone) => {
    const key = timezoneLabelKey(zone);
    const faLabel = platform(fa)[key];
    const enLabel = platform(en)[key];
    expect(typeof faLabel, `fa.platform.${key}`).toBe("string");
    expect(typeof enLabel, `en.platform.${key}`).toBe("string");
    expect((faLabel as string).length).toBeGreaterThan(0);
    expect((enLabel as string).length).toBeGreaterThan(0);
    /* the Persian screen stays Persian: no Latin letter in the label, so
       «Asia/Tehran» written back as its own label cannot pass */
    expect(faLabel, `fa.platform.${key} carries Latin text`).not.toMatch(/[A-Za-z]/);
  });

  it("a zone the picker does not offer has no words — the check can fail", () => {
    /* the control: without it, a catalogue that happened to name every
       string in the world would pass the loop above for the wrong reason */
    const key = timezoneLabelKey("Asia/Kolkata");
    expect(platform(fa)[key]).toBeUndefined();
    expect(platform(en)[key]).toBeUndefined();
  });
});
