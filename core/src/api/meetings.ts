/**
 * 0145 — meetings (the reference adoption, 2026-08-31).
 *
 * A meeting is a SCHEDULED fact that later gains a record. Everything here
 * runs as the CALLER through withIdentity; the org-sharing and the org wall
 * are db/0145's policies, and this file adds no second opinion. What it
 * owns:
 *
 *   · the MODE vocabulary — upload | in_person | online. Online is the
 *     section the reference has and we did not: the recorder's
 *     system-audio source captures both sides of an online meeting, so the
 *     client maps mode to source and this file only guards the closed set.
 *   · the AGENDA shape — [{title, minutes}] validated here field by field,
 *     because jsonb_typeof(array) is the table's whole opinion and a
 *     free-shape agenda would render as [object Object] forever.
 *   · linking the RECORD — call_id is patched in when the recorder starts,
 *     and the meeting read resolves the call's title so the post stage can
 *     say what it produced without a second fetch.
 */
import { NotFoundError, ValidationError, ConflictError } from "./errors.ts";
import { iso } from "./vocabulary.ts";
import type { Db, SqlTx } from "../db/identity.ts";
import type { Identity } from "../agent/types.ts";

export const MEETING_MODES = ["upload", "in_person", "online"] as const;
export type MeetingMode = (typeof MEETING_MODES)[number];

/**
 * 0160 — the five things a meeting produces, as ROWS.
 *
 * These used to be slices of the summary's prose, which is why they could
 * only ever be read: "remove this action item" against a paragraph means
 * rewriting a model's text and hoping the headings still line up. They are
 * rows now, so a person can add one before a word has been recorded and edit
 * one the assistant heard.
 */
export const MEETING_ITEM_KINDS = ["decision", "action", "question", "risk", "entity"] as const;
export type MeetingItemKind = (typeof MEETING_ITEM_KINDS)[number];

export interface MeetingItemRecord {
  id: string;
  kind: MeetingItemKind;
  body: string;
  /** WHO SAID SO — pinned by the writing role, never supplied (0160). The
      badge on screen is therefore a fact, not a claim. */
  source: "user" | "ai";
  done: boolean;
  owner: string | null;
  /** the moment in the recording this came from; null = a person typed it,
      which is a different thing from "at zero" */
  at_ms: number | null;
  created_at: string;
}

export interface MeetingAgendaItem {
  title: string;
  /** planned minutes — null = unplanned, never 0 (a zero-minute item is a
      claim; an unplanned one is an absence) */
  minutes: number | null;
}

export interface MeetingSignature {
  name: string;
  /** the signer's app_user id — the DEDUPE key (a display name changes with
      locale and rename; an id does not) */
  user_id: string | null;
  at: string;
}

export interface MeetingRecord {
  id: string;
  title: string;
  scheduled_at: string;
  duration_minutes: number | null;
  mode: MeetingMode;
  /** 0151: the folder's id — the NAME travels beside it, resolved by join */
  topic_id: string | null;
  topic: string | null;
  location: string | null;
  description: string;
  invitees: string[];
  agenda: MeetingAgendaItem[];
  /** the record this meeting produced — null until the recorder links it,
      and null again if the call was purged (SET NULL) */
  call_id: string | null;
  call_title: string | null;
  archived: boolean;
  created_by: string;
  /** the host's display names, resolved from `created_by` — null only when
      the author has been tombstoned, which is a real state and not an error */
  host_name: string | null;
  host_name_en: string | null;
  created_at: string;
  /** 0148: the meeting's video room — null is a normal state */
  video_url: string | null;
  video_provider: "google_meet" | "custom" | null;
  /* 0146 — the minutes' lifecycle: draft -> approved -> signed -> closed */
  minutes_approved_at: string | null;
  minutes_closed_at: string | null;
  minutes_signatures: MeetingSignature[];
}

const MEETING_ROWS = `
  select m.id, m.title, m.scheduled_at, m.duration_minutes, m.mode,
         m.topic_id, mt.name as topic,
         m.location, m.description, m.invitees, m.agenda, m.call_id,
         c.title as call_title, m.archived_at, m.created_by, m.created_at,
         /* the HOST's names, resolved the way the topic's is. created_by is
            an id, and every surface that wanted to say who ran the meeting was
            resolving it separately or, worse, showing the VIEWER: the minutes
            listed no attendees at all (the host is not among the invitees --
            nobody invites themselves), and the plan card labelled whoever was
            looking at it as the host. One join, one answer.
            NB: no backticks in here. This is a template literal, and a
            backtick in a comment ends the SQL string. */
         hu.display_name as host_name, hu.display_name_en as host_name_en,
         m.minutes_approved_at, m.minutes_closed_at, m.minutes_signatures,
         m.video_url, m.video_provider
    from echo.meeting m
    left join echo.call c on c.id = m.call_id
    /* LEFT: a meeting with no folder is the ordinary state, and an inner
       join here would hide every one of them from the list */
    left join echo.meeting_topic mt on mt.id = m.topic_id
    /* LEFT as well: a tombstoned author leaves the meeting standing, and an
       inner join would delete the meeting from every list along with them */
    left join echo.app_user hu on hu.id = m.created_by`;

function toMeeting(row: Record<string, unknown>): MeetingRecord {
  const rawAgenda = Array.isArray(row.agenda) ? row.agenda : [];
  return {
    id: String(row.id),
    title: String(row.title),
    scheduled_at: iso(row.scheduled_at),
    duration_minutes: row.duration_minutes === null || row.duration_minutes === undefined
      ? null : Number(row.duration_minutes),
    mode: row.mode as MeetingMode,
    topic_id: (row.topic_id as string | null) ?? null,
    /* the NAME, joined — a client rendering a chip needs the word, and a
       second copy of it on the meeting row is the two-spellings defect the
       migration exists to end */
    topic: (row.topic as string | null) ?? null,
    location: (row.location as string | null) ?? null,
    description: String(row.description ?? ""),
    invitees: (row.invitees as string[]) ?? [],
    agenda: rawAgenda.map((item) => ({
      title: String((item as Record<string, unknown>).title ?? ""),
      minutes: (item as Record<string, unknown>).minutes === null ||
               (item as Record<string, unknown>).minutes === undefined
        ? null : Number((item as Record<string, unknown>).minutes),
    })),
    call_id: (row.call_id as string | null) ?? null,
    call_title: (row.call_title as string | null) ?? null,
    archived: row.archived_at !== null && row.archived_at !== undefined,
    created_by: String(row.created_by),
    host_name: row.host_name === null || row.host_name === undefined ? null : String(row.host_name),
    host_name_en: row.host_name_en === null || row.host_name_en === undefined
      ? null : String(row.host_name_en),
    created_at: iso(row.created_at),
    video_url: (row.video_url as string | null) ?? null,
    video_provider: (row.video_provider as "google_meet" | "custom" | null) ?? null,
    minutes_approved_at: row.minutes_approved_at === null || row.minutes_approved_at === undefined
      ? null : iso(row.minutes_approved_at),
    minutes_closed_at: row.minutes_closed_at === null || row.minutes_closed_at === undefined
      ? null : iso(row.minutes_closed_at),
    minutes_signatures: (Array.isArray(row.minutes_signatures) ? row.minutes_signatures : [])
      .map((sig) => ({
        name: String((sig as Record<string, unknown>).name ?? ""),
        user_id: ((sig as Record<string, unknown>).user_id as string | null | undefined) ?? null,
        at: String((sig as Record<string, unknown>).at ?? ""),
      }))
      .filter((sig) => sig.name !== ""),
  };
}

function parseMode(value: unknown): MeetingMode {
  if (typeof value === "string" && (MEETING_MODES as readonly string[]).includes(value)) {
    return value as MeetingMode;
  }
  throw new ValidationError("unknown meeting mode", { code: "meeting_mode_unknown" });
}

function parseWhen(value: unknown): string {
  const at = new Date(String(value ?? ""));
  if (Number.isNaN(at.getTime())) {
    throw new ValidationError("unreadable meeting time", { code: "meeting_time_invalid" });
  }
  return at.toISOString();
}

/** [{title, minutes}] — validated field by field, defaults applied */
function parseAgenda(value: unknown): MeetingAgendaItem[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new ValidationError("agenda must be a list", { code: "meeting_agenda_invalid" });
  }
  return value.map((item) => {
    const rec = item as Record<string, unknown>;
    const title = typeof rec.title === "string" ? rec.title.trim() : "";
    if (title === "" || title.length > 300) {
      throw new ValidationError("agenda item needs a title", { code: "meeting_agenda_invalid" });
    }
    let minutes: number | null = null;
    if (rec.minutes !== null && rec.minutes !== undefined && rec.minutes !== "") {
      minutes = Number(rec.minutes);
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
        throw new ValidationError("agenda minutes out of range", { code: "meeting_agenda_invalid" });
      }
    }
    return { title, minutes };
  });
}

function parseInvitees(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new ValidationError("invitees must be a list", { code: "meeting_invitees_invalid" });
  }
  return value
    .map((v) => String(v).trim())
    .filter((v) => v !== "")
    .slice(0, 100);
}

/**
 * Slice a summary's prose into typed items.
 *
 * This logic used to live in the BROWSER, in two copies — the review panel
 * and the minutes document — each with its own regexes, which is how the
 * minutes came to say "no decisions extracted" about decisions the review
 * panel was displaying. It is one function on the server now, and its output
 * is rows rather than a rendering, so every reader agrees by construction.
 *
 * The patterns match the headings the SHIPPED summary templates actually
 * write (تصمیم‌ها، اقدامات بعدی، موانع و مشکلات…). A pattern that matches no
 * heading any producer ever emits is a category that is always empty while
 * reading as wired, which is the defect this whole area started as.
 */
const SECTIONS: Array<{ kind: MeetingItemKind; match: RegExp }> = [
  { kind: "decision", match: /مصوب|تصمیم/ },
  { kind: "action", match: /اکشن|اقدام|کار بعدی/ },
  { kind: "question", match: /سؤال|سوال|پرسش/ },
  { kind: "risk", match: /ریسک|خطر|موانع|مشکل|چالش/ },
  { kind: "entity", match: /موجودیت|افراد و سازمان/ },
];

export function sliceSummary(text: string): Array<{ kind: MeetingItemKind; body: string }> {
  const out: Array<{ kind: MeetingItemKind; body: string }> = [];
  let current: MeetingItemKind | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") continue;
    /* a HEADING is a markdown hash, a bold line, or a short line ending in a
       colon — the three shapes the templates produce. Anything else inside a
       section is an item. */
    const heading = /^#{1,6}\s+(.*)$/.exec(line)
      ?? /^\*\*(.+?)\*\*:?$/.exec(line)
      ?? (line.length <= 40 && line.endsWith(":") ? [line, line.slice(0, -1)] : null);
    if (heading !== null) {
      const title = String(heading[1] ?? "").trim();
      const hit = SECTIONS.find((sec) => sec.match.test(title));
      current = hit === undefined ? null : hit.kind;
      continue;
    }
    if (current === null) continue;
    /* strip a bullet or a number, then keep the sentence */
    const body = line.replace(/^([-*•]|\d+[.)])\s*/, "").trim();
    if (body === "") continue;
    out.push({ kind: current, body: body.slice(0, 2000) });
  }
  return out;
}

export function createMeetingsRepo(db: Db) {
  async function list(identity: Identity, opts: { archived?: boolean } = {}): Promise<MeetingRecord[]> {
    return db.withIdentity(identity, async (tx: SqlTx) => {
      const rows = await tx.unsafe<Record<string, unknown>>(
        `${MEETING_ROWS}
          where m.archived_at is ${opts.archived ? "not null" : "null"}
          order by m.scheduled_at`,
      );
      return rows.map(toMeeting);
    });
  }

  /**
   * Resolve a GUEST's join code — the one read on this surface that takes no
   * identity, because a guest has none. The code is the authorisation.
   *
   * `withoutIdentity` is the honest spelling and it is why the SQL function
   * behind it returns three columns: no RLS stands between this and the row,
   * so the wall is the shape of what the function can return at all. Widening
   * it would leak an organisation's plans to anybody holding a link.
   */
  async function byJoinCode(code: string): Promise<{ id: string; title: string; mode: string } | null> {
    const rows = await db.withoutIdentity((tx: SqlTx) => tx.unsafe<{
      meeting_id: string; title: string; mode: string;
    }>("select * from echo.meeting_by_join_code($1)", [code]));
    const row = rows[0];
    return row === undefined ? null : { id: row.meeting_id, title: row.title, mode: row.mode };
  }

  /** Mint or revoke the guest code. Members-only; the door checks the meeting. */
  async function setJoinCode(identity: Identity, id: string, code: string | null): Promise<void> {
    await db.withIdentity(identity, (tx: SqlTx) => tx.unsafe(
      "select echo.set_meeting_join_code($1, $2)", [id, code],
    ));
  }

  /** 0159 — the documents attached to a meeting, newest last. */
  async function attachments(identity: Identity, meetingId: string): Promise<Array<{
    id: string; name: string; content_type: string; size_bytes: number; created_at: string;
  }>> {
    return db.withIdentity(identity, async (tx: SqlTx) => {
      const rows = await tx.unsafe<Record<string, unknown>>(
        `select id, name, content_type, size_bytes, created_at
           from echo.meeting_attachment
          where meeting_id = $1
          order by created_at`,
        [meetingId],
      );
      return rows.map((row) => ({
        id: String(row.id),
        name: String(row.name),
        content_type: String(row.content_type),
        size_bytes: Number(row.size_bytes),
        created_at: iso(row.created_at),
      }));
    });
  }

  /**
   * Record a file that has just been uploaded. `created_by` and `org_id` come
   * from the ACTOR, never from the body — 0159's insert policy refuses any
   * other value, so the api and the wall say the same sentence.
   */
  async function addAttachment(
    identity: Identity,
    meetingId: string,
    file: { name: string; contentType: string; size: number; path: string },
  ): Promise<void> {
    await db.withIdentity(identity, (tx: SqlTx) => tx.unsafe(
      `insert into echo.meeting_attachment
         (meeting_id, org_id, name, content_type, size_bytes, storage_path, created_by)
       values ($1, echo.actor_org_id(), $2, $3, $4, $5, echo.actor_id())`,
      [meetingId, file.name, file.contentType, file.size, file.path],
    ));
  }

  async function removeAttachment(identity: Identity, id: string): Promise<void> {
    await db.withIdentity(identity, (tx: SqlTx) => tx.unsafe(
      "delete from echo.meeting_attachment where id = $1", [id],
    ));
  }

  /** 0160 — the meeting's decisions, action items, questions, risks and
      entities, oldest first inside each kind. */
  async function items(identity: Identity, meetingId: string): Promise<MeetingItemRecord[]> {
    return db.withIdentity(identity, async (tx: SqlTx) => {
      const rows = await tx.unsafe<Record<string, unknown>>(
        `select id, kind, body, source, done, owner, at_ms, created_at
           from echo.meeting_item
          where meeting_id = $1
          order by position, created_at`,
        [meetingId],
      );
      return rows.map((row) => ({
        id: String(row.id),
        kind: String(row.kind) as MeetingItemKind,
        body: String(row.body),
        source: String(row.source) === "ai" ? "ai" as const : "user" as const,
        done: row.done === true,
        owner: row.owner === null ? null : String(row.owner),
        at_ms: row.at_ms === null ? null : Number(row.at_ms),
        created_at: iso(row.created_at),
      }));
    });
  }

  /**
   * `source` is NOT in this signature, and that is the point: the policy pins
   * it to 'user' for echo_app and to 'ai' for echo_agent, so the api cannot
   * offer a caller a way to badge their own line as the assistant's.
   */
  async function addItem(
    identity: Identity,
    meetingId: string,
    item: { kind: MeetingItemKind; body: string; owner: string | null; atMs: number | null },
  ): Promise<MeetingItemRecord> {
    return db.withIdentity(identity, async (tx: SqlTx) => {
      const rows = await tx.unsafe<Record<string, unknown>>(
        `insert into echo.meeting_item
           (meeting_id, org_id, kind, body, source, owner, at_ms, position, created_by)
         values ($1, echo.actor_org_id(), $2, $3, 'user', $4, $5,
                 coalesce((select max(position) + 1 from echo.meeting_item
                            where meeting_id = $1 and kind = $2), 0),
                 echo.actor_id())
         returning id, kind, body, source, done, owner, at_ms, created_at`,
        [meetingId, item.kind, item.body, item.owner, item.atMs],
      );
      const row = rows[0];
      if (row === undefined) throw new NotFoundError();
      return {
        id: String(row.id),
        kind: String(row.kind) as MeetingItemKind,
        body: String(row.body),
        source: "user" as const,
        done: row.done === true,
        owner: row.owner === null ? null : String(row.owner),
        at_ms: row.at_ms === null ? null : Number(row.at_ms),
        created_at: iso(row.created_at),
      };
    });
  }

  /**
   * An edit changes the WORDS and the TICK. It cannot change `source` or
   * `meeting_id` — a trigger refuses both for every role at once (0160), so
   * this signature simply has nowhere to put them.
   *
   * Undefined means "leave it"; null on `owner` means "clear it". The two are
   * different and a form gets them wrong by reflex, so they are separate
   * facts on the wire rather than one nullable field.
   */
  async function updateItem(
    identity: Identity,
    itemId: string,
    patch: { body?: string; done?: boolean; owner?: string | null },
  ): Promise<void> {
    const sets: string[] = [];
    const values: unknown[] = [itemId];
    if (patch.body !== undefined) { values.push(patch.body); sets.push(`body = $${values.length}`); }
    if (patch.done !== undefined) { values.push(patch.done); sets.push(`done = $${values.length}`); }
    if (patch.owner !== undefined) { values.push(patch.owner); sets.push(`owner = $${values.length}`); }
    if (sets.length === 0) return;
    await db.withIdentity(identity, (tx: SqlTx) => tx.unsafe(
      `update echo.meeting_item set ${sets.join(", ")} where id = $1`, values,
    ));
  }

  async function removeItem(identity: Identity, itemId: string): Promise<void> {
    await db.withIdentity(identity, (tx: SqlTx) => tx.unsafe(
      "delete from echo.meeting_item where id = $1", [itemId],
    ));
  }

  /**
   * «تولید دوباره» — re-derive the meeting's items from its latest summary.
   *
   * WHY IT RUNS ON THE AGENT CONNECTION. 0160 pins `source` to the writing
   * ROLE: echo_app may only ever write 'user'. That is the wall which makes
   * the sparkle badge a fact rather than a claim, so the api CANNOT write an
   * ai-badged row on the caller's own connection, and it must not be able to.
   * This borrows the agent role for exactly the insert, which is the same
   * shape a confirmed proposal's write takes (M4).
   *
   * IT ADDS, IT NEVER REPLACES. A person's own decisions are in this table
   * too, and a re-run that cleared the list first would silently delete work
   * somebody typed — the agent holds no DELETE precisely so that cannot
   * happen, and this function does not try to route around it. Rows already
   * present (matched on their exact text) are skipped, so pressing the button
   * twice does not double the list.
   */
  async function extractItems(
    identity: Identity,
    meetingId: string,
    callId: string,
  ): Promise<{ added: number }> {
    const summaries = await db.withIdentity(identity, (tx: SqlTx) => tx.unsafe<Record<string, unknown>>(
      `select body from echo.summary
        where call_id = $1
        order by version desc
        limit 1`,
      [callId],
    ));
    const body = summaries[0] === undefined ? "" : String(summaries[0].body ?? "");
    if (body.trim() === "") return { added: 0 };

    const existing = await db.withIdentity(identity, (tx: SqlTx) => tx.unsafe<Record<string, unknown>>(
      "select kind, body from echo.meeting_item where meeting_id = $1", [meetingId],
    ));
    /* keyed by KIND then body — a single string key needs a separator, and
       every separator is either a character that can appear in a sentence or
       a control byte that a generator will eventually turn into a real one
       (this line shipped a literal NUL once and the encoding sweep caught it) */
    const seen = new Map<string, Set<string>>();
    for (const r of existing) {
      const kind = String(r.kind);
      const set = seen.get(kind) ?? new Set<string>();
      set.add(String(r.body));
      seen.set(kind, set);
    }

    const found = sliceSummary(body);
    let added = 0;
    for (const row of found) {
      const set = seen.get(row.kind) ?? new Set<string>();
      if (set.has(row.body)) continue;
      set.add(row.body);
      seen.set(row.kind, set);
      await db.withIdentity(identity, (tx: SqlTx) => tx.unsafe(
        `insert into echo.meeting_item
           (meeting_id, org_id, kind, body, source, position, created_by)
         values ($1, echo.actor_org_id(), $2, $3, 'ai',
                 coalesce((select max(position) + 1 from echo.meeting_item
                            where meeting_id = $1 and kind = $2), 0),
                 echo.actor_id())`,
        [meetingId, row.kind, row.body],
      ), { role: "agent" });
      added += 1;
    }
    return { added };
  }

  async function detail(identity: Identity, id: string): Promise<MeetingRecord> {
    return db.withIdentity(identity, async (tx: SqlTx) => {
      const rows = await tx.unsafe<Record<string, unknown>>(
        `${MEETING_ROWS} where m.id = $1`, [id],
      );
      if (!rows[0]) throw new NotFoundError();
      return toMeeting(rows[0]);
    });
  }

  async function create(identity: Identity, input: Record<string, unknown>): Promise<MeetingRecord> {
    const title = typeof input.title === "string" ? input.title.trim() : "";
    if (title === "" || title.length > 300) {
      throw new ValidationError("meeting needs a title", { code: "meeting_title_invalid" });
    }
    const when = parseWhen(input.scheduled_at);
    const mode = input.mode === undefined ? "in_person" : parseMode(input.mode);
    const agenda = parseAgenda(input.agenda);
    const invitees = parseInvitees(input.invitees);
    let duration: number | null = null;
    if (input.duration_minutes !== null && input.duration_minutes !== undefined && input.duration_minutes !== "") {
      duration = Number(input.duration_minutes);
      if (!Number.isInteger(duration) || duration < 1 || duration > 1440) {
        throw new ValidationError("duration out of range", { code: "meeting_duration_invalid" });
      }
    }
    return db.withIdentity(identity, async (tx: SqlTx) => {
      const rows = await tx.unsafe<Record<string, unknown>>(
        `insert into echo.meeting
           (org_id, title, scheduled_at, duration_minutes, mode, topic_id,
            location, description, invitees, agenda, created_by)
         values (echo.actor_org_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9::text::jsonb,
                 echo.actor_id())
         returning id`,
        [
          title, when, duration, mode,
          typeof input.topic_id === "string" && input.topic_id.trim() !== "" ? input.topic_id.trim() : null,
          typeof input.location === "string" && input.location.trim() !== "" ? input.location.trim().slice(0, 300) : null,
          typeof input.description === "string" ? input.description.slice(0, 8000) : "",
          invitees,
          JSON.stringify(agenda),
        ],
      );
      const back = await tx.unsafe<Record<string, unknown>>(
        `${MEETING_ROWS} where m.id = $1`, [String(rows[0]!.id)],
      );
      return toMeeting(back[0]!);
    });
  }

  /** dynamic SET over the patchable fields; unknown keys are refused, not
      ignored — a save that silently drops a field reports success about a
      setting that never moved */
  async function update(identity: Identity, id: string, patch: Record<string, unknown>): Promise<MeetingRecord> {
    const sets: string[] = [];
    const args: unknown[] = [];
    const push = (fragment: string, value: unknown) => {
      args.push(value);
      sets.push(`${fragment} = $${args.length}`);
    };
    for (const [key, value] of Object.entries(patch)) {
      switch (key) {
        case "title": {
          const title = typeof value === "string" ? value.trim() : "";
          if (title === "" || title.length > 300) {
            throw new ValidationError("meeting needs a title", { code: "meeting_title_invalid" });
          }
          push("title", title);
          break;
        }
        case "scheduled_at": push("scheduled_at", parseWhen(value)); break;
        case "mode": push("mode", parseMode(value)); break;
        case "topic_id":
          /* the FK does the checking: a topic in another org is refused by
             the composite constraint rather than by a lookup here, which
             would be a second rule that can disagree with the first */
          push("topic_id", typeof value === "string" && value.trim() !== "" ? value.trim() : null);
          break;
        case "location":
          push("location", typeof value === "string" && value.trim() !== "" ? value.trim().slice(0, 300) : null);
          break;
        case "description":
          push("description", typeof value === "string" ? value.slice(0, 8000) : "");
          break;
        case "invitees": push("invitees", parseInvitees(value)); break;
        case "agenda": {
          args.push(JSON.stringify(parseAgenda(value)));
          sets.push(`agenda = $${args.length}::text::jsonb`);
          break;
        }
        case "duration_minutes": {
          if (value === null || value === "" || value === undefined) { push("duration_minutes", null); break; }
          const d = Number(value);
          if (!Number.isInteger(d) || d < 1 || d > 1440) {
            throw new ValidationError("duration out of range", { code: "meeting_duration_invalid" });
          }
          push("duration_minutes", d);
          break;
        }
        /* 0146 — the minutes' lifecycle. Each patch is an EVENT, not a
           field write: approve stamps once (idempotent), sign APPENDS a
           {name, now} pair, close stamps once and requires the approval —
           an unapproved document cannot be the record of record. */
        case "minutes_approved": {
          if (value !== true) {
            throw new ValidationError("approval is an event, not a toggle", { code: "minutes_patch_invalid" });
          }
          sets.push("minutes_approved_at = coalesce(minutes_approved_at, now())");
          break;
        }
        case "minutes_sign": {
          const name = typeof value === "string" ? value.trim().slice(0, 120) : "";
          if (name === "") {
            throw new ValidationError("a signature needs a name", { code: "minutes_patch_invalid" });
          }
          /* the signer's IDENTITY rides with the name, and the append is
             idempotent per actor: a display name changes with the locale,
             so name-equality would let one person sign twice */
          args.push(name);
          sets.push(
            `minutes_signatures = case
               when exists (
                 select 1 from jsonb_array_elements(minutes_signatures) sig
                  where sig->>'user_id' = echo.actor_id()::text
               ) then minutes_signatures
               else minutes_signatures || jsonb_build_array(
                 jsonb_build_object('name', $${args.length}::text, 'user_id', echo.actor_id(), 'at', now()))
             end`,
          );
          break;
        }
        case "minutes_closed": {
          if (value !== true) {
            throw new ValidationError("closing is an event, not a toggle", { code: "minutes_patch_invalid" });
          }
          sets.push("minutes_closed_at = coalesce(minutes_closed_at, now())");
          break;
        }
        case "video_url": {
          const url = typeof value === "string" ? value.trim() : "";
          if (url === "") { push("video_url", null); push("video_provider", null); break; }
          if (!/^https:\/\//i.test(url) || url.length > 2000) {
            /* http would put the room on the wire in clear text, and a
               non-URL in a join button is a button that goes nowhere */
            throw new ValidationError("a room link must be https", { code: "meeting_video_invalid" });
          }
          push("video_url", url);
          push("video_provider", /(^|\.)meet\.google\.com\//i.test(url) ? "google_meet" : "custom");
          break;
        }
        case "call_id": {
          /* the recorder links the record it created; null unlinks. The
             composite FK is the wall — a call outside the org refuses. */
          push("call_id", value === null || value === "" ? null : String(value));
          break;
        }
        case "archived": {
          sets.push(value === true
            ? "archived_at = coalesce(archived_at, now())"
            : "archived_at = null");
          break;
        }
        default:
          throw new ValidationError("unknown field", { code: "unknown_fields", params: { fields: key } });
      }
    }
    if (sets.length === 0) {
      throw new ValidationError("nothing to change", { code: "meeting_patch_empty" });
    }
    sets.push("updated_at = now()");
    const requireApproved = "minutes_closed" in patch;
    /* a CLOSED meeting is the record of record: everything but archiving is
       refused — an editable closed document is a signature on shifting
       paper. The check runs in-transaction, where the write happens. */
    const CLOSED_ALLOWED = new Set(["archived"]);
    const touchesContent = Object.keys(patch).some((key) => !CLOSED_ALLOWED.has(key));
    return db.withIdentity(identity, async (tx: SqlTx) => {
      if (touchesContent) {
        const closedState = await tx.unsafe<Record<string, unknown>>(
          `select minutes_closed_at from echo.meeting where id = $1`, [id],
        );
        if (!closedState[0]) throw new NotFoundError();
        if (closedState[0].minutes_closed_at !== null) {
          throw new ValidationError("a closed meeting is the record of record", { code: "meeting_closed" });
        }
      }
      if (requireApproved) {
        const state = await tx.unsafe<Record<string, unknown>>(
          `select minutes_approved_at from echo.meeting where id = $1`, [id],
        );
        if (!state[0]) throw new NotFoundError();
        if (state[0].minutes_approved_at === null) {
          throw new ValidationError("an unapproved document cannot be closed", { code: "minutes_not_approved" });
        }
      }
      args.push(id);
      const rows = await tx.unsafe<Record<string, unknown>>(
        `update echo.meeting set ${sets.join(", ")} where id = $${args.length} returning id`,
        args,
      );
      if (!rows[0]) throw new NotFoundError();
      const back = await tx.unsafe<Record<string, unknown>>(
        `${MEETING_ROWS} where m.id = $1`, [id],
      );
      return toMeeting(back[0]!);
    });
  }

  /**
   * Delete the PLAN (0148). The record it produced is a different row with
   * its own ladder and its own purge window: this cannot reach it, which
   * the schema asserts rather than this file promising it.
   */
  async function remove(identity: Identity, id: string): Promise<void> {
    await db.withIdentity(identity, async (tx: SqlTx) => {
      const rows = await tx.unsafe<Record<string, unknown>>(
        `delete from echo.meeting where id = $1 returning id`, [id],
      );
      if (!rows[0]) throw new NotFoundError();
    });
  }

  /**
   * THE FOLDERS (0151). Archived, never deleted — the same rule as the task
   * board's: a folder that disappears takes the answer to "where did that
   * meeting go" with it, and the meetings themselves are re-pointed to null
   * by the FK rather than deleted alongside it.
   */
  async function topics(identity: Identity): Promise<Array<{ id: string; name: string }>> {
    return db.withIdentity(identity, async (tx: SqlTx) => {
      const rows = await tx.unsafe<Record<string, unknown>>(
        `select t.id, t.name from echo.meeting_topic t
          where t.archived_at is null order by t.name`, [],
      );
      return rows.map((row) => ({ id: row.id as string, name: row.name as string }));
    });
  }

  async function createTopic(identity: Identity, name: string): Promise<{ id: string; name: string }> {
    const clean = name.trim().slice(0, 80);
    if (clean === "") throw new ValidationError("a folder needs a name", { code: "topic_name_required" });
    return db.withIdentity(identity, async (tx: SqlTx) => {
      const rows = await tx.unsafe<Record<string, unknown>>(
        `insert into echo.meeting_topic (org_id, name, created_by)
         values (echo.actor_org_id(), $1, echo.actor_id())
         returning id, name`, [clean],
      );
      const row = rows[0];
      if (!row) throw new ConflictError("the folder was not created");
      return { id: row.id as string, name: row.name as string };
    });
  }

  async function updateTopic(
    identity: Identity, id: string, patch: { name?: string; archived?: boolean },
  ): Promise<void> {
    await db.withIdentity(identity, async (tx: SqlTx) => {
      if (typeof patch.name === "string") {
        const clean = patch.name.trim().slice(0, 80);
        if (clean === "") throw new ValidationError("a folder needs a name", { code: "topic_name_required" });
        await tx.unsafe(`update echo.meeting_topic set name = $2 where id = $1`, [id, clean]);
      }
      if (typeof patch.archived === "boolean") {
        await tx.unsafe(
          `update echo.meeting_topic set archived_at = $2 where id = $1`,
          [id, patch.archived ? new Date().toISOString() : null],
        );
      }
    });
  }

  return {
    list, detail, create, update, remove, topics, createTopic, updateTopic,
    byJoinCode, setJoinCode, attachments, addAttachment, removeAttachment,
    items, addItem, updateItem, removeItem, extractItems,
  };
}
