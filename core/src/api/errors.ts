/**
 * One error→HTTP mapping for the whole api, matching what the BFF codes
 * against (agreed with the frontend session).
 *
 * The subtle rule, worth stating because it is easy to "helpfully" break:
 * a pending account and a forbidden action BOTH return 403, distinguished
 * only by `kind` in the body. That lets the UI show its M15
 * waiting-for-approval screen, while a member probing an admin route still
 * cannot tell "not admin" from "no such route".
 *
 * And 404-vs-403 for rows: a row the caller cannot see is 404, never 403 —
 * the same not-probeable posture the tool wall uses. Existence is itself
 * information.
 */
import { InvalidTimingError } from "../worker/transcript-mapping.ts";
import { MissingIdentityError } from "../db/identity.ts";

/**
 * These two live here, with the mapping that gives them meaning, rather than
 * in auth.ts. M17 forced it: `apikeys.ts` must throw UnauthenticatedError,
 * `auth.ts` must call apikeys to resolve a gateway key, and errors.ts must
 * see both — a cycle. It resolves at runtime under ESM, which is exactly what
 * makes it a bad thing to leave in place: it would keep working until an
 * unrelated import reordering made it stop. auth.ts re-exports them, so every
 * existing importer is unaffected.
 */
export class UnauthenticatedError extends Error {}

/**
 * Why a caller who IS authenticated may not proceed.
 *
 * Carried as a field rather than sniffed out of the message. `mapError` used
 * to decide pending-vs-forbidden with `/activation/i` on the message text —
 * which worked, and would have quietly mislabelled every new state as
 * "forbidden" the moment one was added. The steward adding `suspended` is
 * exactly that moment.
 */
export type RefusalKind = "pending" | "suspended" | "forbidden";

export class NotActivatedError extends Error {
  /**
   * Declared as a field and assigned in the body — NOT a parameter property
   * (`constructor(…, readonly kind: RefusalKind)`).
   *
   * The api runs under `node --experimental-strip-types`, which erases types
   * and performs no transforms, so a parameter property is a **load-time
   * syntax error**: `ERR_INVALID_TYPESCRIPT_SYNTAX`. tsc accepts it and
   * vitest transpiles it happily, so the entire test suite stays green while
   * the process cannot start at all.
   *
   * I wrote the parameter-property version here minutes after the steward
   * added this exact trap to rule 9 from the worker package hitting it, and
   * found it only because a boot smoke now runs in CI (`api-boot.test.ts`).
   * It is a genuinely easy mistake and typechecking cannot catch it.
   */
  readonly kind: RefusalKind;

  constructor(message: string, kind: RefusalKind = "forbidden") {
    super(message);
    this.kind = kind;
  }
}

export class NotFoundError extends Error {}
export class ValidationError extends Error {}
export class ConflictError extends Error {}

export interface ErrorBody {
  error: string;
  kind?: RefusalKind | "not_found" | "invalid" | "conflict" | "internal";
}

export interface MappedError {
  status: number;
  body: ErrorBody;
  /** True when the cause should be logged at error level (ours, not theirs). */
  ours: boolean;
}

/**
 * What may be logged about a database failure (steward-ratified convention).
 *
 * Structured fields only — code, constraint, table, column, routine — and
 * NEVER `message` or `detail`. A Postgres constraint violation quotes the
 * offending row back at you: `Key (call_id, seq)=(…) already exists`, and for
 * this product a row can be transcript text. So the one place a database
 * error is most likely to be logged verbatim is also the place it is most
 * likely to carry content, which is invariant 7's blind spot.
 *
 * The fields kept are all schema identifiers — they name WHICH rule was
 * broken, which is what a 3am reader needs, and none of them is data.
 */
export function pgErrorFields(error: unknown): Record<string, string> | undefined {
  if (!error || typeof error !== "object") return undefined;
  const source = error as Record<string, unknown>;
  if (typeof source.code !== "string") return undefined;   // not a pg error
  const fields: Record<string, string> = { code: source.code };
  for (const key of ["constraint_name", "table_name", "column_name", "schema_name", "routine", "severity"]) {
    const value = source[key];
    if (typeof value === "string" && value !== "") fields[key] = value;
  }
  return fields;
}

export function mapError(error: unknown): MappedError {
  if (error instanceof UnauthenticatedError) {
    return { status: 401, body: { error: "unauthenticated" }, ours: false };
  }
  if (error instanceof NotActivatedError) {
    // Three distinguishable 403s, and the distinction is the caller's own
    // account state — safe to disclose to them, and load-bearing for the UI:
    //   pending   — signed up, waiting for an admin to accept them (M15)
    //   suspended — the ORG was switched off. An account-level state resolved
    //               with us, never with the org admin, who cannot help.
    //               Telling them to "wait for approval" would send them to
    //               someone powerless — a small cruelty on top of a wrong
    //               message (steward ruling).
    //   forbidden — everything else, including a member probing an admin
    //               route, which must stay indistinguishable from "no such
    //               route" in every respect except this word.
    const message = error.kind === "pending"
      ? "account is awaiting activation"
      : error.kind === "suspended"
        ? "organization is suspended"
        : "forbidden";
    return { status: 403, body: { error: message, kind: error.kind }, ours: false };
  }
  if (error instanceof NotFoundError) {
    return { status: 404, body: { error: "not found", kind: "not_found" }, ours: false };
  }
  if (error instanceof ValidationError) {
    return { status: 400, body: { error: error.message, kind: "invalid" }, ours: false };
  }
  if (error instanceof ConflictError) {
    return { status: 409, body: { error: error.message, kind: "conflict" }, ours: false };
  }
  if (error instanceof InvalidTimingError) {
    // pipeline invariant broke — ours, and it must be loud
    return { status: 500, body: { error: "internal error", kind: "internal" }, ours: true };
  }
  if (error instanceof MissingIdentityError) {
    // a route reached the database without an identity: a bug in OUR wiring,
    // not a caller mistake. Never leak the detail.
    return { status: 500, body: { error: "internal error", kind: "internal" }, ours: true };
  }
  return { status: 500, body: { error: "internal error", kind: "internal" }, ours: true };
}
