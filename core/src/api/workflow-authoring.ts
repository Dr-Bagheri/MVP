/**
 * M41 P5 — AUTHORING: an admin builds and publishes a workflow without
 * touching SQL. Thin like every repo: the walls already decide who may
 * (admin insert policies, W18's missing UPDATE grant on versions), and
 * the VALIDATOR already decides what a graph may say — this file is
 * shape, sequencing, and honest refusals.
 *
 * Publish = INSERT a new version and repoint. Rollback = repoint at any
 * prior version of the same workflow (W32) — one pointer move, cheap
 * precisely because versions are immutable. Pause = enabled false; new
 * runs stop, in-flight runs finish on their pinned version.
 */
import { randomBytes } from "node:crypto";
import { ConflictError, NotFoundError, ValidationError } from "./errors.ts";
import { iso, WORKFLOW_EVENTS, AUTO_APPLY_ELIGIBLE } from "./vocabulary.ts";
import {
  validateWorkflowBudget,
  validateWorkflowGraph,
  type WorkflowGraph,
} from "./workflow-graph.ts";
import type { Db, SqlTx } from "../db/identity.ts";
import type { Identity } from "../agent/types.ts";

const HANDLE = /^[a-z0-9][a-z0-9-]{0,62}$/;

/**
 * THE SHIPPED STARTERS - installable per org with one press, so the engine
 * is never an empty shelf. Each graph is validated by the SAME publish
 * path an authored one takes (and pinned in the validator's corpus, so a
 * grammar change that breaks a starter breaks the suite, not the press).
 *
 *  followups - manual: reads the member's recent meetings, extracts the
 *    topics, writes one line per topic, cards the result. No writes, so
 *    it runs for any org untouched.
 *  autotag - the flagship (design doc s10): after every summarized
 *    meeting, extract topics from the transcript and PROPOSE them as tags
 *    - the human approves on the run page; the write lands on the agent
 *    role. Ships with max_autonomy act so an org MAY later enable
 *    standing auto-apply; until then every write waits for its human.
 */
export const STARTER_WORKFLOWS = {
  followups: {
    handle: "wf-starter-followups",
    name: "\u067e\u06cc\u06af\u06cc\u0631\u06cc \u062c\u0644\u0633\u0647\u200c\u0647\u0627",
    description: "\u0627\u0632 \u062c\u0644\u0633\u0647\u200c\u0647\u0627\u06cc \u0627\u062e\u06cc\u0631 \u0645\u0648\u0636\u0648\u0639\u200c\u0647\u0627 \u0631\u0627 \u062f\u0631\u0645\u06cc\u200c\u0622\u0648\u0631\u062f \u0648 \u0628\u0631\u0627\u06cc \u0647\u0631 \u06a9\u062f\u0627\u0645 \u06cc\u06a9 \u062e\u0637 \u067e\u06cc\u06af\u06cc\u0631\u06cc \u0645\u06cc\u200c\u0646\u0648\u06cc\u0633\u062f.",
    trigger_event: null as string | null,
    max_autonomy: "assist" as "watch" | "assist" | "act",
    graph: {
      entry: "s1",
      steps: [
        { id: "s1", kind: "search", scope: "calls", limit: 5 },
        { id: "s2", kind: "extract", from: "{{s1}}", schema: "topics_v1",
          instruction: "\u0627\u0632 \u0639\u0646\u0648\u0627\u0646 \u062c\u0644\u0633\u0647\u200c\u0647\u0627 \u0645\u0648\u0636\u0648\u0639\u200c\u0647\u0627\u06cc \u0627\u0635\u0644\u06cc \u0631\u0627 \u0627\u0633\u062a\u062e\u0631\u0627\u062c \u06a9\u0646." },
        { id: "s3", kind: "decide", on: "s2.topics.length", gt: 0, then: "s4", else: "s6" },
        { id: "s4", kind: "foreach", over: "{{s2.topics}}", max: 3, do: "s5" },
        { id: "s5", kind: "ask",
          instruction: "\u062f\u0631\u0628\u0627\u0631\u0647\u0654 \u00ab{{s4.item}}\u00bb \u06cc\u06a9 \u062c\u0645\u0644\u0647\u0654 \u067e\u06cc\u06af\u06cc\u0631\u06cc \u0628\u0646\u0648\u06cc\u0633." },
        { id: "s6", kind: "notify", card: "workflow_result" },
      ],
    },
  },
  autotag: {
    handle: "wf-starter-autotag",
    name: "\u0628\u0631\u0686\u0633\u0628\u200c\u06af\u0630\u0627\u0631\u06cc \u062e\u0648\u062f\u06a9\u0627\u0631 \u062c\u0644\u0633\u0647",
    description: "\u067e\u0633 \u0627\u0632 \u0647\u0631 \u062c\u0644\u0633\u0647 \u0645\u0648\u0636\u0648\u0639\u200c\u0647\u0627 \u0627\u0632 \u0631\u0648\u0646\u0648\u0634\u062a \u062f\u0631\u0645\u06cc\u200c\u0622\u06cc\u062f \u0648 \u0628\u0647\u200c\u0639\u0646\u0648\u0627\u0646 \u0628\u0631\u0686\u0633\u0628 \u067e\u06cc\u0634\u0646\u0647\u0627\u062f \u0645\u06cc\u200c\u0634\u0648\u062f - \u0628\u0627 \u062a\u0623\u06cc\u06cc\u062f \u0634\u0645\u0627 \u062b\u0628\u062a \u0645\u06cc\u200c\u0634\u0648\u062f.",
    trigger_event: "call.summarized" as string | null,
    max_autonomy: "act" as "watch" | "assist" | "act",
    graph: {
      entry: "s1",
      steps: [
        { id: "s1", kind: "search", scope: "transcript", of: "{{trigger.call_id}}" },
        { id: "s2", kind: "extract", from: "{{s1}}", schema: "topics_v1",
          instruction: "\u0627\u0632 \u0627\u06cc\u0646 \u0631\u0648\u0646\u0648\u0634\u062a \u062d\u062f\u0627\u06a9\u062b\u0631 \u067e\u0646\u062c \u0645\u0648\u0636\u0648\u0639 \u06a9\u0648\u062a\u0627\u0647 \u062f\u0631\u0628\u06cc\u0627\u0648\u0631." },
        { id: "s3", kind: "propose", proposal: "add_tags",
          from: "{{s2.topics}}", call: "{{trigger.call_id}}" },
        { id: "s4", kind: "wait", on: "decision" },
        { id: "s5", kind: "apply", from: "s3" },
        { id: "s6", kind: "notify", card: "workflow_result" },
      ],
    },
  },
  mail_reply: {
    handle: "wf-starter-mail-reply",
    name: "\u067e\u06cc\u0634\u200c\u0646\u0648\u06cc\u0633 \u067e\u0627\u0633\u062e \u0627\u06cc\u0645\u06cc\u0644",
    description: "\u0647\u0631 \u0627\u06cc\u0645\u06cc\u0644 \u062a\u0627\u0632\u0647\u200c\u0627\u06cc \u06a9\u0647 \u0645\u06cc\u200c\u0631\u0633\u062f \u062e\u0648\u0627\u0646\u062f\u0647 \u0645\u06cc\u200c\u0634\u0648\u062f \u0648 \u0627\u06af\u0631 \u067e\u0627\u0633\u062e \u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u062f\u060c \u067e\u06cc\u0634\u200c\u0646\u0648\u06cc\u0633\u06cc \u0646\u0648\u0634\u062a\u0647 \u0645\u06cc\u200c\u0634\u0648\u062f \u06a9\u0647 \u062e\u0648\u062f\u062a\u0627\u0646 \u0628\u0627\u0632\u0628\u06cc\u0646\u06cc \u0648 \u0627\u0631\u0633\u0627\u0644 \u06a9\u0646\u06cc\u062f.",
    trigger_event: "mail.received" as string | null,
    /* `act` because the last step WRITES — a draft, into the person's own
       mailbox. It writes nothing anybody has sent: the grant wall (db/0114)
       is what makes that true, not this ceiling. */
    max_autonomy: "act" as "watch" | "assist" | "act",
    graph: {
      entry: "s1",
      steps: [
        /* the message the trigger named, read under the owner's own grant */
        { id: "s1", kind: "fetch", source_kind: "mail_message", of: "{{trigger.source_ref}}" },
        /* the verdict AND the reply, as one validated shape. `reply` is a
           boolean so the next step can branch on it — `decide` refuses to
           read raw content, and is right to. */
        { id: "s2", kind: "extract", schema: "mail_reply_v1", tools: "none",
          from: "{{s1.body}}",
          instruction: "\u0627\u06cc\u0646 \u067e\u06cc\u0627\u0645 \u0631\u0627 \u0628\u062e\u0648\u0627\u0646 \u0648 \u062a\u0635\u0645\u06cc\u0645 \u0628\u06af\u06cc\u0631 \u06a9\u0647 \u0622\u06cc\u0627 \u0627\u0632 \u06cc\u06a9 \u0627\u0646\u0633\u0627\u0646 \u067e\u0627\u0633\u062e \u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u062f \u06cc\u0627 \u0646\u0647 \u2014 \u0627\u0639\u0644\u0627\u0646\u200c\u0647\u0627\u060c \u0631\u0633\u06cc\u062f\u0647\u0627 \u0648 \u062e\u0628\u0631\u0646\u0627\u0645\u0647\u200c\u0647\u0627 \u0646\u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u0646\u062f. \u0627\u06af\u0631 \u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u062f\u060c \u067e\u0627\u0633\u062e\u06cc \u0628\u0647 \u0647\u0645\u0627\u0646 \u0632\u0628\u0627\u0646 \u067e\u06cc\u0627\u0645 \u0628\u0646\u0648\u06cc\u0633: \u0628\u0627 \u0633\u0644\u0627\u0645\u06cc \u0645\u062a\u0646\u0627\u0633\u0628 \u0628\u0627 \u0644\u062d\u0646 \u0641\u0631\u0633\u062a\u0646\u062f\u0647 \u0634\u0631\u0648\u0639 \u06a9\u0646\u060c \u062f\u0631 \u0628\u0646\u062f\u0647\u0627\u06cc \u06a9\u0648\u062a\u0627\u0647 \u0628\u0646\u0648\u06cc\u0633\u060c \u0648 \u0628\u0627 \u06cc\u06a9 \u062e\u062f\u0627\u062d\u0627\u0641\u0638\u06cc \u0633\u0627\u062f\u0647 \u062a\u0645\u0627\u0645 \u06a9\u0646\u061b \u0647\u0631\u06af\u0632 \u0646\u0627\u0645\u06cc \u0628\u0631\u0627\u06cc \u0635\u0627\u062d\u0628 \u062d\u0633\u0627\u0628 \u0627\u0632 \u062e\u0648\u062f\u062a \u0646\u0633\u0627\u0632. \u062f\u0631 note \u06cc\u06a9 \u062c\u0645\u0644\u0647 \u0628\u0631\u0627\u06cc \u0635\u0627\u062d\u0628 \u062d\u0633\u0627\u0628 \u0628\u0646\u0648\u06cc\u0633 \u06a9\u0647 \u0686\u0647 \u06a9\u0631\u062f\u06cc." },
        { id: "s3", kind: "decide", on: "s2.reply", eq: true, then: "s4", else: "__end" },
        /* every dangerous field BOUND to a header the provider parsed */
        { id: "s4", kind: "propose", proposal: "draft_mail",
          message: "{{s1.id}}", to: "{{s1.reply_to}}", subject: "{{s1.subject}}",
          from: "{{s2.body}}" },
        { id: "s5", kind: "apply", from: "s4" },
        { id: "s6", kind: "notify", card: "mail_draft" },
      ],
    },
  },
} as const;
export type StarterKey = keyof typeof STARTER_WORKFLOWS;

export interface AuthoredWorkflow {
  id: string;
  handle: string;
  name: string;
  description: string;
  enabled: boolean;
  trigger_event: string | null;
  current_version: number | null;
  current_version_id: string | null;
  versions: number;
  created_at: string;
}

export interface WorkflowVersionRow {
  id: string;
  version: number;
  max_autonomy: string;
  published_at: string;
  published_by: string;
}

const ROW = `
  select w.id, w.handle, w.name, w.description, w.enabled, w.trigger_event,
         w.current_version_id, w.created_at,
         (select v.version from echo.workflow_version v
           where v.id = w.current_version_id) as current_version,
         (select count(*) from echo.workflow_version v
           where v.workflow_id = w.id) as versions
    from echo.workflow w`;

function toAuthored(row: Record<string, unknown>): AuthoredWorkflow {
  return {
    id: String(row.id),
    handle: String(row.handle),
    name: String(row.name),
    description: String(row.description ?? ""),
    enabled: row.enabled === true,
    trigger_event: (row.trigger_event as string | null) ?? null,
    current_version: row.current_version === null ? null : Number(row.current_version),
    current_version_id: (row.current_version_id as string | null) ?? null,
    versions: Number(row.versions ?? 0),
    created_at: iso(row.created_at),
  };
}

export function createWorkflowAuthoringRepo(db: Db) {
  return {
    /** the builder's list — authored workflows incl. disabled/unpublished */
    async list(identity: Identity): Promise<AuthoredWorkflow[]> {
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<Record<string, unknown>>(
          `${ROW} where w.archived_at is null order by w.created_at desc`));
      return rows.map(toAuthored);
    },

    /** a new DRAFT: no version yet, disabled until published + enabled */
    async create(
      identity: Identity,
      input: { handle?: unknown; name?: unknown; description?: unknown },
    ): Promise<AuthoredWorkflow> {
      const name = typeof input.name === "string" ? input.name.trim() : "";
      if (!name) throw new ValidationError("name is required");
      const handle = typeof input.handle === "string" && input.handle.trim() !== ""
        ? input.handle.trim()
        : `wf-${randomBytes(4).toString("hex")}`;
      if (!HANDLE.test(handle)) {
        throw new ValidationError("handle must be lowercase letters, digits and dashes");
      }
      const description = typeof input.description === "string" ? input.description.trim() : "";
      try {
        const rows = await db.withIdentity(identity, (tx: SqlTx) =>
          tx.unsafe<{ id: string }>(
            `insert into echo.workflow (org_id, handle, name, description, enabled, created_by)
             values ($1, $2, $3, $4, false, $5)
             returning id`,
            [identity.orgId, handle, name, description, identity.userId]));
        return (await this.get(identity, rows[0]!.id))!;
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          throw new ConflictError("that handle is already in use",
            { code: "handle_taken", params: { handle } });
        }
        throw error;
      }
    },

    async get(identity: Identity, id: string): Promise<AuthoredWorkflow | undefined> {
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<Record<string, unknown>>(`${ROW} where w.id = $1`, [id]));
      return rows[0] ? toAuthored(rows[0]) : undefined;
    },

    /**
     * PUBLISH: validate the whole checklist, insert version N+1, repoint.
     * The refusal NAMES the step and the rule — the validator's whole
     * point is that an invalid workflow dies here, not at 3 a.m.
     */
    async publish(
      identity: Identity,
      workflowId: string,
      input: { graph?: unknown; max_autonomy?: unknown; budget?: unknown },
    ): Promise<{ version: number; version_id: string }> {
      const workflow = await this.get(identity, workflowId);
      if (!workflow) throw new NotFoundError("no such workflow");
      const maxAutonomy = input.max_autonomy === "watch" || input.max_autonomy === "act"
        ? input.max_autonomy : "assist";
      const graph: WorkflowGraph = validateWorkflowGraph(input.graph, { maxAutonomy });
      const budget = validateWorkflowBudget(input.budget);

      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ id: string; version: number }>(
          `insert into echo.workflow_version
             (workflow_id, org_id, version, graph, max_autonomy, budget, published_by)
           values ($1, $2,
             coalesce((select max(version) from echo.workflow_version
                        where workflow_id = $1), 0) + 1,
             $3::text::jsonb, $4, $5::text::jsonb, $6)
           returning id, version`,
          [workflowId, identity.orgId, JSON.stringify(graph),
            maxAutonomy, JSON.stringify(budget), identity.userId]));
      const version = rows[0];
      if (!version) throw new Error("version insert returned no row");
      await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe(
          `update echo.workflow set current_version_id = $2 where id = $1`,
          [workflowId, version.id]));
      return { version: version.version, version_id: version.id };
    },

    /** pause / rename / trigger / ROLLBACK (repoint at a prior version) */
    /**
     * **Remove a workflow** (user directive, 2026-08-28: "add remove this
     * workflow to the kebab menu").
     *
     * ARCHIVE, not DELETE, and the reason is not squeamishness: a workflow's
     * runs, its step outputs and its published versions all point at this
     * row, and they are the record of things that actually happened to
     * somebody's data. Destroying the row would either orphan that history
     * or cascade it away — one of which is a lie and the other is a bigger
     * one. `archived_at` takes it out of every list, out of the trigger
     * query, and out of the product; the history it produced stays readable.
     *
     * Reversible on purpose, at the database. The product offers no un-remove
     * because nobody has asked for one — and "we cannot get it back" would be
     * false if it did.
     */
    async archive(identity: Identity, workflowId: string): Promise<void> {
      const workflow = await this.get(identity, workflowId);
      if (!workflow) throw new NotFoundError("no such workflow");
      await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe(
          /* enabled goes false in the same statement: an archived row is
             invisible, and an invisible row that is still `enabled` would
             keep firing on every matching event forever */
          `update echo.workflow
              set archived_at = now(), enabled = false
            where id = $1 and archived_at is null`,
          [workflowId]));
    },

    async update(
      identity: Identity,
      workflowId: string,
      patch: {
        enabled?: unknown; name?: unknown; description?: unknown;
        trigger_event?: unknown; current_version_id?: unknown;
      },
    ): Promise<AuthoredWorkflow> {
      const workflow = await this.get(identity, workflowId);
      if (!workflow) throw new NotFoundError("no such workflow");
      if (patch.trigger_event !== undefined && patch.trigger_event !== null
        && !(WORKFLOW_EVENTS as readonly string[]).includes(patch.trigger_event as string)) {
        throw new ValidationError("trigger_event must be a known fact or null");
      }
      if (patch.current_version_id !== undefined) {
        // W32's rollback: the pointer may only land on THIS workflow's own
        // immutable history — anything else is a graph swap wearing a
        // rollback costume
        const owns = await db.withIdentity(identity, (tx: SqlTx) =>
          tx.unsafe<{ id: string }>(
            `select id from echo.workflow_version
              where id = $1 and workflow_id = $2`,
            [String(patch.current_version_id), workflowId]));
        if (owns.length === 0) {
          throw new ValidationError("current_version_id must name one of this workflow's versions");
        }
      }
      await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe(
          `update echo.workflow
              set enabled = coalesce($2::boolean, enabled),
                  name = coalesce($3::text, name),
                  description = coalesce($4::text, description),
                  trigger_event = case when $5::boolean then $6::text else trigger_event end,
                  current_version_id = coalesce($7::uuid, current_version_id)
            where id = $1`,
          [workflowId,
            typeof patch.enabled === "boolean" ? patch.enabled : null,
            typeof patch.name === "string" && patch.name.trim() !== "" ? patch.name.trim() : null,
            typeof patch.description === "string" ? patch.description.trim() : null,
            patch.trigger_event !== undefined,
            (patch.trigger_event as string | null) ?? null,
            patch.current_version_id !== undefined ? String(patch.current_version_id) : null,
          ]));
      return (await this.get(identity, workflowId))!;
    },

    /** the immutable history, for the rollback picker */
    async versions(identity: Identity, workflowId: string): Promise<WorkflowVersionRow[]> {
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<Record<string, unknown>>(
          `select id, version, max_autonomy, published_at, published_by
             from echo.workflow_version
            where workflow_id = $1 order by version desc`,
          [workflowId]));
      return rows.map((row) => ({
        id: String(row.id),
        version: Number(row.version),
        max_autonomy: String(row.max_autonomy),
        published_at: iso(row.published_at),
        published_by: String(row.published_by),
      }));
    },

    /** the current (or named) graph, for the editor — ADMIN policy read */
    async graph(
      identity: Identity, workflowId: string, versionId?: string,
    ): Promise<{ graph: WorkflowGraph; max_autonomy: string; budget: unknown } | undefined> {
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ graph: WorkflowGraph; max_autonomy: string; budget: unknown }>(
          versionId
            ? `select graph, max_autonomy, budget from echo.workflow_version
                where workflow_id = $1 and id = $2`
            : `select v.graph, v.max_autonomy, v.budget
                 from echo.workflow w join echo.workflow_version v on v.id = w.current_version_id
                where w.id = $1`,
          versionId ? [workflowId, versionId] : [workflowId]));
      return rows[0];
    },

    /**
     * Install one shipped starter for THIS org: create with its fixed
     * handle, publish through the same validated path as any authored
     * graph, enable, set its trigger. A second install of the same
     * starter is one 23505 -> 409, named.
     */
    async installStarter(identity: Identity, key: unknown): Promise<AuthoredWorkflow> {
      if (typeof key !== "string" || !(key in STARTER_WORKFLOWS)) {
        throw new ValidationError(
          `starter must be one of: ${Object.keys(STARTER_WORKFLOWS).join(", ")}`);
      }
      const starter = STARTER_WORKFLOWS[key as StarterKey];
      let workflow: AuthoredWorkflow;
      try {
        workflow = await this.create(identity, {
          handle: starter.handle, name: starter.name, description: starter.description,
        });
      } catch (error) {
        if (error instanceof ConflictError) {
          throw new ConflictError("this starter is already installed",
            { code: "starter_installed", params: { handle: starter.handle } });
        }
        throw error;
      }
      await this.publish(identity, workflow.id, {
        graph: starter.graph, max_autonomy: starter.max_autonomy,
      });
      return this.update(identity, workflow.id, {
        enabled: true, trigger_event: starter.trigger_event,
      });
    },

    /**
     * The standing decisions (W13/W17). Only ELIGIBLE (reversible) kinds
     * may ever be enabled — the platform floor an org cannot lower.
     */
    async autoApply(identity: Identity): Promise<{ kind: string; allowed: boolean; decided_by: string }[]> {
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<Record<string, unknown>>(
          `select proposal_kind, allowed, decided_by from echo.workflow_auto_apply
            where org_id = $1 order by proposal_kind`,
          [identity.orgId]));
      return rows.map((row) => ({
        kind: String(row.proposal_kind),
        allowed: row.allowed === true,
        decided_by: String(row.decided_by),
      }));
    },

    async setAutoApply(
      identity: Identity, kind: string, allowed: boolean,
    ): Promise<void> {
      if (!(AUTO_APPLY_ELIGIBLE as readonly string[]).includes(kind)) {
        throw new ValidationError(
          "only reversible kinds may auto-apply — this one always keeps a live human",
          { code: "kind_not_eligible", params: { kind } });
      }
      await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe(
          `insert into echo.workflow_auto_apply (org_id, proposal_kind, allowed, decided_by)
           values ($1, $2, $3, $4)
           on conflict (org_id, proposal_kind)
           do update set allowed = excluded.allowed,
                         decided_by = excluded.decided_by,
                         decided_at = now()`,
          [identity.orgId, kind, allowed, identity.userId]));
    },
  };
}
