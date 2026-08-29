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

/**
 * The same guarantee for a COLUMN of jsonb values sent as one array.
 *
 * ── why this exists ─────────────────────────────────────────────────────────
 *
 * A multi-row insert built on `unnest(...)` sends N values as ONE parameter,
 * which is what turns 200 round trips into one. The jsonb column in that
 * insert is the exact place the double-encode bug comes back: binding a
 * `jsonb[]` parameter to an array of already-stringified values encodes each
 * element a second time, and the result is an array of jsonb STRINGS that
 * looks right in a `select` and answers null to every `->>`. Same bug as
 * above, one dimension up, and `transcript_segment.words` — which already
 * burned once — is precisely the column that travels this way.
 *
 * So the array is bound as `text[]` and Postgres does the decoding, element by
 * element, exactly once:
 *
 *   `unnest(${JSONB_ARRAY_PARAM(9)}) as t(words)`  →  "unnest($9::text[])"
 *   tx.unsafe(SQL, [ …, toJsonbArray(rows.map(r => r.words)) ])
 *
 * ── the half this helper CANNOT carry, and why that is safe ─────────────────
 *
 * The unnested column arrives as `text` and has to be cast at the point of
 * use: `select …, t.words::jsonb, …`. That cast cannot travel inside this
 * function, because it belongs to a column reference rather than to a
 * placeholder — which is the one thing JSONB_PARAM was designed to avoid
 * having to remember.
 *
 * It is safe to leave to the call site only because forgetting it is LOUD:
 * there is no assignment cast from text to jsonb, so an insert whose target
 * column is jsonb and whose expression is text fails outright with
 *
 *   42804  column "words" is of type jsonb but expression is of type text
 *
 * That is the opposite of the failure this file exists for. The original bug
 * was silent and produced readable-looking garbage; this one refuses to run.
 * A rule you cannot forget quietly does not need to be mechanised.
 */
export function JSONB_ARRAY_PARAM(position: number): string {
  return `$${position}::text[]`;
}

/** Exactly one JSON encode PER ELEMENT — the array twin of `toJsonb`. */
export function toJsonbArray(values: readonly unknown[]): string[] {
  return values.map((value) => toJsonb(value));
}
