/** M30's manual workflow templates. They are trusted server configuration. */
import { randomBytes } from "node:crypto";
import type { Db, SqlTx } from "../db/identity.ts";
import type { Identity } from "../agent/types.ts";
import { ValidationError } from "./errors.ts";

export type WorkflowSourceKind = "calendar_event" | "mail_message";

export interface WorkflowCard {
  id: string;
  slug: string;
  name: string;
  description: string;
  source_kind: WorkflowSourceKind;
  icon: string;
  color: string;
}

export interface WorkflowTemplate extends WorkflowCard {
  /** Never emitted by the list route; it is trusted server configuration. */
  instructions: string;
}

interface WorkflowRow extends WorkflowTemplate {}

const COLUMNS = "id, slug, name, description, source_kind, instructions, icon, color";

function publicWorkflow({ instructions: _instructions, ...workflow }: WorkflowTemplate): WorkflowCard {
  return workflow;
}

export async function listWorkflows(db: Db, identity: Identity): Promise<WorkflowCard[]> {
  const rows = await db.withIdentity(identity, (tx: SqlTx) => tx.unsafe<WorkflowRow>(
    `select ${COLUMNS} from echo.workflow_template where enabled order by created_at`,
  ));
  return rows.map(publicWorkflow);
}

export const WORKFLOW_SOURCE_KINDS: readonly WorkflowSourceKind[] = ["calendar_event", "mail_message"];

/**
 * An org-authored workflow (0072; user directive 2026-08-20). Admin-gated at
 * the ROUTE and again at the RLS insert policy — the wall, not this file, is
 * what makes a member's forged request fail. The slug is server-generated
 * (`wf-` + 8 hex): it is an internal handle, and deriving one from a Persian
 * name would demand transliteration rules nobody asked for while a
 * user-supplied slug would be a bidi-unsafe global-namespace claim.
 */
export async function createWorkflow(
  db: Db,
  identity: Identity,
  input: {
    name?: unknown;
    description?: unknown;
    source_kind?: unknown;
    instructions?: unknown;
  },
): Promise<WorkflowCard> {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) throw new ValidationError("name is required");
  const instructions = typeof input.instructions === "string" ? input.instructions.trim() : "";
  if (!instructions) throw new ValidationError("instructions are required");
  const sourceKind = input.source_kind;
  if (sourceKind !== "calendar_event" && sourceKind !== "mail_message") {
    throw new ValidationError(`source_kind must be one of: ${WORKFLOW_SOURCE_KINDS.join(", ")}`);
  }
  const description = typeof input.description === "string" ? input.description.trim() : "";
  const slug = `wf-${randomBytes(4).toString("hex")}`;

  const rows = await db.withIdentity(identity, (tx: SqlTx) => tx.unsafe<WorkflowRow>(
    `insert into echo.workflow_template
       (slug, name, description, source_kind, instructions, org_id, created_by)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning ${COLUMNS}`,
    [slug, name, description, sourceKind, instructions, identity.orgId, identity.userId],
  ));
  const row = rows[0];
  if (!row) throw new Error("workflow insert returned no row");
  return publicWorkflow(row);
}

export async function resolveWorkflow(
  db: Db, identity: Identity, slug: string,
): Promise<WorkflowTemplate | undefined> {
  const rows = await db.withIdentity(identity, (tx: SqlTx) => tx.unsafe<WorkflowRow>(
    `select ${COLUMNS}
       from echo.workflow_template
      where slug = $1 and enabled
      limit 1`,
    [slug],
 ));
  return rows[0];
}
