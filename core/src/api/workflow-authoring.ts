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
        : `wf-${Math.random().toString(16).slice(2, 10)}`;
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
