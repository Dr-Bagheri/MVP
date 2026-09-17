/**
 * THE MINUTES ARE SIGNED (db/0229).
 *
 * User directive, 2026-09-17: each attendee, in their own account, opens the
 * meeting and signs its summary; when the host prints, every real signature
 * — uploaded as a JPG or PNG — is already on the page.
 *
 * Two facts, two tables, one repo:
 *
 *   the signature ON FILE     `user_signature` — a person's picture of their
 *                             own hand, read and written by them alone;
 *   the signature ON A MEETING `meeting_signature` — that picture SNAPSHOTTED
 *                             onto a meeting at the moment of signing, keyed
 *                             (meeting, person), read by whoever reads the
 *                             meeting.
 *
 * Nothing here decides who may sign: the policy asks `echo.actor_on_meeting`
 * and names the actor on the row, so a signature in a colleague's name or on
 * a meeting the caller was not in is refused by the database, not by this
 * file remembering to check. What this file decides is WHICH NOTHING a
 * refused signing is (rule 12): "you have no signature on file" is a thing
 * the person can fix in their profile, and "you were not in this meeting" is
 * not, and they must not arrive as one sentence.
 *
 * ONCE. A second signing meets the primary key (23505) and is reported as
 * `already_signed`; re-signing is withdrawing and signing again, two acts
 * done on purpose. There is no update path and no grant for one.
 */
import type { Db, SqlTx } from "../db/identity.ts";
import type { Identity } from "../agent/types.ts";
import { hasMeetingSignatures } from "../db/capabilities.ts";
import { ConflictError, NotFoundError } from "./errors.ts";

export interface MeetingSignatureRow {
  user_id: string;
  /** resolved from user management at read time, the roster's own rule:
      a rename reaches every signed meeting */
  display_name: string;
  display_name_en: string | null;
  username: string | null;
  mime: string;
  signed_at: string;
}

export interface MeetingSignaturesRecord {
  signatures: MeetingSignatureRow[];
  /**
   * Whether the CALLER may sign this meeting — its host, or on its roster.
   * The same question the insert policy asks, asked ahead of time so the
   * screen draws a button only for somebody the server would let press it.
   */
  can_sign: boolean;
  /** the caller has a signature on file (their own — the read is self-scoped) */
  has_signature_on_file: boolean;
  /** the caller's own signature is already on this meeting */
  signed: boolean;
}

interface SignatureRow {
  user_id: string;
  display_name: string;
  display_name_en: string | null;
  username: string | null;
  mime: string;
  signed_at: Date;
}

export function createSignaturesRepo(db: Db) {
  /** The caller's own signature on file, or null. Self-scoped by policy. */
  async function mine(identity: Identity): Promise<{ bytes: Buffer; mime: string } | null> {
    if (!(await hasMeetingSignatures(db))) return null;
    const rows = await db.withIdentity(identity, (tx: SqlTx) =>
      tx.unsafe<{ bytes: Buffer; mime: string }>(
        `select bytes, mime from echo.user_signature where user_id = echo.actor_id()`,
      ));
    const row = rows[0];
    return row === undefined ? null : { bytes: row.bytes, mime: row.mime };
  }

  /**
   * Keep or drop the caller's signature on file. An UPSERT: a person
   * replacing their signature does not first delete the old one, and two
   * rows for one person is what the primary key refuses anyway.
   */
  async function setMine(identity: Identity, image: { bytes: Buffer; mime: string } | null): Promise<void> {
    if (!(await hasMeetingSignatures(db))) throw new ConflictError("not_migrated");
    await db.withIdentity(identity, async (tx: SqlTx) => {
      if (image === null) {
        await tx.unsafe(`delete from echo.user_signature where user_id = echo.actor_id()`);
        return;
      }
      await tx.unsafe(
        `insert into echo.user_signature (user_id, org_id, bytes, mime)
         values (echo.actor_id(), echo.actor_org_id(), $1, $2)
         on conflict (user_id) do update
           set bytes = excluded.bytes, mime = excluded.mime, updated_at = now()`,
        [image.bytes, image.mime],
      );
    });
  }

  /**
   * The signatures placed on a meeting, with the three facts the screen
   * needs about the CALLER. 404 when the meeting is not theirs to read — the
   * same not-probeable posture every meeting read takes.
   */
  async function forMeeting(identity: Identity, meetingId: string): Promise<MeetingSignaturesRecord> {
    if (!(await hasMeetingSignatures(db))) {
      return { signatures: [], can_sign: false, has_signature_on_file: false, signed: false };
    }
    return db.withIdentity(identity, async (tx: SqlTx) => {
      const meeting = await tx.unsafe<{ id: string }>(
        `select id from echo.meeting where id = $1`, [meetingId],
      );
      if (!meeting[0]) throw new NotFoundError();
      const rows = await tx.unsafe<SignatureRow>(
        `select s.user_id, u.display_name, u.display_name_en, u.username, s.mime, s.signed_at
           from echo.meeting_signature s
           join echo.app_user u on u.id = s.user_id
          where s.meeting_id = $1
          order by s.signed_at asc`,
        [meetingId],
      );
      /* the three facts in one round trip — the room through the same
         definer helper the policy asks, the file through its self-scoped
         read, the caller's own row by their id */
      const facts = await tx.unsafe<{ on_meeting: boolean; on_file: boolean }>(
        `select echo.actor_on_meeting($1) as on_meeting,
                exists (select 1 from echo.user_signature where user_id = echo.actor_id()) as on_file`,
        [meetingId],
      );
      const fact = facts[0];
      return {
        signatures: rows.map((r) => ({
          user_id: r.user_id,
          display_name: r.display_name,
          display_name_en: r.display_name_en,
          username: r.username,
          mime: r.mime,
          signed_at: r.signed_at.toISOString(),
        })),
        can_sign: fact?.on_meeting === true,
        has_signature_on_file: fact?.on_file === true,
        signed: rows.some((r) => r.user_id === identity.userId),
      };
    });
  }

  /**
   * SIGN. With `image`, the picture is filed first (the person who has none
   * yet uploads it right there — one act, not a trip to the profile and
   * back); either way what lands on the meeting is a COPY of the row on
   * file, taken inside the same transaction, so what was signed with is what
   * the file held at that second.
   *
   * Two refusals, told apart on purpose:
   *   · nothing on file → the insert-select inserts NOTHING and raises
   *     nothing, and that zero is `no_signature_on_file` — a thing the
   *     person can fix;
   *   · not in the room → the policy raises 42501, which reaches the caller
   *     as the 404 every unwritable row is (errors.ts).
   */
  async function sign(
    identity: Identity,
    meetingId: string,
    image?: { bytes: Buffer; mime: string },
  ): Promise<MeetingSignaturesRecord> {
    if (!(await hasMeetingSignatures(db))) throw new ConflictError("not_migrated");
    await db.withIdentity(identity, async (tx: SqlTx) => {
      if (image !== undefined) {
        await tx.unsafe(
          `insert into echo.user_signature (user_id, org_id, bytes, mime)
           values (echo.actor_id(), echo.actor_org_id(), $1, $2)
           on conflict (user_id) do update
             set bytes = excluded.bytes, mime = excluded.mime, updated_at = now()`,
          [image.bytes, image.mime],
        );
      }
      let placed: Array<{ user_id: string }>;
      try {
        placed = await tx.unsafe<{ user_id: string }>(
          `insert into echo.meeting_signature (meeting_id, user_id, org_id, bytes, mime)
           select $1::uuid, f.user_id, f.org_id, f.bytes, f.mime
             from echo.user_signature f
            where f.user_id = echo.actor_id()
           returning user_id`,
          [meetingId],
        );
      } catch (cause) {
        if ((cause as { code?: string }).code === "23505") {
          throw new ConflictError("this meeting is already signed by you", { code: "already_signed" });
        }
        throw cause;
      }
      if (placed.length === 0) {
        throw new ConflictError("no signature on file to sign with", { code: "no_signature_on_file" });
      }
    });
    return forMeeting(identity, meetingId);
  }

  /** WITHDRAW your own. 404 when there was nothing to withdraw — the delete's
      own RETURNING says so, rather than a second read that could disagree. */
  async function withdraw(identity: Identity, meetingId: string): Promise<MeetingSignaturesRecord> {
    if (!(await hasMeetingSignatures(db))) throw new ConflictError("not_migrated");
    const gone = await db.withIdentity(identity, (tx: SqlTx) => tx.unsafe<{ user_id: string }>(
      `delete from echo.meeting_signature
        where meeting_id = $1 and user_id = echo.actor_id()
        returning user_id`,
      [meetingId],
    ));
    if (gone.length === 0) throw new NotFoundError();
    return forMeeting(identity, meetingId);
  }

  /** One placed signature's picture — what the document builder fetches. */
  async function image(
    identity: Identity, meetingId: string, userId: string,
  ): Promise<{ bytes: Buffer; mime: string } | null> {
    if (!(await hasMeetingSignatures(db))) return null;
    const rows = await db.withIdentity(identity, (tx: SqlTx) =>
      tx.unsafe<{ bytes: Buffer; mime: string }>(
        `select bytes, mime from echo.meeting_signature where meeting_id = $1 and user_id = $2`,
        [meetingId, userId],
      ));
    const row = rows[0];
    return row === undefined ? null : { bytes: row.bytes, mime: row.mime };
  }

  return { mine, setMine, forMeeting, sign, withdraw, image };
}

export type SignaturesRepo = ReturnType<typeof createSignaturesRepo>;
