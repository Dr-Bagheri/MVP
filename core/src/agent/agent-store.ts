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
  tools, source_scope, icon, color
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
       (level, org_id, user_id, handle, name, description, instructions, model, tools, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, ${JSONB_PARAM(9)}, $10)
     returning ${COLUMNS}`,
    [
      input.level, identity.orgId, input.level === "user" ? identity.userId : null,
      `agent-${randomUUID()}`, name, description, instructions, input.model ?? null,
      toJsonb(tools), identity.userId,
    ],
  ));
  const row = rows[0];
  if (!row) throw new Error("assistant agent insert returned no row");
  return publicCard(rowToAgent(row));
}
