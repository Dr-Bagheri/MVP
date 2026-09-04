import { describe, expect, it, vi } from "vitest";

/**
 * WHO IS ASKING, AND WHAT THEY MAY DO.
 *
 * User directive, 2026-09-04: "give them access to see who has what role in
 * the platform, so based on that they will tell the user if they have access
 * to do what they asked or not."
 *
 * Neither tool is a permission CHECK — every route still refuses on its own,
 * and an agent that read this table and decided to proceed would be reasoning
 * where the database is deciding. What they buy is the ability to say so
 * FIRST, instead of attempting something and relaying a 403.
 *
 * The property that carries the feature is the one about ABSENCE: a written
 * "allowed" and an unwritten default are the same permission and different
 * facts, and an org that has never opened the permissions screen has no rows
 * at all. Returning only the rows would read as "this organization permits
 * nothing" — the absent-versus-denied confusion, on the one subject where
 * getting it backwards makes the assistant refuse work it could have done.
 */
const { createPlatformTools } = await import("../src/agent/platform-tools.ts");
const { CAPABILITIES } = await import("../src/api/capabilities.ts");

/** the identity the runtime resolved before the run was allowed to start */
function identityOf(role: "member" | "admin" | "owner") {
  return { userId: "u-1", orgId: "o-1", role, isActive: true } as never;
}

/** a db whose only job is to answer the capabilities repo's one query */
function dbWith(rows: { role: string; capability: string; allowed: boolean }[]) {
  return {
    withIdentity: async (_identity: unknown, fn: (tx: unknown) => Promise<unknown>) =>
      fn({ unsafe: async () => rows }),
  } as never;
}

const tool = (name: string) => createPlatformTools().find((t) => t.name === name)!;

describe("whoami", () => {
  it("reports the role the run was started with", async () => {
    const result = await tool("whoami").run(
      { identity: identityOf("admin"), deps: { db: dbWith([]) } } as never,
      {} as never,
    ) as { role: string; active: boolean; user_id: string };
    expect(result.role).toBe("admin");
    expect(result.active).toBe(true);
    expect(result.user_id).toBe("u-1");
  });

  it("does not go back to the database for it", async () => {
    /*
     * The identity was resolved against the database before this run was
     * permitted to exist. Asking again would be a second reading of one fact,
     * and a second reading can only ever disagree with the first — including
     * mid-run, if somebody changes the role while the model is thinking.
     */
    const withIdentity = vi.fn();
    await tool("whoami").run(
      { identity: identityOf("member"), deps: { db: { withIdentity } as never } } as never,
      {} as never,
    );
    expect(withIdentity).not.toHaveBeenCalled();
  });
});

describe("list_role_permissions", () => {
  it("returns the WHOLE vocabulary for an org that has decided nothing", async () => {
    const result = await tool("list_role_permissions").run(
      { identity: identityOf("member"), deps: { db: dbWith([]) } } as never,
      {} as never,
    ) as { capabilities: { capability: string; allowed: boolean; decided: boolean }[] };

    expect(result.capabilities).toHaveLength(CAPABILITIES.length);
    /* every one allowed, and every one marked as NOT decided: the difference
       between "they said yes" and "nobody has said anything" is the whole
       reason `decided` exists */
    expect(result.capabilities.every((row) => row.allowed)).toBe(true);
    expect(result.capabilities.every((row) => !row.decided)).toBe(true);
  });

  it("reports a capability the organization took away", async () => {
    const result = await tool("list_role_permissions").run(
      {
        identity: identityOf("member"),
        deps: { db: dbWith([{ role: "member", capability: "records.delete", allowed: false }]) },
      } as never,
      {} as never,
    ) as { capabilities: { capability: string; allowed: boolean; decided: boolean }[] };

    const removed = result.capabilities.find((row) => row.capability === "records.delete")!;
    expect(removed.allowed).toBe(false);
    expect(removed.decided).toBe(true);

    /* the control: ONE written row must not move the others. Without this a
       version that applied the first row's answer to everything passes the
       assertion above and reports an organization that permits nothing. */
    const others = result.capabilities.filter((row) => row.capability !== "records.delete");
    expect(others.every((row) => row.allowed && !row.decided)).toBe(true);
  });

  it("says who is asking, because the answer depends on it", async () => {
    /* a member-level rule does not bind an admin, and none of them bind the
       owner — the model cannot apply this table without knowing which row of
       it the asker stands on */
    const result = await tool("list_role_permissions").run(
      { identity: identityOf("owner"), deps: { db: dbWith([]) } } as never,
      {} as never,
    ) as { asking_role: string };
    expect(result.asking_role).toBe("owner");
  });

  it("carries whose privilege each capability is", async () => {
    const result = await tool("list_role_permissions").run(
      { identity: identityOf("member"), deps: { db: dbWith([]) } } as never,
      {} as never,
    ) as { capabilities: { capability: string; role: string }[] };
    const byKey = new Map(result.capabilities.map((row) => [row.capability, row.role]));
    for (const def of CAPABILITIES) expect(byKey.get(def.key)).toBe(def.role);
  });

  it("both tools are on EVERY agent, not one specialism", async () => {
    /* "may I" is not an analyst question or an operator question — an agent
       that cannot tell somebody why it will not do something is the failure
       this pair exists to prevent, whichever of the three is answering */
    const { toolsFor } = await import("../src/agent/platform-tools.ts");
    for (const who of ["analyst", "operator"] as const) {
      const names = toolsFor(who).map((t) => t.name);
      expect(names, who).toContain("whoami");
      expect(names, who).toContain("list_role_permissions");
    }
  });
});
