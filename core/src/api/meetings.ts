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
import { NotFoundError, ValidationError } from "./errors.ts";
import { iso } from "./vocabulary.ts";
import type { Db, SqlTx } from "../db/identity.ts";
import type { Identity } from "../agent/types.ts";

export const MEETING_MODES = ["upload", "in_person", "online"] as const;
export type MeetingMode = (typeof MEETING_MODES)[number];

export interface MeetingAgendaItem {
  title: string;
  /** planned minutes — null = unplanned, never 0 (a zero-minute item is a
      claim; an unplanned one is an absence) */
  minutes: number | null;
}

export interface MeetingRecord {
  id: string;
  title: string;
  scheduled_at: string;
  duration_minutes: number | null;
  mode: MeetingMode;
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
  created_at: string;
}

const MEETING_ROWS = `
  select m.id, m.title, m.scheduled_at, m.duration_minutes, m.mode, m.topic,
         m.location, m.description, m.invitees, m.agenda, m.call_id,
         c.title as call_title, m.archived_at, m.created_by, m.created_at
    from echo.meeting m
    left join echo.call c on c.id = m.call_id`;

function toMeeting(row: Record<string, unknown>): MeetingRecord {
  const rawAgenda = Array.isArray(row.agenda) ? row.agenda : [];
  return {
    id: String(row.id),
    title: String(row.title),
    scheduled_at: iso(row.scheduled_at),
    duration_minutes: row.duration_minutes === null || row.duration_minutes === undefined
      ? null : Number(row.duration_minutes),
    mode: row.mode as MeetingMode,
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
    created_at: iso(row.created_at),
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
           (org_id, title, scheduled_at, duration_minutes, mode, topic,
            location, description, invitees, agenda, created_by)
         values (echo.actor_org_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9::text::jsonb,
                 echo.actor_id())
         returning id`,
        [
          title, when, duration, mode,
          typeof input.topic === "string" && input.topic.trim() !== "" ? input.topic.trim().slice(0, 120) : null,
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
        case "topic":
          push("topic", typeof value === "string" && value.trim() !== "" ? value.trim().slice(0, 120) : null);
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
    return db.withIdentity(identity, async (tx: SqlTx) => {
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

  return { list, detail, create, update };
}
