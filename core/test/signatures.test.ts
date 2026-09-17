import { beforeEach, describe, expect, it } from "vitest";
import { createSignaturesRepo } from "../src/api/signatures.ts";
import { resetCapabilityCache } from "../src/db/capabilities.ts";
import { ConflictError, NotFoundError } from "../src/api/errors.ts";
import type { Db, SqlTx } from "../src/db/identity.ts";
import type { Identity } from "../src/agent/types.ts";

/**
 * THE MINUTES ARE SIGNED (db/0229) — the repo's own decisions, which are the
 * ones the database cannot make for it: WHICH nothing a refused signing is,
 * and the ORDER of the two writes when a picture arrives with the signing.
 *
 * Who may sign is the policy's, walked in db/test/132 against real RLS; this
 * file fakes the connection and asserts the statements it was asked, because
 * a fake that answered "signed" for everybody would prove nothing about the
 * wall and everything about the fake.
 */

const IDENTITY: Identity = {
  userId: "11111111-1111-4111-8111-111111111111",
  orgId: "22222222-2222-4222-8222-222222222222",
  role: "member", isActive: true,
};
const MEETING = "33333333-3333-4333-8333-333333333333";

interface Script {
  /** what the insert-select RETURNS: [] = nothing on file; a row = placed;
      a 23505 = already signed */
  placed: Array<{ user_id: string }> | "duplicate";
  meetingReadable?: boolean;
  onFile?: boolean;
  rows?: Array<Record<string, unknown>>;
}

function fakeDb(script: Script) {
  const asked: string[] = [];
  const tx = {
    unsafe: async (sql: string) => {
      asked.push(sql);
      /* the capability probe: the table exists */
      if (sql.includes("information_schema.tables")) return [{ 1: 1 }];
      if (sql.includes("insert into echo.meeting_signature")) {
        if (script.placed === "duplicate") {
          throw Object.assign(new Error("duplicate key"), { code: "23505" });
        }
        return script.placed;
      }
      if (sql.includes("insert into echo.user_signature")) return [];
      if (sql.includes("select id from echo.meeting")) {
        return script.meetingReadable === false ? [] : [{ id: MEETING }];
      }
      if (sql.includes("from echo.meeting_signature s")) return script.rows ?? [];
      if (sql.includes("actor_on_meeting")) {
        return [{ on_meeting: true, on_file: script.onFile ?? true }];
      }
      if (sql.includes("delete from echo.meeting_signature")) return script.rows ?? [];
      return [];
    },
  } as unknown as SqlTx;
  const db = {
    withIdentity: async <T,>(_i: unknown, fn: (t: SqlTx) => Promise<T>) => fn(tx),
    withoutIdentity: async <T,>(fn: (t: SqlTx) => Promise<T>) => fn(tx),
  } as unknown as Db;
  return { db, asked };
}

beforeEach(() => resetCapabilityCache());

describe("signing the minutes", () => {
  it("places the signature ON FILE, and says so when there is none", async () => {
    /* the ordinary path first: the insert-select copies the row on file */
    const ok = fakeDb({ placed: [{ user_id: IDENTITY.userId }], rows: [] });
    await createSignaturesRepo(ok.db).sign(IDENTITY, MEETING);
    const insert = ok.asked.find((s) => s.includes("insert into echo.meeting_signature"))!;
    expect(insert).toContain("from echo.user_signature");
    expect(insert).toContain("user_id = echo.actor_id()");

    /* nothing on file: the insert-select inserts NOTHING and raises nothing,
       and that zero is a refusal the person can fix — named as such, never
       reported as "signed" */
    const none = fakeDb({ placed: [] });
    await expect(createSignaturesRepo(none.db).sign(IDENTITY, MEETING))
      .rejects.toMatchObject({ code: "no_signature_on_file" });
  });

  it("names a second signing as the primary key refusing, not as a failure", async () => {
    const { db } = fakeDb({ placed: "duplicate" });
    const refused = createSignaturesRepo(db).sign(IDENTITY, MEETING);
    await expect(refused).rejects.toBeInstanceOf(ConflictError);
    await expect(refused).rejects.toMatchObject({ code: "already_signed" });
  });

  it("files the picture that arrives with the signing BEFORE copying it onto the meeting", async () => {
    /* one transaction, in this order — the other order signs with whatever
       was on file a moment ago, which for a first-time signer is nothing */
    const { db, asked } = fakeDb({ placed: [{ user_id: IDENTITY.userId }] });
    await createSignaturesRepo(db).sign(IDENTITY, MEETING, { bytes: Buffer.from([1, 2, 3]), mime: "image/png" });
    const file = asked.findIndex((s) => s.includes("insert into echo.user_signature"));
    const place = asked.findIndex((s) => s.includes("insert into echo.meeting_signature"));
    expect(file).toBeGreaterThanOrEqual(0);
    expect(place).toBeGreaterThan(file);
    /* an UPSERT: a person replacing their signature does not first delete */
    expect(asked[file]).toContain("on conflict (user_id) do update");
  });

  it("files nothing when no picture came — the signature on file is what lands", async () => {
    const { db, asked } = fakeDb({ placed: [{ user_id: IDENTITY.userId }] });
    await createSignaturesRepo(db).sign(IDENTITY, MEETING);
    expect(asked.some((s) => s.includes("insert into echo.user_signature"))).toBe(false);
  });
});

describe("reading a meeting's signatures", () => {
  it("answers the three facts about the CALLER beside the list", async () => {
    const row = {
      user_id: IDENTITY.userId, display_name: "رؤیا", display_name_en: null, username: "roya",
      mime: "image/png", signed_at: new Date("2026-09-17T10:00:00Z"),
    };
    const { db } = fakeDb({ placed: [], rows: [row], onFile: true });
    const record = await createSignaturesRepo(db).forMeeting(IDENTITY, MEETING);
    expect(record.signatures).toEqual([{
      user_id: IDENTITY.userId, display_name: "رؤیا", display_name_en: null, username: "roya",
      mime: "image/png", signed_at: "2026-09-17T10:00:00.000Z",
    }]);
    expect(record.can_sign).toBe(true);
    expect(record.has_signature_on_file).toBe(true);
    /* `signed` is the caller's OWN row in the list, by id */
    expect(record.signed).toBe(true);

    const other = fakeDb({ placed: [], rows: [{ ...row, user_id: "99999999-9999-4999-8999-999999999999" }], onFile: false });
    const theirs = await createSignaturesRepo(other.db).forMeeting(IDENTITY, MEETING);
    expect(theirs.signed).toBe(false);
    expect(theirs.has_signature_on_file).toBe(false);
  });

  it("is a 404 on a meeting the caller cannot read — the not-probeable posture", async () => {
    const { db } = fakeDb({ placed: [], meetingReadable: false });
    await expect(createSignaturesRepo(db).forMeeting(IDENTITY, MEETING)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("withdraws only the caller's own row, and 404s when there was none", async () => {
    const { db, asked } = fakeDb({ placed: [], rows: [] });
    await expect(createSignaturesRepo(db).withdraw(IDENTITY, MEETING)).rejects.toBeInstanceOf(NotFoundError);
    const del = asked.find((s) => s.includes("delete from echo.meeting_signature"))!;
    /* the actor, never a parameter: a withdraw cannot name somebody else */
    expect(del).toContain("user_id = echo.actor_id()");
    expect(del).not.toMatch(/user_id = \$2/);
  });
});
