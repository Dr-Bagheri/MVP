import { describe, expect, it } from "vitest";
import { uploadRejection } from "./RecordPanel";

const MB = 1024 * 1024;
const minutes = (n: number) => n * 60;

/**
 * The upload limits, tested because the SCREEN CLAIMS THEY ARE CHECKED.
 *
 * «حداکثر ۵۰۰ مگابایت و ۲۴۰ دقیقه برای هر فایل — پیش از بارگذاری بررسی می‌شود»
 * is a promise printed under the drop zone, and only half of it was kept: the
 * `tooLong` string was fully translated and unreachable, so a four-hour file
 * was accepted under a message saying it had been examined.
 *
 * That is the failure this codebase keeps finding — present, reads as
 * satisfied, does nothing — and a copy string is the one place it cannot be
 * caught by types. So the rule gets a test rather than a browser poke: I tried
 * to verify it by driving a real file input, and the harness gave me a false
 * negative twice (a real blob fires the decoder's error path before a stubbed
 * metadata event can land). A test that is hard to write correctly against the
 * DOM is an argument for extracting the decision, not for trusting it.
 */
describe("what the limits line promises", () => {
  it("refuses a file over the size limit", () => {
    expect(uploadRejection(501 * MB, null)).toEqual({ reason: "tooBig", megabytes: 501 });
  });

  it("refuses a file over the duration limit — the half that did nothing", () => {
    expect(uploadRejection(10 * MB, minutes(300))).toEqual({ reason: "tooLong" });
  });

  it("accepts a file exactly AT each limit", () => {
    // The boundary is the number the product chose to allow. An off-by-one
    // here refuses precisely the file the limit was written to permit, and it
    // would read to the user as an arbitrary refusal.
    expect(uploadRejection(500 * MB, minutes(240))).toBeNull();
  });

  it.each([
    ["Infinity", Infinity],
    ["NaN", NaN],
  ])("accepts an unusable duration of %s — it is unknown, not long", (_label, value) => {
    /*
     * `HTMLMediaElement.duration` reports `Infinity` for media with no
     * seekable metadata, and `Infinity > 14400` is true — so without this the
     * function refuses an undecodable file as "too long", which is exactly the
     * lie the whole repair exists to prevent, wearing a number instead of a
     * null.
     *
     * The call site filters both already. This asserts the DECISION holds on
     * its own, because an invariant enforced one level from the decision that
     * depends on it is airtight with one caller and a landmine with two.
     * (FE2 found this reviewing the repair; my six original cases covered
     * 300/240/49/null and the ordering, and not the value that is neither
     * finite nor null.)
     */
    expect(uploadRejection(10 * MB, value)).toBeNull();
  });

  it("accepts when the duration is UNKNOWN rather than refusing", () => {
    /*
     * `null` is "the browser could not decode enough to say" — not "fine" and
     * not "too long". Refusing here would reject valid audio in any format
     * this particular browser cannot read, and would report "we could not
     * look" to the user as "we looked and it was too long".
     */
    expect(uploadRejection(10 * MB, null)).toBeNull();
  });

  it("reports SIZE first when a file breaks both limits", () => {
    // Size is knowable without decoding anything, so it is the honest answer
    // and the fast one; naming the duration instead would send someone off to
    // trim a recording that would still be too large afterwards.
    expect(uploadRejection(900 * MB, minutes(300))).toEqual({ reason: "tooBig", megabytes: 900 });
  });

  it("accepts an ordinary meeting", () => {
    expect(uploadRejection(48 * MB, minutes(49))).toBeNull();
  });
});
