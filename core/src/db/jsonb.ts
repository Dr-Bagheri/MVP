/**
 * Binding a JS value to a jsonb parameter, in one place (steward directive).
 *
 * ── The bug this exists to kill ─────────────────────────────────────────────
 *
 * `tx.unsafe("… $1::jsonb", [JSON.stringify(value)])` looks obviously correct
 * and is silently wrong. postgres.js sees a `jsonb` parameter and serialises
 * the JS value it was given — which is already a JSON *string* — so the string
 * gets JSON-encoded a second time. Asked against the real database:
 *
 *   $1::jsonb        + JSON.stringify([step])  →  ["[{\"tool\":\"search…\"}]"]
 *   $1::text::jsonb  + JSON.stringify([step])  →  [{"tool":"search…"}]
 *
 * The first row LOOKS fine in a `select steps` — the data is all there, and a
 * JS consumer that JSON.parses twice never notices. What breaks is SQL:
 * `jsonb_array_elements(steps)->>'tool'` returns **null**, because every
 * element is a string rather than an object. So `agent_run.steps` was present
 * and unqueryable — invariant 5's audit trail cannot answer "which tools did
 * this run call", which is the first question anyone asks it.
 *
 * It happened three times in one day, in three modules, by three people: the
 * worker's pgmq payloads, its `words` column, and this package's `steps`. At
 * that point it stops being a lesson and becomes code — hence one helper, and
 * a cast that is part of the helper rather than a convention to remember.
 *
 * ── Using it ────────────────────────────────────────────────────────────────
 *
 *   `set steps = steps || ${JSONB_PARAM(2)}`   →  "steps || $2::text::jsonb"
 *   tx.unsafe(SQL, [runId, toJsonb([step])])
 *
 * `::text::jsonb` forces the parameter to be bound as TEXT, then cast by
 * Postgres — one encode, one decode, no inference. Do not "simplify" it to
 * `::jsonb`; that is the bug.
 */

/** Exactly one JSON encode. Undefined becomes null, never the string "undefined". */
export function toJsonb(value: unknown): string {
  return JSON.stringify(value ?? null);
}

/**
 * The placeholder to write in SQL for a `toJsonb` parameter.
 *
 * A function rather than a documented string so the cast travels with the
 * value: a reader who copies the call site gets the cast for free, and a
 * reviewer sees `JSONB_PARAM` and knows the encoding was considered.
 */
export function JSONB_PARAM(position: number): string {
  return `$${position}::text::jsonb`;
}
