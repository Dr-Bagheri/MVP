/**
 * THE PUBLISH-TIME GRAPH VALIDATOR (M41 §4.2–4.3).
 *
 * An invalid workflow is refused when it is SAVED, naming the step and the
 * rule — never discovered at 3 a.m. by the person whose call it was about.
 * Every refusal here has a corpus fixture in test/workflow-graph.test.ts
 * that proves the check can fire (rule 13: a validator is proven able to
 * refuse before it is trusted to accept).
 *
 * ── The control model (P0's deliberately small one) ─────────────────────
 * Steps execute in ARRAY ORDER. `decide` jumps FORWARD to `then`/`else`
 * (later steps, or "__end"); `foreach.do` names the IMMEDIATELY FOLLOWING
 * step as its one-step body, and control continues after it. Forward-only
 * jumps make the graph acyclic BY CONSTRUCTION — there is no cycle check
 * because there is nothing to write one about. Multi-step loop bodies are
 * a later phase's decision, not a missing feature.
 *
 * ── What this file cannot check, said plainly ───────────────────────────
 * Agent handles are SHAPE-checked here; whether one resolves (org →
 * system, W22) needs the database and is the publish ROUTE's second half.
 * The same for org-defined extract schemas beyond the shipped registry —
 * callers pass what they know via `options`.
 *
 * ── W5, and why there is no check for it ────────────────────────────────
 * No graph can name a role, a grant, an org or a user id, because the
 * binding grammar (W25, below) has no way to SAY it: paths resolve only
 * against `trigger` and earlier steps' declared outputs. Identity comes
 * from the run. Prompts remain free text and can claim anything — but
 * prompts are never the wall; they hold no authority to misuse.
 */
import { ValidationError } from "./errors.ts";
import {
  FETCH_SOURCE_KINDS,
  INERT_PROPOSAL_KINDS,
  WORKFLOW_PROPOSAL_KINDS,
  WORKFLOW_STEP_KINDS,
  type WorkflowStepKind,
} from "./vocabulary.ts";

/* ── the extract schema registry ─────────────────────────────────────── */

export type SchemaField =
  | "text" | "number" | "boolean" | "date" | "person_ref"
  | { list: SchemaField }
  | { object: Record<string, SchemaField> };

export type ExtractSchema = Record<string, SchemaField>;

const ACTION_ITEM: SchemaField = {
  object: { title: "text", assignee: "person_ref", due: "date" },
};

/**
 * The shipped schemas, versioned by name. `person_ref` resolves against
 * the directory UNDER THE RUN OWNER'S RLS at execution time — the schema
 * declares the intent; the wall decides the rows.
 */
export const EXTRACT_SCHEMAS: Record<string, ExtractSchema> = {
  decisions_v1: {
    decisions: { list: "text" },
    action_items: { list: ACTION_ITEM },
    open_questions: { list: "text" },
  },
  action_items_v1: { action_items: { list: ACTION_ITEM } },
  topics_v1: { topics: { list: "text" } },
  /*
   * The reply verdict, as a CONTRACT rather than a hopeful parse. The
   * hardcoded poller asks for the same three fields and reads them back
   * defensively (`readVerdict` falls through to prose when the JSON is
   * wrong), which was the right call for a single call site and the wrong
   * one for a graph: here the shape is validated, retried once with the
   * errors named, and forfeits loudly if it still does not arrive.
   *
   * `reply` is a boolean so `decide` can branch on it — decide refuses raw
   * content by design, so "should we answer at all" has to be typed to be
   * askable at all.
   */
  mail_reply_v1: { reply: "boolean", note: "text", body: "text" },
};

/**
 * RUNTIME validation of an extract's answer against its declared schema —
 * the other half of the publish-time typing (W4): the publish validator
 * promises downstream steps a shape; this is what makes the promise true
 * at 3 a.m. Returns the list of NAMED field errors (empty = valid), which
 * the executor hands back to the model for its one retry.
 *
 * Deliberately forgiving about EXTRA keys (models editorialize) and strict
 * about declared ones: a missing field, a null, or a wrong type each earns
 * a path-named error. `date` and `person_ref` validate as non-empty
 * strings in this phase — a Jalali date is a legal date, and person
 * RESOLUTION against the directory is the propose step's job (P3), where
 * the assignment actually happens.
 */
export function validateExtractOutput(schema: ExtractSchema, value: unknown): string[] {
  const errors: string[] = [];
  const check = (field: SchemaField, at: string, v: unknown): void => {
    if (typeof field === "string") {
      if (field === "number") {
        if (typeof v !== "number" || Number.isNaN(v)) errors.push(`${at}: expected a number`);
      } else if (field === "boolean") {
        if (typeof v !== "boolean") errors.push(`${at}: expected true/false`);
      } else {
        // text | date | person_ref — a non-empty string
        if (typeof v !== "string" || v.trim() === "") errors.push(`${at}: expected non-empty text`);
      }
      return;
    }
    if ("list" in field) {
      if (!Array.isArray(v)) { errors.push(`${at}: expected a list`); return; }
      v.forEach((element, index) => check(field.list, `${at}[${index}]`, element));
      return;
    }
    if (typeof v !== "object" || v === null || Array.isArray(v)) {
      errors.push(`${at}: expected an object`);
      return;
    }
    for (const [key, inner] of Object.entries(field.object)) {
      const child = (v as Record<string, unknown>)[key];
      if (child === undefined || child === null) errors.push(`${at}.${key}: missing`);
      else check(inner, `${at}.${key}`, child);
    }
  };
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return ["the answer must be a JSON object"];
  }
  for (const [key, field] of Object.entries(schema)) {
    const child = (value as Record<string, unknown>)[key];
    if (child === undefined || child === null) errors.push(`${key}: missing`);
    else check(field, key, child);
  }
  return errors;
}

/** the schema as a JSON skeleton the prompt shows the model — deterministic */
export function renderSchemaContract(schema: ExtractSchema): string {
  const render = (field: SchemaField): unknown => {
    if (typeof field === "string") {
      if (field === "number") return 0;
      if (field === "boolean") return false;
      if (field === "date") return "تاریخ";
      if (field === "person_ref") return "نام شخص";
      return "متن";
    }
    if ("list" in field) return [render(field.list)];
    return Object.fromEntries(Object.entries(field.object).map(([k, f]) => [k, render(f)]));
  };
  return JSON.stringify(
    Object.fromEntries(Object.entries(schema).map(([k, f]) => [k, render(f)])),
    null, 1,
  );
}

/* ── W25: the binding grammar — closed and tiny ──────────────────────── */

const BINDING = /\{\{\s*([^{}]+?)\s*\}\}/g;
const IDENT = /^[a-z_][a-z0-9_]{0,59}$/i;
const STEP_ID = /^[a-z0-9][a-z0-9_-]{0,59}$/;

export interface BindingPath {
  source: string;                       // "trigger" | a step id
  parts: (string | number)[];           // idents and [int] indexes
}

/** Parse one path. Throws nothing — the validator names the step itself. */
export function parseBindingPath(raw: string): BindingPath | null {
  // split on '.' but honour [int] segments: a.b[0].c
  const segments = raw.trim().split(".");
  if (segments.length === 0 || segments.length > 8) return null;
  const parts: (string | number)[] = [];
  let source: string | null = null;
  for (const [index, segment] of segments.entries()) {
    const match = /^([^[\]]+)((\[\d{1,4}\])*)$/.exec(segment);
    if (!match) return null;
    const name = match[1]!;
    if (index === 0) {
      if (name !== "trigger" && !STEP_ID.test(name)) return null;
      source = name;
    } else {
      if (!IDENT.test(name)) return null;
      parts.push(name);
    }
    for (const idx of match[2]?.match(/\d{1,4}/g) ?? []) parts.push(Number(idx));
  }
  if (source === null || parts.length > 8) return null;
  return { source, parts };
}

/** every `{{…}}` in a string, parsed — a malformed one returns null in place */
export function bindingsIn(text: string): (BindingPath | null)[] {
  const found: (BindingPath | null)[] = [];
  for (const match of text.matchAll(BINDING)) found.push(parseBindingPath(match[1]!));
  return found;
}

/* ── what each kind's output looks like, for edge typing (W4) ────────── */

type OutputShape =
  | { kind: "content" }                 // search/ask: fenced at bind time (W20)
  | { kind: "envelope"; source: string; fields: Readonly<Record<string, EnvelopeTrust>> }
  | { kind: "schema"; schema: ExtractSchema }
  | { kind: "item"; of: SchemaField }   // a foreach body's view of one element
  | { kind: "none" };

/**
 * **What a fetched field may be trusted to DO** — the reason `fetch` has a
 * shape of its own instead of being one more lump of content.
 *
 * A message is not uniformly untrustworthy. Its BODY is a stranger's prose
 * and must never be anything but fenced data; its `reply_to` is an address
 * the provider parsed out of a header, and binding a reply's recipient to it
 * is precisely how "the model never chooses the recipient" stops being a
 * comment in one file and becomes a property the validator can check.
 *
 * So the trust travels with the field:
 *
 *  · `id` / `address` / `date` — provider-parsed, spliced inline, and the
 *    only things a dangerous field like a recipient may bind to;
 *  · `untrusted_text` — a person wrote it; fenced at bind time, always,
 *    with no author opt-out.
 *
 * The old boolean (typed vs content) could not express "trustworthy enough
 * to address an email with, not trustworthy enough to obey".
 */
export type EnvelopeTrust = "id" | "address" | "date" | "untrusted_text";

/**
 * The envelope each `source_kind` declares. Hand-written and closed, because
 * it is a CONTRACT rather than a description: a field named here is one the
 * executor promises to produce, and a graph may bind it at publish time,
 * months before the run. `core/test/workflow-fetch.test.ts` holds the
 * executor to it — a producer and a consumer with no common ancestor is how
 * the words-shape incident happened.
 */
export const ENVELOPE_FIELDS: Readonly<Record<string, Readonly<Record<string, EnvelopeTrust>>>> = {
  mail_message: {
    id: "id",
    thread_ref: "id",
    reply_to: "address",
    occurred_at: "date",
    subject: "untrusted_text",
    body: "untrusted_text",
  },
  calendar_event: {
    id: "id",
    starts_at: "date",
    title: "untrusted_text",
    attendees: "untrusted_text",
    description: "untrusted_text",
  },
};

const TRUSTS: readonly string[] = ["id", "address", "date", "untrusted_text"];
export function isEnvelopeTrust(value: unknown): value is EnvelopeTrust {
  return typeof value === "string" && TRUSTS.includes(value);
}

/** Resolve a path against a shape. Returns the field type, "content", or null. */
function resolveAgainst(
  shape: OutputShape, parts: (string | number)[],
): SchemaField | EnvelopeTrust | "content" | "length" | null {
  if (shape.kind === "none") return null;
  if (shape.kind === "content") return parts.length === 0 ? "content" : null;
  if (shape.kind === "envelope") {
    /*
     * A bare `{{s1}}` is THE WHOLE MESSAGE, and it stays legal: db/0105
     * writes exactly that shape for every migrated template, and "read the
     * email, then reason over it" is the ordinary thing to want. It resolves
     * as content, so it fences — which is the correct treatment for a blob
     * that contains a stranger's prose.
     *
     * One segment is a FIELD, and that is the new part: `s1.reply_to` is an
     * address the provider parsed, and being able to say so is what lets a
     * recipient be bound instead of written.
     */
    if (parts.length === 0) return "content";
    if (parts.length !== 1 || typeof parts[0] !== "string") return null;
    return shape.fields[parts[0]] ?? null;
  }
  let current: SchemaField | { object: ExtractSchema } =
    shape.kind === "schema" ? { object: shape.schema } : shape.of;
  for (const [index, part] of parts.entries()) {
    if (typeof part === "number") {
      if (typeof current !== "object" || !("list" in current)) return null;
      current = current.list;
      continue;
    }
    if (part === "length" && index === parts.length - 1
      && typeof current === "object" && "list" in current) {
      return "length";                  // list.length → number, decide's friend
    }
    if (typeof current !== "object" || !("object" in current)) return null;
    const next: SchemaField | undefined = (current.object as Record<string, SchemaField>)[part];
    if (next === undefined) return null;
    current = next;
  }
  return current as SchemaField;
}

/* ── the steps, loosely typed on purpose (validation IS the typing) ──── */

export interface GraphStep { id: string; kind: WorkflowStepKind; [key: string]: unknown }
export interface WorkflowGraph { entry: string; steps: GraphStep[] }

/** per-kind allowed keys — an unknown key is refused, never ignored */
const STEP_KEYS: Record<WorkflowStepKind, readonly string[]> = {
  search: ["id", "kind", "scope", "of", "limit"],
  fetch: ["id", "kind", "source_kind", "of"],
  /* `web` = OpenRouter's `:online` variant on the SAME model (M41 + the
     assistant's own toggle): a step may look things up rather than only
     reason over what the run already holds. Optional and off by default —
     a workflow that searches the web when nobody asked it to is spending
     someone's money on a guess. */
  ask: ["id", "kind", "instruction", "agent", "from", "web", "tools"],
  extract: ["id", "kind", "instruction", "agent", "from", "schema", "tools"],
  decide: ["id", "kind", "on", "gt", "gte", "lt", "lte", "eq", "ne", "contains", "then", "else"],
  foreach: ["id", "kind", "over", "max", "do"],
  propose: ["id", "kind", "proposal", "from", "call", "to", "subject", "message"],
  apply: ["id", "kind", "from"],
  notify: ["id", "kind", "card"],
  wait: ["id", "kind", "on"],
};

const SEARCH_SCOPES = ["transcript", "summaries", "calls", "directory"] as const;
const DECIDE_OPS = ["gt", "gte", "lt", "lte", "eq", "ne", "contains"] as const;
const FETCH_KINDS = FETCH_SOURCE_KINDS;
const WAIT_KINDS = ["decision", "until", "signal"] as const;

export interface ValidateOptions {
  /** the version's declared ceiling — a graph with `apply` under 'watch'
      is refused as self-contradictory (§4.3 check 10) */
  maxAutonomy: "watch" | "assist" | "act";
  /** org-defined schemas beyond the shipped registry, when known */
  extraSchemas?: Record<string, ExtractSchema>;
  /** resolvable agent handles, when the caller has them (the publish
      route's half); absent = shape-check only */
  knownAgents?: readonly string[];
}

const MAX_STEPS = 200;
const MAX_FOREACH = 50;
const MAX_INSTRUCTION = 8000;

/** the named refusal every check speaks with */
function refuse(rule: string, step?: string): never {
  throw new ValidationError(
    step ? `invalid graph at step ${step}: ${rule}` : `invalid graph: ${rule}`,
    { code: "invalid_graph", params: { rule, ...(step ? { step } : {}) } },
  );
}

/**
 * The whole checklist, or no version. Throws ValidationError naming the
 * step and the rule; returns the parsed graph on success.
 */
export function validateWorkflowGraph(raw: unknown, options: ValidateOptions): WorkflowGraph {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) refuse("graph must be an object");
  const top = raw as Record<string, unknown>;
  for (const key of Object.keys(top)) {
    if (key !== "entry" && key !== "steps") refuse(`unknown key '${key}'`);
  }
  if (!Array.isArray(top.steps) || top.steps.length === 0) refuse("steps must be a non-empty array");
  if (top.steps.length > MAX_STEPS) refuse(`at most ${MAX_STEPS} steps`);

  // ids, kinds, per-kind keys
  const steps: GraphStep[] = [];
  const indexOf = new Map<string, number>();
  for (const [index, value] of top.steps.entries()) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      refuse(`step ${index} must be an object`);
    }
    const step = value as Record<string, unknown>;
    const id = step.id;
    if (typeof id !== "string" || !STEP_ID.test(id) || id === "trigger" || id === "__end") {
      refuse(`step ${index} needs a valid id`);
    }
    if (indexOf.has(id)) refuse("duplicate step id", id);
    const kind = step.kind;
    if (typeof kind !== "string" || !(WORKFLOW_STEP_KINDS as readonly string[]).includes(kind)) {
      refuse("unknown step kind", id);
    }
    for (const key of Object.keys(step)) {
      if (!STEP_KEYS[kind as WorkflowStepKind].includes(key)) refuse(`unknown key '${key}'`, id);
    }
    indexOf.set(id, index);
    steps.push(step as GraphStep);
  }
  if (typeof top.entry !== "string" || !indexOf.has(top.entry)) refuse("entry must name a step");
  if (indexOf.get(top.entry) !== 0) refuse("entry must be the first step");

  const schemas = { ...EXTRACT_SCHEMAS, ...(options.extraSchemas ?? {}) };

  // What each step's output looks like to LATER steps. foreach exposes a
  // body-only `item` view (its body may bind `<foreachId>.item…`).
  const outputs = new Map<string, OutputShape>();
  const foreachBody = new Map<string, string>();       // bodyId → foreachId

  const resolvePath = (path: BindingPath, atIndex: number, bodyOf?: string) => {
    if (path.source === "trigger") {
      /*
       * The runtime carries exactly two trigger facts and refuses the rest
       * (`resolveBinding`, worker/workflow-step.ts). This used to answer
       * "content" for ANY `trigger.*` path, so a mis-bound trigger published
       * happily and died at 3am as `binding_unresolved`. A publish-time
       * refusal is the same fact, said early — and both are ids, so they
       * splice rather than fence.
       */
      if (path.parts.length !== 1) return null;
      const fact = path.parts[0];
      return fact === "source_ref" || fact === "call_id" || fact === "source_provider"
        ? ("id" as const) : null;
    }
    if (!indexOf.has(path.source)) return null;
    /* P2 tightening: a foreach BODY's output is unbindable from anywhere —
       it exists once per iteration, and a later step binding it would
       silently read iteration 0 and present it as the whole. The loop's
       data flows through the foreach's own item view, nowhere else. */
    if (foreachBody.has(path.source)) return null;
    const sourceIndex = indexOf.get(path.source)!;
    if (sourceIndex >= atIndex) {
      // one exception: a foreach BODY may read its own foreach's item view
      if (!(bodyOf === path.source && path.parts[0] === "item")) return null;
    }
    if (bodyOf === path.source) {
      if (path.parts[0] !== "item" && path.parts[0] !== "index") return null;
      if (path.parts[0] === "index") return path.parts.length === 1 ? ("length" as const) : null;
      const shape = outputs.get(path.source);
      if (!shape || shape.kind !== "item") return null;
      return resolveAgainst(shape, path.parts.slice(1));
    }
    const shape = outputs.get(path.source) ?? { kind: "none" as const };
    return resolveAgainst(shape, path.parts);
  };

  const requireBinding = (value: unknown, field: string, id: string, atIndex: number, bodyOf?: string): BindingPath => {
    if (typeof value !== "string") refuse(`${field} must be a binding`, id);
    const trimmed = value.trim();
    if (!/^\{\{[^{}]+\}\}$/.test(trimmed)) {
      refuse(`${field} must be exactly one {{binding}}`, id);
    }
    const path = parseBindingPath(trimmed.slice(2, -2));
    if (!path) refuse(`${field} has a malformed binding`, id);
    if (resolvePath(path, atIndex, bodyOf) === null) {
      refuse(`${field} does not resolve against an earlier step's declared output`, id);
    }
    return path;
  };

  const sawProposeAt = new Map<string, number>();      // proposeId → index
  const proposalKind = new Map<string, string>();      // proposeId → its kind
  /* a graph that can address a stranger gets no retrieval tools — see the
     tools rule under `ask`/`extract` below */
  let addressesOutward = false;
  const waits: string[] = [];
  const jumpSpans: Array<{ from: number; into: [number, number] }> = [];

  for (const [index, step] of steps.entries()) {
    const id = step.id;
    const bodyOf = foreachBody.get(id);

    switch (step.kind) {
      case "search": {
        if (typeof step.scope !== "string"
          || !(SEARCH_SCOPES as readonly string[]).includes(step.scope)) {
          refuse("search needs a known scope", id);
        }
        if (step.of !== undefined) requireBinding(step.of, "of", id, index, bodyOf);
        if (step.limit !== undefined
          && (typeof step.limit !== "number" || !Number.isInteger(step.limit)
              || step.limit < 1 || step.limit > 50)) {
          refuse("limit must be an integer 1..50", id);
        }
        outputs.set(id, { kind: "content" });
        break;
      }
      case "fetch": {
        if (typeof step.source_kind !== "string"
          || !(FETCH_KINDS as readonly string[]).includes(step.source_kind)) {
          refuse("fetch needs a known source_kind", id);
        }
        /* WHAT it reads must be an id — a provider address, not prose. A
           `of` bound to a model's output would let the run fetch whatever
           the model named, which is the recipient problem one layer up. */
        const ofPath = requireBinding(step.of, "of", id, index, bodyOf);
        const ofShape = resolvePath(ofPath, index, bodyOf);
        if (ofShape !== "id") {
          refuse("fetch.of must bind an id — the trigger's source_ref, or an id field of an earlier fetch", id);
        }
        outputs.set(id, {
          kind: "envelope",
          source: step.source_kind as string,
          fields: ENVELOPE_FIELDS[step.source_kind as string]!,
        });
        break;
      }
      case "ask":
      case "extract": {
        if (typeof step.instruction !== "string" && step.kind === "ask") {
          refuse("ask needs an instruction", id);
        }
        if (typeof step.instruction === "string") {
          if (step.instruction.trim() === "") refuse("instruction cannot be blank", id);
          if (step.instruction.length > MAX_INSTRUCTION) {
            refuse(`instruction tops out at ${MAX_INSTRUCTION} characters`, id);
          }
          for (const path of bindingsIn(step.instruction)) {
            if (path === null) refuse("instruction has a malformed binding", id);
            if (resolvePath(path, index, bodyOf) === null) {
              refuse("instruction binds something no earlier step declares", id);
            }
          }
        }
        if (step.agent !== undefined) {
          if (typeof step.agent !== "string" || !STEP_ID.test(step.agent)) {
            refuse("agent must be a handle", id);
          }
          if (options.knownAgents && !options.knownAgents.includes(step.agent)) {
            refuse("agent does not resolve (org → system)", id);
          }
        }
        if (step.from !== undefined) requireBinding(step.from, "from", id, index, bodyOf);
        /* the model step's REACH. Default is today's behaviour — the domain
           read tools — because every graph that exists was written under it;
           `none` is the opt-out a mail-drafting graph is required to take. */
        if (step.tools !== undefined && step.tools !== "read" && step.tools !== "none") {
          refuse("tools must be read | none", id);
        }
        if (step.kind === "extract") {
          if (typeof step.schema !== "string" || !(step.schema in schemas)) {
            refuse("extract needs a declared schema", id);
          }
          outputs.set(id, { kind: "schema", schema: schemas[step.schema]! });
        } else {
          outputs.set(id, { kind: "content" });
        }
        break;
      }
      case "decide": {
        if (typeof step.on !== "string") refuse("decide needs an on path", id);
        const onPath = parseBindingPath(step.on);
        if (!onPath) refuse("on is not a valid path", id);
        const resolved = resolvePath(onPath, index, bodyOf);
        if (resolved === null) refuse("on does not resolve against a declared output", id);
        // W6's sharp edge: a decide over raw CONTENT is a model-shaped
        // branch wearing a code costume — only typed values may steer.
        if (resolved === "content") refuse("decide must read a typed extract output, never raw content", id);
        const ops = DECIDE_OPS.filter((op) => step[op] !== undefined);
        if (ops.length > 1) refuse("decide takes at most one operator", id);
        const op = ops[0];
        if ((op === "gt" || op === "gte" || op === "lt" || op === "lte")
          && !(resolved === "length" || resolved === "number")) {
          refuse(`${op} needs a number on the left`, id);
        }
        for (const branch of ["then", "else"] as const) {
          const target = step[branch];
          if (typeof target !== "string") refuse(`decide needs ${branch}`, id);
          if (target === "__end") continue;
          const targetIndex = indexOf.get(target);
          if (targetIndex === undefined) refuse(`${branch} names no step`, id);
          if (targetIndex <= index) refuse("jumps go forward only — the graph is acyclic by construction", id);
          jumpSpans.push({ from: index, into: [index, targetIndex] });
        }
        outputs.set(id, { kind: "none" });
        break;
      }
      case "foreach": {
        const overPath = requireBinding(step.over, "over", id, index, bodyOf);
        const sourceShape = overPath.source === "trigger"
          ? null : outputs.get(overPath.source);
        let element: SchemaField | null = null;
        if (sourceShape?.kind === "schema") {
          const resolved = resolveAgainst(sourceShape, overPath.parts);
          if (resolved && typeof resolved === "object" && "list" in resolved) {
            element = resolved.list;
          }
        }
        if (element === null) refuse("over must bind a LIST field of an extract output", id);
        if (typeof step.max !== "number" || !Number.isInteger(step.max)
          || step.max < 1 || step.max > MAX_FOREACH) {
          refuse(`max must be an integer 1..${MAX_FOREACH}`, id);
        }
        const body = step.do;
        if (typeof body !== "string" || indexOf.get(body) !== index + 1) {
          refuse("do must name the immediately following step — one-step bodies in P0", id);
        }
        const bodyKind = (top.steps[index + 1] as Record<string, unknown>).kind;
        if (bodyKind === "decide" || bodyKind === "foreach"
          || bodyKind === "apply" || bodyKind === "wait") {
          /* a body that jumps, loops, writes or sleeps is not a one-step
             body — it is control flow hiding inside an iteration */
          refuse("a foreach body must be a linear step (search/fetch/ask/extract/propose/notify)", id);
        }
        foreachBody.set(body, id);
        outputs.set(id, { kind: "item", of: element });
        break;
      }
      case "propose": {
        if (typeof step.proposal !== "string"
          || !(WORKFLOW_PROPOSAL_KINDS as readonly string[]).includes(step.proposal)) {
          refuse("propose needs a known proposal kind", id);
        }
        const fromPath = requireBinding(step.from, "from", id, index, bodyOf);
        /* P3: a proposal's payload is TYPED data only — a propose fed raw
           content would put unvalidated text one human click from a write */
        const fromShape = resolvePath(fromPath, index, bodyOf);
        if (fromShape === "content") {
          refuse("propose.from must bind typed extract output, never raw content", id);
        }
        if (step.proposal === "draft_mail") {
          /*
           * **THE RECIPIENT IS BOUND, NEVER WRITTEN.**
           *
           * This is the whole reason `fetch` grew a trust-labelled envelope.
           * In the hardcoded poller "the model never chooses the recipient"
           * is true because one file takes `to` from the headers and a
           * comment says so. In a graph the author picks the binding — so
           * the rule has to be a property the validator can check, or the
           * first person to bind `to` to a model's output has published a
           * workflow that emails whoever the email told it to.
           *
           * `address` trust exists only on provider-parsed header fields.
           * An extract output, a search result and an ask's prose are all
           * refused here BY SHAPE, at publish time, naming the step.
           */
          const to = requireBinding(step.to, "to", id, index, bodyOf);
          if (resolvePath(to, index, bodyOf) !== "address") {
            refuse("draft_mail.to must bind an address from a fetched message — never a model's output", id);
          }
          /* which message it answers: an id, for the same reason */
          const message = requireBinding(step.message, "message", id, index, bodyOf);
          if (resolvePath(message, index, bodyOf) !== "id") {
            refuse("draft_mail.message must bind a fetched message id", id);
          }
          /*
           * The subject must come from the SAME message. A reply carrying
           * one message's subject and another's recipient is a mix-up that
           * reads as a working feature and lands in a stranger's inbox.
           */
          if (step.subject !== undefined) {
            const subject = requireBinding(step.subject, "subject", id, index, bodyOf);
            if (resolvePath(subject, index, bodyOf) !== "untrusted_text"
              || subject.source !== message.source) {
              refuse("draft_mail.subject must be the subject of the message being answered", id);
            }
          }
          if (step.call !== undefined) refuse("draft_mail answers a message, not a call", id);
        } else {
          /* the call-scoped kinds, where the CALL is load-bearing: the
             decision row carries it so its own decider can read it back */
          requireBinding(step.call, "call", id, index, bodyOf);
        }
        sawProposeAt.set(id, index);
        proposalKind.set(id, step.proposal as string);
        outputs.set(id, { kind: "none" });
        break;
      }
      case "apply": {
        // §4.3 check 6 + check 10: apply only behind ITS propose, and never
        // in a graph whose declared ceiling forbids writes
        if (options.maxAutonomy === "watch") {
          refuse("a graph with apply cannot declare max_autonomy watch — self-contradictory", id);
        }
        const from = step.from;
        if (typeof from !== "string" || !sawProposeAt.has(from)) {
          refuse("apply must name an earlier propose step", id);
        }
        const proposeIndex = sawProposeAt.get(from)!;
        if (proposalKind.get(from) === "draft_mail") addressesOutward = true;
        // span protection: no earlier decide may jump INTO (propose, apply]
        // from before the propose — the path that skips the propose is the
        // path that must not exist
        for (const jump of jumpSpans) {
          if (jump.from < proposeIndex && jump.into[1] > proposeIndex && jump.into[1] <= index) {
            refuse("a branch may not jump between a propose and its apply", id);
          }
        }
        outputs.set(id, { kind: "none" });
        break;
      }
      case "notify": {
        if (typeof step.card !== "string" || step.card.length < 3 || step.card.length > 60) {
          refuse("notify needs a card kind", id);
        }
        outputs.set(id, { kind: "none" });
        break;
      }
      case "wait": {
        if (typeof step.on !== "string" || !(WAIT_KINDS as readonly string[]).includes(step.on)) {
          refuse("wait needs decision | until | signal", id);
        }
        waits.push(id);
        outputs.set(id, { kind: "none" });
        break;
      }
    }
  }

  /*
   * ── TWO RULES ABOUT THE WHOLE GRAPH ──────────────────────────────────
   *
   * **A graph that can address a stranger gets no retrieval tools.** M43
   * gives the mail drafter none and M44 gives the meeting brief all of
   * them, and the difference is not caution levels — it is blast radius:
   * a brief is read by the person who asked for it, a reply is read by
   * somebody else. Today that asymmetry is a comment in two worker files.
   * A graph can compose the two, so it becomes a refusal.
   *
   * **A wait cannot sit in a graph whose only proposal is inert.** An
   * inert propose writes no decision row, so `wait on:decision` would park
   * until its deadline and fail — a workflow that publishes cleanly and
   * can only ever time out.
   */
  if (addressesOutward) {
    for (const step of steps) {
      if ((step.kind === "ask" || step.kind === "extract") && step.tools !== "none") {
        refuse("a graph that drafts mail must set tools:\"none\" on every model step — what it writes is addressed to somebody else", step.id);
      }
    }
    if (waits.length > 0 && [...proposalKind.values()].every((kind) =>
      (INERT_PROPOSAL_KINDS as readonly string[]).includes(kind))) {
      refuse("wait on a decision that nothing will ever record — a draft_mail is decided in the mailbox, not by a proposal decision", waits[0]!);
    }
  }

  return { entry: top.entry, steps };
}

/** the budget shape a version may declare, with the platform's own caps */
export interface WorkflowBudget {
  max_steps?: number;
  max_model_calls?: number;
  max_tokens?: number;
}

export function validateWorkflowBudget(raw: unknown): WorkflowBudget {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) refuse("budget must be an object");
  const budget = raw as Record<string, unknown>;
  const out: WorkflowBudget = {};
  const caps = { max_steps: MAX_STEPS, max_model_calls: 30, max_tokens: 2_000_000 } as const;
  for (const key of Object.keys(budget)) {
    if (!(key in caps)) refuse(`unknown budget key '${key}'`);
    const value = budget[key];
    const cap = caps[key as keyof typeof caps];
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > cap) {
      refuse(`${key} must be an integer 1..${cap}`);
    }
    out[key as keyof WorkflowBudget] = value;
  }
  return out;
}
