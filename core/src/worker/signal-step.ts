/**
 * M35 — the signals handler: the agent acting without being asked.
 *
 * Consumes `echo_agent_rules`. Every firing runs AS THE OWNER (the
 * job-identity precedent, M3): the identity is resolved from the payload
 * written at enqueue time, and every read below happens under that owner's
 * RLS — the scheduler crossed owners only to discover ids (the 0074 definer
 * doors), never to touch content.
 *
 * v1 outputs are MODEL-FREE by design: the post-call brief is composed from
 * the summary the pipeline JUST wrote, and the weekly digest from the
 * owner's own visible rows. The value being shipped is the unasked
 * DELIVERY — a card in the dock that opens as a real conversation — not a
 * second model pass over the same text; model-composed briefs are a later
 * upgrade with a spend story of their own.
 *
 * Every output is two writes as the owner: a conversation (the content's
 * home) and an `agent_card` pointing at it (the proactivity channel).
 * Capability-gated: before db/0074 lands, the step reports the skip loudly
 * and archives the message — never an error loop against missing tables.
 */
import { createSessionsRepo } from "../api/sessions.ts";
import { resolveIdentity } from "../db/actor.ts";
import { hasSignalTables } from "../db/capabilities.ts";
import { resolveJobIdentity } from "./job-identity.ts";
import { Q_AGENT_RULES, isSignalPayload, type QueuePayload } from "./queue.ts";
import type { StepHandler } from "./runner.ts";
import type { Db, SqlTx } from "../db/identity.ts";
import type { Identity } from "../agent/types.ts";

export interface SignalStepOptions {
  db: Db;
}

async function writeCard(
  db: Db,
  identity: Identity,
  kind: "post_call_brief" | "weekly_digest",
  title: string,
  body: string,
): Promise<void> {
  const sessions = createSessionsRepo(db);
  const conversation = await sessions.resolveForAsk(identity, null, title);
  await sessions.append(identity, {
    sessionId: conversation.id,
    role: "assistant",
    content: body,
  });
  await db.withIdentity(identity, (tx: SqlTx) =>
    tx.unsafe(
      `insert into echo.agent_card (org_id, owner_id, kind, title, session_id)
       values ($1, $2, $3, $4, $5)`,
      [identity.orgId, identity.userId, kind, title.slice(0, 200), conversation.id],
    ));
}

export function createSignalStep({ db }: SignalStepOptions): StepHandler {
  return {
    name: "signals",
    queue: Q_AGENT_RULES,

    async handle(payload: QueuePayload, { log }) {
      if (!isSignalPayload(payload)) {
        log.warn({ event: "signal_payload_unrecognized" }, "not a signal payload; dropped");
        return;
      }
      if (!(await hasSignalTables(db))) {
        // db/0074 has not landed on this database — the forfeit says so and
        // the message is consumed (a retry loop against missing tables would
        // page someone about a migration, forever, in the least useful way).
        log.warn(
          { event: "capability_missing", capability: "agent_card" },
          "signal skipped — apply db/0074",
        );
        return;
      }

      /*
       * call.processed carries a call, so it gets the FULL job-identity
       * resolution (owner re-reads the call — fail closed). cron.weekly has
       * no call: it resolves the owner alone; an inactive owner throws and
       * the message retries/dead-letters exactly like a pipeline job's.
       */
      const identity = payload.callId
        ? await resolveJobIdentity(db, { callId: payload.callId, ownerId: payload.ownerId })
        : await resolveIdentity(db, payload.ownerId);
      if (!identity.isActive) {
        log.warn({ event: "signal_owner_inactive" }, "owner inactive; signal skipped");
        return;
      }

      if (payload.event === "call.processed" && payload.callId) {
        // The brief: the call's own facts, read under the owner's RLS.
        const rows = await db.withIdentity(identity, (tx: SqlTx) =>
          tx.unsafe<{ title: string | null; body: string | null }>(
            `select c.title,
                    (select s.body from echo.summary s
                      where s.call_id = c.id order by s.version desc limit 1) as body
               from echo.call c where c.id = $1`,
            [payload.callId],
          ));
        const call = rows[0];
        if (!call) {
          // invisible or gone — a brief about a call the owner can no longer
          // see must not exist (which nothing is not ours to decide here)
          log.warn({ event: "brief_call_invisible" }, "no visible call for brief; skipped");
          return;
        }
        const name = call.title?.trim() || "بدون عنوان";
        const summary = call.body?.trim();
        await writeCard(
          db, identity, "post_call_brief",
          `خلاصهٔ آمادهٔ «${name}»`,
          summary
            ? `تماس «${name}» پردازش شد. خلاصه:\n\n${summary}\n\nمی‌توانید همین‌جا درباره‌اش بپرسید.`
            : `تماس «${name}» پردازش شد، اما خلاصه‌ای ثبت نشده است (دلیل در صفحهٔ تماس آمده). می‌توانید همین‌جا درباره‌اش بپرسید.`,
        );
        log.info({ event: "brief_delivered", call_id: payload.callId }, "post-call brief delivered");
        return;
      }

      if (payload.event === "cron.weekly") {
        const rows = await db.withIdentity(identity, (tx: SqlTx) =>
          tx.unsafe<{ n: string; titles: string[] | null }>(
            `select count(*)::text as n,
                    array_agg(title order by created_at desc)
                      filter (where title is not null) as titles
               from echo.call
              where created_at > now() - interval '7 days'
                and deleted_at is null`,
          ));
        const stat = rows[0];
        const count = Number(stat?.n ?? 0);
        const titles = (stat?.titles ?? []).slice(0, 8);
        const listing = titles.length ? `\n\nتماس‌های هفته:\n- ${titles.join("\n- ")}` : "";
        await writeCard(
          db, identity, "weekly_digest",
          "گزارش هفتگی",
          count === 0
            ? "این هفته تماسی ثبت نشد."
            : `این هفته ${count} تماس در دسترس شما ثبت شد.${listing}\n\nبرای جزئیات هرکدام، همین‌جا بپرسید.`,
        );
        log.info({ event: "digest_delivered" }, "weekly digest delivered");
        return;
      }

      log.warn({ event: "signal_event_unknown" }, "unknown signal event; dropped");
    },
  };
}
