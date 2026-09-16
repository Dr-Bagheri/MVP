import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAgentRuntime } from "../src/agent/runtime.ts";
import { createAgentRunStore } from "../src/agent/run-store.ts";
import type { Identity } from "../src/agent/types.ts";
import {
  assertOrgVerified, isOrgUnverifiedRefusal, orgIsVerified, OrgUnverifiedError,
} from "../src/agent/verification.ts";
import { mapError } from "../src/api/errors.ts";
import { createPlatformRepo } from "../src/api/platform.ts";
import { resolveIdentity } from "../src/db/actor.ts";
import { resetCapabilityCache } from "../src/db/capabilities.ts";
import { createDb, type SqlClient, type SqlTx } from "../src/db/identity.ts";

/**
 * db/0224 (M54) — A WORKSPACE IS VERIFIED BEFORE ITS AGENTS SPEND.
 *
 * The wall is the trigger; what this file pins is the shape core/ gives it:
 * the fact rides the identity, absent is not false, the runtime refuses
 * BEFORE a run is recorded, the store names the trigger's own refusal, and
 * the api maps it to a code a screen can turn into words. Every positive
 * case has its control beside it — a gate that refuses everyone satisfies
 * every "it refused" assertion in this file.
 */

const ALICE = "11111111-1111-4111-8111-111111111111";
const ORG = "0a000000-0000-4000-8000-00000000000a";

function fakeDb(opts: { columnPresent: boolean; orgVerified?: boolean | null | undefined }) {
  const log: { sql: string; params: unknown[] }[] = [];
  const make = (): SqlClient => ({
    async begin<T>(fn: (tx: SqlTx) => Promise<T>): Promise<T> {
      const tx = (async () => []) as unknown as SqlTx;
      (tx as unknown as { unsafe: SqlTx["unsafe"] }).unsafe = (async (sql: string, params?: unknown[]) => {
        log.push({ sql, params: params ?? [] });
        if (sql.includes("set local") || sql.includes("set_config")) return [];
        if (sql.includes("information_schema.columns")) return opts.columnPresent ? [{ present: 1 }] : [];
        if (sql.includes("from echo.app_user u") && sql.includes("left join echo.org o")) {
          return [{
            id: ALICE, org_id: ORG, role: "owner", status: "active", org_status: "active",
            ...(opts.orgVerified === undefined ? {} : { org_verified: opts.orgVerified }),
          }];
        }
        return [];
      }) as SqlTx["unsafe"];
      return fn(tx);
    },
    async end() {},
  });
  return { db: createDb({ app: make(), agent: make() }), log };
}

beforeEach(() => resetCapabilityCache());

describe("the fact rides the identity (db/actor.ts)", () => {
  it("an unverified workspace resolves with orgVerified: false", async () => {
    const { db, log } = fakeDb({ columnPresent: true, orgVerified: false });
    const identity = await resolveIdentity(db, ALICE);
    expect(identity.orgVerified).toBe(false);
    const read = log.find((l) => l.sql.includes("from echo.app_user u"));
    expect(read!.sql).toContain("(o.verified_at is not null) as org_verified");
  });

  it("a verified workspace resolves with orgVerified: true — the control", async () => {
    const { db } = fakeDb({ columnPresent: true, orgVerified: true });
    expect((await resolveIdentity(db, ALICE)).orgVerified).toBe(true);
  });

  it("before 0224 the column is not even selected, and the field stays ABSENT (never false)", async () => {
    const { db, log } = fakeDb({ columnPresent: false });
    const identity = await resolveIdentity(db, ALICE);
    expect("orgVerified" in identity).toBe(false);
    const read = log.find((l) => l.sql.includes("from echo.app_user u"));
    expect(read!.sql).not.toContain("verified_at");
  });

  it("a probe that says present over a row that omits the column stays absent (a stale fake is not a wall)", async () => {
    const { db } = fakeDb({ columnPresent: true });
    expect("orgVerified" in (await resolveIdentity(db, ALICE))).toBe(false);
  });
});

describe("absent is not false", () => {
  it("only an explicit false refuses", () => {
    expect(orgIsVerified({})).toBe(true);
    expect(orgIsVerified({ orgVerified: true })).toBe(true);
    expect(orgIsVerified({ orgVerified: false })).toBe(false);
    expect(() => assertOrgVerified({})).not.toThrow();
    expect(() => assertOrgVerified({ orgVerified: false })).toThrow(OrgUnverifiedError);
  });
});

describe("the runtime refuses BEFORE a run is recorded", () => {
  const runs = {
    begin: vi.fn(async () => "run-1"),
    appendStep: vi.fn(async () => undefined),
    finish: vi.fn(async () => undefined),
  };
  beforeEach(() => { runs.begin.mockClear(); });

  const ask = (identity: Identity) =>
    createAgentRuntime({ runs }).run({
      identity, kind: "assistant", input: "hi", provider: "openrouter", apiKey: "k",
    } as never);

  it("an unverified workspace: OrgUnverifiedError, and runs.begin was never called", async () => {
    await expect(ask({ userId: ALICE, orgId: ORG, role: "owner", isActive: true, orgVerified: false }))
      .rejects.toBeInstanceOf(OrgUnverifiedError);
    expect(runs.begin).not.toHaveBeenCalled();
  });

  it("the control: with the field absent the gate is passed (the run fails later, for its own reason)", async () => {
    let caught: unknown;
    try {
      await ask({ userId: ALICE, orgId: ORG, role: "owner", isActive: true });
    } catch (error) {
      caught = error;
    }
    expect(caught, "the fixture reaches past the gate and fails on something else").toBeDefined();
    expect(caught).not.toBeInstanceOf(OrgUnverifiedError);
  });
});

describe("the store names the trigger's own refusal", () => {
  const storeWith = (thrown: unknown) => {
    const make = (): SqlClient => ({
      async begin<T>(fn: (tx: SqlTx) => Promise<T>): Promise<T> {
        const tx = (async () => []) as unknown as SqlTx;
        (tx as unknown as { unsafe: SqlTx["unsafe"] }).unsafe = (async (sql: string) => {
          if (sql.includes("set local") || sql.includes("set_config")) return [];
          throw thrown;
        }) as SqlTx["unsafe"];
        return fn(tx);
      },
      async end() {},
    });
    const db = createDb({ app: make(), agent: make() });
    const identity: Identity = { userId: ALICE, orgId: ORG, role: "owner", isActive: true };
    return createAgentRunStore({ db, identity });
  };
  const run = { orgId: ORG, actorId: ALICE, callId: null, skillId: null, kind: "assistant" as const, model: "m", request: {} };

  it("42501 with HINT org_unverified becomes OrgUnverifiedError", async () => {
    const pg = Object.assign(new Error("this workspace is not verified yet"), { code: "42501", hint: "org_unverified" });
    expect(isOrgUnverifiedRefusal(pg)).toBe(true);
    await expect(storeWith(pg).begin(run)).rejects.toBeInstanceOf(OrgUnverifiedError);
  });

  it("the control: a bare 42501 is a miswired role and is rethrown as itself", async () => {
    const pg = Object.assign(new Error("permission denied"), { code: "42501" });
    expect(isOrgUnverifiedRefusal(pg)).toBe(false);
    await expect(storeWith(pg).begin(run)).rejects.toBe(pg);
  });
});

describe("the api maps it to a code the screen can turn into words", () => {
  it("403, kind forbidden, code org_unverified — no fourth kind on the wire", () => {
    const mapped = mapError(new OrgUnverifiedError());
    expect(mapped.status).toBe(403);
    expect(mapped.body.kind).toBe("forbidden");
    expect(mapped.body.code).toBe("org_unverified");
    expect(mapped.ours).toBe(false);
  });
});

describe("the console verifies through the door (platform repo)", () => {
  const ROOT: Identity = { userId: ALICE, orgId: ORG, role: "owner", isActive: true };
  const TARGET = "33333333-3333-4333-8333-333333333333";

  function repoWith(changed: boolean) {
    const log: { sql: string; params?: unknown[] | undefined }[] = [];
    const make = (): SqlClient => ({
      async begin<T>(fn: (tx: SqlTx) => Promise<T>): Promise<T> {
        const tx = (async () => []) as unknown as SqlTx;
        (tx as unknown as { unsafe: SqlTx["unsafe"] }).unsafe = (async (sql: string, params?: unknown[]) => {
          log.push({ sql, params });
          if (sql.includes("platform_set_org_verified")) return [{ changed }];
          return [];
        }) as SqlTx["unsafe"];
        return fn(tx);
      },
      async end() {},
    });
    return { repo: createPlatformRepo(createDb({ app: make(), agent: make() })), log };
  }

  it("hands the door the root, the org, the direction and the reason, and returns whether anything changed", async () => {
    const { repo, log } = repoWith(true);
    expect(await repo.setOrganizationVerified(ROOT, TARGET, true, "a real person — looked")).toBe(true);
    const call = log.find((l) => l.sql.includes("platform_set_org_verified"));
    expect(call!.params).toEqual([ALICE, TARGET, true, "a real person — looked"]);
  });

  it("a no-op comes back as false rather than as a second audit line", async () => {
    const { repo } = repoWith(false);
    expect(await repo.setOrganizationVerified(ROOT, TARGET, true, "again")).toBe(false);
  });
});
