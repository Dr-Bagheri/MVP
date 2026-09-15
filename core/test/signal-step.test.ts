/**
 * M35 signal step — the positive-detection assertions (rule 7): a weekly
 * digest firing WRITES a conversation and a card as the owner, and the
 * capability-absent state is a loud consumed skip, never an error loop.
 */
import { describe, expect, it } from "vitest";

import { createSignalStep } from "../src/worker/signal-step.ts";
import { resetCapabilityCache } from "../src/db/capabilities.ts";
import { createDb, type SqlClient, type SqlTx } from "../src/db/identity.ts";

const OWNER = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const SESSION = "33333333-3333-4333-8333-333333333333";
const CALL = "44444444-4444-4444-8444-444444444444";
/** Arabic-script block — the question a screenshot of an English screen asks */
const PERSIAN = /[؀-ۿ]/;

function fakeDb({ signalTables = true, locale = "fa" } = {}) {
  const log: { sql: string; params?: unknown[] | undefined }[] = [];
  const make = (): SqlClient => ({
    async begin<T>(fn: (tx: SqlTx) => Promise<T>): Promise<T> {
      const tx = (async () => []) as unknown as SqlTx;
      (tx as unknown as { unsafe: SqlTx["unsafe"] }).unsafe = (async (sql: string, params?: unknown[]) => {
        log.push({ sql, params });
        if (sql.includes("information_schema.tables")) {
          return signalTables ? [{ present: 1 }] : [];
        }
        /* the locale join is checked FIRST: it also selects from
           echo.app_user, and the identity branch below would otherwise
           swallow it and hand the resolver a row with no locale in it —
           which reads exactly like "this person has no language" */
        if (sql.includes("u.locale as person")) return [{ person: locale, org: locale }];
        if (sql.includes("from echo.app_user u")) {
          return [{ id: OWNER, org_id: ORG, role: "member", status: "active", org_status: "active" }];
        }
        if (sql.includes("insert into echo.agent_session")) return [{ id: SESSION }];
        if (sql.includes("insert into echo.agent_message")) {
          return [{ id: "m1", seq: 1, role: "assistant", content: "x", tool_calls: [], agent_run_id: null, created_at: new Date() }];
        }
        /* the brief's own read (title + latest summary) and the digest's
           count are two different queries over echo.call */
        if (sql.includes("as body")) return [{ title: "Weekly meeting with NAI", body: "We ship on Friday." }];
        if (sql.includes("from echo.call")) return [{ n: "2", titles: ["الف", "ب"] }];
        return [];
      }) as SqlTx["unsafe"];
      return fn(tx);
    },
    async end() {},
  });
  return { db: createDb({ app: make(), agent: make() }), log };
}

/** the title, the card's title and the body, as they were actually stored */
function delivered(log: { sql: string; params?: unknown[] | undefined }[]) {
  const session = log.find((e) => e.sql.includes("insert into echo.agent_session"));
  const message = log.find((e) => e.sql.includes("insert into echo.agent_message"));
  const card = log.find((e) => e.sql.includes("insert into echo.agent_card"));
  /* by INDEX, from each statement's own column list — agent_session
     (org, actor, title), agent_message (session, org, role, content),
     agent_card (org, owner, kind, title). A `find` over the params would
     pass against a version that stored the title in the wrong column. */
  return {
    sessionTitle: session?.params?.[2],
    body: message?.params?.[3],
    cardTitle: card?.params?.[3],
  };
}

const quietLog = { info: () => {}, warn: () => {}, error: () => {} } as never;

describe("the signal step", () => {
  it("a weekly digest firing WRITES a conversation and a card, as the owner", async () => {
    resetCapabilityCache();
    const { db, log } = fakeDb();
    const step = createSignalStep({ db });
    await step.handle(
      { event: "cron.weekly", ownerId: OWNER, orgId: ORG, ruleId: "r1" } as never,
      { attempt: 1, log: quietLog },
    );
    const sql = log.map((e) => e.sql).join("\n");
    expect(sql).toContain("insert into echo.agent_session");
    expect(sql).toContain("insert into echo.agent_message");
    expect(sql).toContain("insert into echo.agent_card");
    const card = log.find((e) => e.sql.includes("insert into echo.agent_card"));
    expect(card?.params?.[0]).toBe(ORG);
    expect(card?.params?.[1]).toBe(OWNER);
    expect(card?.params?.[2]).toBe("weekly_digest");
  });

  it("before db/0074, a signal is a loud CONSUMED skip — never a retry loop against missing tables", async () => {
    resetCapabilityCache();
    const { db, log } = fakeDb({ signalTables: false });
    const warned: unknown[] = [];
    const step = createSignalStep({ db });
    await step.handle(
      { event: "cron.weekly", ownerId: OWNER, orgId: ORG } as never,
      { attempt: 1, log: { info: () => {}, error: () => {}, warn: (f: unknown) => warned.push(f) } as never },
    );
    expect(warned.length).toBeGreaterThan(0);
    expect(log.some((e) => e.sql.includes("agent_card"))).toBe(false);
    resetCapabilityCache();
  });

  /**
   * THE DELIVERY SPEAKS THE READER'S LANGUAGE (2026-09-09).
   *
   * The reported defect: an English organisation's conversation list read
   * «خلاصهٔ آمادهٔ «Weekly meeting with NAI»». All three writes are asserted
   * per language — the conversation's title, the card's title and the
   * message body — because a half-translated delivery is the version that
   * READS as fixed: the bell says the right thing and the thread it opens
   * does not.
   *
   * Both directions are asserted, and the Persian one is the load-bearing
   * half: a fix that hard-coded English would pass every English assertion
   * here and would be this same bug in a Persian-first product.
   */
  it("an ENGLISH reader's post-call brief is English — title, card and body", async () => {
    resetCapabilityCache();
    const { db, log } = fakeDb({ locale: "en" });
    await createSignalStep({ db }).handle(
      { event: "call.processed", callId: CALL, ownerId: OWNER, orgId: ORG, ruleId: "r1" } as never,
      { attempt: 1, log: quietLog },
    );
    const { sessionTitle, cardTitle, body } = delivered(log);
    expect(sessionTitle).toBe("Summary ready — “Weekly meeting with NAI”");
    expect(cardTitle).toBe("Summary ready — “Weekly meeting with NAI”");
    expect(body).toContain("has been processed");
    /* the screenshot's own question, asked of the row: is there Persian
       script in what an English organisation was handed? */
    for (const written of [sessionTitle, cardTitle, body]) {
      expect(String(written)).not.toMatch(PERSIAN);
    }
  });

  it("a PERSIAN reader's post-call brief is unchanged — the exact words that shipped", async () => {
    resetCapabilityCache();
    const { db, log } = fakeDb({ locale: "fa" });
    await createSignalStep({ db }).handle(
      { event: "call.processed", callId: CALL, ownerId: OWNER, orgId: ORG, ruleId: "r1" } as never,
      { attempt: 1, log: quietLog },
    );
    const { sessionTitle, cardTitle, body } = delivered(log);
    expect(sessionTitle).toBe("خلاصهٔ آمادهٔ «Weekly meeting with NAI»");
    expect(cardTitle).toBe("خلاصهٔ آمادهٔ «Weekly meeting with NAI»");
    expect(body).toContain("پردازش شد");
  });

  it("the weekly digest follows the reader too, both ways", async () => {
    resetCapabilityCache();
    const en = fakeDb({ locale: "en" });
    await createSignalStep({ db: en.db }).handle(
      { event: "cron.weekly", ownerId: OWNER, orgId: ORG, ruleId: "r1" } as never,
      { attempt: 1, log: quietLog },
    );
    expect(delivered(en.log).cardTitle).toBe("Weekly digest");

    resetCapabilityCache();
    const fa = fakeDb({ locale: "fa" });
    await createSignalStep({ db: fa.db }).handle(
      { event: "cron.weekly", ownerId: OWNER, orgId: ORG, ruleId: "r1" } as never,
      { attempt: 1, log: quietLog },
    );
    expect(delivered(fa.log).cardTitle).toBe("گزارش هفتگی");
  });

  it("a non-signal payload is dropped with a warning, not guessed at", async () => {
    resetCapabilityCache();
    const { db, log } = fakeDb();
    const step = createSignalStep({ db });
    await step.handle(
      { callId: "c", ownerId: OWNER } as never,
      { attempt: 1, log: quietLog },
    );
    expect(log.some((e) => e.sql.includes("agent_card"))).toBe(false);
    resetCapabilityCache();
  });
});
