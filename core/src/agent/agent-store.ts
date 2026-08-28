/**
 * Persisted assistant personas (M30).
 *
 * This mirrors the skill resolver's shape without conflating the two nouns:
 * a skill is a task prompt; an assistant agent is a durable persona that can
 * choose a bounded set of tools and add trusted server-side instructions to a
 * normal assistant turn. RLS answers who can see a row; this module only
 * collapses system < org < user rows by handle.
 */
import type { Db, SqlTx } from "../db/identity.ts";
import { isAdmin, type Identity } from "./types.ts";
import { toJsonb, JSONB_PARAM } from "../db/jsonb.ts";
import { ValidationError } from "../api/errors.ts";
import { randomUUID } from "node:crypto";

export type AgentLevel = "system" | "org" | "user";

export interface AgentCard {
  id: string;
  handle: string;
  name: string;
  description: string;
  level: AgentLevel;
  icon: string;
  color: string;
  model: string | null;
  tools: string[];
  /** M47: this agent's asks may search the web (:online, same model) */
  web: boolean;
}

export interface ResolvedAssistantAgent extends AgentCard {
  /** Trusted configuration; deliberately never sent on the browser wire. */
  instructions: string;
  sourceScope: Record<string, unknown>;
}

interface AgentRow {
  id: string;
  handle: string;
  name: string;
  description: string;
  level: AgentLevel;
  instructions: string;
  model: string | null;
  tools: unknown;
  source_scope: unknown;
  icon: string;
  color: string;
}

const COLUMNS = `
  id, handle, name, description, level, instructions, model,
  tools, source_scope, icon, color, web
`;

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function scope(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function rowToAgent(row: AgentRow): ResolvedAssistantAgent {
  return {
    id: row.id,
    handle: row.handle,
    name: row.name,
    description: row.description,
    level: row.level,
    instructions: row.instructions,
    model: row.model,
    tools: strings(row.tools),
    web: (row as unknown as { web?: boolean }).web === true,
    sourceScope: scope(row.source_scope),
    icon: row.icon,
    color: row.color,
  };
}

function publicCard(agent: ResolvedAssistantAgent): AgentCard {
  const { instructions: _instructions, sourceScope: _sourceScope, ...card } = agent;
  return card;
}

/** Later, more-specific rows overwrite their handle's lower-level row. */
function resolve(rows: AgentRow[]): Map<string, ResolvedAssistantAgent> {
  const ranks: Record<AgentLevel, number> = { system: 0, org: 1, user: 2 };
  const result = new Map<string, ResolvedAssistantAgent>();
  for (const row of [...rows].sort((a, b) => ranks[a.level] - ranks[b.level])) {
    result.set(row.handle, rowToAgent(row));
  }
  return result;
}

async function visible(db: Db, identity: Identity): Promise<AgentRow[]> {
  return db.withIdentity(identity, (tx: SqlTx) => tx.unsafe<AgentRow>(
    `select ${COLUMNS}
       from echo.assistant_agent
      where enabled and archived_at is null
      order by level, name`,
  ));
}

export async function listAssistantAgents(db: Db, identity: Identity): Promise<AgentCard[]> {
  return [...resolve(await visible(db, identity)).values()]
    .map(publicCard)
    .sort((a, b) => a.name.localeCompare(b.name, "fa"));
}

export async function resolveAssistantAgent(
  db: Db, identity: Identity, handle: string,
): Promise<ResolvedAssistantAgent | undefined> {
  return resolve(await visible(db, identity)).get(handle);
}

export interface CreateAssistantAgentInput {
  level: "org" | "user";
  name: string;
  description?: string | undefined;
  instructions: string;
  model?: string | null | undefined;
  tools?: string[] | undefined;
  icon?: string | undefined;
  color?: string | undefined;
  web?: boolean | undefined;
}

const DEFAULT_AGENT_TOOLS = ["search_transcripts", "read_window", "get_call", "list_related_calls"];

function requireText(value: string, field: string, max: number): string {
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > max) throw new ValidationError(`${field} must be 1–${max} characters`);
  return cleaned;
}

/**
 * Create a private or organisation agent. RLS is the authorisation floor;
 * this function supplies the human-readable validation and a safe default
 * tool set. The opaque handle is generated server-side, so Persian names do
 * not have to be mangled into an invented Latin slug in the browser.
 */
export async function createAssistantAgent(
  db: Db, identity: Identity, input: CreateAssistantAgentInput,
): Promise<AgentCard> {
  if (input.level === "org" && !isAdmin(identity)) {
    // Match the regular RLS refusal without exposing a row/permission detail.
    throw new ValidationError("not permitted");
  }
  const name = requireText(input.name, "name", 100);
  const instructions = requireText(input.instructions, "instructions", 12_000);
  const description = (input.description ?? "").trim().slice(0, 500);
  const tools = input.tools ?? DEFAULT_AGENT_TOOLS;
  if (!tools.every((tool) => typeof tool === "string" && tool.length > 0 && tool.length <= 80)) {
    throw new ValidationError("agent tools must be non-empty names");
  }
  const rows = await db.withIdentity(identity, (tx: SqlTx) => tx.unsafe<AgentRow>(
    `insert into echo.assistant_agent
       (level, org_id, user_id, handle, name, description, instructions, model, tools,
        icon, color, web, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, ${JSONB_PARAM(9)}, $10, $11, $12, $13)
     returning ${COLUMNS}`,
    [
      input.level, identity.orgId, input.level === "user" ? identity.userId : null,
      `agent-${randomUUID()}`, name, description, instructions, input.model ?? null,
      toJsonb(tools),
      (input.icon ?? "sparkles").slice(0, 40), (input.color ?? "violet").slice(0, 40),
      input.web === true, identity.userId,
    ],
  ));
  const row = rows[0];
  if (!row) throw new Error("assistant agent insert returned no row");
  return publicCard(rowToAgent(row));
}


export interface UpdateAssistantAgentInput {
  name?: string | undefined;
  description?: string | undefined;
  instructions?: string | undefined;
  model?: string | null | undefined;
  tools?: string[] | undefined;
  icon?: string | undefined;
  color?: string | undefined;
  web?: boolean | undefined;
  enabled?: boolean | undefined;
}

/**
 * Edit an agent (M47). RLS is the wall — a member editing an org agent, or
 * anyone editing a system one, updates zero rows and gets the same not-found
 * as an agent that does not exist. Absent field = untouched (the profile
 * form's contract, applied here).
 */
export async function updateAssistantAgent(
  db: Db, identity: Identity, agentId: string, patch: UpdateAssistantAgentInput,
): Promise<AgentCard> {
  const name = patch.name === undefined ? null : requireText(patch.name, "name", 100);
  const instructions = patch.instructions === undefined
    ? null : requireText(patch.instructions, "instructions", 12_000);
  const rows = await db.withIdentity(identity, (tx: SqlTx) => tx.unsafe<AgentRow>(
    `update echo.assistant_agent
        set name = coalesce($2, name),
            description = coalesce($3, description),
            instructions = coalesce($4, instructions),
            model = case when $5::boolean then $6::text else model end,
            tools = case when $7::boolean then ${JSONB_PARAM(8)} else tools end,
            icon = coalesce($9, icon),
            color = coalesce($10, color),
            web = coalesce($11, web),
            enabled = coalesce($12, enabled),
            updated_at = now()
      where id = $1 and level <> 'system' and archived_at is null
      returning ${COLUMNS}`,
    [
      agentId, name, patch.description?.trim().slice(0, 500) ?? null, instructions,
      patch.model !== undefined, patch.model ?? null,
      patch.tools !== undefined, toJsonb(patch.tools ?? []),
      patch.icon?.slice(0, 40) ?? null, patch.color?.slice(0, 40) ?? null,
      patch.web ?? null, patch.enabled ?? null,
    ],
  ));
  const row = rows[0];
  if (!row) throw new ValidationError("no such agent");
  return publicCard(rowToAgent(row));
}

/** The workflows an agent carries (M47) — id + name, for the overview panel. */
export async function agentWorkflows(
  db: Db, identity: Identity, agentId: string,
): Promise<{ id: string; handle: string; name: string }[]> {
  return db.withIdentity(identity, (tx: SqlTx) =>
    tx.unsafe<{ id: string; handle: string; name: string }>(
      `select w.id, w.handle, w.name
         from echo.agent_workflow aw
         join echo.workflow w on w.id = aw.workflow_id
        where aw.agent_id = $1 and aw.enabled and w.archived_at is null
        order by w.name`,
      [agentId]));
}

/**
 * Replace an agent's workflow set (M47). Whole-set write, the same trade the
 * models allow-list took and with the same recorded hazard: two admins
 * editing one agent at once is last-writer-wins. Diffed insert/delete rather
 * than delete-all-reinsert, so an unchanged membership row keeps its
 * created_at — the row is a fact about when the workflow joined the agent.
 */
export async function setAgentWorkflows(
  db: Db, identity: Identity, agentId: string, workflowIds: string[],
): Promise<void> {
  const wanted = [...new Set(workflowIds)];
  const current = (await agentWorkflows(db, identity, agentId)).map((row) => row.id);
  const add = wanted.filter((id) => !current.includes(id));
  const remove = current.filter((id) => !wanted.includes(id));
  await db.withIdentity(identity, async (tx: SqlTx) => {
    for (const workflowId of add) {
      /* the org id rides along for RLS; a workflow from ANOTHER org fails
         the workflow join in the policy and inserts nothing, loudly. A
         re-attach revives the kept row — detaching never deleted it
         (0123: echo_purge stays the only role that deletes product rows) */
      await tx.unsafe(
        `insert into echo.agent_workflow (agent_id, workflow_id, org_id, enabled)
         select $1, w.id, w.org_id, true from echo.workflow w where w.id = $2
         on conflict (agent_id, workflow_id) do update set enabled = true`,
        [agentId, workflowId]);
    }
    if (remove.length > 0) {
      await tx.unsafe(
        `update echo.agent_workflow set enabled = false
          where agent_id = $1 and workflow_id = any($2::uuid[])`,
        [agentId, remove]);
    }
  });
}
