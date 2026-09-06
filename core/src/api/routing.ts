import { listAssistantAgents } from "../agent/agent-store.ts";
import {
  decide, ECHO, namesIn, rosterFor,
  type RouteDecision, type Responder,
} from "../agent/router.ts";
import type { Db, SqlTx } from "../db/identity.ts";
import type { Identity } from "../agent/types.ts";

/**
 * THE ONE CALL THAT DECIDES WHO ANSWERS.
 *
 * `agent/router.ts` holds the rule; this file reads the roster and asks it.
 *
 * There is NO MODEL CALL here any more. There was one — a cheap classifier
 * that guessed which specialist a message was about — and it is gone with the
 * bug it caused (see router.ts). Two things follow, and both are improvements
 * the user did not have to ask for: the decision costs nothing and adds no
 * latency before the first visible token, and it can be reproduced without a
 * network, which is why its whole failure surface now fits in a unit test.
 */

export interface RouteInput {
  db: Db;
  identity: Identity;
  /** the message being routed */
  question: string;
  sessionId?: string | undefined;
  /**
   * An agent a SURFACE chose — a conversation opened from Roya's own page
   * sends `agent: roya`. It counts as a name only on the FIRST message of a
   * new conversation: after that the floor governs, or a page that keeps
   * sending it would drag the person back to Roya after they said «اکو».
   */
  pinned?: string | undefined;
}

/**
 * Who spoke last in this conversation.
 *
 * It no longer decides anything — the rule is "named, or Echo" — but it is
 * still READ, and by two things worth keeping: the log line that says whether
 * a turn changed voice, and `switched` on the decision. A column that records
 * who is speaking is a fact about the thread, not a routing input.
 */
export async function incumbentOf(
  db: Db, identity: Identity, sessionId: string | undefined,
): Promise<Responder | null> {
  if (sessionId === undefined || sessionId === "") return null;
  return db.withIdentity(identity, async (tx: SqlTx) => {
    const rows = await tx.unsafe<{ current_agent: string | null }>(
      `select current_agent from echo.agent_session where id = $1`,
      [sessionId],
    );
    return rows[0]?.current_agent ?? null;
  });
}

/**
 * Who holds the floor in this conversation — the colleagues the person called
 * and has not yet dismissed (db/0194). Empty = Echo, the default.
 */
export async function floorOf(
  db: Db, identity: Identity, sessionId: string | undefined,
): Promise<Responder[]> {
  if (sessionId === undefined || sessionId === "") return [];
  return db.withIdentity(identity, async (tx: SqlTx) => {
    const rows = await tx.unsafe<{ floor: string[] | null }>(
      `select floor from echo.agent_session where id = $1`,
      [sessionId],
    );
    return rows[0]?.floor ?? [];
  });
}

/** Write the floor a turn decided — only when it changed, so an unchanged
    floor costs no row and no `updated_at`. */
export async function rememberFloor(
  db: Db, identity: Identity, sessionId: string, floor: readonly Responder[],
): Promise<void> {
  await db.withIdentity(identity, async (tx: SqlTx) => {
    await tx.unsafe(
      `update echo.agent_session set floor = $2::text[], updated_at = now()
        where id = $1 and floor is distinct from $2::text[]`,
      [sessionId, [...floor]],
    );
  });
}

/** Remember who answered — the thread's record of its own voice. */
export async function rememberIncumbent(
  db: Db, identity: Identity, sessionId: string, agent: Responder,
): Promise<void> {
  await db.withIdentity(identity, async (tx: SqlTx) => {
    await tx.unsafe(
      `update echo.agent_session set current_agent = $2, updated_at = now()
        where id = $1 and coalesce(current_agent, '') <> $2`,
      [sessionId, agent],
    );
  });
}

export async function routeTurn(input: RouteInput): Promise<RouteDecision> {
  const incumbent = await incumbentOf(input.db, input.identity, input.sessionId)
    .catch(() => null);
  /*
   * A read that fails must not stop the question — but it must be SAID
   * (2026-09-06): the old `.catch(() => [])` made a database hiccup
   * indistinguishable from "nobody holds the floor", and the caller then
   * WROTE that emptiness back as the floor. Roya, on the floor, dismissed by
   * a timeout. `unreliable` travels with the decision; the ask route answers
   * from it and persists nothing.
   */
  let unreliable = false;
  const floor = await floorOf(input.db, input.identity, input.sessionId)
    .catch(() => { unreliable = true; return [] as Responder[]; });
  const agents = await listAssistantAgents(input.db, input.identity)
    .catch(() => { unreliable = true; return []; });
  const roster = rosterFor(agents.map((a) => ({ handle: a.handle, name: a.name })));
  const known = new Set<Responder>(roster.map((entry) => entry.handle));
  known.add(ECHO);
  let named = namesIn(input.question, roster);
  const fresh = input.sessionId === undefined || input.sessionId === "";
  if (named.length === 0 && fresh && input.pinned !== undefined && known.has(input.pinned)) {
    named = [input.pinned];
  }
  const decision = decide(named, floor, incumbent, known);
  return unreliable ? { ...decision, unreliable: true } : decision;
}
