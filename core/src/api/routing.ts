import { listAssistantAgents } from "../agent/agent-store.ts";
import {
  decide, ECHO, nameIn, rosterFor,
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
   * A roster read that fails must not stop somebody asking a question: with no
   * roster nobody can be named, and "nobody named" is Echo — which is the same
   * answer this function gives on the ordinary path most of the time.
   */
  const agents = await listAssistantAgents(input.db, input.identity).catch(() => []);
  const roster = rosterFor(agents.map((a) => ({ handle: a.handle, name: a.name })));
  const known = new Set<Responder>(roster.map((entry) => entry.handle));
  known.add(ECHO);

  return decide(nameIn(input.question, roster), incumbent, known);
}
