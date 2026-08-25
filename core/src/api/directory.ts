/**
 * The people directory (db/0004's `echo.person`, titled by 0062) and the
 * speaker-to-person link — how «S1» becomes a NAME with an org-chart title.
 *
 * Ownership of truth:
 *  - the TITLE vocabulary is db/0062's CHECK constraint; the list here
 *    mirrors it so refusals happen with a sentence before the 23514
 *    backstop re-speaks the same rule;
 *  - RLS scopes every read and write — this layer adds identity and shape,
 *    never authorization;
 *  - linking stamps linked_by/linked_at (who attributed the voice is part
 *    of the record — attribution is a claim about a PERSON).
 */
import { ConflictError, NotActivatedError, NotFoundError, ValidationError } from "./errors.ts";
import { assertUuid, type Db, type SqlTx } from "../db/identity.ts";
import { hasPersonTeams, hasVoiceprints } from "../db/capabilities.ts";
import type { Identity } from "../agent/types.ts";

/** Mirror of 0062's constraint. Codes — the UI localizes. */
export const PERSON_TITLES = [
  "", "ceo", "cto", "coo", "cmo", "cfo",
  "vp", "director", "manager", "lead", "employee", "other",
] as const;
export type PersonTitle = (typeof PERSON_TITLES)[number];

export interface PersonRecord {
  id: string;
  display_name: string;
  title: PersonTitle;
  /** Set when the person IS a platform member (directory ↔ account link). */
  app_user_id: string | null;
  /**
   * Voice enrollment state (db/0081) — WHEN, never the vector: the vector
   * is match-machinery, not display data, and serving it would put a
   * biometric on every directory response for no screen that needs it.
   * ABSENT (not false) before 0081 — the capability pattern.
   */
  voice_enrolled_at?: string | null;
  /**
   * How many clips are averaged into the stored print (db/0096) — a
   * recognition quality the person can act on ("add another sample").
   * ABSENT pre-0096; null when there is no print at all.
   */
  voice_samples?: number | null;
  /**
   * The person's team/department (db/0096) — free text, the org's own
   * vocabulary. ABSENT pre-0096; null when unassigned.
   */
  team?: string | null;
}

const PERSON_COLUMNS = "id, display_name, title, app_user_id";

const toPerson = (row: Record<string, unknown>): PersonRecord => ({
  id: row.id as string,
  display_name: String(row.display_name),
  title: (row.title as PersonTitle) ?? "",
  app_user_id: (row.app_user_id as string | null) ?? null,
  ...(Object.prototype.hasOwnProperty.call(row, "voiceprint_at")
    ? { voice_enrolled_at: row.voiceprint_at ? new Date(row.voiceprint_at as string | Date).toISOString() : null }
    : {}),
  ...(Object.prototype.hasOwnProperty.call(row, "voiceprint_samples")
    ? { voice_samples: (row.voiceprint_samples as number | null) ?? null }
    : {}),
  ...(Object.prototype.hasOwnProperty.call(row, "team")
    ? { team: (row.team as string | null) ?? null }
    : {}),
});

function assertTitle(title: string): asserts title is PersonTitle {
  if (!(PERSON_TITLES as readonly string[]).includes(title)) {
    throw new ValidationError(
      `title must be one of: ${PERSON_TITLES.filter(Boolean).join(", ")} (or empty for none)`,
      { code: "unknown_title" },
    );
  }
}

export function createDirectoryRepo(db: Db) {
  return {
    /** Everyone the caller may see, merged tombstones excluded. */
    async list(identity: Identity): Promise<PersonRecord[]> {
      const withVoice = await hasVoiceprints(db);
      const withTeams = await hasPersonTeams(db);
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<Record<string, unknown>>(
          `select ${PERSON_COLUMNS}${withVoice ? ", voiceprint_at" : ""}${
            withTeams ? ", team, voiceprint_samples" : ""}
             from echo.person
            where merged_into is null
            order by display_name`,
        ),
      );
      return rows.map(toPerson);
    },

    /**
     * MERGE two people (db/0096's door): the loser keeps its id and points
     * at the winner, its voices move, and the directory shows one person
     * where it showed two. Admin-only — the wall is the door's, in SQL.
     */
    async merge(identity: Identity, loserId: string, winnerId: string): Promise<void> {
      const loser = assertUuid(loserId, "person id");
      const winner = assertUuid(winnerId, "person id");
      try {
        await db.withIdentity(identity, (tx: SqlTx) =>
          tx.unsafe(`select echo.merge_person($1, $2)`, [loser, winner]),
        );
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === "42501") {
          throw new NotActivatedError("only an org admin or owner may merge people");
        }
        if (code === "P0002") throw new NotFoundError("no such person");
        if (code === "23514") throw new ValidationError("a person cannot be merged into themselves");
        if (code === "42883") {
          throw new ConflictError("not_migrated"); // deployment predates 0096
        }
        throw error;
      }
    },

    /**
     * Store an enrollment (db/0081). The vector arrives WITH its model's
     * name and both land together — comparing vectors across models is
     * confident nonsense, so the pair is inseparable at every layer.
     */
    async setVoiceprint(
      identity: Identity,
      personId: string,
      input: { vector: number[]; model: string },
    ): Promise<void> {
      const id = assertUuid(personId, "person id");
      if (!(await hasVoiceprints(db))) throw new ConflictError("not_migrated");
      if (input.vector.length < 8 || input.vector.some((v) => !Number.isFinite(v))) {
        throw new ValidationError("degenerate embedding vector");
      }
      /*
       * IMPROVE, don't replace (db/0096): a second clip from the same
       * person under the SAME extractor is averaged into the stored
       * vector — a centroid is the standard multi-sample representation of
       * a voice, and each sample narrows it. A DIFFERENT model replaces
       * outright: vectors from two extractors live in different spaces and
       * averaging them yields confident nonsense (0081's own rule).
       */
      const withSamples = await hasPersonTeams(db);
      let vector = input.vector;
      let samples = 1;
      if (withSamples) {
        const [prior] = await db.withIdentity(identity, (tx: SqlTx) =>
          tx.unsafe<{ voiceprint: number[] | null; voiceprint_model: string | null; voiceprint_samples: number | null }>(
            `select voiceprint, voiceprint_model, voiceprint_samples
               from echo.person where id = $1 and merged_into is null`,
            [id],
          ),
        );
        if (prior?.voiceprint
          && prior.voiceprint_model === input.model
          && prior.voiceprint.length === input.vector.length) {
          const n = prior.voiceprint_samples ?? 1;
          samples = Math.min(50, n + 1);
          vector = input.vector.map((v, i) => ((prior.voiceprint![i]! * n) + v) / (n + 1));
        }
      }
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ id: string }>(
          `update echo.person
              set voiceprint = $2::float8[],
                  voiceprint_model = $3,
                  voiceprint_at = now(),
                  voiceprint_by = $4${withSamples ? ", voiceprint_samples = $5" : ""}
            where id = $1 and merged_into is null
            returning id`,
          withSamples
            ? [id, vector, input.model, identity.userId, samples]
            : [id, vector, input.model, identity.userId],
        ),
      );
      if (!rows[0]) throw new NotFoundError("no such person");
    },

    async clearVoiceprint(identity: Identity, personId: string): Promise<void> {
      const id = assertUuid(personId, "person id");
      if (!(await hasVoiceprints(db))) throw new ConflictError("not_migrated");
      /* the sample count goes WITH the print: db/0097 refuses a count
         without one, so clearing must clear both (capability-gated — a
         pre-0096 deployment has no such column to null) */
      const withSamples = await hasPersonTeams(db);
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ id: string }>(
          `update echo.person
              set voiceprint = null, voiceprint_model = null,
                  voiceprint_at = null, voiceprint_by = null${
                    withSamples ? ", voiceprint_samples = null" : ""}
            where id = $1
            returning id`,
          [id],
        ),
      );
      if (!rows[0]) throw new NotFoundError("no such person");
    },

    /**
     * The match candidates: every enrolled print the caller may see, for
     * ONE model — the worker asks with the extractor's name, so a model
     * upgrade silently excludes stale prints instead of mis-scoring them.
     * Reads the vectors; exists for the matcher, never for a screen.
     */
    async voiceprints(
      identity: Identity,
      model: string,
    ): Promise<{ person_id: string; vector: number[] }[]> {
      if (!(await hasVoiceprints(db))) return [];
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ id: string; voiceprint: number[] }>(
          `select id, voiceprint from echo.person
            where merged_into is null
              and voiceprint is not null
              and voiceprint_model = $1`,
          [model],
        ),
      );
      return rows.map((r) => ({ person_id: r.id, vector: r.voiceprint }));
    },

    async create(
      identity: Identity,
      input: { displayName: string; title?: string | undefined },
    ): Promise<PersonRecord> {
      const name = input.displayName.trim();
      if (!name) throw new ValidationError("a name is required");
      const title = input.title ?? "";
      assertTitle(title);
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<Record<string, unknown>>(
          `insert into echo.person (org_id, display_name, title, created_by)
           values ($1, $2, $3, $4)
           returning ${PERSON_COLUMNS}`,
          [identity.orgId, name, title, identity.userId],
        ),
      );
      if (!rows[0]) throw new ConflictError("could not add the person");
      return toPerson(rows[0]);
    },

    /** Supplied-flags update: omitted leaves alone (names never invented). */
    async update(
      identity: Identity,
      personId: string,
      patch: {
        displayName?: string | undefined;
        title?: string | undefined;
        /** db/0096: "" CLEARS the team, undefined leaves it alone */
        team?: string | undefined;
      },
    ): Promise<PersonRecord> {
      const id = assertUuid(personId, "person id");
      if (patch.displayName !== undefined && !patch.displayName.trim()) {
        throw new ValidationError("a name cannot be blank");
      }
      if (patch.title !== undefined) assertTitle(patch.title);
      if (patch.team !== undefined && patch.team.trim().length > 60) {
        throw new ValidationError("a team name is at most 60 characters",
          { code: "team_too_long", params: { max: 60 } });
      }
      const withTeams = await hasPersonTeams(db);
      if (patch.team !== undefined && !withTeams) {
        throw new ConflictError("not_migrated");
      }
      const setTeam = patch.team !== undefined && withTeams;
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<Record<string, unknown>>(
          `update echo.person set
             display_name = coalesce($2, display_name),
             title        = coalesce($3, title),${
               setTeam ? "\n             team         = $4," : ""}
             updated_at   = now()
           where id = $1 and merged_into is null
           returning ${PERSON_COLUMNS}${withTeams ? ", team, voiceprint_samples" : ""}`,
          setTeam
            ? [id, patch.displayName?.trim() ?? null, patch.title ?? null,
               patch.team!.trim() || null]
            : [id, patch.displayName?.trim() ?? null, patch.title ?? null],
        ),
      );
      if (!rows[0]) throw new NotFoundError("no such person");
      return toPerson(rows[0]);
    },

    /**
     * True delete of a directory person, through db/0076's NAMED DOOR —
     * the role wall (admin/owner) lives in the FUNCTION, below every api
     * route (the D27 altitude rule). Linked speakers are unlinked by the
     * door itself; the speaker rows and transcripts survive.
     */
    async remove(identity: Identity, personId: string, reason: string): Promise<void> {
      const id = assertUuid(personId, "person id");
      if (reason.trim().length < 3) {
        // 0085: deletions carry their reason into the ledger
        throw new ValidationError("a reason is required (at least 3 characters)",
          { code: "reason_required" });
      }
      try {
        await db.withIdentity(identity, (tx: SqlTx) =>
          tx.unsafe(`select echo.delete_person($1, $2::text)`, [id, reason.trim()]));
      } catch (cause) {
        const code = (cause as { code?: string }).code;
        if (code === "42883") {
          // the door does not exist yet — db/0076 has not run here. A
          // nameable nothing (the autonomy precedent), never a crash.
          throw new ConflictError("not_migrated");
        }
        if (code === "42501") throw new NotActivatedError("not permitted");
        if (code === "P0002") throw new NotFoundError("no such person");
        throw cause;
      }
    },

    /**
     * Attribute a voice: link a call's speaker to a person (or unlink with
     * null), and/or rename the LABEL («S1» → whatever reads better before a
     * person is known). The label survives linking — it is the transcript's
     * own word for the voice.
     */
    async updateSpeaker(
      identity: Identity,
      callId: string,
      speakerId: string,
      patch: { personId?: string | null | undefined; label?: string | undefined },
    ): Promise<{ id: string; label: string; person_id: string | null }> {
      const call = assertUuid(callId, "call id");
      const speaker = assertUuid(speakerId, "speaker id");
      if (patch.personId !== undefined && patch.personId !== null) {
        assertUuid(patch.personId, "person id");
      }
      if (patch.label !== undefined && !patch.label.trim()) {
        throw new ValidationError("a speaker label cannot be blank");
      }
      const setPerson = patch.personId !== undefined;
      let rows: Record<string, unknown>[];
      try {
        rows = await db.withIdentity(identity, (tx: SqlTx) =>
          tx.unsafe<Record<string, unknown>>(
            `update echo.call_speaker set
               person_id = case when $3 then $4::uuid else person_id end,
               linked_by = case when $3 then $5::uuid else linked_by end,
               linked_at = case when $3 then now() else linked_at end,
               label     = coalesce($6, label),
               updated_at = now()
             where id = $2 and call_id = $1
             returning id, label, person_id`,
            [call, speaker, setPerson, patch.personId ?? null,
             identity.userId, patch.label?.trim() ?? null],
          ),
        );
      } catch (error) {
        /* 0093: an admin may RENAME a voice, but the directory link is the
           OWNER's act — the db trigger raises 42501 for anyone else. That is
           a legible refusal, not a miswired pool: map it to a 403 instead of
           letting it fall through as a 500 (found live, 2026-08-25). */
        if ((error as { code?: string }).code === "42501") {
          throw new NotActivatedError(
            "only the call's owner may change a voice's directory link");
        }
        throw error;
      }
      if (!rows[0]) throw new NotFoundError("no such speaker on that call");
      return {
        id: rows[0].id as string,
        label: rows[0].label as string,
        person_id: (rows[0].person_id as string | null) ?? null,
      };
    },
  };
}

export type DirectoryRepo = ReturnType<typeof createDirectoryRepo>;
