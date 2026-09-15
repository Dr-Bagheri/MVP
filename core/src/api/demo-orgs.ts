/**
 * The DEMO ORGANISATIONS repository (M52) — what the platform console's
 * fourth tab talks to.
 *
 * It owns the order of a seeding, and the order is the part that carries the
 * safety:
 *
 *   1. mint the auth identities (Supabase admin API — the only thing that can
 *      produce an `auth.users` row a human `app_user` may borrow);
 *   2. call `echo.platform_create_demo_org`, which seats every one of them in
 *      ONE statement run;
 *   3. resolve the OWNER's identity and write the content as them.
 *
 * Step 1 before step 2 is not a preference: db/0171's trigger refuses a human
 * `app_user` whose id is not an auth identity, so the ids have to exist
 * first. That ordering creates the one state worth designing for — identities
 * that exist with no organisation — and `create` unwinds it: every identity
 * minted in this call is removed if the door refuses, and any that could not
 * be removed are NAMED in the error, because an orphaned identity somebody
 * has to delete by hand is not something to swallow.
 *
 * Past that point the unwind stops, deliberately. Once the door has committed
 * there IS an organisation, it is flagged `demo`, it appears in this tab, and
 * it can be deleted from the same screen — so a content failure reports the
 * organisation's id and leaves it standing rather than trying to reverse a
 * dozen repositories' writes with no transaction around them.
 *
 * THE PASSWORDS. The owner's is generated here, returned ONCE, and never
 * stored — not in a row, not in the audit reason, not in a log. Every other
 * member gets one too, from the same generator, and it is discarded
 * unread: nothing needs it, and a demo where four extra passwords are handed
 * around is four more secrets than the demo requires. Somebody who needs to
 * sign in as a member resets it from the console.
 */

import type { Db, SqlTx } from "../db/identity.ts";
import type { Identity } from "../agent/types.ts";
import { resolveIdentity } from "../db/actor.ts";
import { ConflictError, NotFoundError, ValidationError } from "./errors.ts";
import type { AuthAdmin } from "./demo-seed/auth-users.ts";
import {
  demoEmail, demoSlug, generatePassword, presenterEmail,
} from "./demo-seed/auth-users.ts";
import type { DemoStorage } from "./demo-seed/storage.ts";
import type { DemoLanguage, DemoPersonKey } from "./demo-seed/pack.ts";
import { isDemoLanguage, packFor } from "./demo-seed/packs.ts";
import { buildTimeline, parseDemoDate, todayInZone } from "./demo-seed/timeline.ts";
import type { DemoRepos, SeedProgress, SeedReport, SeedWarn } from "./demo-seed/engine.ts";
import { contentStages, peopleForDoor, seedDemoContent } from "./demo-seed/engine.ts";

/** One row of the console's Demo tab. */
export interface DemoOrganization {
  id: string;
  name: string;
  status: string;
  locale: string;
  created_at: string;
  deleted_at: string | null;
  /** the CONTENT language — null on a row seeded before the field existed */
  language: string | null;
  demo_date: string | null;
  seeded_at: string | null;
  reseeded_at: string | null;
  owner_email: string | null;
  member_count: number;
}

/** Shown ONCE. Never persisted, never logged, never in the audit reason. */
export interface DemoCredentials {
  email: string;
  password: string;
}

export interface DemoSeedResult {
  org_id: string;
  owner: DemoCredentials;
  report: SeedReport;
}

export interface CreateDemoInput {
  name?: unknown;
  language?: unknown;
  demo_date?: unknown;
  offset_minutes?: unknown;
  presenter_email?: unknown;
  reason?: unknown;
}

export interface ReseedDemoInput {
  demo_date?: unknown;
  offset_minutes?: unknown;
  reason?: unknown;
}

/**
 * A seed, parsed but not started. The route reads `name` and `stages` to
 * open a job, then calls `run` in the background — so an input the
 * repository would refuse is refused NOW, as a 400, and never becomes a
 * job that fails a second later with the same sentence.
 */
export interface PreparedSeed<T> {
  name: string;
  stages: string[];
  run: (progress?: SeedProgress) => Promise<T>;
}

export interface DemoOrgsDeps {
  db: Db;
  repos: DemoRepos;
  auth: AuthAdmin | null;
  storage: DemoStorage | null;
  /**
   * `WORKER_SUMMARY_MODEL`, read once by the entrypoint. The seeded org is
   * curated to it (else to the engine's default) so M5's ladder has a top
   * rung for the demo. Absent here = null; the engine never reads env.
   */
  defaultModel?: string | null | undefined;
  /** Structured warn sink (codes and ids only, never content). */
  warn?: SeedWarn | undefined;
  /** Structured info sink — the audio cache fill announces itself here. */
  info?: SeedWarn | undefined;
  now?: () => Date;
}

const MAX_OFFSET_MINUTES = 1440;

function readReason(value: unknown): string {
  if (typeof value !== "string" || value.trim().length < 3) {
    throw new ValidationError("reason is required");
  }
  return value;
}

function readOffset(value: unknown): number {
  if (value === undefined || value === null) return 20;
  const minutes = Number(value);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_OFFSET_MINUTES) {
    throw new ValidationError(
      `the upcoming meeting is between 1 and ${MAX_OFFSET_MINUTES} minutes away`,
      { code: "demo_offset_invalid" },
    );
  }
  return minutes;
}

function readDemoDate(value: unknown, now: Date): string {
  const raw = typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : todayInZone(now);
  try {
    parseDemoDate(raw);
  } catch {
    throw new ValidationError("the demo date must be a real YYYY-MM-DD day", {
      code: "demo_date_invalid",
    });
  }
  return raw;
}

function readLanguage(value: unknown): DemoLanguage {
  if (!isDemoLanguage(value)) {
    throw new ValidationError("the demo content language is en or fa", {
      code: "demo_language_unknown",
    });
  }
  return value;
}

/** `demo` is jsonb; read a string field out of it without trusting the shape. */
const readDemoField = (demo: unknown, key: string): string | null => {
  if (demo === null || typeof demo !== "object") return null;
  const value = (demo as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
};

export function createDemoOrgsRepo(deps: DemoOrgsDeps) {
  const { db, repos } = deps;
  const clock = deps.now ?? (() => new Date());

  async function list(identity: Identity): Promise<DemoOrganization[]> {
    const rows = await db.withIdentity(identity, (tx: SqlTx) =>
      tx.unsafe<Record<string, unknown>>(
        `select * from echo.platform_demo_orgs($1)`,
        [identity.userId],
      ),
    );
    return rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      status: String(row.status),
      locale: String(row.locale),
      created_at: new Date(row.created_at as string).toISOString(),
      deleted_at: row.deleted_at === null || row.deleted_at === undefined
        ? null
        : new Date(row.deleted_at as string).toISOString(),
      language: readDemoField(row.demo, "language"),
      demo_date: readDemoField(row.demo, "demo_date"),
      seeded_at: readDemoField(row.demo, "seeded_at"),
      reseeded_at: readDemoField(row.demo, "reseeded_at"),
      owner_email: row.owner_email === null || row.owner_email === undefined
        ? null
        : String(row.owner_email),
      member_count: Number(row.member_count ?? 0),
    }));
  }

  /** The human accounts in a demo org — the auth identities a delete removes. */
  async function identitiesOf(identity: Identity, orgId: string): Promise<string[]> {
    const rows = await db.withIdentity(identity, (tx: SqlTx) =>
      tx.unsafe<{ id: string }>(
        `select u.id
           from echo.app_user u
           join echo.org o on o.id = u.org_id
          where u.org_id = $1 and u.kind = 'human' and o.demo is not null`,
        [orgId],
      ),
    );
    return rows.map((row) => row.id);
  }

  /** Validate a create without starting it; see `PreparedSeed`. */
  function prepareCreate(
    identity: Identity, input: CreateDemoInput,
  ): PreparedSeed<DemoSeedResult> {
    const reason = readReason(input.reason);
    const language = readLanguage(input.language);
    const now = clock();
    const demoDate = readDemoDate(input.demo_date, now);
    const offsetMinutes = readOffset(input.offset_minutes);
    const pack = packFor(language);
    const name = typeof input.name === "string" && input.name.trim() !== ""
      ? input.name.trim()
      : pack.orgName;
    if (name.length > 120) {
      throw new ValidationError("that organisation name is too long", {
        code: "demo_name_too_long",
      });
    }
    const auth = deps.auth;
    if (auth === null) {
      throw new ValidationError(
        "seeding a demo organisation needs Supabase auth configuration — the five accounts cannot be created without it",
        { code: "demo_auth_unconfigured" },
      );
    }

    const slug = demoSlug(name);
    const ownerEmail = typeof input.presenter_email === "string"
      && input.presenter_email.trim() !== ""
      ? input.presenter_email.trim()
      : presenterEmail(slug, demoDate);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) {
      throw new ValidationError("that presenter address is not an email", {
        code: "demo_email_invalid",
      });
    }

    const stages = ["identities", "organization", ...contentStages(pack)];
    const run = async (progress: SeedProgress = () => {}): Promise<DemoSeedResult> => {
    const emails = {} as Record<DemoPersonKey, string>;
    for (const person of pack.people) {
      emails[person.key] = person.key === "owner"
        ? ownerEmail
        : demoEmail(person.username, slug, demoDate);
    }

    /* ── 1. the identities ────────────────────────────────────────────── */
    progress("identities");
    const ids = {} as Record<DemoPersonKey, string>;
    const minted: string[] = [];
    const ownerPassword = generatePassword();
    try {
      for (const person of pack.people) {
        const password = person.key === "owner" ? ownerPassword : generatePassword();
        const user = await auth.create(emails[person.key], password);
        ids[person.key] = user.id;
        minted.push(user.id);
      }
    } catch (cause) {
      throw await unwind(auth, minted, cause);
    }

    /* ── 2. the organisation and its seats, in one statement run ──────── */
    progress("organization");
    let orgId: string;
    try {
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ platform_create_demo_org: string }>(
          /* ::text::jsonb — the cast travels with the value (db/jsonb.ts):
             a bare ::jsonb over a serialised string arrives as a JSON STRING
             and the door refuses "people must be a json array" — the
             double-encoding trap, met again 2026-09-09 on this very line */
          `select echo.platform_create_demo_org($1, $2, $3, $4::date, $5::text::jsonb, $6)`,
          [identity.userId, name, language, demoDate,
           JSON.stringify(peopleForDoor(pack, ids, emails)), reason],
        ),
      );
      const created = rows[0]?.platform_create_demo_org;
      if (typeof created !== "string" || created === "") {
        throw new Error("the door returned no organisation id");
      }
      orgId = created;
    } catch (cause) {
      const pg = cause as { code?: string };
      const unwound = await unwind(auth, minted, cause);
      if (pg.code === "23505") {
        throw new ConflictError("an active organization already has this name");
      }
      if (pg.code === "42883") throw new ConflictError("not_migrated");
      throw unwound;
    }

    /* ── 3. the content, as the OWNER ─────────────────────────────────── */
    const owner = await resolveIdentity(db, ids.owner);
    const timeline = buildTimeline({
      demoDate,
      offsetMinutes,
      prior: pack.records[0]!,
      pricing: pack.records[1]!,
      now,
    });
    let report: SeedReport;
    try {
      report = await seedDemoContent({
        db, repos, identity: owner, pack, timeline, userIds: ids,
        storage: deps.storage, defaultModel: deps.defaultModel ?? null,
        warn: deps.warn, info: deps.info, progress,
      });
    } catch (cause) {
      /* The organisation EXISTS. Saying so is the whole value of this branch:
         it is in the Demo tab, it can be removed from the same screen, and a
         message that only said "seeding failed" would leave an operator
         hunting for something they were never told about. */
      throw new ConflictError(
        `the organisation was created (${orgId}) but its content was not finished — remove it from the demo tab and try again. ${cause instanceof Error ? cause.message : String(cause)}`,
        { code: "demo_content_failed" },
      );
    }

    if (timeline.pricingMoved) {
      report.warnings.push(
        "the pricing call landed on the Iranian weekend, so it was moved back to the Thursday",
      );
    }
    return { org_id: orgId, owner: { email: ownerEmail, password: ownerPassword }, report };
    };
    return { name, stages, run };
  }

  async function create(
    identity: Identity, input: CreateDemoInput, progress?: SeedProgress,
  ): Promise<DemoSeedResult> {
    return prepareCreate(identity, input).run(progress);
  }

  /**
   * Validate a re-seed without starting it. The reads here (the org row, its
   * owner) are the checks a caller wants answered before a job is opened;
   * the clear-and-write is the part that takes minutes and runs inside `run`.
   */
  async function prepareReseed(
    identity: Identity, orgId: string, input: ReseedDemoInput,
  ): Promise<PreparedSeed<SeedReport>> {
    const reason = readReason(input.reason);
    const now = clock();
    const demoDate = readDemoDate(input.demo_date, now);
    const offsetMinutes = readOffset(input.offset_minutes);

    const existing = (await list(identity)).find((org) => org.id === orgId);
    if (existing === undefined) throw new NotFoundError("no such demo organization");
    if (existing.deleted_at !== null) {
      throw new ValidationError("a deleted demo organization is restored before it is re-seeded", {
        code: "demo_deleted",
      });
    }
    const language = readLanguage(existing.language ?? existing.locale);
    const pack = packFor(language);

    const owners = await db.withIdentity(identity, (tx: SqlTx) =>
      tx.unsafe<{ id: string }>(
        `select id from echo.app_user
          where org_id = $1 and kind = 'human' and role = 'owner'
          order by created_at limit 1`,
        [orgId],
      ),
    );
    const ownerId = owners[0]?.id;
    if (ownerId === undefined) {
      throw new ConflictError("that demo organization has no owner left to seed as", {
        code: "demo_no_owner",
      });
    }

    const stages = ["organization", ...contentStages(pack)];
    const run = async (progress: SeedProgress = () => {}): Promise<SeedReport> => {
      /* The accounts SURVIVE — the credentials were shown once and a re-seed
         that invalidated them would make that panel a lie. */
      progress("organization");
      await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe(`select echo.platform_clear_demo_org($1, $2, $3::date, $4)`,
          [identity.userId, orgId, demoDate, reason]),
      );

      const userIds = await memberKeys(db, identity, orgId, pack.people);
      const owner = await resolveIdentity(db, ownerId);
      const timeline = buildTimeline({
        demoDate, offsetMinutes,
        prior: pack.records[0]!, pricing: pack.records[1]!, now,
      });
      const report = await seedDemoContent({
        db, repos, identity: owner, pack, timeline, userIds, storage: deps.storage,
        defaultModel: deps.defaultModel ?? null, warn: deps.warn, info: deps.info, progress,
      });
      if (timeline.pricingMoved) {
        report.warnings.push(
          "the pricing call landed on the Iranian weekend, so it was moved back to the Thursday",
        );
      }
      return report;
    };
    return { name: existing.name, stages, run };
  }

  async function reseed(
    identity: Identity, orgId: string, input: ReseedDemoInput, progress?: SeedProgress,
  ): Promise<SeedReport> {
    return (await prepareReseed(identity, orgId, input)).run(progress);
  }

  return { list, identitiesOf, prepareCreate, create, prepareReseed, reseed };
}

export type DemoOrgsRepo = ReturnType<typeof createDemoOrgsRepo>;

/**
 * Re-seeding writes content for people who already exist, so it has to find
 * them again. The USERNAME is the key: it is the one identity field the pack
 * fixes and the door writes verbatim, and it is per-org unique (db/0039).
 */
async function memberKeys(
  db: Db, identity: Identity, orgId: string,
  people: readonly { key: DemoPersonKey; username: string }[],
): Promise<Record<DemoPersonKey, string>> {
  const rows = await db.withIdentity(identity, (tx: SqlTx) =>
    tx.unsafe<{ id: string; username: string | null }>(
      `select id, username from echo.app_user
        where org_id = $1 and kind = 'human' and username = any($2::text[])`,
      [orgId, people.map((p) => p.username)],
    ),
  );
  const byUsername = new Map(rows.map((row) => [row.username ?? "", row.id]));
  const out: Partial<Record<DemoPersonKey, string>> = {};
  for (const person of people) {
    const id = byUsername.get(person.username);
    if (id === undefined) {
      throw new ConflictError(
        `the demo account "${person.username}" is missing from that organization, so it cannot be re-seeded`,
        { code: "demo_account_missing" },
      );
    }
    out[person.key] = id;
  }
  return out as Record<DemoPersonKey, string>;
}

/**
 * Remove every identity this call minted, and NAME the ones that would not
 * go. An orphaned auth user is a real thing an operator may have to clear by
 * hand; the only way they learn about it is if the error says so.
 */
async function unwind(
  auth: AuthAdmin, minted: readonly string[], cause: unknown,
): Promise<Error> {
  const stranded: string[] = [];
  for (const id of minted) {
    try {
      await auth.remove(id);
    } catch {
      stranded.push(id);
    }
  }
  const detail = cause instanceof Error ? cause.message : String(cause);
  if (stranded.length > 0) {
    return new ConflictError(
      `the demo organization was not created (${detail}); ${stranded.length} auth identity/identities could not be removed and remain: ${stranded.join(", ")}`,
      { code: "demo_identities_stranded" },
    );
  }
  return new ConflictError(
    `the demo organization was not created (${detail}); the auth identities it had minted were removed`,
    { code: "demo_create_failed" },
  );
}
