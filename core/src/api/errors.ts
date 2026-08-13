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
import { AlreadyDecidedError } from "../agent/proposals.ts";
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
/**
 * Why a caller is not authenticated. The 401 twin of `RefusalKind`, and it
 * exists for debuggability rather than for the browser (Front-end 2's
 * observation, via Front-end 1 — and the right layer for it is this one).
 *
 *   bad_signature — the token did not verify. In practice: the two services
 *                   do not share a trust root. core/ running on a smoke
 *                   secret while Supabase signs with the project key
 *                   produces exactly this, for every user at once.
 *   unknown_actor — the token verified and the person is real, but there is
 *                   no `app_user` row for that subject: unregistered, or
 *                   seed data that does not match the auth directory.
 *   no_token      — nothing presented, or not a bearer token.
 *   bad_key       — an M17 gateway key that did not resolve. ONE kind for
 *                   every way a key can fail, on purpose: apikeys.ts keeps
 *                   "no such key", "revoked" and "resolves to nobody"
 *                   indistinguishable so the endpoint is not an oracle for
 *                   which keys exist, and a kind that split them would undo
 *                   that from the outside.
 *
 * These are opposite problems — a config mismatch between two services versus
 * missing data — and they answered identically until now, so at the moment
 * someone debugs a failing sign-in the most plausible-looking suspect is the
 * auth layer, which is the one thing that is not wrong.
 *
 * The caller still gets a flat 401 with the same body. The distinction lives
 * in the `kind` and in our logs, exactly as pending/suspended/forbidden do.
 * Nothing is disclosed that the holder of the token does not already know.
 */
export type UnauthenticatedKind = "no_token" | "bad_signature" | "unknown_actor" | "bad_key";

export class UnauthenticatedError extends Error {
  /** Field, not a parameter property — see NotActivatedError below. */
  readonly kind: UnauthenticatedKind;

  constructor(message: string, kind: UnauthenticatedKind = "no_token") {
    super(message);
    this.kind = kind;
  }
}

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

/**
 * A machine-readable refusal, so a Persian UI can say a true sentence.
 *
 * My messages are English prose and they were reaching users — «username must
 * be 3–32 characters…» rendered verbatim in an RTL Persian screen. The two
 * obvious fixes are both wrong: localizing here puts UI locale at the wrong
 * altitude (the api would need to know who is reading), and translating my
 * English on the client means re-implementing my rule in a second place, in a
 * language nobody checks against the first.
 *
 * So a refusal carries a CODE and its PARAMS. The client owns the sentence;
 * the api owns the rule and the numbers in it. **The params are what keep the
 * translation true when the rule changes** — if the username minimum moves to
 * four, `{min: 4}` updates every locale at once and no catalogue goes stale
 * saying "three".
 *
 * The English `message` stays in the payload as the honest fallback for a
 * code the client has not catalogued yet. A blank screen is worse than a
 * sentence in the wrong language.
 *
 * Codes are `snake_case`, stable, and DISTINCT where the truth differs — a
 * taken username and a retired one are different facts and both locales must
 * be able to say which.
 */
export interface RefusalCode {
  code: string;
  params?: Record<string, string | number> | undefined;
}

export class ValidationError extends Error {
  /** Declared as fields, never parameter properties — see NotActivatedError. */
  readonly code: string | undefined;
  readonly params: Record<string, string | number> | undefined;

  constructor(message: string, refusal?: RefusalCode) {
    super(message);
    this.code = refusal?.code;
    this.params = refusal?.params;
  }
}

export class ConflictError extends Error {
  readonly code: string | undefined;
  readonly params: Record<string, string | number> | undefined;

  constructor(message: string, refusal?: RefusalCode) {
    super(message);
    this.code = refusal?.code;
    this.params = refusal?.params;
  }
}

export interface ErrorBody {
  /** English prose. The fallback when a client has not catalogued `code`. */
  error: string;
  kind?: RefusalKind | UnauthenticatedKind | "not_found" | "invalid" | "conflict" | "internal";
  /** Stable, snake_case, and what a localized client actually keys on. */
  code?: string;
  /** The numbers and names inside the sentence — see RefusalCode. */
  params?: Record<string, string | number>;
}

export interface MappedError {
  status: number;
  body: ErrorBody;
  /** True when the cause should be logged at error level (ours, not theirs). */
  ours: boolean;
  /**
   * A plain-language cause for the LOG only, never the response body.
   *
   * Set where a SQLSTATE has a specific operational meaning that a bare code
   * would leave someone to look up at 3am. It exists because a database
   * error that reads as "internal error, code 25P03" is a mystery, and the
   * same error reading "a handler held a transaction open across a wait" is
   * a diagnosis.
   */
  diagnosis?: string;
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
    // Same status and same `error` string as before — only the kind is new,
    // so nothing that keyed off the old shape breaks.
    return { status: 401, body: { error: "unauthenticated", kind: error.kind }, ours: false };
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
    return {
      status: 400,
      body: {
        error: error.message,
        kind: "invalid",
        // Omitted rather than sent as undefined: a client checking
        // `"code" in body` should learn whether this refusal is catalogued.
        ...(error.code === undefined ? {} : { code: error.code }),
        ...(error.params === undefined ? {} : { params: error.params }),
      },
      ours: false,
    };
  }
  if (error instanceof AlreadyDecidedError) {
    // db/0029's primary key did the refusing. A second decision on one
    // proposal is a conflict, not a fault: the first decision stands, and
    // saying 409 is what stops a double-click writing a second summary
    // version.
    return { status: 409, body: { error: error.message, kind: "conflict" }, ours: false };
  }
  if (error instanceof ConflictError) {
    return {
      status: 409,
      body: {
        error: error.message,
        kind: "conflict",
        ...(error.code === undefined ? {} : { code: error.code }),
        ...(error.params === undefined ? {} : { params: error.params }),
      },
      ours: false,
    };
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
  /**
   * An RLS **WITH CHECK** refusal is "you may not do that to this row", and
   * this product answers that with the same 404 it gives for a row you cannot
   * see. Anything else re-opens the probe: a caller who can READ an org-scoped
   * call but not modify it would learn, from a 500 vs a 404, exactly which
   * rows exist and which of those they merely lack rights on.
   *
   * Found live: a member soft-deleting a call they can see but do not own got
   * `{"error":"internal error"}`. USING-clause refusals filter to zero rows
   * and were already 404 via the "no row" branch; WITH CHECK refusals RAISE,
   * and fell straight through to 500 — so the two halves of one policy gave
   * two different answers. Affects update, delete, archive and restore alike.
   *
   * Narrowed by `routine` on purpose. 42501 also covers GRANT refusals
   * ("permission denied for table …"), which are wiring faults — the
   * run-store-on-the-app-role bug was one — and those must stay loud 500s.
   * `ExecWithCheckOptions` is the row-policy path specifically.
   */
  const pg = error as { code?: unknown; routine?: unknown };

  /**
   * The idle-in-transaction reaper took our connection (db/0053).
   *
   * `25P03` is the timeout itself; `57P01` is the same event seen as "the
   * administrator terminated this backend", which is how it can surface when
   * the kill lands between statements.
   *
   * **This is ours, it is a 500, and it is loud — and that is the whole deal
   * I made with the steward.** I objected to a role-wide timeout on the
   * grounds that it would silently abort a live api transaction; their answer
   * was that the objection is about SILENCE rather than the timeout, and that
   * closing it was my half of the work. They were right. The reaper only
   * fires when a connection sits idle BETWEEN statements inside an open
   * transaction — which for a supervised process means a handler is stuck
   * across a wait and the write was never going to complete. Without the
   * timeout that handler blocks other people's DDL and nobody learns anything
   * for thirty minutes; with it, plus this branch, the stuck handler names
   * itself in our own logs.
   *
   * If a legitimate api transaction ever needs to idle longer than the role's
   * window, the measurement is what buys a deliberate `ALTER ROLE` with a
   * stated reason — not a quiet retry here.
   */
  if (pg?.code === "25P03" || pg?.code === "57P01") {
    return {
      status: 500,
      body: { error: "internal error", kind: "internal" },
      ours: true,
      diagnosis: "idle-in-transaction timeout: a handler held a transaction open across a wait",
    };
  }

  if (pg?.code === "42501" && pg.routine === "ExecWithCheckOptions") {
    return { status: 404, body: { error: "not found", kind: "not_found" }, ours: false };
  }

  /**
   * Fastify's own client errors — malformed JSON, an empty body where one was
   * declared, an unsupported media type, a body over the limit. They carry a
   * real `statusCode` and they are the CALLER's mistake, not ours.
   *
   * Without this every one of them fell through to 500. Found by POSTing to
   * `/v1/calls/:id/archive` with `content-type: application/json` and no body
   * — which is exactly what a client does for a route that takes no body, and
   * what my own probe did. A 500 there tells the caller the server broke when
   * the server understood perfectly and objected.
   *
   * `ours: false` matters as much as the status: a caller's bad request must
   * not be logged at error level, or a client looping on a malformed body
   * fills the log with our own alarms.
   */
  const status = (error as { statusCode?: unknown })?.statusCode;
  if (typeof status === "number" && status >= 400 && status < 500) {
    return { status, body: { error: "bad request", kind: "invalid" }, ours: false };
  }

  return { status: 500, body: { error: "internal error", kind: "internal" }, ours: true };
}
