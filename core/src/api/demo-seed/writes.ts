/**
 * The writes the demo seed needs that no repository offers (M52).
 *
 * Everything else a demo organisation contains goes through the product's own
 * paths — createTasksRepo, createMeetingsRepo, createDirectoryRepo,
 * createOrgRepo, createMembersRepo, uploads.createCall, the worker's own
 * `upsertSpeakers` and `writeTranscript`, and `meetings.extractItems`. These
 * are what is left, and each is here for a reason rather than for
 * convenience:
 *
 *   • BACKDATE. A call is born at `now()` and a demo's records happened days
 *     ago. Only the OWNER may move `started_at`, `duration_ms` or `status`
 *     (db/0011's column trigger), which is why this runs under the demo
 *     owner's identity on echo_app like every other write here — the wall is
 *     doing its job, not being stepped around.
 *   • THE PART ROW. `uploads.registerPart` is the product's path and it is the
 *     wrong one twice over: it demands a path under `<call>/`, HEADs the
 *     object through the uploads config, and — the disqualifying half —
 *     ENQUEUES `process_part`, which would send a seeded transcript to be
 *     transcribed again, spending Soniox money to overwrite the timings the
 *     player seeks to.
 *   • THE SPEAKER SAMPLE. `upsertSpeakers` writes the roster; the sample
 *     window (which seconds of audio this voice is heard in) is set by the
 *     link step, which does not run here.
 *   • THE CONVERSATION'S CLOCK. `sessions.append` stamps
 *     `last_message_at = now()` on every turn, deliberately — the sidebar's
 *     order depends on it — and a demo's conversations happened over the days
 *     before the demo. `echo_app` holds `update` on `echo.agent_session` and
 *     `agent_session_own` is FOR ALL, so this is the presenter moving their
 *     OWN row through the same wall a person meets.
 *   • THE SUMMARY. The worker writes it inline in call-steps.ts rather than
 *     through a repo. `version` is computed in SQL exactly as it is there, so
 *     the immutability trigger and the current-summary pointer (db/0008) do
 *     their own work and this never names `current_summary_id`.
 *   • THE ITEM'S RESOLVED OWNER. `meetings.extractItems` writes the free-text
 *     `owner` db/0160 gave it and leaves db/0211's `owner_id` NULL, because
 *     the prose slicer has no roster to resolve a name against. db/0217's
 *     aftermath door joins `app_user` ON `owner_id`, so a demo organisation
 *     that left it NULL got no commitment cards and no error. The read and
 *     the update below are the second statement that closes
 *     it; `engine.ts` owns WHO a name resolves to (the pack knows its people)
 *     and reuses the worker's own `resolveOwner`, so there is one resolution
 *     rule in the codebase and not two.
 *
 * All of them take an `Identity` and go through `db.withIdentity`, so RLS sees
 * a real person and the policies that admit them are the ones that would admit
 * the same writes from a screen.
 */

import type { Db, SqlTx } from "../../db/identity.ts";
import type { Identity } from "../../agent/types.ts";
import { JSONB_PARAM, toJsonb } from "../../db/jsonb.ts";

export interface BackdateInput {
  startedAt: Date;
  durationMs: number;
  language: string;
}

/** Move a seeded call into the past and give it its measured length. */
export async function backdateCall(
  db: Db,
  identity: Identity,
  callId: string,
  input: BackdateInput,
): Promise<void> {
  await db.withIdentity(identity, (tx: SqlTx) =>
    tx.unsafe(
      `update echo.call
          set started_at = $2, duration_ms = $3, language = $4, updated_at = now()
        where id = $1`,
      [callId, input.startedAt.toISOString(), input.durationMs, input.language],
    ),
  );
}

export interface PartInput {
  callId: string;
  orgId: string;
  idx: number;
  offsetMs: number;
  durationMs: number;
  bucket: string;
  path: string;
  byteSize: number;
  sha256: string;
  /** false when the artefact was missing from storage — see storage.ts */
  hasAudio: boolean;
}

/**
 * One part row for a seeded record.
 *
 * `status` is `diarized` and `has_word_timestamps` is true because that is
 * what the pack's timings ARE: measured per line, with word spans spread
 * inside each. `missing` carries the audio's absence, so a record seeded
 * without its artefact says so on the row the player reads rather than 404ing
 * at play time.
 */
export async function insertPart(
  db: Db,
  identity: Identity,
  input: PartInput,
): Promise<string> {
  const rows = await db.withIdentity(identity, (tx: SqlTx) =>
    tx.unsafe<{ id: string }>(
      `insert into echo.call_part
         (call_id, org_id, idx, offset_ms, duration_ms, storage_bucket, storage_path,
          audio_format, byte_size, audio_sha256, status, has_word_timestamps, missing)
       values ($1, $2, $3, $4, $5, $6, $7, 'wav', $8, $9, 'diarized', true, $10)
       returning id`,
      [input.callId, input.orgId, input.idx, input.offsetMs, input.durationMs,
       input.bucket, input.path, input.byteSize, input.sha256, !input.hasAudio],
    ),
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("the demo part row was not written");
  return id;
}

/** The seconds of audio a voice is first heard in — what the link step sets. */
export async function setSpeakerSample(
  db: Db,
  identity: Identity,
  speakerId: string,
  startMs: number,
  endMs: number,
): Promise<void> {
  await db.withIdentity(identity, (tx: SqlTx) =>
    tx.unsafe(
      `update echo.call_speaker
          set sample_start_ms = $2, sample_end_ms = $3, updated_at = now()
        where id = $1`,
      [speakerId, startMs, endMs],
    ),
  );
}

export interface ConversationClock {
  /** when the thread was opened */
  createdAt: Date;
  /** when the last thing in it was said — what the sidebar reads */
  lastMessageAt: Date;
}

/**
 * Move a seeded conversation onto the demo's week.
 *
 * WHAT THIS DOES NOT MOVE, said out loud rather than discovered: the TURNS.
 * db/0016 grants `echo_app` `select, insert` on `echo.agent_message` and
 * nothing else — there is no update policy and no update grant, on purpose,
 * because a message is a record of something that was said. So each turn's
 * `created_at` is the moment of seeding while the thread's own two stamps are
 * the fictional past.
 *
 * The refused alternative was a migration granting `update` on
 * `echo.agent_message` so the turns could be backdated too. Widening the wall
 * on the table that holds every person's private conversations, to make a
 * demo tidier, is the wrong trade — and it buys nothing visible: the sidebar
 * reads `last_message_at`, the history table reads
 * `last_message_at ?? created_at`, and the thread view renders no per-turn
 * time at all. The stamps a reader actually reads a date on are exactly the
 * two this moves, which is the same line M52 draws for a call's `started_at`.
 */
export async function backdateConversation(
  db: Db,
  identity: Identity,
  sessionId: string,
  clock: ConversationClock,
): Promise<void> {
  await db.withIdentity(identity, (tx: SqlTx) =>
    tx.unsafe(
      `update echo.agent_session
          set created_at = $2, last_message_at = $3
        where id = $1`,
      [sessionId, clock.createdAt.toISOString(), clock.lastMessageAt.toISOString()],
    ),
  );
}

export interface SummaryInput {
  callId: string;
  orgId: string;
  body: string;
  model: string;
}

/**
 * The summary, written the way call-steps.ts writes one: version computed in
 * SQL, append-only, and the current-summary pointer left entirely to db/0008's
 * trigger — naming it here would be a second writer for a fact that already
 * has one.
 *
 * `grounding` is `{"clean": true}`: the body was written by a person against
 * a transcript that says exactly what it says, so there is nothing in it the
 * anti-fabrication pass would have flagged. That is a claim about THIS text,
 * not a default.
 */
export async function insertSummary(
  db: Db,
  identity: Identity,
  input: SummaryInput,
): Promise<string> {
  const rows = await db.withIdentity(identity, (tx: SqlTx) =>
    tx.unsafe<{ id: string }>(
      `insert into echo.summary
         (call_id, org_id, version, body, model, created_by, grounding)
       values ($1, $2,
               (select coalesce(max(version), 0) + 1 from echo.summary where call_id = $1),
               $3, $4, echo.actor_id(), ${JSONB_PARAM(5)})
       returning id`,
      [input.callId, input.orgId, input.body, input.model, toJsonb({ clean: true })],
    ),
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("the demo summary was not written");
  return id;
}

/** One row the extractor landed, as much of it as the owner fix needs. */
export interface SeededMeetingItem {
  id: string;
  /** db/0160's five; only `action` carries an owner worth resolving */
  kind: string;
  /** the name the summary attached, as `splitOwner` read it */
  owner: string | null;
  /** db/0211's resolved account — NULL on everything `extractItems` writes */
  ownerId: string | null;
}

/**
 * The items `extractItems` just landed on a seeded meeting.
 *
 * Read rather than returned by the extractor, because `extractItems`'
 * `{ added, found }` is a COUNT, and widening it would change a return shape
 * the summary route and the worker's own entry both read. A fresh meeting
 * holds nothing else, so this is the
 * extraction's own output read back under the same identity that wrote it —
 * db/0160's `meeting_item_read` goes through the meeting's own policy, so the
 * demo owner sees exactly the rows they just created.
 */
export async function readMeetingItems(
  db: Db,
  identity: Identity,
  meetingId: string,
): Promise<SeededMeetingItem[]> {
  const rows = await db.withIdentity(identity, (tx: SqlTx) =>
    tx.unsafe<{ id: string; kind: string; owner: string | null; owner_id: string | null }>(
      `select id, kind, owner, owner_id
         from echo.meeting_item
        where meeting_id = $1
        order by kind, position`,
      [meetingId],
    ),
  );
  return rows.map((row) => ({
    id: String(row.id),
    kind: String(row.kind),
    owner: row.owner === null ? null : String(row.owner),
    ownerId: row.owner_id === null ? null : String(row.owner_id),
  }));
}

/**
 * Give one seeded action item the ACCOUNT its spoken owner resolved to.
 *
 * WHY AN UPDATE AND NOT THE INSERT. The insert that made the row is
 * `meetings.extractItems`, which runs on the AGENT role (db/0160 pins
 * `source = 'ai'` to the writer) and names no `owner_id` — and widening it
 * would mean handing the prose slicer a roster it has no business holding, on
 * the one function the summary route, the worker and this seed all call. So the
 * row lands exactly as a real call's does and the resolution follows as a
 * second statement.
 *
 * What the row ENDS UP as is identical to what the summarizer's own pass
 * produces: `source = 'ai'`, the spoken name in `owner`, the account in
 * `owner_id`. That the path differs is the cost, said out loud the way the
 * backdates above say theirs — and `echo_app`'s own update policy (db/0160)
 * is what admits it, which is the same wall a person editing the item meets.
 * `source` cannot drift here: db/0160's `meeting_item_immutable` trigger
 * refuses that for every role at once, and this statement does not name it.
 */
export async function setMeetingItemOwner(
  db: Db,
  identity: Identity,
  itemId: string,
  ownerId: string,
): Promise<void> {
  await db.withIdentity(identity, (tx: SqlTx) =>
    tx.unsafe(
      `update echo.meeting_item
          set owner_id = $2
        where id = $1 and kind = 'action'`,
      [itemId, ownerId],
    ),
  );
}

/** Was the call actually left in `ready` with a current summary? */
export async function readCallState(
  db: Db,
  identity: Identity,
  callId: string,
): Promise<{ status: string; current_summary_id: string | null } | null> {
  const rows = await db.withIdentity(identity, (tx: SqlTx) =>
    tx.unsafe<{ status: string; current_summary_id: string | null }>(
      `select status::text as status, current_summary_id from echo.call where id = $1`,
      [callId],
    ),
  );
  return rows[0] ?? null;
}
