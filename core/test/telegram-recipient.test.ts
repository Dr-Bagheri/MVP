import { describe, expect, it } from "vitest";
import { createConnectorsRepo, telegramRecipient } from "../src/api/connectors.ts";
import type { Db, SqlTx } from "../src/db/identity.ts";
import type { Identity } from "../src/agent/types.ts";

/**
 * SENDING A COLLEAGUE A TELEGRAM MESSAGE (db/0216).
 *
 * User report, 2026-09-08 — with the screenshot: the assistant was asked to
 * message a colleague, was given their @username and their phone number, and
 * failed. **It could not have succeeded.** A bot cannot open a conversation
 * with a person; a @username addresses a public channel or group; a phone
 * number addresses nothing at all. The one address that exists for a person
 * is the numeric chat THEY opened — which is exactly what db/0212's link
 * records, and which nothing had ever joined to the send.
 *
 * The resolver is exported and tested directly rather than through `act`,
 * and that is a decision worth stating: reaching it through the repo means
 * getting past the credential store, and a fake that produces a decryptable
 * token is this file re-implementing the cipher — a second spelling of the
 * one thing in here that must have exactly one. That `act` calls it at all
 * is asserted at the foot, where it costs one line.
 */

const IDENTITY: Identity = {
  userId: "11111111-1111-4111-8111-111111111111",
  orgId: "22222222-2222-4222-8222-222222222222",
  role: "member", isActive: true,
};
const SINA = "44444444-4444-4444-8444-444444444444";

function fakeDb(chat: string | null) {
  const asked: string[] = [];
  const tx = {
    unsafe: async (sql: string) => {
      asked.push(sql);
      return sql.includes("telegram_chat_for") ? [{ chat }] : [];
    },
  } as unknown as SqlTx;
  const db = {
    withIdentity: async <T,>(_i: unknown, fn: (t: SqlTx) => Promise<T>) => fn(tx),
    withoutIdentity: async <T,>(fn: (t: SqlTx) => Promise<T>) => fn(tx),
    withActor: async <T,>(_a: string, fn: (t: SqlTx) => Promise<T>) => fn(tx),
  } as unknown as Db;
  return { db, asked };
}

describe("who a Telegram message can reach", () => {
  it("turns a named colleague into the chat they opened themselves", async () => {
    const { db } = fakeDb("707070707");
    const args = await telegramRecipient(db, IDENTITY, { user_id: SINA, text: "سلام" });

    expect(args.chat).toBe("707070707");
    expect(args.text).toBe("سلام");
    /* the platform's own id does not travel to Telegram, which has never
       heard of it — an argument a provider ignores is one nobody notices is
       being sent, and this one names a colleague */
    expect(args).not.toHaveProperty("user_id");
  });

  it("refuses a colleague who has not linked — by what to do, not by a provider error", async () => {
    /*
     * The screenshot's failure, named. db/0216 answers NULL to "not linked",
     * "not in this org" and "no such person" alike, so ONE sentence covers
     * every refusal: telling them apart would make the door an oracle for
     * who uses Telegram.
     */
    const { db } = fakeDb(null);
    await expect(telegramRecipient(db, IDENTITY, { user_id: SINA, text: "سلام" }))
      .rejects.toMatchObject({ code: "telegram_not_linked" });
  });

  it("leaves a channel alone — a group the bot is in is a different address", async () => {
    const { db, asked } = fakeDb("707070707");
    const args = await telegramRecipient(db, IDENTITY, { chat: "@neurai_news", text: "خبر" });

    expect(args.chat).toBe("@neurai_news");
    /* the door is not consulted at all: a channel was never a person, and a
       resolver that ran anyway would turn every channel post into a lookup */
    expect(asked.some((sql) => sql.includes("telegram_chat_for"))).toBe(false);
  });

  it("refuses an id that is not one, before it reaches the database", async () => {
    /* a bad uuid used to reach Postgres as 22P02 and come back a 500 — the
       check-up's own lesson, applied where a MODEL supplies the string */
    const { db, asked } = fakeDb("707070707");
    await expect(telegramRecipient(db, IDENTITY, { user_id: "sinasepasi", text: "x" }))
      .rejects.toThrow();
    expect(asked).toHaveLength(0);
  });

  it("is what the repo's own send calls — the refusal arrives through act()", async () => {
    /*
     * The seam, and the only assertion here that goes through the repo. It
     * works precisely because the refusal happens BEFORE the credential
     * store is touched: a version that resolved the recipient after opening
     * the connection would spend a token read on a message it cannot send.
     */
    const { db } = fakeDb(null);
    await expect(
      createConnectorsRepo(db).act(IDENTITY, "telegram", "send_message", { user_id: SINA, text: "س" }),
    ).rejects.toMatchObject({ code: "telegram_not_linked" });
  });
});
