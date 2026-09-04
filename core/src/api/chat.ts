/**
 * 0184 — the team channel.
 *
 * Everything here runs as the CALLER through withIdentity; 0184's policies are
 * the wall and this file adds no second opinion about who may read what. What
 * it owns:
 *
 *   · UNREAD AS A COMPARISON. `max(seq) > last_read_seq` — never a count that
 *     something has to maintain. The mention badge IS counted, from
 *     `chat_mention` rows, which is exact by construction and stays exact
 *     through deletes, edits and mark-as-unread; a maintained counter gets all
 *     three wrong and nothing tells you when it has.
 *   · MENTIONS RESOLVED AT WRITE TIME. The body keeps the `@handle` the person
 *     typed and a row records WHO that was. The row is what the badge counts,
 *     so a later rename cannot break somebody's unread state; the prose keeps
 *     the spelling that was actually used, which is the honest record of what
 *     was said.
 *   · THE AGENT'S REPLY, posted on the AGENT connection so `author_kind` is
 *     pinned by the role rather than by this file (0184's header).
 */
import { ConflictError, NotFoundError, ValidationError } from "./errors.ts";
import { iso } from "./vocabulary.ts";
import { agentToolsDb, type Db, type SqlTx } from "../db/identity.ts";
import type { Identity } from "../agent/types.ts";

export interface ChatChannelRecord {
  id: string;
  name: string;
  topic: string;
  project_id: string | null;
  archived_at: string | null;
  created_by: string;
  created_at: string;
  /** is the reader in this room's sidebar */
  joined: boolean;
  muted: boolean;
  /** the highest seq in the channel — 0 for an empty room */
  last_seq: number;
  /** how far the reader has got; 0 when they have never opened it */
  last_read_seq: number;
  /** unread is the COMPARISON, and the wire carries the two numbers rather
      than a boolean so a client can render "jump to first unread" too */
  mention_count: number;
}

/** one emoji on one message, folded across everybody who pressed it */
export interface ChatReactionRecord {
  emoji: string;
  count: number;
  /** did the reader press this one — the client needs it to draw the
      pressed state, and computing it there would need every reactor's id */
  mine: boolean;
}

/**
 * The message being answered, resolved for the quote (0189).
 *
 * Carried ON the reply rather than looked up by the client, because the
 * parent may be older than the page in hand: a reply to something from
 * yesterday would otherwise render a quote of nothing, which is the worst
 * shape a quote can take — it looks like the parent was deleted.
 */
export interface ChatReplyPreview {
  id: string;
  author_kind: "user" | "agent";
  author_id: string | null;
  agent_handle: string | null;
  /** null when the parent was tombstoned — the quote then says so, rather
      than quoting an empty string as though somebody had said nothing */
  excerpt: string | null;
}

export interface ChatMessageRecord {
  id: string;
  seq: number;
  channel_id: string;
  author_kind: "user" | "agent";
  author_id: string | null;
  agent_handle: string | null;
  /** null when the message was tombstoned — the row stays, the words go */
  body: string | null;
  deleted: boolean;
  edited_at: string | null;
  created_at: string;
  /** the ids this message named, so a client can highlight without parsing */
  mentions: string[];
  reactions: ChatReactionRecord[];
  reply_to: ChatReplyPreview | null;
}

const MAX_BODY = 20000;
const PAGE = 50;

function cleanBody(value: unknown): string {
  const body = typeof value === "string" ? value.trim() : "";
  if (body === "" || body.length > MAX_BODY) {
    throw new ValidationError("a message needs a body", {
      code: "chat_body_invalid",
      params: { max: String(MAX_BODY) },
    });
  }
  return body;
}

function cleanName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (name === "" || name.length > 80) {
    throw new ValidationError("a channel needs a name", {
      code: "chat_name_invalid",
      params: { max: "80" },
    });
  }
  return name;
}

/**
 * The handles a message named, in the order they appear.
 *
 * ASCII only, because that is what a username is (D24's ruling: "bidi
 * @mention has no unambiguous end"). The boundary is the same shape the
 * router's own name matcher uses — a handle must not be the tail of a longer
 * word, or `@ali` fires inside an email address.
 */
export function handlesIn(body: string): string[] {
  const out: string[] = [];
  for (const match of body.matchAll(/(?<![\w.@-])@([a-z0-9][a-z0-9_-]{0,38})\b/gi)) {
    const handle = match[1]!.toLowerCase();
    if (!out.includes(handle)) out.push(handle);
  }
  return out;
}

const CHANNEL_ROWS = `
  select c.id, c.name, c.topic, c.project_id, c.archived_at,
         c.created_by, c.created_at,
         (m.user_id is not null) as joined,
         coalesce(m.muted, false) as muted,
         coalesce(m.last_read_seq, 0) as last_read_seq,
         coalesce(tip.seq, 0) as last_seq,
         coalesce(men.n, 0) as mention_count
    from echo.chat_channel c
    left join echo.chat_channel_member m
      on m.channel_id = c.id and m.user_id = echo.actor_id()
    left join lateral (
      /* the whole unread mechanism, and it is an index-only scan on
         (channel_id, seq desc): three unread and three hundred thousand
         unread cost the same */
      select max(x.seq) as seq from echo.chat_message x where x.channel_id = c.id
    ) tip on true
    left join lateral (
      select count(*) as n from echo.chat_mention n
       where n.user_id = echo.actor_id() and n.channel_id = c.id
         and n.seq > coalesce(m.last_read_seq, 0)
    ) men on true`;

function toChannel(row: Record<string, unknown>): ChatChannelRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    topic: String(row.topic ?? ""),
    project_id: (row.project_id as string | null) ?? null,
    archived_at: row.archived_at === null || row.archived_at === undefined
      ? null
      : iso(row.archived_at),
    created_by: String(row.created_by),
    created_at: iso(row.created_at),
    joined: row.joined === true,
    muted: row.muted === true,
    last_seq: Number(row.last_seq ?? 0),
    last_read_seq: Number(row.last_read_seq ?? 0),
    mention_count: Number(row.mention_count ?? 0),
  };
}

function toMessage(row: Record<string, unknown>): ChatMessageRecord {
  const deleted = row.deleted_at !== null && row.deleted_at !== undefined;
  const parentGone = row.reply_deleted_at !== null && row.reply_deleted_at !== undefined;
  return {
    id: String(row.id),
    seq: Number(row.seq),
    channel_id: String(row.channel_id),
    author_kind: row.author_kind as "user" | "agent",
    author_id: (row.author_id as string | null) ?? null,
    agent_handle: (row.agent_handle as string | null) ?? null,
    /* THE WORDS GO, THE ROW STAYS. Nulled here rather than at the wall: a
       read policy that hid the row would make the post-image of the delete
       invisible to its own author, which is exactly the 42501 that broke M11
       for members. The client renders a tombstone. */
    body: deleted ? null : String(row.body),
    deleted,
    edited_at: row.edited_at === null || row.edited_at === undefined
      ? null
      : iso(row.edited_at),
    created_at: iso(row.created_at),
    mentions: ((row.mentions as string[] | null) ?? []).map(String),
    reactions: ((row.reactions as ChatReactionRecord[] | null) ?? []).map((r) => ({
      emoji: String(r.emoji),
      count: Number(r.count),
      mine: r.mine === true,
    })),
    reply_to: row.reply_id === null || row.reply_id === undefined ? null : {
      id: String(row.reply_id),
      author_kind: row.reply_author_kind as "user" | "agent",
      author_id: (row.reply_author_id as string | null) ?? null,
      agent_handle: (row.reply_agent_handle as string | null) ?? null,
      /* ONE LINE of it. A quote that reproduces a long message twice on one
         screen is the thing every chat product trims, and trimming at the
         source keeps the wire honest about what the client will draw. */
      excerpt: parentGone ? null : String(row.reply_body ?? "").slice(0, 140),
    },
  };
}

const MESSAGE_ROWS = `
  select m.id, m.seq, m.channel_id, m.author_kind, m.author_id, m.agent_handle,
         m.body, m.edited_at, m.deleted_at, m.created_at,
         coalesce(men.ids, '{}') as mentions,
         coalesce(rx.list, '[]'::jsonb) as reactions,
         p.id as reply_id, p.author_kind as reply_author_kind,
         p.author_id as reply_author_id, p.agent_handle as reply_agent_handle,
         p.body as reply_body, p.deleted_at as reply_deleted_at
    from echo.chat_message m
    left join lateral (
      select array_agg(x.user_id) as ids from echo.chat_mention x where x.message_id = m.id
    ) men on true
    /* FOLDED IN SQL, not in the client: a room with forty reactions on one
       message would otherwise put forty rows on the wire for a control that
       renders three chips. The mine flag is computed here too, and the
       backticks are gone from around it on purpose: this comment lives INSIDE
       a template literal, so one of them ends the SQL string and the file
       stops parsing four lines later at a word that reads like prose.
       The reason for computing it here rather than in the client: the
       alternative ships every reactor's id to answer one boolean. */
    left join lateral (
      select jsonb_agg(jsonb_build_object('emoji', g.emoji, 'count', g.n, 'mine', g.mine)
                       order by g.first_at) as list
        from (
          select r.emoji,
                 count(*)::int as n,
                 bool_or(r.user_id = echo.actor_id()) as mine,
                 min(r.created_at) as first_at
            from echo.chat_reaction r
           where r.message_id = m.id
           group by r.emoji
        ) g
    ) rx on true
    /* the parent, joined rather than fetched by the client — see
       ChatReplyPreview for why the quote cannot be a second read */
    left join echo.chat_message p on p.id = m.reply_to_id`;

export function createChatRepo(db: Db) {
  /** the agent's own handle on the database — role "agent", same actor */
  const asAgent = agentToolsDb(db);

  async function channels(identity: Identity): Promise<ChatChannelRecord[]> {
    return db.withIdentity(identity, async (tx: SqlTx) => {
      const rows = await tx.unsafe<Record<string, unknown>>(
        `${CHANNEL_ROWS} where c.archived_at is null order by c.created_at`,
      );
      return rows.map(toChannel);
    });
  }

  async function channel(identity: Identity, id: string): Promise<ChatChannelRecord> {
    return db.withIdentity(identity, async (tx: SqlTx) => {
      const rows = await tx.unsafe<Record<string, unknown>>(
        `${CHANNEL_ROWS} where c.id = $1`, [id],
      );
      if (!rows[0]) throw new NotFoundError();
      return toChannel(rows[0]);
    });
  }

  async function createChannel(
    identity: Identity,
    input: { name?: unknown; topic?: unknown; project_id?: unknown },
  ): Promise<ChatChannelRecord> {
    const name = cleanName(input.name);
    const topic = typeof input.topic === "string" ? input.topic.trim().slice(0, 200) : "";
    const projectId = typeof input.project_id === "string" && input.project_id !== ""
      ? input.project_id
      : null;
    return db.withIdentity(identity, async (tx: SqlTx) => {
      let id: string;
      try {
        const created = await tx.unsafe<Record<string, unknown>>(
          `insert into echo.chat_channel (org_id, name, topic, project_id, created_by)
           values (echo.actor_org_id(), $1, $2, $3, echo.actor_id())
           returning id`,
          [name, topic, projectId],
        );
        id = String(created[0]!.id);
      } catch (error) {
        /* the unique index on (org, lower(name)) is the enforcer; this
           re-speaks its sentence with the field named */
        if ((error as { code?: string }).code === "23505") {
          throw new ConflictError("a channel with that name exists", {
            code: "chat_name_taken",
            params: { name },
          });
        }
        throw error;
      }
      /* the creator is in the room. A channel you made and are not in shows
         up in nobody's sidebar including your own, which reads as the create
         having silently failed. */
      await tx.unsafe(
        `insert into echo.chat_channel_member (channel_id, user_id, org_id)
         values ($1, echo.actor_id(), echo.actor_org_id()) on conflict do nothing`,
        [id],
      );
      const rows = await tx.unsafe<Record<string, unknown>>(
        `${CHANNEL_ROWS} where c.id = $1`, [id],
      );
      return toChannel(rows[0]!);
    });
  }

  async function updateChannel(
    identity: Identity,
    id: string,
    patch: Record<string, unknown>,
  ): Promise<ChatChannelRecord> {
    const sets: string[] = [];
    const values: unknown[] = [id];
    const put = (col: string, value: unknown) => {
      values.push(value);
      sets.push(`${col} = $${values.length}`);
    };
    if ("name" in patch) put("name", cleanName(patch.name));
    if ("topic" in patch) {
      put("topic", typeof patch.topic === "string" ? patch.topic.trim().slice(0, 200) : "");
    }
    if ("archived" in patch) put("archived_at", patch.archived === true ? new Date() : null);
    if (sets.length === 0) return channel(identity, id);

    return db.withIdentity(identity, async (tx: SqlTx) => {
      const done = await tx.unsafe<Record<string, unknown>>(
        `update echo.chat_channel set ${sets.join(", ")} where id = $1 returning id`,
        values,
      );
      if (!done[0]) throw new NotFoundError();
      const rows = await tx.unsafe<Record<string, unknown>>(
        `${CHANNEL_ROWS} where c.id = $1`, [id],
      );
      return toChannel(rows[0]!);
    });
  }

  /** join or leave. Idempotent both ways — a double click is not an error. */
  async function setJoined(identity: Identity, id: string, on: boolean): Promise<void> {
    await db.withIdentity(identity, async (tx: SqlTx) => {
      if (on) {
        await tx.unsafe(
          `insert into echo.chat_channel_member (channel_id, user_id, org_id)
           values ($1, echo.actor_id(), echo.actor_org_id()) on conflict do nothing`,
          [id],
        );
      } else {
        await tx.unsafe(
          `delete from echo.chat_channel_member where channel_id = $1 and user_id = echo.actor_id()`,
          [id],
        );
      }
    });
  }

  /**
   * A page of a channel, oldest-first.
   *
   * Keyset on `seq`, never an offset: a page boundary that moves when
   * somebody posts is how a scrollback drops a message. `before` is
   * exclusive, so the caller passes the seq of the oldest row it holds.
   */
  async function messages(
    identity: Identity,
    channelId: string,
    opts: { before?: number; after?: number; limit?: number } = {},
  ): Promise<ChatMessageRecord[]> {
    const limit = Math.min(Math.max(opts.limit ?? PAGE, 1), 200);
    return db.withIdentity(identity, async (tx: SqlTx) => {
      if (typeof opts.after === "number") {
        /* THE CATCH-UP QUERY. Every stream connect and reconnect runs this,
           which is what makes the stream a hint and the database the record —
           a dropped event costs nothing because the next connect asks for
           everything after the cursor. */
        const rows = await tx.unsafe<Record<string, unknown>>(
          `${MESSAGE_ROWS} where m.channel_id = $1 and m.seq > $2
            order by m.seq asc limit $3`,
          [channelId, opts.after, limit],
        );
        return rows.map(toMessage);
      }
      const rows = await tx.unsafe<Record<string, unknown>>(
        `${MESSAGE_ROWS} where m.channel_id = $1
           and ($2::bigint is null or m.seq < $2)
          order by m.seq desc limit $3`,
        [channelId, opts.before ?? null, limit],
      );
      return rows.map(toMessage).reverse();
    });
  }

  /**
   * Write one message and the rows for whoever it named.
   *
   * ONE transaction: a mention row that failed to land is an unread badge
   * that never appears, and the person it was for has no way to know the
   * message was addressed to them.
   */
  async function post(
    identity: Identity,
    channelId: string,
    input: { body?: unknown; reply_to?: unknown },
  ): Promise<ChatMessageRecord> {
    const body = cleanBody(input.body);
    const handles = handlesIn(body);
    const replyTo = typeof input.reply_to === "string" && input.reply_to !== ""
      ? input.reply_to
      : null;
    return db.withIdentity(identity, async (tx: SqlTx) => {
      const created = await tx.unsafe<Record<string, unknown>>(
        `insert into echo.chat_message (org_id, channel_id, author_kind, author_id, body, reply_to_id)
         values (echo.actor_org_id(), $1, 'user', echo.actor_id(), $2, $3)
         returning id, seq`,
        [channelId, body, replyTo],
      );
      if (!created[0]) throw new NotFoundError();
      const id = String(created[0].id);
      const seq = Number(created[0].seq);
      await writeMentions(tx, id, channelId, seq, handles);
      /* the author has read their own message by definition — without this
         every send would leave the room looking unread to its own sender */
      await tx.unsafe(
        `update echo.chat_channel_member set last_read_seq = greatest(last_read_seq, $2)
          where channel_id = $1 and user_id = echo.actor_id()`,
        [channelId, seq],
      );
      const rows = await tx.unsafe<Record<string, unknown>>(
        `${MESSAGE_ROWS} where m.id = $1`, [id],
      );
      return toMessage(rows[0]!);
    });
  }

  async function writeMentions(
    tx: SqlTx,
    messageId: string,
    channelId: string,
    seq: number,
    handles: string[],
  ): Promise<void> {
    if (handles.length === 0) return;
    /* ONE statement, resolving handles to ids inside the wall: a lookup
       loop here would be N round trips and, worse, would decide membership
       in application code where the policy already decides it */
    await tx.unsafe(
      `insert into echo.chat_mention (message_id, user_id, org_id, channel_id, seq)
       select $1, u.id, u.org_id, $2, $3
         from echo.app_user u
        where lower(u.username) = any($4::text[])
       on conflict do nothing`,
      [messageId, channelId, seq, handles],
    );
  }

  /**
   * An agent's turn in the room, written on the AGENT connection.
   *
   * `author_kind` is not passed as an argument anywhere: 0184's policy for
   * echo_agent requires 'agent' and a null author, and echo_app's requires
   * 'user' and the caller's id. So the row's attribution is a fact about
   * which role wrote it, and this function cannot post as a person however it
   * is called.
   */
  async function postAsAgent(
    identity: Identity,
    channelId: string,
    handle: string,
    body: string,
  ): Promise<ChatMessageRecord> {
    const text = cleanBody(body);
    /* the agent's OWN words do not fire mentions. A reply that says «@سارا
       را هم در جریان می‌گذارم» would otherwise badge Sara on the strength of
       a sentence the model wrote — Discord's default does exactly this and
       it is how a model ends up able to page everybody. */
    return asAgent.withIdentity(identity, async (tx: SqlTx) => {
      const created = await tx.unsafe<Record<string, unknown>>(
        `insert into echo.chat_message (org_id, channel_id, author_kind, agent_handle, body)
         values (echo.actor_org_id(), $1, 'agent', $2, $3)
         returning id`,
        [channelId, handle, text],
      );
      if (!created[0]) throw new NotFoundError();
      const rows = await tx.unsafe<Record<string, unknown>>(
        `${MESSAGE_ROWS} where m.id = $1`, [String(created[0].id)],
      );
      return toMessage(rows[0]!);
    });
  }

  /** edit your own words; tombstone your own, or anybody's as an admin */
  async function editMessage(
    identity: Identity,
    id: string,
    patch: { body?: unknown; deleted?: unknown },
  ): Promise<ChatMessageRecord> {
    return db.withIdentity(identity, async (tx: SqlTx) => {
      if (patch.deleted === true) {
        const done = await tx.unsafe<Record<string, unknown>>(
          `update echo.chat_message set deleted_at = now()
            where id = $1 and deleted_at is null returning id`,
          [id],
        );
        /* an already-tombstoned message is not an error: the second press of
           a button whose first press worked must not report a failure */
        if (!done[0]) {
          const still = await tx.unsafe<Record<string, unknown>>(
            `${MESSAGE_ROWS} where m.id = $1`, [id],
          );
          if (!still[0]) throw new NotFoundError();
          return toMessage(still[0]);
        }
      } else {
        const body = cleanBody(patch.body);
        const done = await tx.unsafe<Record<string, unknown>>(
          `update echo.chat_message set body = $2, edited_at = now()
            where id = $1 and deleted_at is null returning id`,
          [id, body],
        );
        if (!done[0]) throw new NotFoundError();
      }
      const rows = await tx.unsafe<Record<string, unknown>>(
        `${MESSAGE_ROWS} where m.id = $1`, [id],
      );
      return toMessage(rows[0]!);
    });
  }

  /**
   * Move the reader's cursor. `greatest()` because a stale client — a second
   * tab, a reconnect replaying an old ack — must never move it backwards.
   */
  async function markRead(identity: Identity, channelId: string, seq: number): Promise<void> {
    await db.withIdentity(identity, async (tx: SqlTx) => {
      await tx.unsafe(
        `insert into echo.chat_channel_member (channel_id, user_id, org_id, last_read_seq)
         values ($1, echo.actor_id(), echo.actor_org_id(), $2)
         on conflict (channel_id, user_id)
         do update set last_read_seq = greatest(echo.chat_channel_member.last_read_seq, excluded.last_read_seq)`,
        [channelId, Math.max(0, Math.floor(seq))],
      );
    });
  }

  /**
   * Press an emoji, or press it again to take it back (0189).
   *
   * `on` is explicit rather than a toggle the server derives, because a
   * toggle makes the outcome depend on what the server thinks the current
   * state is — and two quick presses from one person then race each other
   * into whichever order the connections happened to take. The client knows
   * what it drew; it says what it wants.
   */
  async function react(
    identity: Identity,
    messageId: string,
    emoji: string,
    on: boolean,
  ): Promise<ChatMessageRecord> {
    const clean = typeof emoji === "string" ? emoji.trim() : "";
    if (clean === "" || [...clean].length > 8) {
      throw new ValidationError("a reaction is one emoji", { code: "chat_emoji_invalid" });
    }
    await db.withIdentity(identity, async (tx: SqlTx) => {
      if (on) {
        await tx.unsafe(
          `insert into echo.chat_reaction (message_id, user_id, emoji, org_id)
           select m.id, echo.actor_id(), $2, m.org_id
             from echo.chat_message m where m.id = $1
           on conflict do nothing`,
          [messageId, clean],
        );
      } else {
        await tx.unsafe(
          `delete from echo.chat_reaction
            where message_id = $1 and user_id = echo.actor_id() and emoji = $2`,
          [messageId, clean],
        );
      }
    });
    /* the WHOLE message back, not the reaction: the caller has to redraw the
       chip row anyway, and returning a fragment would make the client
       reassemble a count it can simply be told */
    return db.withIdentity(identity, async (tx: SqlTx) => {
      const rows = await tx.unsafe<Record<string, unknown>>(
        `${MESSAGE_ROWS} where m.id = $1`, [messageId],
      );
      if (!rows[0]) throw new NotFoundError();
      return toMessage(rows[0]);
    });
  }

  return {
    channels, channel, createChannel, updateChannel, setJoined,
    messages, post, postAsAgent, editMessage, markRead, react,
  };
}

export type ChatRepo = ReturnType<typeof createChatRepo>;
