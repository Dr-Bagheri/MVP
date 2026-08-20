/**
 * The permission core (M3), app side.
 *
 * Invariant 2: **no DB access without a user identity attached.** This module
 * makes that structural rather than aspirational — there is no exported way
 * to obtain a query handle without first producing an `Identity`, and the
 * identity is applied with `SET LOCAL echo.actor_id` inside the same
 * transaction as the queries it authorises.
 *
 * Why SET LOCAL and never SET: connections are pooled. A `SET` would leak the
 * previous caller's identity to whoever gets the connection next — the worst
 * possible bug in a multi-tenant product. `SET LOCAL` dies with the
 * transaction, so a leaked handle is inert.
 *
 * Two identity sources, both landing in the same place (per db/0001):
 *   - api    → verified JWT `sub`
 *   - worker → the row's owner (a job runs as the call's owner, M3)
 *
 * Two roles, per db/0012 — this is a real security boundary, not tidiness:
 *   - echo_app   → api + worker. Product access, no DELETE anywhere.
 *   - echo_agent → the agent runtime's tool calls. No DELETE on anything,
 *                  writes exactly three things. "The agent deletes nothing"
 *                  is a grant, not a prompt instruction.
 * A tool call that ran on an `echo_app` connection would silently have more
 * authority than the architecture says it does, so the agent path takes the
 * agent pool and `assertAgentRole` guards against future miswiring.
 */
import type { Identity } from "../agent/types.ts";

export type DbRole = "app" | "agent";

/** Minimal shape of a `postgres` (porsager) client; keeps this file testable. */
export interface SqlClient {
  begin<T>(fn: (tx: SqlTx) => Promise<T>): Promise<T>;
  end(): Promise<void>;
}

export interface SqlTx {
  /** Tagged-template query, as `postgres` provides. */
  <T = unknown>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  unsafe<T = unknown>(query: string, params?: unknown[]): Promise<T[]>;
}

export class MissingIdentityError extends Error {
  constructor() { super("no identity: refusing to open a database handle"); }
}

export class WrongRoleError extends Error {}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Guard the value we interpolate into SET LOCAL. `postgres` cannot bind a
 * parameter in a SET, so this is the one place a value reaches SQL as text —
 * it must be provably a UUID before it gets there.
 */
export function assertUuid(value: string, what = "actor id"): string {
  if (!UUID_RE.test(value)) throw new Error(`invalid ${what}`);
  return value;
}

export interface Pools {
  app: SqlClient;
  agent: SqlClient;
}

export interface ScopeOptions {
  /** Which grant set this work runs under. Defaults to "app". */
  role?: DbRole;
}

/**
 * `withIdentity` is the ONLY door to the database.
 *
 * Everything inside the callback runs in one transaction with
 * `echo.actor_id` set, so every RLS policy in db/0013 resolves to this
 * caller — including the SECURITY DEFINER helpers in db/0003, which read it.
 */
export function createDb(pools: Pools) {
  /**
   * The primitive: run a transaction as one actor id. Everything else is a
   * wrapper over this, so there is exactly one place that writes SET LOCAL.
   */
  async function withActor<T>(
    actorId: string,
    fn: (tx: SqlTx) => Promise<T>,
    options: ScopeOptions = {},
  ): Promise<T> {
    const actor = assertUuid(actorId);
    const role: DbRole = options.role === "agent" ? "agent" : "app";
    const client = role === "agent" ? pools.agent : pools.app;
    return client.begin(async (tx) => {
      // SET LOCAL ROLE, not just the right pool.
      //
      // The pool choice alone made the role boundary a CONFIGURATION fact,
      // and configuration fails quietly. Two live examples: worker/main.ts
      // defaults `DATABASE_URL_AGENT || DATABASE_URL_APP`, so a missing
      // variable turns the agent pool into echo_app and every agent limit
      // (no DELETE anywhere, no grant on echo.call, column-scoped UPDATE)
      // evaporates; and a dev pointing DATABASE_URL_APP at the owner or a
      // superuser bypasses RLS entirely, because owners are not subject to
      // it. In both cases nothing visibly breaks and every test still passes
      // — which is the whole problem.
      //
      // Asserting the role inside the transaction makes the boundary a
      // PROPERTY OF THE CODE. A connection with more privilege than it should
      // have is dropped to the intended role; one with less fails loudly
      // here rather than succeeding at something it should not do.
      await tx.unsafe(`set local role ${role === "agent" ? "echo_agent" : "echo_app"}`);
      // set_config takes a bound parameter; `SET` cannot. This removes the
      // last interpolated value in the data layer — assertUuid still guards
      // it, but a guard you can delete is weaker than a parameter you cannot.
      // is_local = true: scoped to this transaction, cannot outlive it on a
      // pooled connection.
      await tx.unsafe(`select set_config('echo.actor_id', $1, true)`, [actor]);
      return fn(tx);
    });
  }

  return {
    withActor,

    async withIdentity<T>(
      identity: Identity | null | undefined,
      fn: (tx: SqlTx) => Promise<T>,
      options: ScopeOptions = {},
    ): Promise<T> {
      if (!identity?.userId) throw new MissingIdentityError();
      return withActor(identity.userId, fn, options);
    },

    /**
     * Deliberately NOT a general escape hatch: only for work that has no
     * caller by nature (health probes, queue plumbing in the `pgmq` schema).
     * It cannot read product tables usefully — with no actor, every policy in
     * db/0013 denies — which is exactly the point, and why the worker
     * resolves its actor from the job payload instead of "just looking up"
     * the row's owner here.
     */
    async withoutIdentity<T>(fn: (tx: SqlTx) => Promise<T>): Promise<T> {
      return pools.app.begin(fn);
    },
  };
}

export type Db = ReturnType<typeof createDb>;

/**
 * Belt for the agent path: assert at wiring time that a tool's dependencies
 * were built against the agent pool. Cheap, and it turns a future
 * copy-paste ("just use the app db here") into a loud failure.
 */
export function assertAgentRole(role: DbRole): void {
  if (role !== "agent") {
    throw new WrongRoleError("agent tools must run on the echo_agent role");
  }
}

/**
 * The Db the agent's tools are handed (2026-08-20 tenancy audit).
 *
 * The architecture says the agent runtime's tool calls run on echo_agent —
 * "the agent deletes nothing is a grant, not a prompt instruction" — but the
 * tools reach the DB through the SAME repos the REST api uses, and those call
 * `withIdentity` with no role option, which defaults to echo_app. So the
 * documented floor was only half-enforced: reads were RLS-scoped either way
 * (no cross-org exposure), but a future agent-reachable write would have run
 * with echo_app's unrestricted UPDATE instead of echo_agent's column-scoped
 * grants, and `assertAgentRole` — written for exactly that miswiring — was
 * never called by anything.
 *
 * This wrapper closes both: every call through it runs `role: "agent"`
 * (db/0013's read policies already name echo_agent on every table the tools
 * touch, and db/0014 grants it SELECT there, so nothing silently returns
 * empty), an explicit `role: "app"` from a future caller fails loudly through
 * assertAgentRole instead of quietly widening, and the actor-less door does
 * not exist on this handle at all — a tool has a caller by definition.
 */
export function agentToolsDb(db: Db): Db {
  const force = (options: ScopeOptions = {}): ScopeOptions => {
    const role: DbRole = options.role ?? "agent";
    assertAgentRole(role);
    return { ...options, role };
  };
  // async, deliberately: force() throws, and a Promise-returning method that
  // sometimes throws synchronously is a refusal a caller's .catch never sees.
  return {
    withActor: async (actorId, fn, options) => db.withActor(actorId, fn, force(options)),
    withIdentity: async (identity, fn, options) => db.withIdentity(identity, fn, force(options)),
    withoutIdentity: () => {
      throw new WrongRoleError("agent tools have no actor-less database door");
    },
  };
}
