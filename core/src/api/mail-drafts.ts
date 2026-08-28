/**
 * M43 — the reply that waits for a person.
 *
 * The assistant writes a draft; nobody but its owner can read it, and only
 * its owner can send it. That last clause is not enforced here — it is
 * enforced by db/0114 withholding UPDATE from `echo_agent`, which is why
 * this file can be short and why the promise survives a future edit to it.
 *
 * `create` runs on the AGENT role deliberately, even though the caller is a
 * signed-in person: the draft's body is model output, and writing it through
 * the same narrow role every other piece of generated content goes through
 * keeps one answer to "what can the assistant write" — the grant table.
 */
import { ConflictError, NotFoundError, ValidationError } from "./errors.ts";
import { iso } from "./vocabulary.ts";
import type { Db, SqlTx } from "../db/identity.ts";
import type { Identity } from "../agent/types.ts";
import type { ConnectorProvider, OutgoingMail } from "./connectors.ts";

export interface MailDraftRecord {
  id: string;
  provider: ConnectorProvider;
  source_ref: string;
  thread_ref: string | null;
  to_address: string;
  subject: string;
  body: string;
  status: "pending" | "sent" | "discarded";
  in_provider: boolean;
  session_id: string | null;
  created_at: string;
  decided_at: string | null;
}

const ROW = `
  select id, provider, source_ref, thread_ref, to_address, subject, body,
         status, provider_draft_id, session_id, created_at, decided_at
    from echo.mail_draft`;

function toRecord(row: Record<string, unknown>): MailDraftRecord {
  return {
    id: String(row.id),
    provider: row.provider as ConnectorProvider,
    source_ref: String(row.source_ref),
    thread_ref: (row.thread_ref as string | null) ?? null,
    to_address: String(row.to_address),
    subject: String(row.subject),
    body: String(row.body),
    status: row.status as MailDraftRecord["status"],
    /* whether it also exists in the person's own mailbox — the difference
       between "we wrote you a reply" and "your drafts folder has it" */
    in_provider: typeof row.provider_draft_id === "string" && row.provider_draft_id !== "",
    session_id: (row.session_id as string | null) ?? null,
    created_at: iso(row.created_at),
    decided_at: row.decided_at === null ? null : iso(row.decided_at),
  };
}

/** The message a draft answers, for showing above the reply. */
export interface MailSourceMessage {
  from: string;
  subject: string;
  body: string;
  occurred_at: string | null;
}

export interface MailSender {
  createDraft(identity: Identity, provider: ConnectorProvider, mail: OutgoingMail): Promise<string | null>;
  sendMail(
    identity: Identity, provider: ConnectorProvider, mail: OutgoingMail, providerDraftId: string | null,
  ): Promise<void>;
  sourceContext(
    identity: Identity, provider: ConnectorProvider, sourceKind: "mail_message", sourceId: string,
  ): Promise<{ content: string; label: string }>;
}

export function createMailDraftsRepo(db: Db, connectors: MailSender) {
  return {
    /** the caller's own drafts; `session` narrows to one conversation's */
    async list(
      identity: Identity, filter: { status?: string | undefined; session?: string | undefined } = {},
    ): Promise<MailDraftRecord[]> {
      const status = filter.status === "sent" || filter.status === "discarded" || filter.status === "pending"
        ? filter.status
        : null;
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<Record<string, unknown>>(
          `${ROW}
            where ($1::text is null or status = $1)
              and ($2::uuid is null or session_id = $2)
            order by created_at desc
            limit 50`,
          [status, filter.session ?? null]));
      return rows.map(toRecord);
    },

    async get(identity: Identity, id: string): Promise<MailDraftRecord | null> {
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<Record<string, unknown>>(`${ROW} where id = $1`, [id]));
      return rows[0] ? toRecord(rows[0]) : null;
    },

    /**
     * Write a draft for one incoming message. Idempotent by construction:
     * db/0114's unique (owner, provider, source_ref) means a poller that
     * sees the same mail twice gets a conflict rather than a second reply,
     * and the caller can treat that as "already handled".
     */
    async create(
      identity: Identity,
      input: {
        provider: ConnectorProvider;
        source_ref: string;
        thread_ref?: string | null;
        to_address: string;
        subject: string;
        body: string;
        session_id?: string | null;
        in_reply_to?: string | null;
        /** also place it in the person's real drafts folder */
        toProvider?: boolean;
      },
    ): Promise<MailDraftRecord> {
      const to = input.to_address.trim();
      const body = input.body.trim();
      if (to.length < 3 || !to.includes("@")) throw new ValidationError("a draft needs a recipient address");
      if (body === "") throw new ValidationError("a draft needs a body");
      if (body.length > 20_000) throw new ValidationError("the draft body is too long");

      let providerDraftId: string | null = null;
      if (input.toProvider) {
        try {
          providerDraftId = await connectors.createDraft(identity, input.provider, {
            to, subject: input.subject, body,
            thread_ref: input.thread_ref ?? null,
            in_reply_to: input.in_reply_to ?? null,
          });
        } catch {
          /* the provider refusing a draft must not lose the reply: it stays
             ours, the card still renders, and Send falls back to composing
             the message at send time. A connection without the compose scope
             lands here, which is the ordinary case right after an upgrade. */
          providerDraftId = null;
        }
      }

      try {
        const rows = await db.withIdentity(identity, (tx: SqlTx) =>
          tx.unsafe<Record<string, unknown>>(
            `insert into echo.mail_draft
               (org_id, owner_id, provider, source_ref, thread_ref, to_address,
                subject, body, provider_draft_id, session_id)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             returning id, provider, source_ref, thread_ref, to_address, subject,
                       body, status, provider_draft_id, session_id, created_at, decided_at`,
            [identity.orgId, identity.userId, input.provider, input.source_ref,
              input.thread_ref ?? null, to, input.subject, body,
              providerDraftId, input.session_id ?? null]),
          { role: "agent" });
        return toRecord(rows[0]!);
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          throw new ConflictError("this message already has a draft", { code: "draft_exists" });
        }
        throw error;
      }
    },

    /**
     * SEND — the only place a message leaves the building, reached only from
     * the route a signed-in person presses.
     *
     * Order matters and is the M41 confirm ordering: mark it decided FIRST,
     * then hand it to the provider. A decided row that failed to send is a
     * visible, reconcilable line; sending first and failing to record it
     * would let one press become two sent emails.
     */
    async send(identity: Identity, id: string): Promise<MailDraftRecord> {
      const draft = await this.get(identity, id);
      if (!draft) throw new NotFoundError();
      if (draft.status !== "pending") {
        throw new ConflictError("this draft is already decided", { code: "draft_decided" });
      }
      const claimed = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ id: string; provider_draft_id: string | null }>(
          `update echo.mail_draft
              set status = 'sent', decided_at = now(), decided_by = $2
            where id = $1 and status = 'pending'
          returning id, provider_draft_id`,
          [id, identity.userId]));
      /* the claim IS the replay wall: a second press matches no rows */
      if (!claimed[0]) throw new ConflictError("this draft is already decided", { code: "draft_decided" });

      await connectors.sendMail(identity, draft.provider, {
        to: draft.to_address, subject: draft.subject, body: draft.body,
        thread_ref: draft.thread_ref,
      }, claimed[0].provider_draft_id);

      return { ...draft, status: "sent" };
    },

    /**
     * The message this draft answers, read from the provider ON DEMAND.
     *
     * Not stored beside the draft, deliberately: the mail is the person's
     * and belongs in their mailbox (W9 — we keep references, not content).
     * The cost is a provider call when someone opens the thread; the
     * alternative is a second copy of their correspondence in our database,
     * which is a much larger thing to own.
     */
    async source(identity: Identity, id: string): Promise<MailSourceMessage> {
      const draft = await this.get(identity, id);
      if (!draft) throw new NotFoundError();
      const context = await connectors.sourceContext(
        identity, draft.provider, "mail_message", draft.source_ref);
      /* sourceContext hands back the provider's JSON as a string, already
         bounded; parse defensively — a shape we cannot read is still a
         message the person can see in their mailbox, so it degrades to the
         label rather than failing the screen */
      try {
        const parsed = JSON.parse(context.content) as Record<string, unknown>;
        return {
          from: typeof parsed.from === "string" ? parsed.from : "",
          subject: typeof parsed.subject === "string" ? parsed.subject : context.label,
          body: typeof parsed.body === "string" ? parsed.body : "",
          occurred_at: typeof parsed.date === "string" ? parsed.date : null,
        };
      } catch {
        return { from: "", subject: context.label, body: "", occurred_at: null };
      }
    },

    async discard(identity: Identity, id: string): Promise<MailDraftRecord> {
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<Record<string, unknown>>(
          `update echo.mail_draft
              set status = 'discarded', decided_at = now(), decided_by = $2
            where id = $1 and status = 'pending'
          returning id, provider, source_ref, thread_ref, to_address, subject,
                    body, status, provider_draft_id, session_id, created_at, decided_at`,
          [id, identity.userId]));
      if (!rows[0]) throw new NotFoundError();
      return toRecord(rows[0]);
    },
  };
}
