/**
 * Members and the pending-approval queue (M15, SPEC §"Settings & admin").
 *
 * Acceptance is the whole point of M15: anyone may register, nobody sees
 * anything until an admin accepts them. This is the surface that admin acts
 * through, and it is deliberately thin — db/0011's trigger stamps
 * `accepted_at`/`accepted_by`, db/0013's `app_user_write` decides who may
 * change whom, and this file neither re-implements nor second-guesses either.
 *
 * The one thing it will NOT do is create a member. Registration goes through
 * `echo.register_account()` (db/0015) — one of only two SECURITY DEFINER
 * doors in the product — which always produces `pending`. An admin-side
 * "add member" that skipped that would be a second way to create an account,
 * and the acceptance gate is exactly the thing that must not have two doors.
 */
import { record } from "./admin-actions.ts";
import { ConflictError, NotFoundError, ValidationError } from "./errors.ts";
import {
  CALENDAR_PREFERENCES, iso, isoOrNull, MEMBER_ROLES, TIMEZONE_AUTO, USER_STATUSES,
  type CalendarPreference, type MemberRole, type UserStatus,
} from "./vocabulary.ts";
import { assertUuid, type Db, type SqlTx } from "../db/identity.ts";
import type { Identity } from "../agent/types.ts";

export interface MemberRecord {
  id: string;
  email: string;
  /** The Persian name. Always present — Persian-first is the product (M22). */
  display_name: string;
  /**
   * The Latin-script name, and the English half of a bilingual product
   * (M24 round 1). NULL means "not provided", which a client renders by
   * falling back to `display_name` — NOT by showing an empty cell.
   */
  display_name_en: string | null;
  /** Unique within the org, NULL until chosen. Format mirrored below. */
  username: string | null;
  /**
   * The profile photo as a `data:image/…;base64` URL, NULL until uploaded.
   *
   * On the wire since the upload path landed (user directive, 2026-08-16 —
   * the KNOWN_ABSENT entry this retires said "it returns alongside an upload
   * design"). v1 stores the image IN the column rather than behind a storage
   * signer: the write path caps it at 128KB and a 256px crop is ~20KB, so the
   * row stays sane, RLS already scopes who may read it, and the column holds
   * a URL either way — a later move to signed storage URLs is a value change,
   * not a schema change.
   */
  avatar_url: string | null;
  role: MemberRole;
  status: UserStatus;
  accepted_at: string | null;
  /**
   * When a HUMAN last did something (M24). Null goes over the wire as null
   * rather than being omitted, so a client can render "not seen yet"
   * honestly instead of inferring it from a missing key — an absent field and
   * a null one are different nothings, and only one of them is a fact.
   */
  last_seen_at: string | null;
  created_at: string;
}

/**
 * The UM table's controls (M24). Every field is optional and every one is
 * validated against a closed set — none of them reaches SQL as text.
 */
export interface MemberQuery {
  /** Matches display_name, display_name_en, username or email. */
  search?: string | undefined;
  status?: string | undefined;
  role?: string | undefined;
  /** A key of the sort map, NOT a column name. */
  sort?: string | undefined;
}

export interface MemberStats {
  counts: { pending: number; active: number; disabled: number; total: number };
  trend: {
    window_days: number;
    activated: number;
    disabled: number;
    joined: number;
    /**
     * When the status log starts, or NULL if it holds nothing at all.
     *
     * The one field that stops the tiles lying. Null means "we were not
     * recording", which a client renders as "—"; a zero next to a non-null
     * `history_since` means "nothing changed". Collapsing them would let a
     * brand-new log report "+0 this month" with total confidence.
     */
    history_since: string | null;
  };
}

export interface MeRecord extends MemberRecord {
  org_id: string;
  org_name: string | null;
  /** NULL = has not chosen. M5 imposes no default (see api/models.ts). */
  preferred_model: string | null;
  /**
   * How this person wants dates rendered. NOT NULL, `"auto"` by default.
   *
   * `auto` means "follow the active language" — today's behaviour — and it is
   * a VALUE rather than an absence, which is why this is not nullable: `null`
   * and `"auto"` would be two spellings of one state, and there is no unset
   * condition to spell. Resetting is choosing `auto`.
   */
  /**
   * The person's language. **The column existed all along** — `app_user.locale`,
   * NOT NULL default `'fa'` — and nothing selected it, so a preference that
   * should follow someone across devices was invisible to every client.
   *
   * FE1 reported it as "core has no locale column"; the truth was worse and
   * quieter: stored and never served, the same shape as `last_seen_at` and
   * `call.duration_ms` before them. A column nobody reads and a column that
   * does not exist look identical from the outside, which is why it needed
   * checking rather than believing.
   */
  locale: string;
  calendar: CalendarPreference;
  /**
   * `"auto"` (follow the device, resolved at render) or an IANA zone name.
   *
   * Stored as the sentinel rather than a snapshot of the browser's zone: FE2
   * pointed out that snapshotting silently freezes a traveller's dates, which
   * is right and is the sort of thing only someone building the screen sees.
   */
  timezone: string;
}

/**
 * Exported so `schema-contract.ts` can ask whether this list has kept up with
 * `echo.app_user`.
 *
 * M24 round 1 added `username` and `display_name_en`. The api exposing them
 * is a separate act from the database having them — and "separate act nobody
 * remembers to perform" is how `register_account` sat uncalled for weeks. So
 * the harness fails the day a listed column appears in the catalogue and not
 * in this string. It fired within minutes of being armed: db/'s migration
 * landed while I was writing the check that watches for it.
 */
export const MEMBER_COLUMNS = `
  id, email, display_name, display_name_en, username, avatar_url,
  role, status, accepted_at, last_seen_at, created_at
`;

/**
 * The username rule, mirrored from `app_user_username_format` (db/, M24).
 *
 * A copy of a database constraint, which is normally the thing to avoid —
 * two spellings of one rule, and the one nobody exercises drifts. It earns
 * its place here because the alternative is worse: without it the caller's
 * mistake surfaces as a raw 23514 from Postgres, which the api can only map
 * to a generic 400. The steward's phrasing is the requirement — "a 422 that
 * doesn't state the format is a support ticket" — and only the edge that
 * knows the rule can state it.
 *
 * The database remains the enforcer. This exists to produce a good sentence,
 * not to be the wall; if the two ever disagree, the constraint wins and this
 * one is the bug.
 */
/**
 * Is this a zone we can actually render dates in?
 *
 * Asked of the RUNTIME rather than matched against a list, and the reason is
 * better than "IANA changes" (which is true but secondary): **this api is not
 * the thing that formats the dates.** The UI does, against ICU's zone data.
 * A curated server list would be a second list that must agree with the
 * browser's, and the failure mode is rejecting a zone the formatter handles
 * perfectly — a false refusal, which is worse than no check.
 *
 * `Intl.DateTimeFormat` throws `RangeError` for a zone this runtime cannot
 * use, which is exactly the predicate the feature needs. B3 reached the same
 * conclusion from the database side and put a SHAPE check on the column
 * rather than a validity one, so `Pacific/Kiritimati` is accepted by both of
 * us and neither claims to be the authority on what zones exist.
 */
function assertRenderableZone(value: string): void {
  if (value === TIMEZONE_AUTO) return;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: value });
  } catch {
    throw new ValidationError(
      `unknown timezone: use "${TIMEZONE_AUTO}" or an IANA zone name`,
      { code: "timezone_unknown" });
  }
}

const USERNAME_FORMAT = /^[a-z][a-z0-9_]{2,31}$/;
const USERNAME_MIN = 3;
const USERNAME_MAX = 32;
const USERNAME_RULE =
  `username must be ${USERNAME_MIN}–${USERNAME_MAX} characters, start with a lowercase letter, `
  + "and contain only lowercase letters, digits and underscores";
/**
 * The params travel with the code so a Persian sentence stays TRUE when the
 * rule moves: change `USERNAME_MIN` and every locale updates at once, instead
 * of a catalogue somewhere still saying "three".
 */
const USERNAME_REFUSAL = {
  code: "username_format",
  params: { min: USERNAME_MIN, max: USERNAME_MAX },
} as const;

const toMember = (row: Record<string, unknown>): MemberRecord => ({
  id: row.id as string,
  email: String(row.email),
  display_name: (row.display_name as string) ?? "",
  display_name_en: (row.display_name_en as string | null) ?? null,
  username: (row.username as string | null) ?? null,
  avatar_url: (row.avatar_url as string | null) ?? null,
  role: row.role as MemberRole,
  status: row.status as MemberRecord["status"],
  accepted_at: isoOrNull(row.accepted_at),
  last_seen_at: isoOrNull(row.last_seen_at),
  created_at: iso(row.created_at),
});

export interface RegisterInput {
  /** From the verified token's `sub`. NEVER from the request body. */
  userId: string;
  /** From the token's `email` claim — Supabase owns the address, not us. */
  email: string;
  displayName: string;
  /** Create a new org and become its admin. Mutually exclusive with joinOrg. */
  orgName?: string | undefined;
  /** Join an existing org as a pending member. */
  joinOrg?: string | undefined;
}

export function createMembersRepo(db: Db) {
  return {
    /**
     * Registration (M15) — the only door, and until now an unopened one.
     *
     * All this does is call `echo.register_account()`, which is deliberate:
     * that function decides org-vs-join, stamps `pending`, and is one of the
     * product's two SECURITY DEFINER doors. Re-implementing any of it here
     * would be the second way to create an account, and a gate with two doors
     * is not a gate.
     *
     * `withoutIdentity` is right here and nowhere else in this file: the
     * caller is verified but has no `app_user` row yet, so there is no actor
     * to scope by. It is safe only because the function takes the id as an
     * explicit argument rather than reading `echo.actor_id()` — and because
     * the caller cannot choose that id (it is the token's `sub`).
     */
    async register(input: RegisterInput): Promise<MemberRecord & { org_id: string }> {
      assertUuid(input.userId, "user id");
      if (input.orgName && input.joinOrg) {
        // Ambiguous rather than harmless: the db would silently prefer the
        // join and quietly ignore the name someone typed for their new org.
        throw new ValidationError("provide either org_name or join_org, not both");
      }
      if (input.joinOrg) assertUuid(input.joinOrg, "organization id");
      const email = input.email.trim();
      if (!email) throw new ValidationError("token has no email claim");

      /*
       * The invitation door FIRST (db/0060): if a live invitation exists for
       * this VERIFIED address, the person arrives active with the granted
       * role and never sees the org-choice screen — the platform emailed
       * them, so the email in their token IS the address match. NULL means
       * "no invitation", the normal answer, and registration proceeds.
       */
      const redeemed = await db.withoutIdentity((tx: SqlTx) =>
        tx.unsafe<Record<string, unknown>>(
          // a NULL composite comes back as one all-null row — the filter
          // turns "no invitation" into zero rows instead of a ghost member.
          // The display name travels (0064): the first live arrival was a
          // nameless row in every roster.
          `select * from echo.redeem_invitation_for_email($1::uuid, $2::citext, $3::text) r
            where r.id is not null`,
          [input.userId, email,
           input.displayName.trim() || email.split("@")[0] || ""],
        ),
      );
      if (redeemed[0]) {
        const row = redeemed[0];
        return { ...toMember(row), org_id: row.org_id as string };
      }

      try {
        // Explicit casts: with bare placeholders Postgres cannot resolve the
        // (uuid, citext, text, text, uuid) signature and answers 42P18
        // "could not determine data type of parameter" — which reads like a
        // missing function rather than a missing cast.
        const rows = await db.withoutIdentity((tx: SqlTx) =>
          tx.unsafe<Record<string, unknown>>(
            `select * from echo.register_account($1::uuid, $2::citext, $3::text, $4::text, $5::uuid)`,
            [input.userId, email, input.displayName.trim(), input.orgName ?? null, input.joinOrg ?? null],
          ),
        );
        const row = rows[0];
        if (!row) throw new ConflictError("registration produced no account");
        return { ...toMember(row), org_id: row.org_id as string };
      } catch (error) {
        const pg = error as { code?: string; constraint_name?: string };
        if (pg.code === "23505") {
          // Already registered. A conflict, not a fault — and NOT a hint that
          // the address exists: the caller already proved they hold this token.
          throw new ConflictError("this account is already registered");
        }
        if (pg.code === "23503") {
          // Two different causes, and they must not be conflated (rule 12):
          // the org they asked to join does not exist, OR there is no
          // auth.users row for this token's subject (db/0002's FK). The
          // second means the identity itself is unknown to Supabase.
          throw pg.constraint_name
            ? new ValidationError("no auth identity for this token")
            : new ValidationError("no such organization");
        }
        throw error;
      }
    },

    /**
     * The caller's own profile — who am I, and what may I do.
     *
     * BLOCKING for the web client and it has no fallback: M1 keeps the token
     * server-side, so the browser never sees the JWT and cannot read its own
     * claims. Without this route the shell cannot know the signed-in person's
     * name or role, which gates the profile screen and every admin surface.
     * The frontend found it the moment mocks came off.
     *
     * Role and status come from `resolveIdentity` (the database), never from
     * the token — a token minted a minute ago can be stale about someone
     * whose role just changed.
     */
    async me(identity: Identity): Promise<MeRecord> {
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<Record<string, unknown>>(
          // The org join is LEFT for the same reason resolveIdentity's is: an
          // inactive person cannot read their org row, and an inner join
          // would turn "you are suspended" into "you do not exist" — the M15
          // bug, one layer up. requireActive gates this route today, so it
          // cannot bite here; it is left this way so it still cannot if a
          // future surface serves /me to a pending person to explain why.
          // Written out rather than derived from MEMBER_COLUMNS by string
          // surgery: a regex that rewrites a column list is unreadable at the
          // call site and breaks silently when someone adds a column with a
          // comment or a cast. Two lists that must agree is the smaller risk
          // here than one list nobody can see the output of.
          `select u.id, u.email, u.display_name, u.display_name_en, u.username,
                  u.avatar_url, u.role, u.status,
                  u.accepted_at, u.last_seen_at, u.created_at,
                  u.preferred_model, u.locale, u.calendar, u.timezone, o.name as org_name
             from echo.app_user u
             left join echo.org o on o.id = u.org_id
            where u.id = $1
            limit 1`,
          [identity.userId],
        ),
      );
      const row = rows[0];
      // An authenticated caller can always read their own row (db/0013's
      // self-read exception), so no row here is a fault, not a refusal.
      if (!row) throw new NotFoundError("member not found");
      return {
        ...toMember(row),
        org_id: identity.orgId,
        org_name: (row.org_name as string | null) ?? null,
        // Carried here so the shell need not call /v1/models just to know
        // whether a model has been chosen. NULL is a real state (M5).
        preferred_model: (row.preferred_model as string | null) ?? null,
        // NOT NULL in the schema, so the fallbacks are belt: a row that
        // somehow lacked them should read as the default, never as undefined
        // on the wire.
        locale: (row.locale as string) ?? "fa",
        calendar: (row.calendar as CalendarPreference) ?? "auto",
        timezone: (row.timezone as string) ?? TIMEZONE_AUTO,
      };
    },

    /**
     * The caller edits their OWN profile (M24 round 1).
     *
     * Deliberately not the admin patch: that one carries role and status,
     * which are things done TO a person. This carries the names they call
     * themselves. Keeping them apart means "edit my display name" and "change
     * someone's role" can never be one request with different fields filled
     * in, and db/0013's self-write exception is the wall behind it.
     *
     * `null` clears a field, `undefined` leaves it alone — the distinction
     * matters for optional columns, and collapsing them would make "remove my
     * Latin name" impossible to express.
     */
    async updateProfile(
      identity: Identity,
      patch: {
        display_name?: string | undefined;
        display_name_en?: string | null | undefined;
        username?: string | null | undefined;
        avatar_url?: string | null | undefined;
        calendar?: string | undefined;
        timezone?: string | undefined;
        locale?: string | undefined;
      },
    ): Promise<MeRecord> {
      const displayName = patch.display_name?.trim();
      if (patch.display_name !== undefined && !displayName) {
        // NOT NULL in the schema, so an empty one is a 400 here rather than a
        // 23502 the api can only describe as "something went wrong".
        throw new ValidationError("display_name cannot be empty",
          { code: "display_name_empty" });
      }
      // Trimmed to null: an all-whitespace Latin name would pass the format
      // check on its own and then fail `app_user_display_name_en_not_blank`.
      const displayNameEn = patch.display_name_en === undefined
        ? undefined
        : (patch.display_name_en?.trim() || null);

      let username: string | null | undefined;
      if (patch.username !== undefined) {
        username = patch.username === null ? null : patch.username.trim().toLowerCase();
        // Lower-cased rather than rejected on case: the constraint is
        // lowercase-only, and refusing "Ali" while the fix is mechanical is
        // pedantry the caller experiences as a bug.
        if (username !== null && !USERNAME_FORMAT.test(username)) {
          throw new ValidationError(USERNAME_RULE, USERNAME_REFUSAL);
        }
      }

      if (patch.avatar_url !== undefined && patch.avatar_url !== null) {
        /**
         * A data URL and nothing else. An https URL is refused ON PURPOSE:
         * the product would be rendering an image it does not hold from an
         * origin the uploader picked, which is a tracking pixel wearing a
         * profile photo. The client crops to 256px before sending, so the
         * cap is generous — hitting it means the caller skipped the crop.
         */
        if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(patch.avatar_url)) {
          throw new ValidationError(
            "avatar_url must be a data:image/jpeg|png|webp;base64 URL",
            { code: "avatar_not_data_url" });
        }
        if (patch.avatar_url.length > 131072) {
          throw new ValidationError("avatar too large — crop to 256px before uploading",
            { code: "avatar_too_large", params: { max_chars: "131072" } });
        }
      }
      if (patch.calendar !== undefined
          && !CALENDAR_PREFERENCES.includes(patch.calendar as CalendarPreference)) {
        // Names the set, because "invalid calendar" leaves a dropdown with
        // three options and no way to know which one the server disliked.
        // The allowed set travels as a param so a translated sentence can
        // list the options without the client hard-coding them a second time.
        throw new ValidationError(
          `calendar must be one of: ${CALENDAR_PREFERENCES.join(", ")}`,
          { code: "calendar_unknown", params: { allowed: CALENDAR_PREFERENCES.join(",") } });
      }
      if (patch.timezone !== undefined) assertRenderableZone(patch.timezone);
      if (patch.locale !== undefined && !/^[a-z]{2}(-[A-Za-z0-9]{2,8})?$/.test(patch.locale)) {
        // Shape, not a closed list — same reasoning as the org's locale: the
        // product is fa/en today and a third language should not need a code
        // change in a file that has no opinion about languages.
        throw new ValidationError("locale must look like 'fa' or 'en-GB'",
          { code: "locale_shape" });
      }

      if (displayName === undefined && displayNameEn === undefined && username === undefined
          && patch.avatar_url === undefined
          && patch.calendar === undefined && patch.timezone === undefined
          && patch.locale === undefined) {
        throw new ValidationError("nothing to update", { code: "nothing_to_update" });
      }

      try {
        const rows = await db.withIdentity(identity, (tx: SqlTx) =>
          tx.unsafe<Record<string, unknown>>(
            // `$n::text is null` cannot distinguish "leave alone" from "clear
            // it", so each field carries an explicit boolean saying whether
            // it was supplied. coalesce() alone would make clearing a name
            // impossible — the classic optional-column bug.
            `update echo.app_user
                set display_name    = case when $2  then $3::text  else display_name end,
                    display_name_en = case when $4  then $5::text  else display_name_en end,
                    username        = case when $6  then $7::text  else username end,
                    calendar        = case when $8  then $9::text  else calendar end,
                    timezone        = case when $10 then $11::text else timezone end,
                    locale          = case when $12 then $13::text else locale end,
                    avatar_url      = case when $14 then $15::text else avatar_url end
              where id = $1
              returning ${MEMBER_COLUMNS}`,
            [
              identity.userId,
              displayName !== undefined, displayName ?? null,
              displayNameEn !== undefined, displayNameEn ?? null,
              username !== undefined, username ?? null,
              // No null branch for these two: they are NOT NULL and `auto` is
              // the reset, so a supplied-flag with a value is the only shape.
              patch.calendar !== undefined, patch.calendar ?? null,
              patch.timezone !== undefined, patch.timezone ?? null,
              patch.locale !== undefined, patch.locale ?? null,
              patch.avatar_url !== undefined, patch.avatar_url ?? null,
            ],
          ),
        );
        if (!rows[0]) throw new NotFoundError("member not found");
        return this.me(identity);
      } catch (error) {
        const pg = error as { code?: string; constraint_name?: string };
        if (pg.code === "23505" && pg.constraint_name === "app_user_username_per_org") {
          /**
           * Names the FIELD, because "conflict" alone leaves a form with
           * three inputs and no idea which one to fix — and then names WHICH
           * KIND of collision, because there are two and they need different
           * sentences.
           *
           * A tombstoned person keeps their handle forever (RESERVED, M24):
           * it is retired, not held. "Taken" implies someone currently has it
           * and could be asked for it, which after a tombstone is precisely
           * what is not true — the person is gone and the handle never comes
           * back. Both collisions land on the same index, so the constraint
           * name cannot tell them apart; only a second look can.
           *
           * Backend 3 offered a database helper instead. I declined it: this
           * runs only on an error path, it needs no new SECURITY DEFINER
           * door, and a door that exists solely to produce a nicer sentence
           * is a door to maintain forever.
           *
           * Degrades safely and deliberately. If the row is invisible to this
           * caller — or the look fails for any reason — we fall back to
           * "taken", which is the less specific message but never a false
           * one. A wrong explanation is worse than a vague one.
           *
           * Visibility, since it decides which branch real users get, and
           * measured by Backend 3 against an actual tombstone rather than
           * assumed by either of us (there were none on dev when this was
           * written, so "0 rows visible" proved nothing at all):
           *
           *   plain member   sees the tombstoned row — the "retired" message
           *   owner          sees it
           *   pending member sees NOTHING — the fallback answers
           *
           * `app_user_read` lets any active member read their org's rows and
           * the tombstone does not hide the row, deliberately: it exists so
           * that references still resolve. The pending case is why the
           * fallback is not decoration.
           */
          let retired = false;
          try {
            const found = await db.withIdentity(identity, (tx: SqlTx) =>
              tx.unsafe<{ id: string }>(
                `select id from echo.app_user
                  where org_id = $1 and username = $2 and tombstoned_at is not null
                  limit 1`,
                [identity.orgId, username ?? null],
              ),
            );
            retired = found.length > 0;
          } catch {
            // Deliberately ignored — see above.
          }
          /**
           * DISTINCT codes, because they are distinct facts and both locales
           * must be able to say which. "Taken" implies a person currently has
           * it and could be asked for it; "retired" means the handle belonged
           * to a deleted account and never comes back. A single
           * `username_conflict` code would force every translator to pick one
           * of those meanings for both cases.
           */
          throw retired
            ? new ConflictError(
                "that username belonged to a deleted account and is permanently retired",
                { code: "username_retired" })
            : new ConflictError(
                "username is already taken in this organization",
                { code: "username_taken" });
        }
        if (pg.code === "23514" && pg.constraint_name === "app_user_username_format") {
          // Only reachable if USERNAME_FORMAT above drifts from the
          // constraint. The database is the enforcer; this turns its refusal
          // back into the sentence the caller needed.
          throw new ValidationError(USERNAME_RULE, USERNAME_REFUSAL);
        }
        throw error;
      }
    },

    /**
     * The org's people. RLS scopes it (`app_user_read`: own row, or the org
     * if active), so this adds ordering, not a predicate.
     *
     * Pending first, deliberately: the queue is the thing an admin opens this
     * screen to act on, and burying it under an alphabetical list of active
     * members is how someone waits a week for approval.
     */
    async list(identity: Identity, options: MemberQuery = {}): Promise<MemberRecord[]> {
      /**
       * Sort is a closed set mapped to SQL here, never a column name from the
       * caller. `order by ${query.sort}` is the injection everyone knows
       * about, but the quieter reason is that it would also expose the
       * schema's column names as an API contract — renaming a column would
       * become a breaking change for anyone who had guessed one.
       */
      const SORTS: Record<string, string> = {
        // The default keeps the pending queue on top: it is what an admin
        // opens this screen to act on, and burying it under an alphabetical
        // list of active members is how someone waits a week for approval.
        default: "(status = 'pending') desc, created_at",
        name: "display_name, created_at",
        created: "created_at desc",
        // NULLS LAST is the point: someone never seen is not the most recent
        // thing that happened, and Postgres sorts NULLs first on DESC.
        last_seen: "last_seen_at desc nulls last, created_at",
        status: "status, created_at",
      };
      const sort = options.sort ?? "default";
      if (!(sort in SORTS)) {
        throw new ValidationError(`sort must be one of: ${Object.keys(SORTS).filter((s) => s !== "default").join(", ")}`);
      }
      if (options.status !== undefined && !USER_STATUSES.includes(options.status as UserStatus)) {
        throw new ValidationError(`status must be one of: ${USER_STATUSES.join(", ")}`);
      }
      if (options.role !== undefined && !MEMBER_ROLES.includes(options.role as MemberRole)) {
        throw new ValidationError(`role must be one of: ${MEMBER_ROLES.join(", ")}`);
      }

      /**
       * Search spans the four things a person is FINDABLE by, including both
       * name columns — an org with Persian and Latin names would otherwise
       * have half its people unsearchable depending on which script the admin
       * typed, which reads as "search is broken" rather than "search only
       * covers one column".
       *
       * `ilike` with an escaped pattern rather than full-text: this is a
       * directory of tens to hundreds of rows, and websearch_to_tsquery would
       * make `ali` fail to match `alireza` — prefix matching is the behaviour
       * a directory filter is expected to have.
       */
      const search = options.search?.trim();
      const pattern = search
        ? `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
        : null;

      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<Record<string, unknown>>(
          `select ${MEMBER_COLUMNS} from echo.app_user
            where ($1::text is null
                   or display_name ilike $1 escape '\\'
                   or coalesce(display_name_en, '') ilike $1 escape '\\'
                   or coalesce(username, '') ilike $1 escape '\\'
                   or email::text ilike $1 escape '\\')
              and ($2::echo.user_status is null or status = $2::echo.user_status)
              and ($3::echo.member_role is null or role = $3::echo.member_role)
            order by ${SORTS[sort]}`,
          [pattern, options.status ?? null, options.role ?? null],
        ),
      );
      return rows.map(toMember);
    },

    /**
     * The UM stat tiles (M24): counts now, and movement over a window.
     *
     * Counts come from `app_user` because that is what "how many members are
     * pending" means — the current state, not a replay of the log.
     *
     * Trends come from `user_status_history`, and the steward's rule is why:
     * **deltas must never be faked.** The tempting shortcut is to derive a
     * trend from `created_at` (how many joined this month) and call it
     * movement, which silently reports zero activity for an org that accepted
     * ten people and disabled three — every one of those events invisible
     * because nobody was created.
     *
     * ── The distinction the response exists to preserve ─────────────────────
     *
     * `history_since` is null when the log holds no rows AT ALL. A client must
     * render that as "—" and not as "0", because they are different facts:
     * zero means nothing changed, null means we were not recording. The log
     * is new, so today every org is in the second case, and a tile confidently
     * showing "+0 this month" would be a fabricated delta — the exact thing
     * the ruling forbids, arrived at by honest arithmetic.
     */
    async stats(identity: Identity, options: { windowDays?: number | undefined } = {}): Promise<MemberStats> {
      const windowDays = options.windowDays ?? 30;
      if (!Number.isFinite(windowDays) || windowDays <= 0 || windowDays > 365) {
        throw new ValidationError("window_days must be between 1 and 365");
      }

      return db.withIdentity(identity, async (tx: SqlTx) => {
        const [counts] = await tx.unsafe<Record<string, unknown>>(
          `select count(*) filter (where status = 'pending')::int  as pending,
                  count(*) filter (where status = 'active')::int   as active,
                  count(*) filter (where status = 'disabled')::int as disabled,
                  count(*)::int as total
             from echo.app_user`,
        );
        const [movement] = await tx.unsafe<Record<string, unknown>>(
          `select count(*) filter (where new_status = 'active')::int   as activated,
                  count(*) filter (where new_status = 'disabled')::int as disabled,
                  count(*) filter (where new_status = 'pending')::int  as joined
             from echo.user_status_history
            where changed_at >= now() - make_interval(days => $1)`,
          [windowDays],
        );
        // Deliberately NOT windowed: it answers "were we recording at all",
        // which is a different question from "what happened recently".
        const [recording] = await tx.unsafe<Record<string, unknown>>(
          `select min(changed_at) as first_recorded from echo.user_status_history`,
        );

        return {
          counts: {
            pending: Number(counts?.pending ?? 0),
            active: Number(counts?.active ?? 0),
            disabled: Number(counts?.disabled ?? 0),
            total: Number(counts?.total ?? 0),
          },
          trend: {
            window_days: windowDays,
            activated: Number(movement?.activated ?? 0),
            disabled: Number(movement?.disabled ?? 0),
            joined: Number(movement?.joined ?? 0),
            history_since: isoOrNull(recording?.first_recorded),
          },
        };
      });
    },

    /**
     * Accept a pending signup (M15). `accepted_at`/`accepted_by` are stamped
     * by db/0011's trigger, not written here — one writer for that fact.
     *
     * `status = 'pending'` in the WHERE is not just an optimisation: it makes
     * accepting an already-active member affect no rows, which we report as a
     * conflict rather than a cheerful success that re-stamps nothing.
     */
    async accept(identity: Identity, memberId: string): Promise<MemberRecord> {
      const id = assertUuid(memberId, "member id");
      const rows = await db.withIdentity(identity, async (tx: SqlTx) => {
        const accepted = await tx.unsafe<Record<string, unknown>>(
          `update echo.app_user set status = 'active'
            where id = $1 and status = 'pending'
            returning ${MEMBER_COLUMNS}`,
          [id],
        );
        // Only when a row actually moved: accepting an already-active member
        // affects nothing and must not produce a log entry saying otherwise.
        if (accepted[0]) {
          await record(tx, identity, {
            action: "member_accepted", targetType: "member", targetId: id,
          });
        }
        return accepted;
      });
      const row = rows[0];
      // No row = not pending, not visible, or not ours to change. All three
      // are 404 for the same not-probeable reason used everywhere else.
      if (!row) throw new NotFoundError("no pending member with that id");
      return toMember(row);
    },

    /**
     * Role change and disable/enable, the two things an admin actually does
     * to an existing member.
     *
     * The self-demotion guard is the one piece of judgement here: an admin
     * removing their OWN admin role can strand an org with no admin, and
     * nothing in the schema prevents it (db/0013's `app_user_write` allows
     * editing your own row by design, so the profile screen works). Refused
     * with a legible message rather than allowed and regretted.
     */
    async update(
      identity: Identity, memberId: string,
      patch: { role?: MemberRole | undefined; status?: "active" | "disabled" | undefined },
    ): Promise<MemberRecord> {
      const id = assertUuid(memberId, "member id");
      if (patch.role === undefined && patch.status === undefined) {
        throw new ValidationError("nothing to update");
      }
      /**
       * `owner` is NOT settable here, and that is a decision rather than an
       * oversight (M23).
       *
       * There is exactly one owner per org, so "set role = owner" is not a
       * role change — it is a TRANSFER, which moves authority away from the
       * current owner as a side effect of a request that never mentions
       * them. M23 calls transfer an explicit action, and an explicit action
       * deserves its own endpoint with its own confirmation, not a value
       * smuggled into the general-purpose patch.
       *
       * Who may promote or demote an ADMIN is db/'s authorization matrix to
       * enforce (M23: only the owner), and this layer does not restate it —
       * a second copy here could disagree with the wall, and the wall wins.
       */
      if (patch.role !== undefined && patch.role !== "admin" && patch.role !== "member") {
        throw new ValidationError("role must be admin or member");
      }
      if (patch.status !== undefined && patch.status !== "active" && patch.status !== "disabled") {
        // 'pending' is not settable: it is where registration puts you, and
        // going back would be a second, quieter way to revoke access than
        // disabling — with different semantics nobody has decided.
        throw new ValidationError("status must be active or disabled");
      }
      if (id === identity.userId && patch.role === "member") {
        throw new ConflictError("an admin cannot remove their own admin role");
      }
      if (id === identity.userId && patch.status === "disabled") {
        throw new ConflictError("an admin cannot disable their own account");
      }

      const rows = await db.withIdentity(identity, async (tx: SqlTx) => {
        const changed = await tx.unsafe<Record<string, unknown>>(
          `update echo.app_user
              set role   = coalesce($2::echo.member_role, role),
                  status = coalesce($3::echo.user_status, status)
            where id = $1 and status <> 'pending'
            returning ${MEMBER_COLUMNS}`,
          [id, patch.role ?? null, patch.status ?? null],
        );
        /**
         * TWO actions, not one "member_updated", because a role change and a
         * disable are different events to whoever reads this later — and a
         * single request can be both. Merging them would make the log's
         * granularity worse than the operation's.
         *
         * The new role and status ARE recorded: they are codes from closed
         * vocabularies, not content. "Who was made an admin" is the question
         * this table exists to answer.
         */
        if (changed[0]) {
          if (patch.role !== undefined) {
            await record(tx, identity, {
              action: "member_role_changed", targetType: "member", targetId: id,
              detail: { role: patch.role },
            });
          }
          if (patch.status !== undefined) {
            await record(tx, identity, {
              action: "member_status_changed", targetType: "member", targetId: id,
              detail: { status: patch.status },
            });
          }
        }
        return changed;
      });
      const row = rows[0];
      // `status <> 'pending'` keeps acceptance on its own path: promoting a
      // pending person to admin would activate them by a side door.
      if (!row) throw new NotFoundError("member not found");
      return toMember(row);
    },
  };
}

export type MembersRepo = ReturnType<typeof createMembersRepo>;
