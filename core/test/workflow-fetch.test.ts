import { describe, expect, it } from "vitest";
import { ENVELOPE_FIELDS } from "../src/api/workflow-graph.ts";
import { gmailEnvelope } from "../src/api/connectors.ts";

/**
 * **The envelope, from the producer** (rule 10).
 *
 * `ENVELOPE_FIELDS` is a promise the validator makes to a workflow author,
 * possibly months before the run: bind `s1.reply_to` and an address will be
 * there. `fetchEnvelope` is what has to keep it. They live in different
 * packages' files and neither imports the other, which is the shape that
 * produced the words-shape incident — two correct sides and an unowned wire.
 *
 * So the fixture here is a REAL Gmail response body, and the assertion is
 * that the producer fills the fields the registry declares. A hand-written
 * envelope on both sides would agree with itself and prove nothing.
 */

/** the shape Gmail's `format=full` actually returns, trimmed to the parts read */
const GMAIL_MESSAGE = {
  id: "1a047f1d6946fbbc",
  threadId: "1a047e9544873f5b",
  snippet: "سلام، برای سه‌شنبه وقت داری؟",
  payload: {
    mimeType: "text/plain",
    headers: [
      { name: "Subject", value: "قرار سه‌شنبه" },
      { name: "From", value: "Colleague <colleague@example.com>" },
      { name: "Reply-To", value: "Team <team@example.com>" },
      { name: "Date", value: "Fri, 28 Aug 2026 09:52:00 +0000" },
      { name: "Message-ID", value: "<abc@example.com>" },
    ],
    body: { size: 44, data: Buffer.from("سلام، برای سه‌شنبه وقت داری؟", "utf8").toString("base64url") },
  },
};

describe("fetchEnvelope keeps the registry's promise", () => {
  it("fills every mail_message field the validator declares", () => {
    /*
     * The shaping, against a REAL Gmail body. No OAuth, no database — the
     * first version of this test called through the token path and fell into
     * an "if it refused, assert something trivially true" branch, which is a
     * green that means nothing. The provider call is one line; this is the
     * part with decisions in it.
     */
    const envelope = gmailEnvelope(GMAIL_MESSAGE.id, GMAIL_MESSAGE);
    for (const field of Object.keys(ENVELOPE_FIELDS.mail_message!)) {
      expect(Object.keys(envelope), `envelope is missing ${field}`).toContain(field);
    }
    /* and the values are the RIGHT ones, not merely present: Reply-To beats
       From, the body is decoded rather than base64, and the subject is the
       message's own */
    expect(envelope.reply_to).toBe("team@example.com");
    expect(envelope.thread_ref).toBe("1a047e9544873f5b");
    expect(envelope.subject).toBe("قرار سه‌شنبه");
    expect(String(envelope.body)).toContain("سه‌شنبه");
  });

  it("falls back to From when the sender set no Reply-To — the control", () => {
    /* without this, "always return From" passes the check above */
    const plain = {
      ...GMAIL_MESSAGE,
      payload: {
        ...GMAIL_MESSAGE.payload,
        headers: GMAIL_MESSAGE.payload.headers.filter((h) => h.name !== "Reply-To"),
      },
    };
    expect(gmailEnvelope(plain.id, plain).reply_to).toBe("colleague@example.com");
  });

  it("declares no field the executor could never fill", () => {
    /*
     * The other direction, and the one a test can actually hold without a
     * live connection: every field name in the registry appears in the
     * producer's source. A registry entry with no producer is a binding the
     * builder offers, the validator accepts, and the run fails on — the
     * granted-vs-called instrument, applied to a wire.
     */
    const source = readSource();
    for (const [kind, fields] of Object.entries(ENVELOPE_FIELDS)) {
      for (const field of Object.keys(fields)) {
        expect(source, `${kind}.${field} is declared but never produced`)
          .toMatch(new RegExp(`\\b${field}:`));
      }
    }
  });

  it("has a source to read — the vacuity guard", () => {
    /* a checker that reads an empty string passes every assertion above */
    expect(readSource().length).toBeGreaterThan(2000);
    expect(readSource()).toContain("fetchEnvelope");
  });
});

function readSource(): string {
  /* eslint-disable-next-line @typescript-eslint/no-require-imports */
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const { fileURLToPath } = require("node:url") as typeof import("node:url");
  const { dirname, join } = require("node:path") as typeof import("node:path");
  /* this file's own directory, then up one — string-slicing a path is the
     Windows trap this repo has already been bitten by */
  const pkg = dirname(dirname(fileURLToPath(import.meta.url)));
  const whole = readFileSync(join(pkg, "src", "api", "connectors.ts"), "utf8");
  /* only the method under test: the file mentions `subject:` in three other
     places, and a match anywhere would report coverage the wire does not have */
  const start = whole.indexOf("async fetchEnvelope(");
  const end = whole.indexOf("async sourceContext(", start);
  return whole.slice(start, end);
}
