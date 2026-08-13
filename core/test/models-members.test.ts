/**
 * The two SPEC surfaces that were missing when the frontend went looking:
 * the model catalogue (M5) and the members / pending-approval queue (M15).
 *
 * Both are thin over RLS on purpose; what's tested here is the handful of
 * decisions the app layer actually owns — what an empty allow-list means,
 * what a null preference means, and the two self-inflicted admin footguns.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/agent/pi.ts", () => ({
  // A stand-in catalogue: the real one is 335 models and its CONTENT is not
  // what these assertions are about. The shape is real.
  // Includes an excluded provider ON PURPOSE: the exclusion tests need the
  // upstream catalogue to contain what the product must refuse to serve, or
  // they would pass against a list that never had one.
  catalogue: () => [
    { id: "google/gemini-3.6-flash", name: "Gemini 3.6 Flash", reasoning: true },
    { id: "anthropic/claude-opus-5", name: "Claude Opus 5", reasoning: false },
    { id: "anthropic/claude-3-haiku", name: "Claude 3 Haiku", reasoning: false },
    { id: "openai/gpt-5", name: "GPT-5", reasoning: false },
  ],
  Type: {},
}));

const { createModelsRepo, SUGGESTED_MODELS } = await import("../src/api/models.ts");
const { toolCapability, resetCapabilityCache } = await import("../src/api/model-capability.ts");
const { createMembersRepo } = await import("../src/api/members.ts");
import { ConflictError, NotFoundError, ValidationError } from "../src/api/errors.ts";
import { createDb, type SqlClient, type SqlTx } from "../src/db/identity.ts";
import type { Identity } from "../src/agent/types.ts";

/** Injected so no unit test reaches OpenRouter. */
const capable = (ids: string[]) => async () => ({ toolCapable: new Set(ids), known: true });
const unknown = async () => ({ toolCapable: new Set<string>(), known: false });

const ADMIN = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ADMIN_ID: Identity = { userId: ADMIN, orgId: "org-a", role: "admin", isActive: true };

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

describe("model catalogue (M5)", () => {
  it("an EMPTY allow-list means the whole catalogue, not none of it", async () => {
    // db/0002: "Empty array = admin has not curated". Reading it as "nothing
    // is permitted" would leave every new org unable to pick any model.
    const { db } = fakeDb(() => [{ allowed_models: [], preferred_model: null }]);
    const result = await createModelsRepo(db).list(ADMIN_ID);
    // 2, not 4: the mocked catalogue holds two excluded providers, and M5's
    // exclusion applies before anything else. "Whole catalogue" means the
    // whole OFFERED catalogue.
    expect(result.models).toHaveLength(2);
    expect(result.curated).toBe(false);
  });

  it("a curated allow-list filters, and says it is curated", async () => {
    // A permitted provider: an admin's allow-list narrows what is offered,
    // and cannot widen it past M5's exclusion (asserted separately).
    const { db } = fakeDb(() => [{
      allowed_models: ["openai/gpt-5"], preferred_model: null,
    }]);
    const result = await createModelsRepo(db).list(ADMIN_ID);
    expect(result.models.map((m) => m.id)).toEqual(["openai/gpt-5"]);
    expect(result.curated).toBe(true);
  });

  it("marks the caller's own choice and imposes no default", async () => {
    const { db } = fakeDb(() => [{ allowed_models: [], preferred_model: "openai/gpt-5" }]);
    const result = await createModelsRepo(db).list(ADMIN_ID);
    expect(result.models.filter((m) => m.selected).map((m) => m.id)).toEqual(["openai/gpt-5"]);

    const { db: none } = fakeDb(() => [{ allowed_models: [], preferred_model: null }]);
    const unset = await createModelsRepo(none).list(ADMIN_ID);
    // M5: null is a real state — "has not chosen" — not a hole to fill
    expect(unset.preferred_model).toBeNull();
    expect(unset.models.some((m) => m.selected)).toBe(false);
  });

  it("filters out models that cannot call tools, and says it filtered", async () => {
    // SPEC: models that cannot call tools are not selectable. Enforced from
    // OpenRouter's supported_parameters, never from a name heuristic.
    const { db } = fakeDb(() => [{ allowed_models: [], preferred_model: null }]);
    const result = await createModelsRepo(db, { capability: capable(["openai/gpt-5"]) })
      .list(ADMIN_ID);
    expect(result.models.map((m) => m.id)).toEqual(["openai/gpt-5"]);
    expect(result.tool_capability_filtered).toBe(true);
    expect(result.models[0]!.tools).toBe(true);
  });

  it("filters NOTHING when the capability catalogue is unreachable, and says so", async () => {
    // The deviation from a literal "unknown = not capable": applied to a
    // FETCH FAILURE it empties the picker, telling every user they have no
    // models — a false statement about their account caused by someone
    // else's outage. An unfiltered list LABELLED unfiltered is honest; an
    // empty one implying "you have none" is not.
    const { db } = fakeDb(() => [{ allowed_models: [], preferred_model: null }]);
    const result = await createModelsRepo(db, { capability: unknown }).list(ADMIN_ID);
    // "nothing" means no CAPABILITY filtering — M5's exclusion still applies,
    // because it is a product rule rather than a fact about a provider we
    // failed to look up.
    expect(result.models).toHaveLength(2);
    expect(result.tool_capability_filtered).toBe(false);
    // and no per-model claim is made either — absent, not false
    expect(result.models[0]).not.toHaveProperty("tools");
  });

  it("serves the last CHECKED map through an outage, labelled stale", async () => {
    // Stale-but-checked beats unchecked: "these accepted tools an hour ago"
    // is real information; an unfiltered list is the absence of any. This
    // shrinks the unfiltered case to a cold start during an outage, which is
    // what keeps the honest `false` rare enough to mean something.
    resetCapabilityCache();
    let fail = false;
    const flaky = async () => new Response(JSON.stringify(
      fail ? {} : { data: [{ id: "openai/gpt-5", supported_parameters: ["tools"] }] },
    ), { status: fail ? 500 : 200 });

    const first = await toolCapability({ fetchImpl: flaky as unknown as typeof fetch, now: 0 });
    expect(first.known).toBe(true);
    expect(first.stale).toBeUndefined();

    fail = true;
    // `now` past the TTL so it actually re-fetches and actually fails
    const second = await toolCapability({ fetchImpl: flaky as unknown as typeof fetch, now: 9_000_000 });
    expect(second.known).toBe(true);          // still checked data…
    expect(second.stale).toBe(true);          // …and honest that it is old
    expect([...second.toolCapable]).toEqual(["openai/gpt-5"]);
    resetCapabilityCache();
  });

  it("is unknown only on a COLD start during an outage", async () => {
    resetCapabilityCache();
    const dead = async () => { throw new Error("unreachable"); };
    const result = await toolCapability({ fetchImpl: dead as unknown as typeof fetch, now: 0 });
    expect(result.known).toBe(false);
    expect(result.toolCapable.size).toBe(0);
    resetCapabilityCache();
  });

  it("refuses a KNOWN-incapable model, and allows one it could not check", async () => {
    const { db } = fakeDb(() => [{ preferred_model: "openai/gpt-5" }]);
    // A PERMITTED model that simply cannot call tools — using an excluded one
    // here would pass on the wrong rule and prove nothing about capability.
    await expect(
      createModelsRepo(db, { capability: capable(["openai/gpt-5"]) })
        .choose(ADMIN_ID, "google/gemini-3.6-flash"),
    ).rejects.toThrow(/cannot call tools/);

    // unreachable catalogue must not block a legitimate choice
    await expect(
      createModelsRepo(db, { capability: unknown }).choose(ADMIN_ID, "google/gemini-3.6-flash"),
    ).resolves.toBeDefined();
  });

  describe("M5's provider exclusion — negative space", () => {
    /**
     * The user directive is "definitely not Claude". It was decided, recorded,
     * and existed in NO CODE: the live catalogue served **28 `anthropic/*`
     * models** and my own suggestion ranking named two of them. Everyone
     * believed the filter existed because it had been described.
     *
     * So these assert the ABSENCE, the way Backend 3 forbade a call-level
     * timing column — a future catalogue addition cannot quietly reintroduce
     * one, because the test is about what must never appear rather than about
     * what happens to be there today.
     */
    const withClaude = () => [
      { id: "google/gemini-3.6-flash", name: "G", reasoning: true },
      { id: "anthropic/claude-opus-5", name: "C", reasoning: false },
      { id: "anthropic/claude-3-haiku", name: "H", reasoning: false },
      { id: "openai/gpt-5", name: "O", reasoning: false },
    ];

    it("serves no excluded provider, ever", async () => {
      const { db } = fakeDb(() => [{ allowed_models: [], preferred_model: null }]);
      const result = await createModelsRepo(db, {
        capability: capable(withClaude().map((m) => m.id)),
      }).list(ADMIN_ID);
      expect(result.models.filter((m) => m.id.startsWith("anthropic/"))).toEqual([]);
    });

    it("cannot be re-admitted by an admin's allow-list", async () => {
      // A rule any later filter could undo is not a rule. An admin naming a
      // barred model explicitly must not get it back.
      const { db } = fakeDb(() => [{
        allowed_models: ["anthropic/claude-opus-5", "openai/gpt-5"],
        preferred_model: null,
      }]);
      const result = await createModelsRepo(db, {
        capability: capable(withClaude().map((m) => m.id)),
      }).list(ADMIN_ID);
      expect(result.models.map((m) => m.id)).toEqual(["openai/gpt-5"]);
    });

    it("cannot be CHOSEN by name either", async () => {
      // Hiding it is not enough: `preferred_model` is read on every assistant
      // turn, so a barred model merely absent from the list would still run.
      const { db } = fakeDb(() => [{ preferred_model: null }]);
      await expect(
        createModelsRepo(db, { capability: capable(["anthropic/claude-opus-5"]) })
          .choose(ADMIN_ID, "anthropic/claude-opus-5"),
      ).rejects.toThrow(/not available on this product/);
    });

    it("is not named by the suggestion ranking", async () => {
      // The ranking recommended two of them. A suggestion list must never
      // name what the catalogue excludes.
      expect(SUGGESTED_MODELS.filter((id) => id.startsWith("anthropic/"))).toEqual([]);
    });
  });

  it("refuses a model id that is not in the catalogue", async () => {
    // stored happily, it would fail at generation time far from the mistake
    const { db, log } = fakeDb(() => []);
    await expect(createModelsRepo(db).choose(ADMIN_ID, "made/up-model"))
      .rejects.toBeInstanceOf(ValidationError);
    expect(log).toHaveLength(0);
  });

  it("accepts null as a deliberate 'no preference'", async () => {
    const { db, log } = fakeDb(() => [{ preferred_model: null }]);
    expect(await createModelsRepo(db).choose(ADMIN_ID, null)).toEqual({ preferred_model: null });
    expect(log.find((l) => l.sql.includes("update"))!.params).toEqual([ADMIN, null]);
  });

  it("writes only the CALLER's row — the pick is the person's own (M5)", async () => {
    const { db, log } = fakeDb(() => [{ preferred_model: "openai/gpt-5" }]);
    await createModelsRepo(db).choose(ADMIN_ID, "openai/gpt-5");
    expect(log.find((l) => l.sql.includes("update"))!.params?.[0]).toBe(ADMIN);
  });
});

describe("members and the pending queue (M15)", () => {
  const memberRow = (over: Record<string, unknown> = {}) => ({
    id: OTHER, email: "someone@example.test", display_name: "کاربر",
    role: "member", status: "pending", accepted_at: null,
    last_seen_at: null, created_at: "2026-08-12T09:00:00.000Z", ...over,
  });

  it("puts pending people FIRST — the queue is why the screen exists", async () => {
    const { db, log } = fakeDb(() => [memberRow()]);
    await createMembersRepo(db).list(ADMIN_ID);
    expect(log.find((l) => l.sql.includes("app_user"))!.sql)
      .toContain("order by (status = 'pending') desc");
  });

  it("accepts a pending signup without writing accepted_at itself", async () => {
    // db/0011's trigger stamps accepted_at/accepted_by — one writer for that
    // fact, so the audit of who accepted whom cannot be forged from here.
    const { db, log } = fakeDb(() => [memberRow({ status: "active" })]);
    const member = await createMembersRepo(db).accept(ADMIN_ID, OTHER);
    expect(member.status).toBe("active");
    const update = log.find((l) => l.sql.includes("update echo.app_user"))!;
    expect(update.sql).toContain("status = 'active'");
    expect(update.sql).not.toContain("accepted_at =");
    expect(update.sql).not.toContain("accepted_by =");
  });

  it("reports accepting a non-pending member as 404, not a silent success", async () => {
    const { db } = fakeDb(() => []);
    await expect(createMembersRepo(db).accept(ADMIN_ID, OTHER))
      .rejects.toBeInstanceOf(NotFoundError);
  });

  it("refuses to let an admin strand the org without an admin", async () => {
    // db/0013 allows editing your own row by design (the profile screen needs
    // it), so nothing below this layer prevents self-demotion.
    const { db, log } = fakeDb(() => [memberRow()]);
    const repo = createMembersRepo(db);
    await expect(repo.update(ADMIN_ID, ADMIN, { role: "member" }))
      .rejects.toBeInstanceOf(ConflictError);
    await expect(repo.update(ADMIN_ID, ADMIN, { status: "disabled" }))
      .rejects.toBeInstanceOf(ConflictError);
    expect(log).toHaveLength(0);
  });

  it("still lets an admin demote a DIFFERENT admin", async () => {
    // the guard is about self-inflicted lockout, not about protecting admins
    const { db } = fakeDb(() => [memberRow({ id: OTHER, role: "member" })]);
    const member = await createMembersRepo(db).update(ADMIN_ID, OTHER, { role: "member" });
    expect(member.role).toBe("member");
  });

  it("refuses to set status back to pending", async () => {
    // going back would be a second, quieter revocation than disabling, with
    // semantics nobody has decided
    const { db } = fakeDb(() => [memberRow()]);
    await expect(createMembersRepo(db).update(ADMIN_ID, OTHER, { status: "pending" as never }))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it("cannot activate a pending person through the role/status path", async () => {
    // acceptance has one door; promoting a pending person would open a second
    const { db, log } = fakeDb(() => []);
    await expect(createMembersRepo(db).update(ADMIN_ID, OTHER, { role: "admin" }))
      .rejects.toBeInstanceOf(NotFoundError);
    expect(log.find((l) => l.sql.includes("update"))!.sql).toContain("status <> 'pending'");
  });

  it("emits ISO 8601 timestamps, not the server's locale string", async () => {
    // pg returns Date objects. `String(date)` gives
    // "Wed Aug 12 2026 19:52:44 GMT+0100 (British Summer Time)" — the
    // SERVER's timezone, in English, parseability implementation-defined.
    // That shipped on a live response; every unit test compared it to a
    // fixture already in the shape the code produced. It matters here more
    // than most places: the UI is Persian-first with Jalali dates, so a
    // server-local offset shifts a meeting by a day rather than erroring.
    const { db } = fakeDb(() => [memberRow({
      created_at: new Date("2026-08-12T09:00:00.000Z"),
      accepted_at: new Date("2026-08-12T10:30:00.000Z"),
      last_seen_at: null,
    })]);
    const [member] = await createMembersRepo(db).list(ADMIN_ID);
    expect(member!.created_at).toBe("2026-08-12T09:00:00.000Z");
    expect(member!.accepted_at).toBe("2026-08-12T10:30:00.000Z");
    expect(member!.last_seen_at).toBeNull();
  });

  it("validates ids before touching the database", async () => {
    const { db, log } = fakeDb(() => []);
    await expect(createMembersRepo(db).accept(ADMIN_ID, "'; drop table echo.app_user; --"))
      .rejects.toThrow(/invalid member id/);
    expect(log).toHaveLength(0);
  });
});
