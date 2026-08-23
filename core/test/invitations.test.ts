/**
 * Invitations (M24/D25) and true delete.
 *
 * The tests that matter here are about what the api REFUSES to distinguish.
 * `redeem_invitation` answers expired, revoked, used, unknown and
 * wrong-address identically, and the temptation to be helpful at this edge is
 * strong and wrong: the caller of a redeem endpoint is not necessarily the
 * invitee, so a differentiated refusal turns a forwarded link into an oracle
 * for which addresses were invited to which org.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConflictError, NotFoundError, ValidationError } from "../src/api/errors.ts";
import { createInvitationsRepo } from "../src/api/invitations.ts";
import { createDb, type SqlClient, type SqlTx } from "../src/db/identity.ts";
import type { Identity } from "../src/agent/types.ts";

const ADMIN: Identity = {
  userId: "11111111-1111-4111-8111-111111111111",
  orgId: "22222222-2222-4222-8222-222222222222",
  role: "admin",
  isActive: true,
};
const OWNER: Identity = { ...ADMIN, role: "owner" };
const OTHER = "33333333-3333-4333-8333-333333333333";

const ROW = {
  id: "44444444-4444-4444-8444-444444444444",
  email: "new@example.com", role: "member", token_prefix: "echo_inv_abc123",
  expires_at: new Date("2026-09-01T00:00:00Z"), redeemed_at: null, revoked_at: null,
  created_at: new Date("2026-08-13T00:00:00Z"),
};

function fakeDb(behaviour: (sql: string) => unknown[] = () => [ROW]) {
  const log: { sql: string; params?: unknown[] | undefined }[] = [];
  const make = (): SqlClient => ({
    async begin<T>(fn: (tx: SqlTx) => Promise<T>): Promise<T> {
      const tx = (async () => []) as unknown as SqlTx;
      (tx as unknown as { unsafe: SqlTx["unsafe"] }).unsafe = (async (sql: string, params?: unknown[]) => {
        log.push({ sql, params });
        if (sql.includes("set local") || sql.includes("set_config")) return [];
        return behaviour(sql);
      }) as SqlTx["unsafe"];
      return fn(tx);
    },
    async end() {},
  });
  return { db: createDb({ app: make(), agent: make() }), log };
}

const issued = (log: { sql: string; params?: unknown[] | undefined }[]) =>
  log.find((l) => l.sql.includes("insert into echo.invitation"))!;

describe("the invite token is show-once and hash-at-rest", () => {
  it("returns a token that was never sent to the database", async () => {
    const { db, log } = fakeDb();
    const invite = await createInvitationsRepo(db).issue(ADMIN, { email: "new@example.com" });
    const params = issued(log).params!;
    expect(invite.token).toMatch(/^echo_inv_/);
    // The raw token must appear in NO parameter. sha256 and a display prefix
    // are stored; the secret itself exists only in this response.
    expect(params.some((p) => p === invite.token)).toBe(false);
    expect(params.some((p) => typeof p === "string" && p.length === 64)).toBe(true);
  });

  it("uses a prefix distinct from an api key's", async () => {
    // Two token families in one product; if they shared a prefix, `isApiKey`
    // would claim invites and route them into gateway auth.
    const { db } = fakeDb();
    const invite = await createInvitationsRepo(db).issue(ADMIN, { email: "a@b.co" });
    expect(invite.token.startsWith("echo_sk_")).toBe(false);
  });

  it("stores a prefix short enough to be useless for redeeming", async () => {
    const { db } = fakeDb();
    const invite = await createInvitationsRepo(db).issue(ADMIN, { email: "a@b.co" });
    expect(invite.token_prefix.length).toBeLessThan(invite.token.length / 2);
  });
});

describe("the role ceiling is about who is asking", () => {
  it("refuses an admin inviting an admin", async () => {
    const { db } = fakeDb();
    await expect(createInvitationsRepo(db).issue(ADMIN, { email: "a@b.co", role: "admin" }))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it("allows an OWNER inviting an admin", async () => {
    const { db } = fakeDb();
    await expect(createInvitationsRepo(db).issue(OWNER, { email: "a@b.co", role: "admin" }))
      .resolves.toBeTruthy();
  });

  it("refuses everyone inviting an owner", async () => {
    // An org has exactly one, and it arrives by transfer. The database says
    // so too (invitation_role_not_owner); this says it in a sentence.
    const { db } = fakeDb();
    for (const who of [ADMIN, OWNER]) {
      await expect(createInvitationsRepo(db).issue(who, { email: "a@b.co", role: "owner" }))
        .rejects.toBeInstanceOf(ValidationError);
    }
  });

  it("maps a duplicate live invite to 409 with the way out", async () => {
    // Terms are immutable after issue, so "already invited" is a dead end
    // unless the message says revoke-then-reissue.
    const { db } = fakeDb(() => {
      throw Object.assign(new Error("dup"), {
        code: "23505", constraint_name: "invitation_one_live_per_email",
      });
    });
    const failure = await createInvitationsRepo(db).issue(ADMIN, { email: "a@b.co" })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ConflictError);
    expect((failure as Error).message).toMatch(/revoke/);
  });
});

describe("redeem refuses every failure the same way", () => {
  it.each([
    ["42501", "the policy or a guard refused"],
    ["23514", "a check constraint refused"],
    ["P0002", "no matching row"],
  ])("turns %s (%s) into one indistinguishable refusal", async (code) => {
    const { db } = fakeDb(() => {
      throw Object.assign(new Error("nope"), { code });
    });
    const failure = await createInvitationsRepo(db)
      .redeem(OTHER, { token: "echo_inv_x", email: "a@b.co" })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(NotFoundError);
    // One sentence for every cause. Expired, revoked, used, unknown and
    // wrong-address must not be tellable apart from outside.
    expect((failure as Error).message).toBe("this invitation cannot be redeemed");
  });

  it("gives the same refusal for a missing token as for a rejected one", async () => {
    const { db } = fakeDb(() => []);
    const failure = await createInvitationsRepo(db)
      .redeem(OTHER, { token: "", email: "a@b.co" })
      .catch((error: unknown) => error);
    expect((failure as Error).message).toBe("this invitation cannot be redeemed");
  });

  it("sends the HASH to the database, never the token", async () => {
    const { db, log } = fakeDb(() => [{ id: OTHER }]);
    await createInvitationsRepo(db).redeem(OTHER, { token: "echo_inv_secret", email: "a@b.co" });
    const call = log.find((l) => l.sql.includes("redeem_invitation"))!;
    expect(call.params?.[0]).not.toBe("echo_inv_secret");
    expect(String(call.params?.[0])).toHaveLength(64);
  });

  it("does not swallow an unrelated database error", async () => {
    const { db } = fakeDb(() => {
      throw Object.assign(new Error("boom"), { code: "40001" });
    });
    await expect(createInvitationsRepo(db).redeem(OTHER, { token: "t", email: "a@b.co" }))
      .rejects.toMatchObject({ code: "40001" });
  });
});

describe("true delete", () => {
  it("refuses an owner deleting themselves", async () => {
    // It would leave an org with no owner and no way to appoint one.
    const { db } = fakeDb(() => [{ tombstone_user: true }]);
    await expect(createInvitationsRepo(db).tombstone(OWNER, OWNER.userId, "دلیل آزمایشی"))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it("is idempotent — already tombstoned is not an error", async () => {
    const { db } = fakeDb(() => [{ tombstone_user: false }]);
    await expect(createInvitationsRepo(db).tombstone(OWNER, OTHER, "دلیل آزمایشی")).resolves.toBeUndefined();
  });

  it("turns a refusal into 404, not 500", async () => {
    const { db } = fakeDb(() => {
      throw Object.assign(new Error("no"), { code: "42501", routine: "exec_stmt_raise" });
    });
    await expect(createInvitationsRepo(db).tombstone(OWNER, OTHER, "دلیل آزمایشی"))
      .rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("the emailed invitation (db/0060's flow)", () => {
  const withFetch = (status: number) => {
    const spy = vi.fn((_url: string | URL, _init?: unknown) => Promise.resolve(new Response("{}", { status })));
    vi.stubGlobal("fetch", spy);
    return spy;
  };
  const CONFIG = { supabaseUrl: "https://project.supabase.co", serviceKey: "k" };

  afterEach(() => vi.unstubAllGlobals());

  it("sends the invite through the auth provider and says so", async () => {
    const { db } = fakeDb();
    const spy = withFetch(200);
    const invite = await createInvitationsRepo(db, CONFIG)
      .issue(ADMIN, { email: "new@example.com" });
    expect(invite.emailed).toBe(true);
    expect(invite.email_status).toBe("sent");
    expect(String(spy.mock.calls[0]![0])).toContain("/auth/v1/invite");
  });

  it("an EXISTING account gets the recovery email instead — GoTrue refuses to invite one, and nothing would land", async () => {
    const { db } = fakeDb();
    const spy = vi.fn((url: string | URL) =>
      Promise.resolve(new Response("{}", {
        status: String(url).includes("/recover") ? 200 : 422,
      })));
    vi.stubGlobal("fetch", spy);
    const invite = await createInvitationsRepo(db, CONFIG)
      .issue(ADMIN, { email: "new@example.com" });
    expect(invite.emailed).toBe(true);
    expect(invite.email_status).toBe("sent");
    expect(spy.mock.calls.some((c) => String(c[0]).includes("/auth/v1/recover"))).toBe(true);
  });

  it("names already_registered honestly only when the recovery fallback ALSO fails", async () => {
    const { db } = fakeDb();
    withFetch(422); // both the invite and the recover answer 422
    const invite = await createInvitationsRepo(db, CONFIG)
      .issue(ADMIN, { email: "new@example.com" });
    expect(invite.emailed).toBe(false);
    expect(invite.email_status).toBe("already_registered");
  });

  it("a failed send still mints the invitation — the token is the rescue", async () => {
    const { db } = fakeDb();
    withFetch(500);
    const invite = await createInvitationsRepo(db, CONFIG)
      .issue(ADMIN, { email: "new@example.com" });
    expect(invite.email_status).toBe("send_failed");
    expect(invite.token.startsWith("echo_inv_")).toBe(true);
  });

  it("an unconfigured deployment says so rather than pretending it sent", async () => {
    const { db } = fakeDb();
    const spy = withFetch(200);
    const invite = await createInvitationsRepo(db).issue(ADMIN, { email: "new@example.com" });
    expect(invite.email_status).toBe("unconfigured");
    expect(spy).not.toHaveBeenCalled();
  });
});
