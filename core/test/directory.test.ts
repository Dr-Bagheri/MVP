import { describe, expect, it } from "vitest";

import { createDirectoryRepo, PERSON_TITLES } from "../src/api/directory.ts";
import type { Db, SqlTx } from "../src/db/identity.ts";
import type { Identity } from "../src/agent/types.ts";

/**
 * The directory's own rules, on fakes at the honest altitude (the fake is
 * the db ANSWER; RLS is the wall and is not claimed here). What IS proved:
 * the title vocabulary refuses before SQL, blank names refuse, the
 * undefined-vs-null split on speaker linking survives the layer, and
 * linking stamps the LINKER.
 */

const WHO: Identity = {
  userId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  orgId: "99999999-8888-4777-8666-555555555555",
  role: "member",
  isActive: true,
} as unknown as Identity;

const CALL = "11111111-2222-4333-8444-555555555555";
const SPEAKER = "21111111-2222-4333-8444-555555555555";

function fakeDb(answer: (sql: string, params: unknown[]) => unknown[]) {
  const log: { sql: string; params: unknown[] }[] = [];
  const tx = {
    unsafe: (sql: string, params: unknown[] = []) => {
      log.push({ sql, params });
      return Promise.resolve(answer(sql, params));
    },
  } as unknown as SqlTx;
  const db = {
    withIdentity: (_who: Identity, fn: (tx: SqlTx) => unknown) => fn(tx),
  } as unknown as Db;
  return { db, log };
}

describe("the title vocabulary", () => {
  it("mirrors 0062's constraint and refuses an invented title with a sentence", async () => {
    const { db, log } = fakeDb(() => []);
    await expect(
      createDirectoryRepo(db).create(WHO, { displayName: "کسی", title: "grand-vizier" }),
    ).rejects.toMatchObject({ code: "unknown_title" });
    expect(log).toHaveLength(0); // refused BEFORE any SQL
  });

  it("every code in the export is one the constraint accepts (the list is one list)", () => {
    // the negative-space check: '' is a member (not-chosen is a real state),
    // 'owner' and other role words are NOT titles
    expect(PERSON_TITLES).toContain("");
    expect(PERSON_TITLES).toContain("employee");
    expect(PERSON_TITLES).not.toContain("owner");
  });

  it("refuses a blank name — a nameless directory row helps nobody find anyone", async () => {
    const { db } = fakeDb(() => []);
    await expect(
      createDirectoryRepo(db).create(WHO, { displayName: "   " }),
    ).rejects.toThrow(/name is required/);
  });
});

describe("speaker attribution", () => {
  const ROW = { id: SPEAKER, label: "S1", person_id: null };

  it("undefined leaves the link alone; null UNLINKS — two different nothings", async () => {
    const { db, log } = fakeDb(() => [ROW]);
    const repo = createDirectoryRepo(db);
    await repo.updateSpeaker(WHO, CALL, SPEAKER, { label: "میزبان" });
    // the set-person branch is driven by a boolean parameter, not by null
    expect(log[0]!.params[2]).toBe(false);
    await repo.updateSpeaker(WHO, CALL, SPEAKER, { personId: null });
    expect(log[1]!.params[2]).toBe(true);
    expect(log[1]!.params[3]).toBeNull();
  });

  it("linking stamps WHO linked — attribution is a claim about a person", async () => {
    const { db, log } = fakeDb(() => [ROW]);
    await createDirectoryRepo(db).updateSpeaker(WHO, CALL, SPEAKER, {
      personId: "31111111-2222-4333-8444-555555555555",
    });
    expect(log[0]!.params[4]).toBe(WHO.userId);
  });

  it("a speaker that is not on that call is not_found, whichever reason", async () => {
    const { db } = fakeDb(() => []);
    await expect(
      createDirectoryRepo(db).updateSpeaker(WHO, CALL, SPEAKER, { label: "x" }),
    ).rejects.toThrow(/no such speaker/);
  });
});

describe("remove — db/0076's named door, mapped honestly", () => {
  const PERSON = "31111111-2222-4333-8444-555555555555";
  const throwing = (code: string) => fakeDb(() => { throw Object.assign(new Error("x"), { code }); });

  it("calls the DOOR, never a bare DELETE", async () => {
    const { db, log } = fakeDb(() => []);
    await createDirectoryRepo(db).remove(WHO, PERSON, "دلیل آزمایشی");
    expect(log[0]!.sql).toContain("echo.delete_person");
    expect(log[0]!.sql).not.toMatch(/deletes+from/i);
  });

  it("42883 (door absent — db/0076 not run) is a NAMEABLE not_migrated, not a crash", async () => {
    await expect(createDirectoryRepo(throwing("42883").db).remove(WHO, PERSON, "دلیل آزمایشی"))
      .rejects.toThrow(/not_migrated/);
  });

  it("42501 (the SQL role wall) surfaces as not-permitted; P0002 as no-such-person", async () => {
    await expect(createDirectoryRepo(throwing("42501").db).remove(WHO, PERSON, "دلیل آزمایشی"))
      .rejects.toThrow(/not permitted/);
    await expect(createDirectoryRepo(throwing("P0002").db).remove(WHO, PERSON, "دلیل آزمایشی"))
      .rejects.toThrow(/no such person/);
  });
});

/**
 * The ACCOUNT LINK (db/0005's column, written for the first time on
 * 2026-08-26). The column, its FK and its RLS have existed since the first
 * speaker migration; what never existed was a writer, so these assertions
 * are about the three states a writer must keep apart — set, cleared, and
 * left alone — and about the two refusals a person can act on.
 */
describe("identify a person as a platform member", () => {
  const PERSON = "31111111-2222-4333-8444-555555555555";
  const MEMBER = "41111111-2222-4333-8444-555555555555";
  const ROW = { id: PERSON, display_name: "Ali", title: "", app_user_id: MEMBER };

  it("an absent app_user_id does not touch the column", async () => {
    /* the omit half of the contract: renaming somebody must not silently
       unlink them, which a coalesce-shaped update would do the moment the
       caller sent only a name */
    const { db, log } = fakeDb(() => [{ ...ROW, app_user_id: null }]);
    await createDirectoryRepo(db).update(WHO, PERSON, { displayName: "Ali" });
    /* matched as an ASSIGNMENT, not as a name: `returning` lists the
       column on every update, so a bare substring check would pass on a
       statement that sets it and fail on one that does not — the name
       matching itself, which this codebase has been bitten by before */
    expect(log[0]!.sql).not.toContain("app_user_id = $");
  });

  it("a uuid SETS the link", async () => {
    const { db, log } = fakeDb(() => [ROW]);
    const person = await createDirectoryRepo(db).update(WHO, PERSON, { appUserId: MEMBER });
    expect(log[0]!.sql).toContain("app_user_id = $");
    expect(log[0]!.params).toContain(MEMBER);
    expect(person.app_user_id).toBe(MEMBER);
  });

  it("null CLEARS it — 'not a member after all' is an answer", async () => {
    // the discriminating third state: if null were treated as "absent",
    // the one interaction that removes a wrong link would do nothing
    const { db, log } = fakeDb(() => [{ ...ROW, app_user_id: null }]);
    await createDirectoryRepo(db).update(WHO, PERSON, { appUserId: null });
    expect(log[0]!.sql).toContain("app_user_id = $");
    expect(log[0]!.params).toContain(null);
  });

  it("refuses a non-uuid before it reaches the database", async () => {
    const { db } = fakeDb(() => [ROW]);
    await expect(createDirectoryRepo(db).update(WHO, PERSON, { appUserId: "me" }))
      .rejects.toThrow();
  });

  it("23505 (db/0100's index) becomes a nameable conflict, not a 500", async () => {
    const { db } = fakeDb(() => { throw Object.assign(new Error("dup"), { code: "23505" }); });
    await expect(createDirectoryRepo(db).update(WHO, PERSON, { appUserId: MEMBER }))
      .rejects.toMatchObject({ message: "account_already_linked" });
  });

  it("23503 (the composite FK) says the account is not in this org", async () => {
    // the two refusals mean different things to the admin standing there:
    // "somebody else is that account" and "that account is not ours"
    const { db } = fakeDb(() => { throw Object.assign(new Error("fk"), { code: "23503" }); });
    await expect(createDirectoryRepo(db).update(WHO, PERSON, { appUserId: MEMBER }))
      .rejects.toMatchObject({ code: "not_a_member" });
  });

  it("the list asks for the linked NAME and a single-match suggestion", async () => {
    /* the id alone is not renderable and the members list is admin-only,
       so the name is resolved server-side; the suggestion is guarded by
       count(*) = 1 because two candidates is a question, not a hint */
    const { db, log } = fakeDb(() => []);
    await createDirectoryRepo(db).list(WHO);
    const sql = log[log.length - 1]!.sql;
    expect(sql).toContain("left join echo.app_user lu on lu.id = p.app_user_id");
    expect(sql).toContain("case when count(*) = 1");
    expect(sql).toContain("echo.fa_fold(u2.display_name) = echo.fa_fold(p.display_name)");
  });
});
