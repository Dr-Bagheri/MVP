/** M30's manual workflow templates. They are trusted server configuration. */
import type { Db, SqlTx } from "../db/identity.ts";
import type { Identity } from "../agent/types.ts";

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
