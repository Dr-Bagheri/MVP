/**
 * ALARMS (db/0231, db/0232).
 *
 * User directive, 2026-09-18: a page in settings that sets a time and gives
 * you a pop-up in the platform; agents can set one for you; a task near its
 * deadline alarms you; an upcoming meeting alarms you half an hour before,
 * including one somebody else has just added you to.
 *
 * ── ONE OF THE THREE IS A ROW ─────────────────────────────────────────────
 *
 * A reminder somebody TYPED exists nowhere else, so it is stored. The other
 * two are ALREADY in this database — `task.due_at`, `meeting.scheduled_at` —
 * and a worker writing reminder rows ahead of time would be a second copy of
 * a deadline that goes wrong the moment anybody moves it, finishes the task,
 * cancels the meeting or is taken off the roster. They are computed here, on
 * every poll, from the rows that already exist.
 *
 * That is also why "somebody added you to a meeting" needs no trigger, no
 * event and no fan-out: the moment the attendee row exists, the alarm exists
 * with it, and the moment it is removed the alarm is gone. A design that
 * pushed a notification on the ADD would have to remember to un-push it.
 *
 * ── THE KEY IS WHAT MAKES IT FIRE ONCE ────────────────────────────────────
 *
 * Every computed alarm carries `task:<id>:<instant>` — the id AND the moment.
 * A person acknowledges the key, so the alarm stops; move the deadline and
 * the key changes, so the NEW deadline alarms again rather than inheriting
 * the acknowledgement of one that no longer exists. A key built from the id
 * alone would silence a task forever the first time somebody dismissed it.
 *
 * ── NO ZONE ANYWHERE IN THIS FILE, deliberately ───────────────────────────
 *
 * Every window here is instant arithmetic — "within the next thirty minutes"
 * is the same span in Tehran and in Berlin. The timezone preference decides
 * how a moment is DISPLAYED and belongs to the screen; a zone parameter here
 * would be a second place for the platform's clock to disagree with itself
 * (the meeting-edit dialog already paid that bill once, 2026-09-06).
 */
import type { Db, SqlTx } from "../db/identity.ts";
import type { Identity } from "../agent/types.ts";
import { ValidationError } from "./errors.ts";

/**
 * HOW EARLY EACH KIND SPEAKS.
 *
 * The meeting number is the user's own ("it shows you half an hour before").
 * The task number is a judgement and is written here rather than inlined, so
 * that "near its deadline" is one decision in one place: an hour is long
 * enough to do something about a deadline and short enough that a board of
 * forty cards does not alarm all morning.
 */
export const MEETING_LEAD_MS = 30 * 60 * 1000;
export const TASK_LEAD_MS = 60 * 60 * 1000;

/**
 * How long a MISSED alarm keeps ringing.
 *
 * Without it, a laptop opened on Monday would fire every deadline of the
 * previous week at once — the alarm equivalent of a mail client that reads
 * every message aloud on launch. With it, the window is "recent enough to
 * still matter", and anything older is in the list on the page rather than
 * in a pop-up.
 */
export const OVERDUE_GRACE_MS = 12 * 60 * 60 * 1000;

export type ReminderKind = "custom" | "task" | "meeting";

export interface DueAlarm {
  /** what an acknowledgement is keyed on; `reminder:<id>` for a stored one */
  key: string;
  kind: ReminderKind;
  /** the moment it is ABOUT — a deadline, a meeting's start, the set time */
  at: string;
  /** the words for a custom alarm; for the other two the SUBJECT's title */
  label: string;
  /** where pressing it should go, when there is somewhere: a task or meeting id */
  task_id?: string;
  meeting_id?: string;
}

export interface ReminderRow {
  id: string;
  at: string;
  label: string;
  dismissed_at: string | null;
  created_at: string;
}

const MAX_LABEL = 200;

/** `2026-09-19T10:00:00.000Z` — one spelling of an instant in every key. */
const stamp = (value: Date | string): string =>
  (value instanceof Date ? value : new Date(value)).toISOString();

export function createRemindersRepo(db: Db) {
  return {
    /** The caller's own alarms, soonest first. RLS scopes it; no filter here. */
    async list(identity: Identity): Promise<ReminderRow[]> {
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<ReminderRow>(
          `select id, at, label, dismissed_at, created_at
             from echo.reminder
            where dismissed_at is null
            order by at asc
            limit 200`,
        ),
      );
      return rows.map((r) => ({ ...r, at: stamp(r.at), created_at: stamp(r.created_at) }));
    },

    /**
     * Set one.
     *
     * `user_id` and `created_by` are both the caller and neither is an
     * argument — an alarm for somebody else is not a feature this product
     * has, and the policy refuses it anyway. When an agent sets one it is
     * running in the person's own browser under the person's own identity
     * (the consent-card path), so the row is theirs in every column.
     */
    async create(identity: Identity, at: string, label: string): Promise<ReminderRow> {
      const when = new Date(at);
      if (Number.isNaN(when.getTime())) throw new ValidationError("at must be an instant");
      const words = label.trim();
      if (words === "") throw new ValidationError("label must not be empty");
      if (words.length > MAX_LABEL) throw new ValidationError(`label must be at most ${MAX_LABEL} characters`);

      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<ReminderRow>(
          `insert into echo.reminder (org_id, user_id, at, label, created_by)
           values (echo.actor_org_id(), echo.actor_id(), $1, $2, echo.actor_id())
           returning id, at, label, dismissed_at, created_at`,
          [when.toISOString(), words],
        ),
      );
      const row = rows[0];
      /* the policy refused it, and that is the only way to get here: a
         pending member (0232), or a caller whose identity is not what the
         row claims. Reported as a refusal rather than as an empty success —
         "we wrote nothing" must never reach a screen as "saved". */
      if (!row) throw new ValidationError("this alarm was refused");
      return { ...row, at: stamp(row.at), created_at: stamp(row.created_at) };
    },

    /** Put one out. Idempotent: dismissing a dismissed alarm is not an error. */
    async dismiss(identity: Identity, id: string): Promise<{ dismissed: boolean }> {
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ id: string }>(
          `update echo.reminder set dismissed_at = now()
            where id = $1 and dismissed_at is null
            returning id`,
          [id],
        ),
      );
      return { dismissed: rows.length > 0 };
    },

    /** Delete one outright — an alarm you set is one you can take back. */
    async remove(identity: Identity, id: string): Promise<{ removed: boolean }> {
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ id: string }>(`delete from echo.reminder where id = $1 returning id`, [id]),
      );
      return { removed: rows.length > 0 };
    },

    /**
     * WHAT SHOULD WAKE THE CALLER RIGHT NOW.
     *
     * Three reads rather than one union, because they are three different
     * questions and a union of them would have to agree about columns that
     * mean different things. `now` is injected so a test can put the clock
     * where it needs it; production passes nothing and gets the wall clock.
     */
    async due(identity: Identity, now: Date = new Date()): Promise<DueAlarm[]> {
      const at = now.toISOString();
      const taskHorizon = new Date(now.getTime() + TASK_LEAD_MS).toISOString();
      const meetingHorizon = new Date(now.getTime() + MEETING_LEAD_MS).toISOString();
      const floor = new Date(now.getTime() - OVERDUE_GRACE_MS).toISOString();

      const alarms = await db.withIdentity(identity, async (tx: SqlTx) => {
        const out: DueAlarm[] = [];

        /* ── the ones a person set ─────────────────────────────────────── */
        const custom = await tx.unsafe<{ id: string; at: string; label: string }>(
          `select id, at, label
             from echo.reminder
            where dismissed_at is null and at <= $1 and at >= $2
            order by at asc limit 20`,
          [at, floor],
        );
        for (const row of custom) {
          out.push({ key: `reminder:${row.id}`, kind: "custom", at: stamp(row.at), label: row.label });
        }

        /*
         * ── a task near its deadline ──────────────────────────────────────
         *
         * WHOSE task: one assigned to the caller, or — when nobody is
         * assigned — one they created. A board-wide alarm would wake every
         * member for every card, which is how a person learns to dismiss
         * without reading.
         *
         * A DONE card does not alarm, and "done" is `task.done_at` — 0144's
         * own comment says it plainly: "done_at is the checkbox; a done task
         * may sit in any column, and the column is where it SITS, not what it
         * IS". Asking the COLUMN instead was this file's first draft and would
         * have been wrong on every board whose last column is not named what
         * the query expected — and on a board where somebody ticks a card
         * without moving it, which is most of them.
         */
        const tasks = await tx.unsafe<{ id: string; title: string; due_at: string }>(
          `select t.id, t.title, t.due_at
             from echo.task t
            where t.due_at is not null
              and t.archived_at is null
              and t.done_at is null
              and t.due_at <= $1 and t.due_at >= $2
              and (
                exists (select 1 from echo.task_assignee a
                         where a.task_id = t.id and a.user_id = echo.actor_id())
                or (t.created_by = echo.actor_id()
                    and not exists (select 1 from echo.task_assignee a where a.task_id = t.id))
              )
            order by t.due_at asc limit 20`,
          [taskHorizon, floor],
        );
        for (const row of tasks) {
          out.push({
            key: `task:${row.id}:${stamp(row.due_at)}`,
            kind: "task",
            at: stamp(row.due_at),
            label: row.title,
            task_id: row.id,
          });
        }

        /*
         * ── a meeting about to start ──────────────────────────────────────
         *
         * The caller's own meetings: hosting, or on the roster. This is the
         * half the user asked for by name — "if someone added you for an
         * upcoming meeting it shows you half an hour before" — and it needs
         * nothing but the attendee row, which is exactly what that act
         * writes.
         *
         * The floor is TIGHTER here than for the other two: a meeting that
         * started eleven hours ago is not news, so the grace is the lead
         * itself. A meeting already under way does not alarm.
         */
        const meetings = await tx.unsafe<{ id: string; title: string; scheduled_at: string }>(
          `select m.id, m.title, m.scheduled_at
             from echo.meeting m
            where m.scheduled_at > $1 and m.scheduled_at <= $2
              and m.archived_at is null
              and (
                m.created_by = echo.actor_id()
                or exists (select 1 from echo.meeting_attendee a
                            where a.meeting_id = m.id and a.user_id = echo.actor_id())
              )
            order by m.scheduled_at asc limit 20`,
          [at, meetingHorizon],
        );
        for (const row of meetings) {
          out.push({
            key: `meeting:${row.id}:${stamp(row.scheduled_at)}`,
            kind: "meeting",
            at: stamp(row.scheduled_at),
            label: row.title,
            meeting_id: row.id,
          });
        }

        /* ── minus the ones already seen ──────────────────────────────────
           Asked AFTER the three reads and in one statement: an ack table
           joined into each query would be three joins saying one thing, and
           the list is at most sixty rows. */
        if (out.length === 0) return out;
        const seen = await tx.unsafe<{ key: string }>(
          `select key from echo.reminder_ack where key = any($1::text[])`,
          [out.map((a) => a.key)],
        );
        const acked = new Set(seen.map((r) => r.key));
        return out.filter((a) => !acked.has(a.key));
      });

      return alarms.sort((a, b) => a.at.localeCompare(b.at));
    },

    /**
     * "I have seen that one."
     *
     * A STORED alarm is dismissed on its own row; a computed one has no row,
     * so the acknowledgement is the key. Routing that here rather than making
     * the client choose is deliberate: a browser deciding which of two writes
     * an alarm needs is a browser that will one day get it wrong, and the
     * prefix is the server's own invention anyway.
     */
    async ack(identity: Identity, key: string): Promise<{ acknowledged: boolean }> {
      const wanted = key.trim();
      if (wanted === "" || wanted.length > MAX_LABEL) throw new ValidationError("key is not one of ours");

      if (wanted.startsWith("reminder:")) {
        return { acknowledged: (await this.dismiss(identity, wanted.slice("reminder:".length))).dismissed };
      }
      if (!wanted.startsWith("task:") && !wanted.startsWith("meeting:")) {
        throw new ValidationError("key is not one of ours");
      }
      await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe(
          `insert into echo.reminder_ack (org_id, user_id, key)
           values (echo.actor_org_id(), echo.actor_id(), $1)
           on conflict (user_id, key) do nothing`,
          [wanted],
        ),
      );
      /* `do nothing` on a second ack, and TRUE either way: the caller asked
         for this alarm to stop and it has stopped. Reporting false because
         somebody pressed twice would be an error message about success. */
      return { acknowledged: true };
    },
  };
}

export type RemindersRepo = ReturnType<typeof createRemindersRepo>;
