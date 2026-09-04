/**
 * 0189 — an invitation somebody accepts.
 *
 * READ THE MIGRATION'S HEADER BEFORE ADDING A PERMISSION HERE. An invitation
 * grants nothing: both things it points at are already readable by every
 * active member of the org (0184 for a channel, 0145 for a meeting). What it
 * carries is attention and a one-press way in — it says somebody wants you
 * there, it survives a reload where a toast does not, and accepting puts the
 * room in your own sidebar and takes you to it.
 *
 * Everything here runs as the CALLER through withIdentity; 0189's policies are
 * the wall — who may invite (an admin for a room, anybody for a meeting), who
 * may answer (the invitee alone), and who may withdraw (the inviter).
 */
import { NotFoundError, ValidationError } from "./errors.ts";
import { iso } from "./vocabulary.ts";
import type { Db, SqlTx } from "../db/identity.ts";
import type { Identity } from "../agent/types.ts";

export const INVITE_KINDS = ["chat_channel", "meeting"] as const;
export type InviteKind = (typeof INVITE_KINDS)[number];

export interface JoinInviteRecord {
  id: string;
  kind: InviteKind;
  target_id: string;
  /** the room's name or the meeting's title, resolved for the bell */
  target_title: string;
  invited_by: string;
  created_at: string;
}

function parseKind(value: unknown): InviteKind {
  if (typeof value !== "string" || !(INVITE_KINDS as readonly string[]).includes(value)) {
    throw new ValidationError("unknown invitation kind", {
      code: "invite_kind_invalid", params: { kinds: INVITE_KINDS.join(", ") },
    });
  }
  return value as InviteKind;
}

/**
 * The inbox query.
 *
 * The JOINs are INNER on each kind's own table and the two halves are UNIONed,
 * which is what DROPS an invitation whose target is gone — the behaviour
 * 0189's header promised when it declined a polymorphic foreign key. An
 * invitation to a deleted meeting is not an error to report; it is a row that
 * no longer means anything, and rendering "you were invited to «»" would be
 * worse than saying nothing.
 */
const INBOX = `
  select i.id, i.kind, i.target_id, c.name as target_title, i.invited_by, i.created_at
    from echo.join_invite i
    join echo.chat_channel c on c.id = i.target_id and c.archived_at is null
   where i.invitee_id = echo.actor_id() and i.state = 'pending'
     and i.kind = 'chat_channel'
  union all
  select i.id, i.kind, i.target_id, m.title as target_title, i.invited_by, i.created_at
    from echo.join_invite i
    join echo.meeting m on m.id = i.target_id and m.archived_at is null
   where i.invitee_id = echo.actor_id() and i.state = 'pending'
     and i.kind = 'meeting'
   order by created_at desc
   limit 50`;

export function createInvitesRepo(db: Db) {
  async function inbox(identity: Identity): Promise<JoinInviteRecord[]> {
    return db.withIdentity(identity, async (tx: SqlTx) => {
      const rows = await tx.unsafe<Record<string, unknown>>(INBOX);
      return rows.map((r) => ({
        id: String(r.id),
        kind: r.kind as InviteKind,
        target_id: String(r.target_id),
        target_title: String(r.target_title ?? ""),
        invited_by: String(r.invited_by),
        created_at: iso(r.created_at),
      }));
    });
  }

  /**
   * Invite people. One statement for the whole list.
   *
   * `on conflict do nothing` is what makes "add all members" idempotent: the
   * unique key is (kind, target, invitee), so pressing it twice is the same
   * invitation rather than a second notification about the same room. It also
   * means somebody already invited is silently skipped, which is the right
   * answer — the alternative is refusing the whole batch because one person
   * was already on the list.
   *
   * SOMEBODY ALREADY IN THE ROOM IS SKIPPED TOO, and that one is not a
   * nicety: an invitation to a room you are standing in is a notification
   * that can only confuse, and it would arrive most often to exactly the
   * people who set the room up.
   */
  async function invite(
    identity: Identity,
    input: { kind?: unknown; target_id?: unknown; user_ids?: unknown },
  ): Promise<{ invited: number }> {
    const kind = parseKind(input.kind);
    const targetId = typeof input.target_id === "string" && input.target_id !== ""
      ? input.target_id
      : null;
    if (targetId === null) {
      throw new ValidationError("an invitation needs a target", { code: "invite_target_missing" });
    }
    const userIds = Array.isArray(input.user_ids)
      ? input.user_ids.filter((v): v is string => typeof v === "string" && v !== "").slice(0, 500)
      : [];
    if (userIds.length === 0) return { invited: 0 };

    return db.withIdentity(identity, async (tx: SqlTx) => {
      const rows = await tx.unsafe<Record<string, unknown>>(
        `insert into echo.join_invite (org_id, kind, target_id, invitee_id, invited_by)
         select echo.actor_org_id(), $1, $2, u.id, echo.actor_id()
           from echo.app_user u
          where u.id = any($3::uuid[])
            and u.org_id = echo.actor_org_id()
            and u.status = 'active'
            /* not yourself: inviting the person doing the inviting is a
               notification about a decision they just made */
            and u.id <> echo.actor_id()
            and not exists (
              select 1 from echo.chat_channel_member m
               where $1 = 'chat_channel' and m.channel_id = $2 and m.user_id = u.id)
         on conflict do nothing
         returning id`,
        [kind, targetId, userIds],
      );
      return { invited: rows.length };
    });
  }

  /**
   * Answer one.
   *
   * ACCEPTING A ROOM JOINS IT, in the same transaction as the answer: the
   * membership row and the `accepted` state are one fact, and writing them
   * separately would leave "they said yes" true while the room is not in
   * their sidebar — a state whose only symptom is somebody wondering why the
   * room did not appear.
   *
   * Accepting a MEETING writes nothing but the answer, and that is not an
   * omission: the meeting was always readable, the invitee list is the
   * meeting's own field, and the accept exists so the person can say yes and
   * be taken there. Adding a second membership table for it would be
   * inventing a wall to have something to open.
   */
  async function respond(
    identity: Identity,
    id: string,
    state: "accepted" | "declined",
  ): Promise<{ kind: InviteKind; target_id: string }> {
    return db.withIdentity(identity, async (tx: SqlTx) => {
      const rows = await tx.unsafe<Record<string, unknown>>(
        `update echo.join_invite
            set state = $2, responded_at = now()
          where id = $1 and state = 'pending'
        returning kind, target_id`,
        [id, state],
      );
      if (!rows[0]) throw new NotFoundError();
      const kind = rows[0].kind as InviteKind;
      const targetId = String(rows[0].target_id);

      if (state === "accepted" && kind === "chat_channel") {
        await tx.unsafe(
          `insert into echo.chat_channel_member (channel_id, user_id, org_id)
           values ($1, echo.actor_id(), echo.actor_org_id())
           on conflict do nothing`,
          [targetId],
        );
      }
      return { kind, target_id: targetId };
    });
  }

  /** the inviter taking one back — the invitee's "no" is `declined`, a state */
  async function withdraw(identity: Identity, id: string): Promise<void> {
    await db.withIdentity(identity, async (tx: SqlTx) => {
      await tx.unsafe(`delete from echo.join_invite where id = $1`, [id]);
    });
  }

  return { inbox, invite, respond, withdraw };
}

export type InvitesRepo = ReturnType<typeof createInvitesRepo>;
