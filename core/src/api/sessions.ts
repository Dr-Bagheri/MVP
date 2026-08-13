/**
 * Assistant conversations — `echo.agent_session` + `echo.agent_message`.
 *
 * The schema for this landed in db/0018 and Q5 ruled its purge semantics
 * (conversations outlive the calls they discuss; the run link is cut, the
 * thread survives). Then no milestone ever scheduled the build, so for weeks
 * there were two tables with policies, zero rows, and no code that named
 * them. The table-granularity instrument in `schema-contract.ts` is what
 * surfaced it — a scheduling seam rather than a code seam, invisible from
 * inside any one package.
 *
 * It is load-bearing rather than a nicety: the hub is the product's first
 * page, and "proposals live and die in their conversation" (M4) needs a
 * conversation that persists in order to be lived in.
 *
 * ── The four contract decisions, and why ────────────────────────────────────
 *
 * **1. Sessions open LAZILY.** An `ask` with no `session_id` creates one; a
 * "new chat" button does not. The alternative writes a row the moment someone
 * opens the hub, so the list fills with empty conversations nobody had — and
 * on a page where "the assistant IS the page" (M22) there is no explicit
 * new-chat moment to hang creation on. A session exists because something was
 * said in it.
 *
 * **2. One `agent_run` per MESSAGE, not per session.** A run is one model
 * invocation: it has a status, a token count, a step trace, and invariant 5
 * says it is replayable. None of those is true of a conversation spanning an
 * afternoon. The schema agrees — `agent_message.agent_run_id` is per-message
 * and nullable — and the nullability is doing real work: the human's turns
 * have no run, because nothing was invoked to produce them.
 *
 * **3. Titles come from the first question**, truncated. `title` is NOT NULL,
 * so the choice is between this and a literal like "New conversation", and a
 * sidebar of twenty identical strings is a list that has stopped being one.
 * Derived once and never rewritten: a title that follows the conversation's
 * drift means the entry a person is scanning for changes its name while they
 * scan.
 *
 * **4. Resume is a READ, never a replay.** `messages()` returns what was
 * said; it does not re-run anything or reconstruct state from `agent_run`
 * steps. The thread is the record.
 *
 * ── What is deliberately NOT stored ─────────────────────────────────────────
 *
 * Tool traces stay in `agent_run.steps`. `agent_message.tool_calls` holds the
 * calls a turn made as codes (name and id), never their arguments or results:
 * arguments quote the transcript the person asked about, and a conversation
 * list is a much wider surface than an audit screen.
 */
import { NotFoundError, ValidationError } from "./errors.ts";
import { iso, isoOrNull } from "./vocabulary.ts";
import { toJsonb, JSONB_PARAM } from "../db/jsonb.ts";
import { assertUuid, type Db, type SqlTx } from "../db/identity.ts";
import type { Identity } from "../agent/types.ts";

export interface SessionRecord {
  id: string;
  title: string;
  last_message_at: string | null;
  archived_at: string | null;
  created_at: string;
}

export interface MessageRecord {
  id: string;
  seq: number;
  role: "user" | "assistant" | "tool";
  content: string;
  /** Codes only — `{id, name}` per call. Never arguments, never results. */
  tool_calls: unknown[];
  /** The run that produced an assistant turn; null for a human's. */
  agent_run_id: string | null;
  /**
   * The run behind this turn ERRORED, so the text stops early (FE2's finding).
   *
   * `coalesce(stored, derived)`: db/0046 stamps the column at the last moment
   * the fact is readable (BEFORE DELETE on the run), and the join answers
   * while the run is still alive. Never two writable copies — `echo_app` holds
   * no write on it at all, so NULL means "derive it" and a boolean means "the
   * run is gone and this is what it said". False for every human turn, and
   * false whenever we cannot tell: a wrong "cut off" on a complete answer
   * would be its own lie.
   *
   * A renderer should show this as an ANNOTATION, not a message — muted, no
   * avatar, no role — so a note ABOUT the answer can never later be mistaken
   * for part of it.
   */
  truncated: boolean;
  created_at: string;
}

/**
 * The thread read, exported so the live harness can execute the EXACT string
 * this repo runs.
 *
 * It is exported rather than re-typed there because a hand-written copy in a
 * test is a test that the copy agrees with itself. And it is a string rather
 * than a repo call because `schema-contract.ts` runs on a single connection
 * inside its own transaction: calling `messages()` there makes the repo open
 * a nested `begin` that waits forever for a connection its own caller is
 * holding. I wrote that version first and the harness hung — a deadlock is at
 * least loud, which is more than the bug it was added to catch managed.
 */
export const THREAD_QUERY = `
  select m.id, m.seq, m.role, m.content, m.tool_calls, m.agent_run_id, m.created_at,
         coalesce(m.truncated, echo.run_is_truncated(r.status, r.started_at)) as truncated
    from echo.agent_message m
    left join echo.agent_run r on r.id = m.agent_run_id
   where m.session_id = $1 order by m.seq
`;

const SESSION_COLUMNS = `id, title, last_message_at, archived_at, created_at`;
const MESSAGE_COLUMNS = `id, seq, role, content, tool_calls, agent_run_id, created_at`;

/** Long enough to tell two conversations apart, short enough for a sidebar. */
const TITLE_MAX = 80;

export function titleFrom(question: string): string {
  const oneLine = question.replace(/\s+/g, " ").trim();
  if (oneLine.length <= TITLE_MAX) return oneLine;
  // Cut on a word boundary when there is one nearby, so a title does not end
  // mid-word — but never search backwards more than a quarter of the length,
  // or a long unbroken string collapses to almost nothing.
  const cut = oneLine.slice(0, TITLE_MAX);
  const space = cut.lastIndexOf(" ");
  return `${space > TITLE_MAX * 0.75 ? cut.slice(0, space) : cut}…`;
}

const toSession = (row: Record<string, unknown>): SessionRecord => ({
  id: row.id as string,
  title: String(row.title),
  last_message_at: isoOrNull(row.last_message_at),
  archived_at: isoOrNull(row.archived_at),
  created_at: iso(row.created_at),
});

const toMessage = (row: Record<string, unknown>): MessageRecord => ({
  id: row.id as string,
  seq: Number(row.seq),
  role: row.role as MessageRecord["role"],
  content: String(row.content),
  tool_calls: Array.isArray(row.tool_calls) ? row.tool_calls : [],
  agent_run_id: (row.agent_run_id as string | null) ?? null,
  truncated: row.truncated === true,
  created_at: iso(row.created_at),
});

export function createSessionsRepo(db: Db) {
  return {
    /**
     * The caller's own conversations, most recently active first.
     *
     * Ordered by `last_message_at` and NOT `created_at`: a conversation
     * returned to after a week belongs at the top, and creation order would
     * bury it. NULLS LAST for the same reason it is elsewhere — a session
     * with no messages is not the most recent thing that happened.
     *
     * `agent_session_own` already scopes this to the caller; no predicate here.
     */
    async list(identity: Identity, options: { archived?: boolean } = {}): Promise<SessionRecord[]> {
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<Record<string, unknown>>(
          `select ${SESSION_COLUMNS} from echo.agent_session
            where ($1::boolean is true) = (archived_at is not null)
            order by last_message_at desc nulls last, created_at desc`,
          [options.archived === true],
        ),
      );
      return rows.map(toSession);
    },

    /** One conversation's thread, in the order it was said. */
    async messages(identity: Identity, sessionId: string): Promise<MessageRecord[]> {
      const id = assertUuid(sessionId, "session id");
      return db.withIdentity(identity, async (tx: SqlTx) => {
        // The session read first, so "no such conversation" and "a
        // conversation with nothing in it" stay distinguishable: both would
        // otherwise be an empty array (rule 12).
        const session = await tx.unsafe<{ id: string }>(
          `select id from echo.agent_session where id = $1`, [id],
        );
        if (!session[0]) throw new NotFoundError("conversation not found");
        /**
         * `truncated` is DERIVED, not stored — and that is why this needed no
         * migration and cannot drift.
         *
         * FE2 found the hole: a run that fails MID-STREAM leaves a real
         * partial answer in the thread, and after a reload nothing says it
         * stopped early. «سه موضوع مطرح شد: نخست» promises three things and
         * delivers one word, and it renders identically to a complete answer
         * the model chose to give — in a product whose whole value is "you do
         * not have to re-listen to the call", a user can act on half a summary
         * believing it is the whole one.
         *
         * I had declined to persist a failure marker because writing a row for
         * a turn that produced nothing would be commentary wearing a message's
         * clothes. That objection holds for the no-text case and NOT for this
         * one: the row already exists and the model really did say it, so
         * marking how it ended annotates a real turn rather than inventing a
         * turn. FE2 drew that line and it is the right one.
         *
         * The fact was already in the database — `agent_run.status` — so the
         * fix is a join, not a column. Nothing is stored twice, nothing can
         * disagree with itself, and a run that becomes readable later starts
         * reporting correctly on its own.
         *
         * `= true` deliberately, not `!== 'ok'`: an unreadable or missing run
         * yields null, and the safe default is NOT claiming truncation. A
         * false "cut off" on a complete answer is its own lie.
         */
        const rows = await tx.unsafe<Record<string, unknown>>(
          /**
           * COALESCE, per the steward's ruling and db/0046: the stored stamp
           * wins when it exists, the join answers while the run is alive.
           * Never two writable copies — `echo_app` holds no write on
           * `m.truncated`, so NULL means "derive it" and a boolean means "the
           * run is gone and this is what it said".
           *
           * ── One rule, called twice: `echo.run_is_truncated` ───────────────
           *
           * My live half said `status = 'error'`; db/0047's stamp said
           * `<> 'ok'`. The steward caught the divergence — an ABANDONED run
           * (process died, stuck 'running') read as COMPLETE here until purge
           * stamped it, the truncated-reads-complete lie one layer early.
           *
           * B3's resolution is better than either of our predicates, and
           * better than my own next answer. I was about to adopt `<> 'ok'`
           * and defend it with an ordering argument: a message row cannot
           * point at an in-flight run, because `runs.finish()` is awaited
           * inside `runtime.run()` and the append happens only after `run()`
           * resolves. That is TRUE — and it made correctness here depend on
           * an invariant in a different file, which I had to flag as
           * load-bearing precisely because nothing enforced it.
           *
           * The real rule was never two rules: *a run is truncated if it did
           * not finish cleanly and is not still plausibly in flight.* At
           * stamp time nothing is in flight, so "not ok" was right; live, a
           * run seconds old might be mid-answer, so it was not. One
           * predicate, two contexts, and the context is a parameter.
           *
           * **The TWO-argument form**, and the second argument is the whole
           * point: with `started_at`, this no longer depends on the api's
           * write ordering to be correct.
           *
           * The one-arg form is equivalent ONLY while a message row cannot
           * point at an in-flight run — true today, because `runs.finish()`
           * is awaited inside `runtime.run()` and the append follows. But
           * that is a discipline in a different file, and if it ever changed,
           * a live streaming answer would read as "cut off" on someone's
           * screen while the schema had no way to notice. The start time
           * makes the answer structural instead of borrowed.
           *
           * (The signature went one-arg → two-arg → one-arg → two-arg across
           * db/0048–0050 while we worked out which rule was real. Both forms
           * are live right now; B3 drops the one-arg version once I confirm
           * this switch, so there is one definition again rather than a
           * signature disappearing under a running caller.)
           */
          THREAD_QUERY,
          [id],
        );
        return rows.map(toMessage);
      });
    },

    /**
     * Resolve the session an `ask` belongs to, creating one if needed.
     *
     * Returns the id and whether it was created, because the route streams
     * that back — a client that opened a conversation implicitly needs to
     * learn its id, or the next message starts a second one.
     */
    async resolveForAsk(
      identity: Identity, sessionId: string | null, question: string,
    ): Promise<{ id: string; created: boolean }> {
      if (sessionId) {
        const id = assertUuid(sessionId, "session id");
        const rows = await db.withIdentity(identity, (tx: SqlTx) =>
          tx.unsafe<{ id: string }>(
            // Archived is not resumable: it is the user saying "done with
            // this". Silently un-archiving on a stray request would undo an
            // explicit act, so it is a 404 like any other unusable row.
            `select id from echo.agent_session where id = $1 and archived_at is null`,
            [id],
          ),
        );
        if (!rows[0]) throw new NotFoundError("conversation not found");
        return { id, created: false };
      }
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ id: string }>(
          `insert into echo.agent_session (org_id, actor_id, title, context)
           values ($1, $2, $3, '{}'::jsonb) returning id`,
          [identity.orgId, identity.userId, titleFrom(question)],
        ),
      );
      const created = rows[0];
      if (!created) throw new ValidationError("could not open a conversation");
      return { id: created.id, created: true };
    },

    /**
     * Append one turn.
     *
     * `seq` is allocated from the thread itself rather than kept in memory:
     * two tabs asking at once would otherwise collide, and the unique
     * (session_id, seq) would turn a race into a 500 on the second one.
     */
    async append(
      identity: Identity,
      message: {
        sessionId: string;
        role: MessageRecord["role"];
        content: string;
        toolCalls?: unknown[] | undefined;
        agentRunId?: string | null | undefined;
      },
    ): Promise<MessageRecord> {
      const id = assertUuid(message.sessionId, "session id");
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<Record<string, unknown>>(
          `insert into echo.agent_message
             (session_id, org_id, seq, role, content, tool_calls, agent_run_id)
           select $1, $2,
                  coalesce((select max(seq) + 1 from echo.agent_message where session_id = $1), 0),
                  $3::echo.agent_message_role, $4, ${JSONB_PARAM(5)}, $6::uuid
           returning ${MESSAGE_COLUMNS}`,
          [
            id, identity.orgId, message.role, message.content,
            toJsonb(message.toolCalls ?? []), message.agentRunId ?? null,
          ],
        ),
      );
      const row = rows[0];
      if (!row) throw new NotFoundError("conversation not found");
      // Touched here rather than by a trigger because no trigger exists; the
      // list's ordering depends on it, so an append that did not stamp would
      // sort a live conversation to the bottom.
      await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe(`update echo.agent_session set last_message_at = now() where id = $1`, [id]),
      );
      return toMessage(row);
    },

    /** Archive / unarchive. Never a delete — Q5 says conversations survive. */
    async setArchived(identity: Identity, sessionId: string, archived: boolean): Promise<SessionRecord> {
      const id = assertUuid(sessionId, "session id");
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<Record<string, unknown>>(
          `update echo.agent_session
              set archived_at = case when $2::boolean then now() else null end
            where id = $1
            returning ${SESSION_COLUMNS}`,
          [id, archived],
        ),
      );
      const row = rows[0];
      if (!row) throw new NotFoundError("conversation not found");
      return toSession(row);
    },
  };
}

export type SessionsRepo = ReturnType<typeof createSessionsRepo>;
