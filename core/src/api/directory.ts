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
}

const PERSON_COLUMNS = "id, display_name, title, app_user_id";

const toPerson = (row: Record<string, unknown>): PersonRecord => ({
  id: row.id as string,
  display_name: String(row.display_name),
  title: (row.title as PersonTitle) ?? "",
  app_user_id: (row.app_user_id as string | null) ?? null,
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
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<Record<string, unknown>>(
          `select ${PERSON_COLUMNS} from echo.person
            where merged_into is null
            order by display_name`,
        ),
      );
      return rows.map(toPerson);
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
      patch: { displayName?: string | undefined; title?: string | undefined },
    ): Promise<PersonRecord> {
      const id = assertUuid(personId, "person id");
      if (patch.displayName !== undefined && !patch.displayName.trim()) {
        throw new ValidationError("a name cannot be blank");
      }
      if (patch.title !== undefined) assertTitle(patch.title);
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<Record<string, unknown>>(
          `update echo.person set
             display_name = coalesce($2, display_name),
             title        = coalesce($3, title),
             updated_at   = now()
           where id = $1 and merged_into is null
           returning ${PERSON_COLUMNS}`,
          [id, patch.displayName?.trim() ?? null, patch.title ?? null],
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
    async remove(identity: Identity, personId: string): Promise<void> {
      const id = assertUuid(personId, "person id");
      try {
        await db.withIdentity(identity, (tx: SqlTx) =>
          tx.unsafe(`select echo.delete_person($1)`, [id]));
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
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
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
