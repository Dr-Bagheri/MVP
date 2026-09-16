import type { Identity } from "./types.ts";

/**
 * A WORKSPACE IS VERIFIED BEFORE ITS AGENTS SPEND (db/0224, M54).
 *
 * User ruling, 2026-09-16: the door stays open — a stranger founds a
 * workspace and is in — and what waits for the platform's word is the SPEND.
 * "The agents on the system use tokens; if all can use it, it becomes
 * problematic. For now I verify them to start using the agents."
 *
 * The WALL is db/0224's trigger on `echo.agent_run`: no run opens for an
 * organisation whose `verified_at` is null, on every model-spending path at
 * once. What this module holds is the same fact where a person is watching,
 * so the refusal arrives as a sentence rather than as a 42501 inside a
 * stream:
 *
 *   - `Identity.orgVerified` is read once, with the identity (db/actor.ts),
 *     so every route and every worker asks a value it already holds rather
 *     than a second query;
 *   - `assertOrgVerified` is the pre-check the api routes and the runtime
 *     make BEFORE anything is recorded or spent;
 *   - `OrgUnverifiedError` is the one class, carrying the one CODE the web
 *     turns into words (the refusal rule: a code from the server, the sentence
 *     at the consumer).
 *
 * ABSENT IS NOT FALSE. `orgVerified` is undefined on a deployment whose
 * schema predates 0224 (and in every test fixture that never heard of it),
 * and undefined means "no such wall here" — only an explicit `false` refuses.
 * The alternative (`!identity.orgVerified`) would lock every agent out of a
 * deployment the day core/ shipped ahead of the migration, which is exactly
 * the order the two are deployed in.
 */
export const ORG_UNVERIFIED = "org_unverified" as const;

export class OrgUnverifiedError extends Error {
  /** the catalogued refusal code — the web's key for the sentence */
  readonly code: typeof ORG_UNVERIFIED;

  constructor(message = "this workspace is not verified yet; its agents cannot run") {
    super(message);
    // assigned in the body, never a parameter property: the api runs under
    // --experimental-strip-types, which refuses the shorthand at load time
    // (errors.ts carries the whole story)
    this.code = ORG_UNVERIFIED;
  }
}

/** true unless the identity says, explicitly, that the wall is up */
export function orgIsVerified(identity: Pick<Identity, "orgVerified">): boolean {
  return identity.orgVerified !== false;
}

export function assertOrgVerified(identity: Pick<Identity, "orgVerified">): void {
  if (!orgIsVerified(identity)) throw new OrgUnverifiedError();
}

/**
 * The wall's own voice: db/0224 raises `insufficient_privilege` with HINT
 * `org_unverified`, and this recognises it so a path that reached the trigger
 * without the pre-check still fails TYPED — never as a bare 42501 that reads
 * like a miswired role.
 */
export function isOrgUnverifiedRefusal(error: unknown): boolean {
  const e = error as { code?: unknown; hint?: unknown } | null;
  return e !== null && typeof e === "object" && e.code === "42501" && e.hint === ORG_UNVERIFIED;
}
