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
import { NotActivatedError, UnauthenticatedError } from "./auth.ts";
import { InvalidTimingError } from "../worker/transcript-mapping.ts";
import { MissingIdentityError } from "../db/identity.ts";

export class NotFoundError extends Error {}
export class ValidationError extends Error {}
export class ConflictError extends Error {}

export interface ErrorBody {
  error: string;
  kind?: "pending" | "forbidden" | "not_found" | "invalid" | "conflict" | "internal";
}

export interface MappedError {
  status: number;
  body: ErrorBody;
  /** True when the cause should be logged at error level (ours, not theirs). */
  ours: boolean;
}

export function mapError(error: unknown): MappedError {
  if (error instanceof UnauthenticatedError) {
    return { status: 401, body: { error: "unauthenticated" }, ours: false };
  }
  if (error instanceof NotActivatedError) {
    // "awaiting activation" is a distinguishable, non-sensitive state;
    // anything else that reaches here is a plain refusal.
    const pending = /activation/i.test(error.message);
    return {
      status: 403,
      body: { error: pending ? "account is awaiting activation" : "forbidden",
              kind: pending ? "pending" : "forbidden" },
      ours: false,
    };
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
