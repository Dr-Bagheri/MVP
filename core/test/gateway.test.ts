/**
 * M17 gateway: per-org keys and webhooks.
 *
 * The load-bearing property is that a key is NOT a bypass — it names a member
 * and the request proceeds as that member, through the same wall. Most of
 * this file exists to hold that, plus the secret-handling rules (token shown
 * once, hashed before it reaches the database, absent from every listing).
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  assistantAllowed, createApiKeysRepo, hashToken, identityFromApiKey, isApiKey,
  KEY_PREFIX, safeEqual,
} from "../src/api/apikeys.ts";
import { mapError, pgErrorFields, UnauthenticatedError, ValidationError } from "../src/api/errors.ts";
import {
  createWebhooksRepo, signPayload, verifySignature, WEBHOOK_EVENTS,
} from "../src/api/webhooks.ts";
import { createDb, type SqlClient, type SqlTx } from "../src/db/identity.ts";
import type { Identity } from "../src/agent/types.ts";

const ADMIN = "11111111-1111-4111-8111-111111111111";
const MEMBER = "22222222-2222-4222-8222-222222222222";
/* the uuid an escalation would name: same org, higher rank */
const OWNER = "33333333-3333-4333-8333-333333333333";
const KEY_ID = "44444444-4444-4444-8444-444444444444";
const IDENTITY: Identity = { userId: ADMIN, orgId: "org-a", role: "admin", isActive: true };

function fakeDb(rowsFor: (sql: string, params?: unknown[]) => unknown[]) {
  const log: { sql: string; params?: unknown[] | undefined }[] = [];
  const make = (): SqlClient => ({
    async begin<T>(fn: (tx: SqlTx) => Promise<T>): Promise<T> {
      const tx = (async () => []) as unknown as SqlTx;
      (tx as unknown as { unsafe: SqlTx["unsafe"] }).unsafe = (async (sql: string, params?: unknown[]) => {
        log.push({ sql, params });
        return rowsFor(sql, params) as never[];
      }) as SqlTx["unsafe"];
      return fn(tx);
    },
    async end() {},
  });
  return { log, db: createDb({ app: make(), agent: make() }) };
}

const keyRow = (over: Record<string, unknown> = {}) => ({
  id: KEY_ID, name: "zapier", token_prefix: `${KEY_PREFIX}abc123`, actor_id: ADMIN,
  allow_assistant: false, last_used_at: null, expires_at: null, revoked_at: null,
  created_at: "2026-08-12T09:00:00.000Z", ...over,
});

const userRow = (over: Record<string, unknown> = {}) => ({
  id: MEMBER, org_id: "org-a", role: "member", status: "active", org_status: "active", ...over,
});

describe("a key names a member — it is not an org-wide bypass", () => {
  it("resolves through the DB resolver and then re-derives membership", async () => {
    const { db, log } = fakeDb((sql) => {
      if (sql.includes("resolve_api_key")) return [{ actor_id: MEMBER }];
      if (sql.includes("app_user")) return [userRow()];
      return [];
    });
    const identity = await identityFromApiKey(db, `${KEY_PREFIX}whatever`);
    // the identity is the MEMBER's, with the member's own role — not admin,
    // not "the org". `viaApiKey` marks how it arrived; it grants nothing.
    expect(identity).toEqual({
      userId: MEMBER, orgId: "org-a", role: "member", isActive: true,
      viaApiKey: true, allowAssistant: false,
    });
    // and membership came from app_user, not from the resolver's org_id
    expect(log.some((l) => l.sql.includes("app_user"))).toBe(true);
  });

  it("carries the member's OWN role, so a key cannot outrank its owner", async () => {
    const { db } = fakeDb((sql) => {
      if (sql.includes("resolve_api_key")) return [{ actor_id: MEMBER }];
      if (sql.includes("app_user")) return [userRow({ role: "member" })];
      return [];
    });
    expect((await identityFromApiKey(db, `${KEY_PREFIX}x`)).role).toBe("member");
  });

  it("inherits the member's suspension — a disabled employee's integration stops", async () => {
    const { db } = fakeDb((sql) => {
      if (sql.includes("resolve_api_key")) return [{ actor_id: MEMBER }];
      if (sql.includes("app_user")) return [userRow({ status: "pending" })];
      return [];
    });
    // isActive:false → requireActive refuses it, same as a browser session
    expect((await identityFromApiKey(db, `${KEY_PREFIX}x`)).isActive).toBe(false);
  });

  it("gives ONE answer for unknown, revoked, expired and disabled", async () => {
    // db/0015's resolver returns no row for all four. Distinguishing them
    // here would make this an oracle for which keys exist.
    const { db } = fakeDb(() => []);
    await expect(identityFromApiKey(db, `${KEY_PREFIX}x`)).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(identityFromApiKey(db, `${KEY_PREFIX}x`)).rejects.toThrow("invalid api key");
  });

  it("refuses anything that is not key-shaped rather than guessing", async () => {
    const { db, log } = fakeDb(() => []);
    await expect(identityFromApiKey(db, "eyJhbGciOi.body.sig")).rejects.toBeInstanceOf(UnauthenticatedError);
    expect(log).toHaveLength(0);
    expect(isApiKey(`${KEY_PREFIX}x`)).toBe(true);
    expect(isApiKey("eyJhbGciOi.body.sig")).toBe(false);
  });
});

describe("assistant access is per key, admin-granted, closed by default (M17 amendment)", () => {
  const resolving = (over: Record<string, unknown>) => (sql: string) => {
    if (sql.includes("resolve_api_key")) return [{ actor_id: MEMBER, ...over }];
    if (sql.includes("app_user")) return [userRow()];
    return [];
  };

  it("takes the flag FROM THE RESOLUTION, not from a later read", async () => {
    // A post-resolution `select allow_assistant from echo.api_key` returns
    // ZERO rows — that table needs an active admin and there is no identity
    // at this point — which reads as false and is indistinguishable from a
    // correctly-closed key. A check that can only fail closed by accident is
    // not a check.
    const { db, log } = fakeDb(resolving({ allow_assistant: true }));
    const identity = await identityFromApiKey(db, `${KEY_PREFIX}x`);
    expect(assistantAllowed(identity)).toBe(true);
    const resolve = log.find((l) => l.sql.includes("resolve_api_key"))!;
    expect(resolve.sql).toContain("allow_assistant");
    // and no separate read of echo.api_key happened
    expect(log.some((l) => l.sql.includes("from echo.api_key"))).toBe(false);
  });

  it("is closed when the flag is false, null, or missing entirely", async () => {
    for (const value of [{ allow_assistant: false }, { allow_assistant: null }, {}]) {
      const { db } = fakeDb(resolving(value));
      const identity = await identityFromApiKey(db, `${KEY_PREFIX}x`);
      expect(assistantAllowed(identity), JSON.stringify(value)).toBe(false);
    }
  });

  it("does not restrict a browser session, which has no such flag", async () => {
    // `allowAssistant === undefined` on a session must never read as a
    // restriction — the assistant IS the product for a signed-in person.
    expect(assistantAllowed(IDENTITY)).toBe(true);
    expect(assistantAllowed({ ...IDENTITY, role: "member" })).toBe(true);
  });

  it("is scope, not throttle: a closed key still reads normally", async () => {
    const { db } = fakeDb(resolving({ allow_assistant: false }));
    const identity = await identityFromApiKey(db, `${KEY_PREFIX}x`);
    expect(identity.isActive).toBe(true);   // the key works; only the assistant is closed
  });
});

describe("the token never reaches the database", () => {
  it("sends the sha256, not the token", async () => {
    const token = `${KEY_PREFIX}super-secret`;
    const { db, log } = fakeDb((sql) => (sql.includes("resolve_api_key") ? [{ actor_id: MEMBER }] : [userRow()]));
    await identityFromApiKey(db, token);
    const call = log.find((l) => l.sql.includes("resolve_api_key"))!;
    expect(call.params?.[0]).toBe(createHash("sha256").update(token, "utf8").digest("hex"));
    expect(JSON.stringify(log)).not.toContain("super-secret");
  });

  it("stores a hash and a display prefix, never the token", async () => {
    const { db, log } = fakeDb(() => [keyRow()]);
    const minted = await createApiKeysRepo(db).create(IDENTITY, { name: "zapier" });

    expect(minted.token.startsWith(KEY_PREFIX)).toBe(true);
    const insert = log.find((l) => l.sql.includes("insert into echo.api_key"))!;
    expect(insert.params).toContain(hashToken(minted.token));
    // the token itself appears in NO parameter
    expect(insert.params?.some((p) => p === minted.token)).toBe(false);
    // the stored prefix is a fragment, not the secret
    expect(minted.token.startsWith(insert.params?.[4] as string)).toBe(true);
    expect((insert.params?.[4] as string).length).toBeLessThan(minted.token.length);
  });

  it("mints a distinct token every time", async () => {
    const { db } = fakeDb(() => [keyRow()]);
    const repo = createApiKeysRepo(db);
    const a = await repo.create(IDENTITY, { name: "a" });
    const b = await repo.create(IDENTITY, { name: "b" });
    expect(a.token).not.toBe(b.token);
    expect(hashToken(a.token)).not.toBe(hashToken(b.token));
  });

  it("never returns a token or a hash from the listing", async () => {
    const { db } = fakeDb(() => [keyRow()]);
    const [record] = await createApiKeysRepo(db).list(IDENTITY);
    expect(record).not.toHaveProperty("token");
    expect(record).not.toHaveProperty("token_sha256");
    expect(record!.token_prefix).toBe(`${KEY_PREFIX}abc123`);
  });
});

describe("key lifecycle", () => {
  it("defaults the acting member to the creating admin", async () => {
    const { db, log } = fakeDb(() => [keyRow()]);
    await createApiKeysRepo(db).create(IDENTITY, { name: "zapier" });
    expect((log.find((l) => l.sql.includes("insert"))!.params)?.[1]).toBe(ADMIN);
  });

  it("accepts another member as the actor when the minter OUTRANKS them", async () => {
    /* the useful case: a service integration acting as a dedicated account */
    const { db, log } = fakeDb((sql) =>
      sql.includes("actor_outranks") ? [{ outranks: true }] : [keyRow({ actor_id: MEMBER })]);
    await createApiKeysRepo(db).create(IDENTITY, { name: "svc", actorId: MEMBER });
    expect((log.find((l) => l.sql.includes("insert"))!.params)?.[1]).toBe(MEMBER);
  });

  it("REFUSES a key that names someone the minter does not outrank", async () => {
    /*
     * The escalation (2026-08-29 audit, S1): the bound used to be db/0009's
     * composite FK alone, and the reasoning written beside it was that the FK
     * "refuses an actor from another org, so an admin cannot mint a key
     * borrowing a stranger's authority". Same-org is not not-a-stranger — the
     * OWNER is in the same org — so an admin could mint a key naming the
     * owner and hold owner authority permanently.
     *
     * The load-bearing half is the second assertion: no insert. A refusal
     * that still wrote the row would read as a fix and mint the key anyway.
     */
    const { db, log } = fakeDb((sql) =>
      sql.includes("actor_outranks") ? [{ outranks: false }] : [keyRow()]);
    await expect(createApiKeysRepo(db).create(IDENTITY, { name: "x", actorId: OWNER }))
      .rejects.toBeInstanceOf(ValidationError);
    expect(log.find((l) => l.sql.includes("insert"))).toBeUndefined();
  });

  it("validates the actor id before it reaches SQL", async () => {
    const { db, log } = fakeDb(() => []);
    await expect(createApiKeysRepo(db).create(IDENTITY, { name: "x", actorId: "'; drop --" }))
      .rejects.toThrow(/invalid actor id/);
    expect(log).toHaveLength(0);
  });

  it("refuses an empty name and a malformed expiry", async () => {
    const { db } = fakeDb(() => [keyRow()]);
    const repo = createApiKeysRepo(db);
    await expect(repo.create(IDENTITY, { name: "  " })).rejects.toBeInstanceOf(ValidationError);
    await expect(repo.create(IDENTITY, { name: "x", expiresAt: "soon" }))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it("mints closed unless the admin explicitly opens it", async () => {
    const { db, log } = fakeDb(() => [keyRow()]);
    const repo = createApiKeysRepo(db);
    await repo.create(IDENTITY, { name: "reader" });
    // param 6 is allow_assistant
    expect((log.find((l) => l.sql.includes("insert"))!.params)?.[6]).toBe(false);

    await repo.create(IDENTITY, { name: "writer", allowAssistant: true });
    expect((log.filter((l) => l.sql.includes("insert"))[1]!.params)?.[6]).toBe(true);
  });

  it("has NO way to change a key's capability after minting", async () => {
    // Deliberate: a key's capabilities are a property of the issued
    // credential, like its actor. An integration deployed with a read-only
    // key must not silently gain the ability to spend because someone
    // flipped a toggle. Changing what a key may do = revoke and mint.
    const repo = createApiKeysRepo(fakeDb(() => []).db);
    expect(Object.keys(repo).sort()).toEqual(["create", "list", "revoke"]);
  });

  it("revokes with a stamp, never a DELETE", async () => {
    const { db, log } = fakeDb(() => [{ id: KEY_ID }]);
    await createApiKeysRepo(db).revoke(IDENTITY, KEY_ID);
    const statement = log.find((l) => l.sql.includes("echo.api_key"))!;
    expect(statement.sql).toContain("set revoked_at = now()");
    expect(statement.sql).not.toMatch(/\bdelete\s+from\b/i);
    expect(statement.params).toEqual([KEY_ID, ADMIN]);
  });

  it("reports re-revoking as 404 rather than a silent success", async () => {
    const { db } = fakeDb(() => []);
    await expect(createApiKeysRepo(db).revoke(IDENTITY, KEY_ID)).rejects.toThrow(/not found/);
  });
});

/**
 * The idle-in-transaction reaper (db/0053) must arrive as a NAMED diagnosis.
 *
 * I objected to a role-wide timeout on the grounds that it could silently
 * abort a live api transaction. The steward's answer was that the objection
 * was about SILENCE rather than the timeout, and that closing it was my half
 * of the work — so these pin that half: the reap is ours, it is loud, and it
 * says what happened instead of leaving someone to look up 25P03 at 3am.
 */
describe("the idle-in-transaction reap names itself", () => {
  it.each(["25P03", "57P01"])("maps %s to a loud 500 carrying a diagnosis", (code) => {
    const mapped = mapError(Object.assign(new Error("terminated"), { code }));
    expect(mapped.status).toBe(500);
    expect(mapped.ours).toBe(true);
    expect(mapped.diagnosis).toMatch(/idle-in-transaction/);
  });

  it("keeps the diagnosis OUT of the response body", () => {
    // An operational note for us. A caller learns nothing about our
    // connection handling from a 500, and should not.
    const mapped = mapError(Object.assign(new Error("terminated"), { code: "25P03" }));
    expect(JSON.stringify(mapped.body)).not.toMatch(/idle|transaction|handler/);
  });

  it("does not label unrelated database errors with it", () => {
    // A diagnosis that attaches to everything explains nothing.
    const mapped = mapError(Object.assign(new Error("boom"), { code: "40001" }));
    expect(mapped.diagnosis).toBeUndefined();
  });
});

describe("a database failure is logged by field, never by message", () => {
  it("keeps schema identifiers and drops message and detail", () => {
    // `detail` is where Postgres quotes the offending row back — for this
    // product that can be transcript text, which makes the most-logged
    // object also the most dangerous one (steward-ratified convention).
    const pgError = Object.assign(new Error("duplicate key value violates unique constraint"), {
      code: "23505",
      constraint_name: "transcript_segment_call_seq_key",
      table_name: "transcript_segment",
      schema_name: "echo",
      severity: "ERROR",
      detail: "Key (call_id, seq)=(c1, 3) already exists.",
    });

    const fields = pgErrorFields(pgError)!;
    expect(fields).toEqual({
      code: "23505",
      constraint_name: "transcript_segment_call_seq_key",
      table_name: "transcript_segment",
      schema_name: "echo",
      severity: "ERROR",
    });
    // asserted positively on the whole object above, so nothing can sneak in;
    // named here too because these two are the point of the rule
    expect(Object.keys(fields)).not.toContain("detail");
    expect(Object.keys(fields)).not.toContain("message");
  });

  it("maps an RLS row-policy refusal to 404, but a GRANT refusal to 500", () => {
    // Two 42501s with opposite meanings. A WITH CHECK refusal is "not your
    // row" and must answer like every other invisible row, or the difference
    // between 500 and 404 tells a caller which rows exist. A grant refusal is
    // OUR wiring being wrong — the run-store-on-the-app-role shape — and has
    // to stay loud.
    const rowPolicy = Object.assign(new Error("new row violates row-level security policy"), {
      code: "42501", routine: "ExecWithCheckOptions",
    });
    expect(mapError(rowPolicy)).toMatchObject({
      status: 404, ours: false, body: { kind: "not_found" },
    });

    const grant = Object.assign(new Error("permission denied for table transcript_segment"), {
      code: "42501", routine: "aclcheck_error",
    });
    expect(mapError(grant)).toMatchObject({ status: 500, ours: true });
  });

  it("maps a client's malformed request to its own status, not 500", () => {
    // Fastify's parser errors carry a real statusCode and are the CALLER's
    // mistake. Found by POSTing to a no-body route with a JSON content-type —
    // what every HTTP client does by default — and getting a 500.
    const badBody = Object.assign(new Error("invalid json body"), { statusCode: 400 });
    expect(mapError(badBody)).toMatchObject({ status: 400, ours: false });
  });

  it("returns nothing for an error that is not from the database", () => {
    expect(pgErrorFields(new Error("plain"))).toBeUndefined();
    expect(pgErrorFields(null)).toBeUndefined();
    expect(pgErrorFields("boom")).toBeUndefined();
  });
});

describe("webhook signatures", () => {
  const SECRET = "whsec_test";
  const BODY = JSON.stringify({ event: "call.summarized", call_id: "c1" });

  it("round-trips a signature the documented way", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(verifySignature(SECRET, BODY, now, signPayload(SECRET, BODY, now))).toBe(true);
  });

  it("SIGNS the timestamp, so a captured delivery cannot be replayed forever", () => {
    // The timestamp is inside the signed string, not merely beside it —
    // otherwise a signature stays valid indefinitely and an attacker replays
    // an old body with a fresh timestamp.
    const now = Math.floor(Date.now() / 1000);
    const signature = signPayload(SECRET, BODY, now);
    expect(signPayload(SECRET, BODY, now + 1)).not.toBe(signature);
    // stale beyond tolerance → refused even though the mac is genuine
    expect(verifySignature(SECRET, BODY, now - 3_600, signature)).toBe(false);
  });

  it("refuses a tampered body and a wrong secret", () => {
    const now = Math.floor(Date.now() / 1000);
    const signature = signPayload(SECRET, BODY, now);
    expect(verifySignature(SECRET, `${BODY} `, now, signature)).toBe(false);
    expect(verifySignature("whsec_other", BODY, now, signature)).toBe(false);
  });

  it("compares in constant time, and unequal lengths are not an error", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

describe("webhooks carry identifiers, never content", () => {
  const hookRow = (over: Record<string, unknown> = {}) => ({
    id: "55555555-5555-4555-8555-555555555555",
    url: "https://example.com/hook", events: ["call.summarized"],
    enabled: true, created_at: "2026-08-12T09:00:00.000Z", ...over,
  });

  it("does not select the payload column in the delivery listing", async () => {
    // payload holds only identifiers by construction (db/0009), but an
    // endpoint that returns it invites someone to start putting more in it.
    const { db, log } = fakeDb(() => []);
    await createWebhooksRepo(db).deliveries(IDENTITY);
    const query = log.find((l) => l.sql.includes("webhook_delivery"))!;
    expect(query.sql).not.toContain("payload");
    expect(query.sql).toContain("response_code");
  });

  it("requires https and rejects an unknown event by name", async () => {
    const { db } = fakeDb(() => [hookRow()]);
    const repo = createWebhooksRepo(db);
    await expect(repo.create(IDENTITY, { url: "http://x.test", events: ["call.created"] }))
      .rejects.toThrow(/https/);
    await expect(repo.create(IDENTITY, { url: "https://x.test", events: [] }))
      .rejects.toThrow(/at least one event/);
    // named, so an integrator does not silently subscribe to nothing
    await expect(repo.create(IDENTITY, { url: "https://x.test", events: ["call.finished"] }))
      .rejects.toThrow(/call\.finished/);
  });

  it("returns the signing secret once and stores only a derivative", async () => {
    const { db, log } = fakeDb(() => [hookRow()]);
    const minted = await createWebhooksRepo(db).create(IDENTITY, {
      url: "https://x.test", events: ["call.summarized"],
    });
    expect(minted.secret.startsWith("whsec_")).toBe(true);
    const insert = log.find((l) => l.sql.includes("insert into echo.webhook"))!;
    expect(insert.params?.some((p) => p === minted.secret)).toBe(false);
  });

  it("disables instead of deleting, keeping the delivery history readable", async () => {
    const { db, log } = fakeDb(() => [hookRow({ enabled: false })]);
    const record = await createWebhooksRepo(db).setEnabled(IDENTITY, hookRow().id as string, false);
    expect(record.enabled).toBe(false);
    expect(log.find((l) => l.sql.includes("echo.webhook"))!.sql).not.toMatch(/\bdelete\s+from\b/i);
  });

  it("publishes a closed event set", () => {
    expect([...WEBHOOK_EVENTS]).toEqual([
      "call.created", "call.transcribed", "call.summarized", "call.failed",
    ]);
  });
});
