/**
 * Telling apart the two reasons a job's owner cannot see their own call.
 *
 * They dead-letter identically unless something separates them, and the
 * recoveries are different: one is "reinstate the person, then requeue", the
 * other is "somebody investigate". The steward's point is that the first is a
 * path an operator actually walks, so it has to be legible from the dead
 * letter alone.
 */
import { describe, expect, it } from "vitest";

import { resolveJobIdentity } from "../src/worker/job-identity.ts";
import { classify } from "../src/worker/runner.ts";
import type { JobPayload } from "../src/worker/queue.ts";

const OWNER = "11111111-1111-4111-8111-111111111111";
const ORG = "55555555-5555-4555-8555-555555555555";
const CALL = "22222222-2222-4222-8222-222222222222";
const payload: JobPayload = { callId: CALL, ownerId: OWNER };

/** `active` drives the app_user row; `callVisible` drives the fail-closed re-read. */
function fakeDb(opts: { active: boolean; callVisible: boolean; userExists?: boolean }) {
  const tx = {
    unsafe: async (sql: string) => {
      if (sql.includes("from echo.app_user")) {
        if (opts.userExists === false) return [];
        return [
          {
            id: OWNER,
            org_id: ORG,
            role: "member",
            status: opts.active ? "active" : "pending",
            org_status: opts.active ? "active" : "suspended",
          },
        ];
      }
      if (sql.includes("select id from echo.call")) return opts.callVisible ? [{ id: CALL }] : [];
      return [];
    },
  };
  return {
    withActor: async (_a: string, fn: (t: unknown) => Promise<unknown>) => fn(tx),
    withIdentity: async (_i: unknown, fn: (t: unknown) => Promise<unknown>) => fn(tx),
    withoutIdentity: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  } as never;
}

describe("resolveJobIdentity", () => {
  it("returns the identity when the owner is active and owns the call", async () => {
    const identity = await resolveJobIdentity(fakeDb({ active: true, callVisible: true }), payload);
    expect(identity).toMatchObject({ userId: OWNER, orgId: ORG, isActive: true });
  });

  it("names an INACTIVE owner, with the recovery in the message", async () => {
    // Pending member or suspended org: RLS denies them their own call. This
    // heals the moment an admin reinstates them, so the reason says so and
    // stays retryable — no manual replay.
    const error = await resolveJobIdentity(
      fakeDb({ active: false, callVisible: false }),
      payload,
    ).catch((e) => e);

    expect(error).toMatchObject({ errorType: "owner_inactive", retryable: true });
    // Names WHICH — pending, disabled and suspended need different human
    // actions, so "inactive" alone would still leave the operator guessing.
    expect(error.message).toMatch(/pending/);
    expect(error.message).toMatch(/reinstated/);
    expect(classify(error).errorType).toBe("owner_inactive");
  });

  it("keeps the generic reason when the owner is ACTIVE but still cannot see it", async () => {
    // Stale payload, forged payload, or a deleted call. Waiting fixes nothing,
    // so it must not claim a reinstatement is pending.
    const error = await resolveJobIdentity(
      fakeDb({ active: true, callVisible: false }),
      payload,
    ).catch((e) => e);

    expect(classify(error).errorType).toBe("owner_cannot_see_call");
  });

  it("reports a missing owner row distinctly from an inactive one", async () => {
    const error = await resolveJobIdentity(
      fakeDb({ active: true, callVisible: false, userExists: false }),
      payload,
    ).catch((e) => e);

    // Nothing will change on its own — non-retryable, and named so.
    expect(classify(error)).toMatchObject({ errorType: "owner_not_found", retryable: false });
  });
});
