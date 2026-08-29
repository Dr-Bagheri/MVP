/**
 * THE swap point. Every screen talks only to `api`; Phase A serves the
 * fixtures in mock-data.ts, and when core/ lands each body becomes a fetch to
 * the BFF route (web/ holds the session — the browser never sees a token, M1).
 * Signatures and types do not change.
 */
// (the mock-data import is gone: the last fixture bodies in this file were
// swapped to the wire or deleted by the 2026-08-20 tenancy audit — see the
// notes at their former sites.)
import type {
  AuthoredWorkflow,
  MailDraft,
  MailSourceMessage,
  AuthSessionRow,
  OrgSessionRow,
  WorkflowRunDetail,
  WorkflowRunRecord,
  CapabilityState,
  AgentCardItem,
  AgentEvent,
  AgentMessage,
  AgentCard,
  AgentStats,
  AgentWorkflowLink,
  CallNote,
  RunTrace,
  AssistantSession,
  AuthoredSkill,
  AuditCursor,
  AuditPage,
  AuditSource,
  CalendarPreference,
  Call,
  CallScope,
  ConnectorItem,
  ConnectorProvider,
  ConnectorStatus,
  Person,
  PlatformAuditEntry,
  PlatformOrganization,
  PlatformOverview,
  PlatformPage,
  PlatformUser,
  GatewayKey,
  GatewayKeyCreated,
  Invitation,
  MintedInvitation,
  AdminModelRow,
  Me,
  MemberSort,
  ModelsResponse,
  Org,
  Role,
  SearchHit,
  ServerHealth,
  Skill,
  Speaker,
  StarterWorkflow,
  SummaryVersion,
  TranscriptSegment,
  User,
  UserStatus,
  WorkflowCard,
} from "./types";
/**
 * The producer's own shape for `GET /v1/me`, imported rather than described.
 * `import type` is erased, so nothing from core/ reaches the bundle — the same
 * basis as the `Call`/`Org` migrations.
 */
import type { MeRecord } from "@echo/core/wire";
import { announceChange, announceWrite } from "@/lib/refreshBus";

/*
 * The AGENT_SESSIONS/AGENT_THREADS fixtures left with the ask() mock (Part 1,
 * M27): the conversation surface is live end to end, and a fixture beside a
 * live wire is two sources for one fact.
 */
const LATENCY = 180;
const wait = <T,>(value: T, ms = LATENCY): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

// The last mutable Phase-A session copies (`users`, `me`, `transcripts`) left
// with their final readers — setPreferredModel went to the wire, and
// agentRuns/correctLine were deleted as caller-less fixtures (2026-08-20
// tenancy audit). Fixture state that survives an account switch in the JS
// heap is a cross-tenant residue; none remains in this file.


/**
 * A refusal that kept its REASON.
 *
 * `kind` is core/'s taxonomy (`pending`, `suspended`, `forbidden`,
 * `unknown_actor`, …) forwarded verbatim by the BFF. It is carried rather than
 * flattened to a status because three of those are 403 and mean entirely
 * different things to the person reading the screen: "an admin hasn't let you
 * in yet" points at a colleague, "your organization is switched off" points at
 * the vendor, and "this isn't yours" points at nobody. A screen that only knows
 * `403` has to pick one of those sentences and will be wrong twice.
 */
export class BffError extends Error {
  constructor(
    readonly status: number,
    readonly kind?: string,
    /**
     * The server's own sentence, when it sent one.
     *
     * Kept because for `invalid` and `conflict` the server is the ONLY thing
     * that knows why: it owns the username format and it alone can tell
     * "already taken" from "retired with a deleted account". A client that
     * re-derives either one has copied a rule it does not own, and the copy
     * goes stale without a single test turning red.
     *
     * Optional on purpose — a refusal with an unreadable body is still a real
     * refusal, and the screen falls back to its own wording.
     */
    readonly detail?: string,
  ) {
    super(`bff ${status}${kind ? ` (${kind})` : ""}${detail ? `: ${detail}` : ""}`);
  }
}

/**
 * The browser → BFF hop. **The first live one in this file** — everything
 * above me is still Phase-A fixtures, so this is the shape the rest of the
 * swap should adopt rather than re-invent.
 *
 * Two decisions worth keeping:
 *
 * A non-2xx **throws**, never returns an empty result. A fetch helper that
 * swallowed a 403 into `[]` would hand every screen "there is nothing here"
 * for "you may not look" — the exact substitution that makes an empty audit
 * list read as an organization where nothing has ever happened.
 *
 * The error body is parsed for `kind` and a failure to parse is not itself an
 * error: an upstream that returned HTML or nothing at all still produced a
 * real status, and losing the status because the body was unreadable would
 * turn a clean refusal into an unexplained crash.
 */
async function bff<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    let kind: string | undefined;
    let detail: string | undefined;
    try {
      const body = (await response.json()) as { kind?: string; error?: string };
      kind = body.kind;
      detail = body.error;
    } catch {
      /* not JSON — the status is still the fact worth keeping */
    }
    throw new BffError(response.status, kind, detail);
  }
  // ANY successful write invalidates the read cache — one rule, one place,
  // no per-mutation bookkeeping to forget (sign-in included: it is a POST)
  // — and ANNOUNCES on the refresh bus, so every table showing this data
  // refetches whether the human pressed the button or the agent did
  // (user directive, 2026-08-21).
  if (init?.method && init.method !== "GET") {
    readCache.clear();
    announceWrite(path);
  }
  // a 204 has no body by definition — json() on it would turn a clean
  // delete into a parse crash
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/**
 * A short-lived shared cache for the HOT identity/catalogue reads.
 *
 * Measured cause (server logs, 2026-08-16): one page navigation fired SIX
 * `/v1/me` requests inside four seconds — every component asks on its own —
 * and each round trip costs ~350ms of api↔database latency. The felt
 * "delay loading information" is mostly the same three answers re-fetched
 * per component, serially.
 *
 * The rules that keep it honest:
 *  - only reads whose staleness is harmless for 60s live here (identity,
 *    the model catalogue, skills, tool names, and — user directive
 *    2026-08-23 — the BARE member/directory listings used for name
 *    resolution); QUERIED member listings and every other acted-on list
 *    (calls, invitations) are never cached;
 *  - any successful non-GET through `bff` clears it, so a saved profile,
 *    changed preference, or fresh sign-in is visible immediately;
 *  - a failed fetch is evicted rather than cached — errors don't linger.
 */
const readCache = new Map<string, { at: number; value: Promise<unknown> }>();
const READ_CACHE_TTL_MS = 60_000;

function cachedRead<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const hit = readCache.get(key);
  if (hit && Date.now() - hit.at < READ_CACHE_TTL_MS) return hit.value as Promise<T>;
  const value = fetcher().catch((error) => {
    readCache.delete(key);
    throw error;
  });
  readCache.set(key, { at: Date.now(), value });
  return value;
}

/**
 * ONE `/api/me` per page load — the shared read behind BOTH `me()` and
 * `identityState()`.
 *
 * `me()` was cached from the day the cache existed, so its ~25 callers
 * collapse to a single request. `identityState()` asked the SAME endpoint
 * with a raw `bff()` call, and `PresenceDock` calls it from a mount effect on
 * every route — so the hottest read in the product was fetched twice on every
 * page load. Giving `identityState` a cache key of its own would not have
 * fixed that: two keys over one endpoint is still two requests. The fix is
 * that the two functions are two READINGS of one answer, so they share the
 * answer and each classifies it its own way.
 *
 * **What is cached and what is not.** A 401 or a 403 is a settled fact about
 * who the caller is — the same thing `me()`'s cached `null` already was — and
 * it is returned as a value so the cache keeps it. Anything else (a 500, a
 * dropped connection, a parse failure) is transient and is rethrown, which
 * makes `cachedRead` evict it: a blip must not stick to the identity for a
 * minute. Write invalidation is unchanged — every non-GET through `bff`
 * clears the whole read cache, so a saved profile, a changed preference or a
 * fresh sign-in re-reads immediately.
 */
function meOutcome(): Promise<{ row: MeRecord } | { refusal: BffError }> {
  return cachedRead("me", async () => {
    try {
      return { row: await bff<MeRecord>("/api/me") };
    } catch (error) {
      if (error instanceof BffError && (error.status === 401 || error.status === 403)) {
        return { refusal: error };
      }
      throw error;
    }
  });
}

/**
 * The SSE hop — the browser half of core/'s typed event stream.
 *
 * Frames arrive as `event: <type>\ndata: <json>\n\n` with `:ka` comment
 * lines as proxy keep-alives; only the data line matters, because the JSON
 * carries the same discriminated `type` the reducer switches on. A torn
 * frame at a chunk boundary is buffered, not parsed early — the classic
 * SSE-by-hand bug is splitting on the first read() and losing the delta
 * that straddled two packets.
 *
 * `signal` is the STOP button: aborting rejects the read, the finally
 * releases the socket, the BFF's upstream fetch is torn down, and core's
 * close handler aborts the run — one chain, no orphaned spend.
 */
async function* streamAssistant(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): AsyncGenerator<AgentEvent> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok || !response.body) {
    let kind: string | undefined;
    let detail: string | undefined;
    try {
      const parsed = (await response.json()) as { kind?: string; error?: string };
      kind = parsed.kind;
      detail = parsed.error;
    } catch {
      /* not JSON — the status is still the fact worth keeping */
    }
    throw new BffError(response.status, kind, detail);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep = buffer.indexOf("\n\n");
      while (sep !== -1) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const data = frame.split("\n").find((line) => line.startsWith("data: "));
        if (data) {
          try {
            yield JSON.parse(data.slice(6)) as AgentEvent;
          } catch {
            /* a malformed frame is dropped; the contract is unknown-ignorable */
          }
        }
        sep = buffer.indexOf("\n\n");
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

/**
 * Who the caller is, as FIVE distinct answers rather than a value-or-null.
 *
 * `me()` collapses every 401 into `null`, which is right for a shell that only
 * needs "is there someone here". It is wrong at the front door, where the
 * differences ARE the routing:
 *
 *  - `unregistered` — a valid token for a subject with no `app_user` row.
 *    **This is the M15 hole's signature**: sign-up's second half never ran, so
 *    the person authenticates perfectly and does not exist to the product.
 *    Indistinguishable from "signed out" unless the kind is read, and the
 *    recovery (register-on-first-sign-in) hangs off exactly this branch.
 *  - `pending` and `suspended` are both 403 and mean opposite things to the
 *    person: one points at a colleague who can let them in, the other at a
 *    vendor who must switch the org back on. A screen that knows only "403"
 *    has to pick one sentence and will be wrong half the time.
 */
export type IdentityState =
  | { state: "member"; me: Me }
  | { state: "unregistered" }
  | { state: "signed_out" }
  | { state: "pending"; detail?: string }
  | { state: "suspended"; detail?: string };

export const api = {
  // ---- session ---------------------------------------------------------------
  /**
   * **LIVE** — the same `GET /api/me`, read for its REFUSAL rather than its
   * payload. Nothing here decides anything; it only reports which of the five
   * states the server put the caller in.
   */
  /**
   * **LIVE** — `POST /api/auth/sign-in`. The token set is exchanged
   * server-side into an httpOnly cookie; **the browser never sees a token**
   * (M1), so there is nothing useful in the response and nothing is returned.
   *
   * A resolved promise means the PASSWORD was accepted — nothing more. Whether
   * this person may use the product is a separate question, answered by
   * `identityState()`, and conflating the two is how a pending account gets
   * told its password is wrong.
   */
  async signIn(email: string, password: string): Promise<void> {
    await bff<{ ok: true }>("/api/auth/sign-in", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  },

  /**
   * **LIVE** — `POST /api/auth/sign-up`: the Supabase identity AND core/'s
   * `/v1/signup` row, in one call, because either alone leaves a person who
   * cannot be helped by an admin.
   *
   * `confirmationRequired` is a real outcome, not an error: the identity
   * exists and the product row does not, because there was no session to
   * create it with. The caller must say so rather than showing the
   * waiting-for-approval screen, which would claim a queue entry that isn't
   * there.
   */
  async signUp(input: {
    email: string;
    password: string;
    display_name: string;
    org_name?: string;
  }): Promise<{ confirmationRequired: boolean; member: User | null }> {
    const body = await bff<User | { ok: true; confirmationRequired: true }>("/api/auth/sign-up", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    return "confirmationRequired" in body
      ? { confirmationRequired: true, member: null }
      : { confirmationRequired: false, member: body };
  },

  /**
   * **LIVE** — `POST /api/auth/register`, the second half of sign-up run late.
   *
   * Reached only from `identityState() === "unregistered"`, which is the one
   * signal that separates "authenticated but unknown to the product" from
   * "signed out". Without this branch that person is permanently stuck while
   * every screen they see looks correct.
   */
  async register(input: {
    display_name: string;
    org_name?: string;
    join_org?: string;
  }): Promise<User> {
    return bff<User>("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  },

  /**
   * **LIVE** — `POST /api/auth/set-password`: the FIRST password on an
   * OAuth-born account, part of the Google/GitHub completion step. No current
   * password exists to verify; the seconds-old provider session is the proof
   * of ownership. Deliberately a different route from changePassword — see
   * the route header for why the two must not share one.
   */
  async setPassword(newPassword: string): Promise<void> {
    await bff<{ ok: true }>("/api/auth/set-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ new_password: newPassword }),
    });
  },

  /** Whether this just-authenticated Google/GitHub account needs its first password. */
  async oauthPasswordEnrollment(): Promise<{ required: boolean }> {
    return bff<{ required: boolean }>("/api/auth/oauth-password-status");
  },

  /**
   * **LIVE** — `POST /api/auth/change-password`. Requires the current one; see
   * the route for why GoTrue's not requiring it is a hole rather than a
   * convenience.
   */
  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await bff<{ ok: true }>("/api/auth/change-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    });
  },

  /**
   * **LIVE** — `POST /api/auth/recover`.
   *
   * Resolves whether or not the address has an account, deliberately: a
   * different answer would make this a membership oracle. The caller must say
   * "if that address has an account, the mail is on its way" and mean it
   * literally, not as a polite evasion of a fact it knows.
   */
  async requestPasswordRecovery(email: string): Promise<void> {
    await bff<{ ok: true }>("/api/auth/recover", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
  },

  /**
   * **LIVE** — `POST /api/auth/reset`: consume the emailed token and set the
   * new password in one request, because the token is single-use and splitting
   * the steps would burn it on a form that might never be submitted.
   */
  async resetPassword(
    tokenHash: string,
    newPassword: string,
    linkType: "recovery" | "invite" = "recovery",
  ): Promise<void> {
    await bff<{ ok: true }>("/api/auth/reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token_hash: tokenHash, new_password: newPassword, type: linkType }),
    });
  },

  async identityState(): Promise<IdentityState> {
    /* Shares `me()`'s cached read — see `meOutcome`. The classification below
       is unchanged; only where the answer comes from moved. A non-`BffError`
       (a dropped connection, a parse failure) is not an identity verdict and
       propagates, exactly as the old `if (!(error instanceof BffError)) throw`
       branch did. */
    const outcome = await meOutcome();
    if (!("refusal" in outcome)) {
      const row = outcome.row;
      return { state: "member", me: { ...row, model_id: row.preferred_model } };
    }
    const error = outcome.refusal;
    if (error.status === 401) {
      return error.kind === "unknown_actor" ? { state: "unregistered" } : { state: "signed_out" };
    }
    if (error.status === 403 && error.kind === "pending") {
      return { state: "pending", detail: error.detail };
    }
    if (error.status === 403 && error.kind === "suspended") {
      return { state: "suspended", detail: error.detail };
    }
    throw error;
  },

  /**
   * **LIVE** — `GET /api/me` → core/'s `GET /v1/me`. The first fixture retired.
   *
   * Returns `Me`, not `User`: preferences live on core/'s `MeRecord` and a
   * members-list row genuinely does not carry them. Typing this as `User`
   * would push every consumer into `me.calendar ?? "auto"`, and that fallback
   * cannot tell "they chose auto" from "the payload never had it".
   *
   * **`null` means NO IDENTITY, and only a 401 produces it.** Every other
   * refusal is re-thrown on purpose: `403 pending` and `403 suspended` are
   * different facts with different screens, and flattening them into "signed
   * out" would tell a suspended organisation to log in again — an instruction
   * that cannot work, aimed at the wrong person. The shell already guards for
   * null (FE2 built that guard before this call was live).
   *
   * **One field is adapted, and it would otherwise fail silently:**
   *
   *  - `preferred_model` → `model_id`. The wire has never used our name. Left
   *    unmapped, `model_id` arrives `undefined`, `?? ""` catches it, and the
   *    model picker shows "no model chosen" to someone who chose one — the
   *    server's answer overwritten by our fallback, with nothing to notice it
   *    by. (M5's null is a real state; this would have manufactured one.)
   *
   * `avatar_url` used to be OVERWRITTEN here with `null` on the belief that
   * MeRecord did not carry it. It does — `MeRecord extends MemberRecord`,
   * which has carried it all along — so a photo the server stored and served
   * was thrown away on arrival: saved, adopted, and gone, in one line. The
   * fifth member of the stored-and-never-served family, this one discarded
   * at the CLIENT. "core has no X" deserves a catalogue read every time.
   *
   * The adapter is typed against the producer's `MeRecord`, so a rename on
   * core/'s side becomes a compile error here rather than a blank name in a
   * greeting. It is a translation layer and should stay a small one: the right
   * end state is `types.ts` calling these fields what the wire calls them, and
   * that rename touches other sessions' files, so it is not in this hot path.
   */
  async me(): Promise<Me | null> {
    const outcome = await meOutcome();
    if ("refusal" in outcome) {
      if (outcome.refusal.status === 401) return null;
      throw outcome.refusal;
    }
    return { ...outcome.row, model_id: outcome.row.preferred_model };
  },
  /** M32: caller-owned platform-root status, safe for shell navigation. */
  async platformAccess(): Promise<{ platform_root: boolean }> {
    return cachedRead("platform-access", () => bff<{ platform_root: boolean }>("/api/platform/access"));
  },
  /** One-time root claim. The target email lives only in the core deployment config. */
  async bootstrapPlatformRoot(): Promise<{ claimed: boolean }> {
    return bff<{ claimed: boolean }>("/api/platform/bootstrap", { method: "POST" });
  },
  async platformOverview(): Promise<PlatformOverview> {
    return bff<PlatformOverview>("/api/platform/overview");
  },
  async platformOrganizations(query: { search?: string; offset?: number; limit?: number; deleted?: boolean } = {})
    : Promise<PlatformPage<PlatformOrganization>> {
    const params = new URLSearchParams();
    if (query.search?.trim()) params.set("search", query.search.trim());
    if (query.offset !== undefined) params.set("offset", String(query.offset));
    if (query.limit !== undefined) params.set("limit", String(query.limit));
    if (query.deleted) params.set("deleted", "true");
    const suffix = params.size ? `?${params}` : "";
    return bff<PlatformPage<PlatformOrganization>>(`/api/platform/organizations${suffix}`);
  },
  async platformUsers(query: { search?: string; offset?: number; limit?: number; deleted?: boolean } = {})
    : Promise<PlatformPage<PlatformUser>> {
    const params = new URLSearchParams();
    if (query.search?.trim()) params.set("search", query.search.trim());
    if (query.offset !== undefined) params.set("offset", String(query.offset));
    if (query.limit !== undefined) params.set("limit", String(query.limit));
    if (query.deleted) params.set("deleted", "true");
    const suffix = params.size ? `?${params}` : "";
    return bff<PlatformPage<PlatformUser>>(`/api/platform/users${suffix}`);
  },
  /** Instant purge (db/0083): NOW, objects first, root-walled twice. */
  async purgePlatformOrganization(id: string, reason: string): Promise<{ purged: boolean }> {
    return bff<{ purged: boolean }>(`/api/platform/organizations/${id}/purge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason }),
    });
  },

  async purgePlatformUser(id: string, reason: string): Promise<{ purged: boolean }> {
    return bff<{ purged: boolean }>(`/api/platform/users/${id}/purge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason }),
    });
  },

  /** Organizations are born in the console (db/0082) — root-walled. */
  async platformCreateOrg(name: string, reason: string): Promise<{ id: string | null }> {
    return bff<{ id: string | null }>("/api/platform/organizations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, reason }),
    });
  },

  async platformAudit(query: { offset?: number; limit?: number } = {})
    : Promise<PlatformPage<PlatformAuditEntry>> {
    const params = new URLSearchParams();
    if (query.offset !== undefined) params.set("offset", String(query.offset));
    if (query.limit !== undefined) params.set("limit", String(query.limit));
    const suffix = params.size ? `?${params}` : "";
    return bff<PlatformPage<PlatformAuditEntry>>(`/api/platform/audit${suffix}`);
  },
  async setPlatformOrganizationStatus(id: string, status: "active" | "suspended", reason: string) {
    return bff<{ changed: boolean }>(`/api/platform/organizations/${id}`, {
      method: "PATCH", body: JSON.stringify({ status, reason }), headers: { "content-type": "application/json" },
    });
  },
  async setPlatformUserStatus(id: string, status: "active" | "disabled", reason: string) {
    return bff<{ changed: boolean }>(`/api/platform/users/${id}`, {
      method: "PATCH", body: JSON.stringify({ status, reason }), headers: { "content-type": "application/json" },
    });
  },
  /** M32 edit: organisation metadata (name, interface locale). */
  async updatePlatformOrganization(id: string, patch: { name?: string; locale?: string | null }, reason: string) {
    return bff<{ changed: boolean }>(`/api/platform/organizations/${id}`, {
      method: "PATCH", body: JSON.stringify({ ...patch, reason }), headers: { "content-type": "application/json" },
    });
  },
  /** M32 edit: user identity metadata (names, handle, locale, org role) — email is auth-owned, never here. */
  async updatePlatformUser(
    id: string,
    patch: { display_name?: string; display_name_en?: string | null; username?: string | null; locale?: string | null; role?: string },
    reason: string,
  ) {
    return bff<{ changed: boolean }>(`/api/platform/users/${id}`, {
      method: "PATCH", body: JSON.stringify({ ...patch, reason }), headers: { "content-type": "application/json" },
    });
  },
  /** M32 soft-delete: organisation (7-day recovery window). */
  async softDeletePlatformOrganization(id: string, reason: string) {
    return bff<{ changed: boolean }>(`/api/platform/organizations/${id}`, {
      method: "DELETE", body: JSON.stringify({ reason }), headers: { "content-type": "application/json" },
    });
  },
  async restorePlatformOrganization(id: string, reason: string) {
    return bff<{ changed: boolean }>(`/api/platform/organizations/${id}/restore`, {
      method: "POST", body: JSON.stringify({ reason }), headers: { "content-type": "application/json" },
    });
  },
  /** M32 soft-delete: user (7-day recovery window). */
  async softDeletePlatformUser(id: string, reason: string) {
    return bff<{ changed: boolean }>(`/api/platform/users/${id}`, {
      method: "DELETE", body: JSON.stringify({ reason }), headers: { "content-type": "application/json" },
    });
  },
  async restorePlatformUser(id: string, reason: string) {
    return bff<{ changed: boolean }>(`/api/platform/users/${id}/restore`, {
      method: "POST", body: JSON.stringify({ reason }), headers: { "content-type": "application/json" },
    });
  },
  async grantPlatformRoot(userId: string, reason: string) {
    return bff<{ changed: boolean }>("/api/platform/roots", {
      method: "POST", body: JSON.stringify({ user_id: userId, reason }), headers: { "content-type": "application/json" },
    });
  },
  async revokePlatformRoot(userId: string, reason: string) {
    return bff<{ changed: boolean }>(`/api/platform/roots/${userId}`, {
      method: "DELETE", body: JSON.stringify({ reason }), headers: { "content-type": "application/json" },
    });
  },
  async org(): Promise<Org> {
    /* **LIVE** — `GET /api/admin/org` → core's `GET /v1/org` (the read is
       any-active-member; only the write is admin-gated). */
    return bff<Org>("/api/admin/org");
  },
  /**
   * **LIVE** — `PATCH /api/me` → core/'s `PATCH /v1/me` (M24 round 1).
   *
   * **Two different kinds of optional in one signature, and they are not
   * interchangeable.**
   *
   * The NAMES take `string | null`: `null` clears them, absent leaves them
   * alone, and core/ carries that distinction to SQL so that removing a Latin
   * name is expressible at all.
   *
   * The PREFERENCES do not. `auto` is the reset, so there is no unset state to
   * spell and core/ refuses `null` outright (`calendar_unknown` /
   * `timezone_unknown`). Typing them nullable here would give the client two
   * ways to say "default" — the exact ambiguity B1 removed at the column.
   *
   * `model_id` is still absent from this patch: it is a different route.
   * Riding along here would have been dropped in silence until core/ started
   * refusing unknown keys.
   */
  async updateProfile(patch: {
    display_name?: string;
    display_name_en?: string | null;
    username?: string | null;
    /** A `data:image/…;base64` URL ≤128KB (core refuses anything else); null removes the photo. */
    avatar_url?: string | null;
    calendar?: CalendarPreference;
    timezone?: string;
    locale?: string;
    job_title?: string | null;
    about?: string | null;
    assistant_context?: boolean;
  }): Promise<Me> {
    return bff<Me>("/api/me", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
  },

  /**
   * Display preferences — the same route as `updateProfile`, given its own
   * name because it is a different act.
   *
   * `PATCH /v1/me` carries both, and a caller changing their calendar has no
   * business being handed a signature that can also rename them. This is the
   * narrow door: whatever it is asked for, the only keys it can send are these
   * three. (Named `updatePreferences` because FE2's `lib/preferences.ts`
   * already calls it that — matching their call site rather than making them
   * chase a rename mid-flight.)
   *
   * **No nullable arguments, deliberately.** `auto` is the reset, so there is
   * nothing to clear; core/ refuses `null` with a named code. Accepting one
   * here would give the client a second spelling for the default.
   */
  async updatePreferences(patch: {
    calendar?: CalendarPreference;
    timezone?: string;
    locale?: string;
  }): Promise<Me> {
    return api.updateProfile(patch);
  },

  /**
   * The model preference (M5). **LIVE** — `PUT /api/models` → core's
   * `PUT /v1/models/preferred`, its own route deliberately separate from the
   * profile patch. `null` is a real value ("no choice") and survives the hop
   * as null. Returns the server's stored value, not an optimistic echo —
   * the last fixture body in this family, swapped by the 2026-08-20 tenancy
   * audit (a fixture write is a save that reports success while the setting
   * never moves, identically for every tenant).
   */
  async setPreferredModel(modelId: string | null): Promise<{ preferred_model: string | null }> {
    return bff<{ preferred_model: string | null }>("/api/models", {
      method: "PUT",
      body: JSON.stringify({ model: modelId }),
      headers: { "content-type": "application/json" },
    });
  },

  /**
   * UI language — **now wire-backed, and the correction is worth keeping.**
   *
   * I reported this as "core/ has no `locale` column, so there is nothing to
   * persist to" and built it client-only on that basis. B1 read the catalogue
   * instead of taking my word: `app_user.locale` existed all along, NOT NULL
   * default `fa`, and no query selected it. Stored and never served — which
   * from outside is indistinguishable from absent, and is why "there is no X"
   * deserves a catalogue read rather than an inference.
   *
   * Flagging rather than inventing a route was still the right call; the fix
   * was three lines of B1's, not a migration.
   *
   * The URL locale is what drives rendering. This makes the choice FOLLOW the
   * person to their next device instead of dying with the tab.
   */
  async setLocale(locale: string): Promise<Me> {
    return api.updateProfile({ locale });
  },

  // ---- calls -----------------------------------------------------------------
  /**
   * **LIVE** — `GET /api/calls`.
   *
   * **The visibility filter is GONE, and its removal is the point.** It used to
   * re-derive the RLS rule here (own + org-scoped, admins read all) against
   * fixtures. Kept against a live wire it would be a second implementation of
   * an access rule — one that can only ever be wrong, because rows the caller
   * may not see never arrive to be filtered. A client-side permission check
   * over server-filtered data is decoration that reads as enforcement.
   *
   * **Archived rows are filtered HERE, and that is not a shortcut.** core/'s
   * list has no archived parameter: it returns archived calls alongside the
   * rest, always. So `includeArchived` is a genuine client concern, on
   * `archived_at` — a timestamp, where null is the un-archived state, because
   * *when* carries more than *whether*.
   *
   * **Soft-deleted calls never arrive** — core/'s list is `deleted_at is null`,
   * unconditionally. So the deleted-calls card renders empty against live data
   * no matter who is looking, exactly as its own header predicted. That is not
   * this function's bug to fix and it must not be papered over here.
   */
  async listCalls(opts?: { includeArchived?: boolean }): Promise<Call[]> {
    const rows = await bff<Call[]>("/api/calls");
    return opts?.includeArchived ? rows : rows.filter((c) => c.archived_at === null);
  },

  /**
   * **LIVE** — the Part 5 upload wire: create → sign → PUT → register →
   * finish. Bytes go from the browser STRAIGHT to storage on a signed URL
   * core mints (Vercel's request ceiling is smaller than one part, so they
   * can never ride the BFF); everything that carries identity stays
   * server-side.
   */
  /** Resume a FAILED call's pipeline — the retry door (2026-08-22). */
  async retryCall(callId: string): Promise<{ status: string; resumed_at: string; parts: number }> {
    return bff<{ status: string; resumed_at: string; parts: number }>(
      `/api/calls/${callId}/retry`, { method: "POST" });
  },

  /** Regenerate a READY call's summary as a NEW version (2026-08-23) —
      optionally shaped by a ruled template and/or an instruction. */
  /** **LIVE** — delete ONE summary version (db/0095: owner or admin). */
  async deleteSummaryVersion(callId: string, version: number): Promise<void> {
    await bff(`/api/calls/${callId}/summaries/${version}`, { method: "DELETE" });
  },
  async resummarize(
    callId: string,
    opts: { template?: string; instruction?: string; figures?: boolean; label?: string } = {},
  ): Promise<{ id: string; status: string }> {
    return bff<{ id: string; status: string }>(`/api/calls/${callId}/summaries`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(opts),
    });
  },

  /** Notes & chapters on a call (0079) — annotations, never the record. */
  async callNotes(callId: string): Promise<CallNote[]> {
    return bff<CallNote[]>(`/api/calls/${callId}/notes`);
  },

  async addCallNote(
    callId: string,
    input: { kind: "note" | "chapter"; at_ms?: number | null; body: string },
  ): Promise<CallNote> {
    return bff<CallNote>(`/api/calls/${callId}/notes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  },

  async deleteCallNote(noteId: string): Promise<void> {
    await bff<null>(`/api/notes/${noteId}`, { method: "DELETE" });
  },

  /** Which external sign-in methods are enabled (0078). Public read. */
  async authMethods(): Promise<{ provider: string; enabled: boolean }[]> {
    return bff<{ provider: string; enabled: boolean }[]>("/api/auth-methods");
  },

  /** Flip one sign-in method — admin/owner; the wall is core's + SQL's. */
  async setAuthMethod(
    provider: "google" | "github",
    enabled: boolean,
  ): Promise<{ provider: string; enabled: boolean }> {
    return bff<{ provider: string; enabled: boolean }>(
      `/api/auth-methods/${provider}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled }),
      },
    );
  },

  async createCall(input: {
    title?: string;
    scope?: "private" | "org";
    source: "web" | "upload";
    language?: "fa" | "en" | "mixed";
    /** 0094: ruled template key, or a custom template's NAME when
        `summary_instruction` carries its prompt */
    summary_template?: string;
    summary_instruction?: string;
    /** 0099: model id for this meeting's summaries; omit = the ladder */
    summary_model?: string;
  }): Promise<{ id: string }> {
    return bff<{ id: string }>("/api/calls", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  },

  async signCallPart(
    callId: string,
    input: { idx: number; content_type: string },
  ): Promise<{ upload_url: string; path: string; content_type: string }> {
    return bff(`/api/calls/${callId}/parts/sign`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  },

  /**
   * The one browser→storage hop in the product. Plain fetch, not `bff`: the
   * URL IS the credential (single object, expiring), no session cookie or
   * token travels, and the response body is not consulted beyond ok-ness.
   */
  async putSignedPart(uploadUrl: string, blob: Blob, contentType: string): Promise<void> {
    const response = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "content-type": contentType },
      body: blob,
    });
    if (!response.ok) {
      throw new BffError(response.status, "upstream", `upload failed (${response.status})`);
    }
  },

  async registerCallPart(
    callId: string,
    input: { idx: number; offset_ms: number; path: string },
  ): Promise<{ part_id: string }> {
    return bff(`/api/calls/${callId}/parts/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  },

  async finishCall(
    callId: string,
    /** M40: the live-caption text — the instant preview while the pipeline runs. */
    provisional?: string,
  ): Promise<{ id: string; status: string }> {
    if (provisional?.trim()) {
      return bff(`/api/calls/${callId}/finish`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provisional_transcript: provisional }),
      });
    }
    return bff(`/api/calls/${callId}/finish`, { method: "POST" });
  },

  /**
   * **LIVE** — on-demand English translation of a call's summary or
   * transcript, through the /translator system skill (0063). Display-only:
   * nothing is persisted; the run is the record.
   */
  async translateCall(
    callId: string,
    what: "summary" | "transcript",
    model?: string,
  ): Promise<{ text: string; model: string }> {
    return bff(`/api/calls/${callId}/translate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ what, model }),
    });
  },

  /**
   * **LIVE** — signed playback URLs, one per part, expiring. `null` for a
   * 404: no audio is an ANSWER (not yours / not there / nothing uploaded),
   * and the player simply doesn't offer itself.
   */
  async getCallAudio(
    callId: string,
  ): Promise<{ parts: { idx: number; offset_ms: number; url: string }[] } | null> {
    try {
      return await bff(`/api/calls/${callId}/audio`);
    } catch (error) {
      if (error instanceof BffError && error.status === 404) return null;
      throw error;
    }
  },

  /**
   * **LIVE** — `GET /api/calls/{id}`, which core/ answers with the call plus
   * its parts.
   *
   * `null` for a 404, and the 404 is an ANSWER rather than a fault: core/
   * returns the same status for a call that does not exist and one the caller
   * may not see, deliberately, so ids cannot be probed. The screen shows "not
   * found" for both, which is the only honest rendering of a deliberately
   * ambiguous answer.
   */
  async getCall(id: string): Promise<Call | null> {
    try {
      return await bff<Call>(`/api/calls/${id}`);
    } catch (error) {
      if (error instanceof BffError && error.status === 404) return null;
      throw error;
    }
  },

  /**
   * **LIVE** — `PATCH /api/calls/{id}`.
   *
   * Only `scope` and `title` exist on that route. An `archived` key here would
   * be accepted by our BFF and dropped in silence by core/, which is why
   * archiving goes through its own verb (see `setArchived`).
   */
  async setScope(id: string, scope: CallScope): Promise<Call> {
    return bff<Call>(`/api/calls/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope }),
    });
  },
  /** **LIVE** — `POST /api/calls/:id/archive` with `{archived}`, core's two
   *  verbs behind one flag (the timestamp is the server's to write). */
  async setArchived(id: string, archived: boolean): Promise<void> {
    await bff(`/api/calls/${id}/archive`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ archived }),
    });
  },

  /** **LIVE** — rename through the same PATCH that carries scope. */
  async setCallTitle(id: string, title: string): Promise<Call> {
    return bff<Call>(`/api/calls/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title }),
    });
  },
  /** 0092: a human's summary edit — a NEW version authored 'human'. */
  async editSummary(id: string, body: string): Promise<{ version: number }> {
    return bff<{ version: number }>(`/api/calls/${id}/summaries/edit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body }),
    });
  },
  /** 0092: a human's transcript correction — line kept, words cleared. */
  async editSegment(callId: string, segmentId: string, text: string): Promise<void> {
    await bff<{ ok: boolean }>(`/api/calls/${callId}/segments/${segmentId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
  },
  /** 0086: replace the record's tag set (whole-list write, ≤10, ≤40 chars).
      409 not_migrated until the column exists on the deployment. */
  async setCallTags(id: string, tags: string[]): Promise<Call> {
    return bff<Call>(`/api/calls/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tags }),
    });
  },
  /**
   * Soft delete with a purge window (M11). Never the agent's path.
   *
   * **Both work now** — db/0032 + 0033 fixed the row policy that had made a
   * call invisible to its own owner the instant it was marked deleted. Live
   * behaviour, verified by core/: owner deletes → 204; deletes again → 204,
   * **idempotent, so a double-click is harmless**; reads it back → 404;
   * owner tries to restore → 404 *and it raises*, where before it matched
   * zero rows and returned success-shaped silence.
   *
   * **Restore is ADMIN-ONLY, and that is ruled, not missing** (Q2: deletion
   * should feel like deletion). An owner must not be shown a restore path.
   * Whether owners may undo their own deletions is with the steward; if it
   * flips it is a one-line change on the server, so don't design around
   * either answer.
   *
   * These stay fixture-backed only until the swap lands with the rest of the
   * write path — no longer because anything is broken.
   */
  async deleteCall(id: string, reason: string): Promise<void> {
    /* **LIVE** — the M11 named door: owner deletes their own, admin any;
       idempotent 204. The REASON rides into the deletion ledger (0085). */
    await bff(`/api/calls/${id}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason }),
    });
  },
  async restoreCall(id: string): Promise<void> {
    /* **LIVE** — admin-only by the user's ruling; a member's attempt gets
       core's 404, indistinguishable from "no such call" on purpose. */
    await bff(`/api/calls/${id}/restore`, { method: "POST" });
  },

  // ---- transcript & speakers --------------------------------------------------
  /**
   * **LIVE** — `GET /api/calls/{id}/transcript`, unwrapped from core/'s
   * `{call_id, segments}`.
   *
   * **An empty array here means "this call has no words", and that is a real
   * claim** — core/ 404s an invisible call before it ever reaches the segment
   * read, precisely so the two cannot be confused. The rejection propagates
   * rather than being swallowed into `[]`: a transcript that failed to load
   * must not render as a meeting where nobody spoke.
   */
  async getTranscript(callId: string): Promise<TranscriptSegment[]> {
    const { segments } = await bff<{ call_id: string; segments: TranscriptSegment[] }>(
      `/api/calls/${callId}/transcript`,
    );
    return segments;
  },
  // correctLine was DELETED here (2026-08-20 tenancy audit), not swapped: it
  // had zero callers and no server wire — a fixture that mutated a local copy
  // and returned `true`, i.e. a user's correction reported as saved and lost
  // on reload. Direct transcript correction re-enters through the agent's
  // propose→confirm path (write-tools correct_transcript) when a screen needs
  // it; a silent-success stub must not be the thing it finds waiting.
  /** **LIVE** — `GET /api/calls/{id}/speakers` (the BFF unwraps the envelope). */
  async getSpeakers(callId: string): Promise<Speaker[]> {
    return bff<Speaker[]>(`/api/calls/${callId}/speakers`);
  },
  /** **LIVE** — rename the transcript's word for a voice («S1» → anything). */
  async renameSpeaker(callId: string, speakerId: string, label: string): Promise<void> {
    await bff(`/api/calls/${callId}/speakers/${speakerId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label }),
    });
  },
  /** **LIVE** — attach a directory person to a voice (null UNLINKS). */
  async linkSpeaker(callId: string, speakerId: string, personId: string | null): Promise<void> {
    await bff(`/api/calls/${callId}/speakers/${speakerId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ person_id: personId }),
    });
  },
  /** **LIVE** — the people directory (0062): names + titles, RLS-scoped. */
  async directory(): Promise<Person[]> {
    // cached like the bare member list (2026-08-23 speed pass): speaker
    // dropdowns on every call page re-ask this; writes clear the cache
    return cachedRead("directory", () => bff<Person[]>("/api/directory"));
  },
  async createPerson(displayName: string, title: string): Promise<Person> {
    return bff<Person>("/api/directory", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ display_name: displayName, title }),
    });
  },
  async updatePerson(
    id: string,
    /**
     * db/0096: `team: ""` clears it, an absent team leaves it alone.
     * db/0005's link (written since 2026-08-26): `app_user_id: null`
     * CLEARS it — "not a member after all" is an answer — and an absent
     * one leaves it alone. JSON.stringify keeps an explicit null and
     * drops nothing, so the two states survive the wire.
     */
    patch: {
      display_name?: string;
      title?: string;
      team?: string;
      app_user_id?: string | null;
    },
  ): Promise<Person> {
    return bff<Person>(`/api/directory/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
  },
  /* mergePerson LEFT the client (user directive, 2026-08-26: "remove the
     merge option"). The server op and its definer door survive — a merge
     is still the right repair for a genuine duplicate, and support can
     run it — but the product no longer offers it, so nothing here calls
     it. Recorded HERE, at the consumer, because a deliberate absence
     noted only where it was removed is invisible to whoever comes looking
     for the method. */
  /** admin/owner-only true delete (db/0076); 409 not_migrated pre-0076 */
  async deletePerson(id: string, reason: string): Promise<void> {
    await bff(`/api/directory/${id}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason }),
    });
  },

  /**
   * Voice enrollment (M39): the clip's bytes travel raw; the platform
   * stores only the VECTOR. Admin/owner — the directory-edit wall.
   */
  async enrollVoice(personId: string, clip: Blob): Promise<{ enrolled: boolean; speech_ms: number }> {
    return bff<{ enrolled: boolean; speech_ms: number }>(
      `/api/directory/${personId}/voice`,
      { method: "POST", headers: { "content-type": clip.type || "application/octet-stream" }, body: clip },
    );
  },

  async clearVoice(personId: string): Promise<void> {
    await bff(`/api/directory/${personId}/voice`, { method: "DELETE" });
  },

  /**
   * **LIVE** — whose voice is this? A snippet in, a directory person out,
   * or `person_id: null` with the reason. Read-only on the server: it
   * stores no audio, no vector, and links nothing. Only people who
   * enrolled can come back from it — a print IS the consent to be
   * recognised.
   */
  async matchVoice(clip: Blob): Promise<{
    person_id: string | null;
    display_name?: string | null;
    score?: number;
    why?: string;
  }> {
    return bff("/api/voice/match", {
      method: "POST",
      headers: { "content-type": clip.type || "application/octet-stream" },
      body: clip,
    });
  },

  // ---- summaries --------------------------------------------------------------
  /**
   * **LIVE** — `GET /api/calls/{id}/summaries`, newest first.
   *
   * Regenerating APPENDS a version and moves the pointer; it never destroys
   * the previous one, so this list only grows. Each entry carries the model
   * that produced it — the provenance invariant, and the reason the history is
   * a list rather than a single current row.
   */
  async getSummaries(callId: string): Promise<SummaryVersion[]> {
    const { summaries: rows } = await bff<{ summaries: SummaryVersion[] }>(
      `/api/calls/${callId}/summaries`,
    );
    return rows;
  },

  // ---- search -----------------------------------------------------------------
  /**
   * **LIVE** — `/api/search` → core's `/v1/search` (Persian-folded matching,
   * `<mark>` highlights on the RAW text — a fold-only hit legitimately comes
   * back unmarked and the page renders it as one plain chunk). This body
   * generated fixture hits from the query for months, which is why "search
   * does not work": the box searched an invented corpus and looked alive.
   */
  async search(query: string): Promise<SearchHit[]> {
    const q = query.trim();
    if (q.length < 2) return []; // core 400s below 2 chars — don't ask
    const { hits } = await bff<{ hits: SearchHit[] }>(
      `/api/search?q=${encodeURIComponent(q)}`,
    );
    return hits;
  },

  // ---- models & skills ---------------------------------------------------------
  /**
   * The picker's view — core/'s real `/v1/models` shape. The allow-list
   * intersection happens server-side, so this maps rather than filters, and
   * `tool_capability_filtered` is false because nothing filters on tool
   * support: the catalogue carries no such field and core/ refused to ship a
   * heuristic that would look like enforcement.
   */
  async models(): Promise<ModelsResponse> {
    /* **LIVE** — `/api/models` → `/v1/models`: the catalogue already
       intersected with the org allow-list AND the structural no-Claude
       filter, both core's. This layer filters nothing. Cached: the
       catalogue changes when an admin curates, which is a write and
       clears the cache. */
    return cachedRead("models", () => bff<ModelsResponse>("/api/models"));
  },
  /** **LIVE** — the curation menu: the whole offered catalogue + allow flags. */
  async adminModels(): Promise<AdminModelRow[]> {
    const { models } = await bff<{ models: AdminModelRow[] }>("/api/admin/models");
    return models;
  },
  /**
   * Toggle one model in the org's allow-list — **LIVE**, with the recorded
   * lost-update decision now TAKEN: re-read before write. Curation is one
   * `allowed_models` array on the org (the field is the unit), so a toggle
   * composes the whole next list; composing it from stale rows meant two
   * admins clobbering each other's edits wholesale. The fresh read narrows
   * that window to the round trip — an accepted residual risk, stated here,
   * chosen over a concurrency token the org form doesn't have either.
   */
  async setModelAllowed(id: string, allowed: boolean): Promise<AdminModelRow[]> {
    const fresh = await api.adminModels();
    const next = fresh
      .filter((m) => (m.id === id ? allowed : m.allowed))
      .map((m) => m.id);
    await api.updateOrg({ allowed_models: next });
    return api.adminModels();
  },
  async skills(): Promise<Skill[]> {
    /* **LIVE** — `/api/skills` → `/v1/skills`, the resolver ladder's view
       (system / org / user, most specific wins). Core sends a WRAPPER; the
       first swap typed it as a bare array and `skills.length` read
       undefined — the picker silently never rendered (rule 10's shape,
       caught by reading the producer). Cached under ONE key with
       assistantTools — same response, one request for both. */
    const { skills } = await cachedRead("skills", () =>
      bff<{ skills: Skill[]; available_tools?: string[] }>("/api/skills"));
    return skills;
  },
  /** **LIVE** — the assistant's tool vocabulary, from the same wrapper. */
  async assistantTools(): Promise<string[]> {
    const { available_tools } = await cachedRead("skills", () =>
      bff<{ skills: Skill[]; available_tools?: string[] }>("/api/skills"));
    return available_tools ?? [];
  },

  // ---- persistent agents, workflows & private connectors (M30) -------------
  async agents(): Promise<AgentCard[]> {
    const { agents } = await bff<{ agents: AgentCard[] }>("/api/agents");
    return agents;
  },
  async createAgent(input: {
    level: "org" | "user";
    name: string;
    description?: string;
    instructions: string;
    model?: string | null;
    tools?: string[];
    icon?: string;
    color?: string;
    web?: boolean;
  }): Promise<AgentCard> {
    return bff<AgentCard>("/api/agents", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
    });
  },
  /**
   * M47 — the editor's save. `patch` carries ONLY the fields the person
   * changed (the org-form precedent: diff-based send, so a stale screen
   * cannot clobber a colleague's edit with old values it never touched).
   * `instructions` never reads back over the wire — absent here means KEEP,
   * which is the platform's patch contract and the only honest option for a
   * write-only field.
   */
  async updateAgent(id: string, patch: Partial<{
    name: string;
    description: string;
    instructions: string;
    model: string | null;
    tools: string[];
    icon: string;
    color: string;
    web: boolean;
  }>): Promise<AgentCard> {
    return bff<AgentCard>(`/api/agents/${encodeURIComponent(id)}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch),
    });
  },
  /** M47 — what an agent carries, for the overview that opens with it. */
  async agentWorkflows(id: string): Promise<AgentWorkflowLink[]> {
    const { workflows } = await bff<{ workflows: AgentWorkflowLink[] }>(
      `/api/agents/${encodeURIComponent(id)}/workflows`);
    return workflows;
  },
  /** M47 — whole-set write (the producer's contract); answers the set as it
      now stands, so the caller adopts the server's truth rather than its own. */
  async setAgentWorkflows(id: string, workflowIds: string[]): Promise<AgentWorkflowLink[]> {
    const { workflows } = await bff<{ workflows: AgentWorkflowLink[] }>(
      `/api/agents/${encodeURIComponent(id)}/workflows`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workflow_ids: workflowIds }),
      });
    return workflows;
  },
  async workflows(): Promise<WorkflowCard[]> {
    const { workflows } = await bff<{ workflows: WorkflowCard[] }>("/api/workflows");
    return workflows;
  },
  /** Org-authored workflow (0072) — admin-gated server-side. */
  async createWorkflow(input: {
    name: string; description?: string;
    source_kind: "calendar_event" | "mail_message"; instructions: string;
  }): Promise<WorkflowCard> {
    return bff<WorkflowCard>("/api/workflows", {
      method: "POST", body: JSON.stringify(input), headers: { "content-type": "application/json" },
    });
  },
  async connectors(): Promise<ConnectorStatus[]> {
    const { connectors } = await bff<{ connectors: ConnectorStatus[] }>("/api/connectors");
    return connectors;
  },
  async connectorItems(
    provider: ConnectorProvider,
    /* the wire's own vocabulary for `GET /v1/connectors/:provider/:source` —
       drive and meet joined it with M47 (google-only lenses; the server 400s
       them for microsoft, so the detail page never offers them there) */
    source: "calendar" | "mail" | "drive" | "meet",
  ): Promise<ConnectorItem[]> {
    const { items } = await bff<{ items: ConnectorItem[] }>(
      `/api/connectors/${encodeURIComponent(provider)}/${source}`,
    );
    return items;
  },
  /**
   * Disconnect one provider (M47): revokes the grant at the provider, empties
   * the stored credential, marks the row revoked. Reconnecting afterwards is
   * the ordinary connect flow. Destructive by name on purpose — the confirm
   * guard derives its list from this file, so every caller must ask first in
   * the theme's one dialog.
   */
  async disconnectConnector(provider: ConnectorProvider): Promise<void> {
    await bff<undefined>(`/api/connectors/${encodeURIComponent(provider)}`, { method: "DELETE" });
  },
  async connectorAuthorization(provider: ConnectorProvider, locale: "fa" | "en"): Promise<string> {
    const { authorization_url } = await bff<{ authorization_url: string }>(
      `/api/connectors/${encodeURIComponent(provider)}/authorization`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ locale }) },
    );
    return authorization_url;
  },

  // ---- skill authoring (M29, Part 2) ----------------------------------------
  /** **LIVE** — the editor's rows (full definitions) + the tool vocabulary. */
  async manageSkills(): Promise<{ skills: AuthoredSkill[]; available_tools: string[] }> {
    return bff("/api/skills/manage");
  },
  /** **LIVE** — create. Core owns every rule and names every refusal. */
  async createSkill(input: {
    level: "org" | "user";
    slug: string;
    name: string;
    prompt: string;
    description?: string;
    model?: string | null;
    tools?: string[];
    starter_questions?: string[];
    max_tool_calls?: number | null;
  }): Promise<AuthoredSkill> {
    return bff<AuthoredSkill>("/api/skills", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  },
  /** **LIVE** — edit. Absent = leave alone; `model: null` clears the pin. */
  async updateSkill(
    id: string,
    patch: {
      name?: string;
      description?: string;
      prompt?: string;
      model?: string | null;
      tools?: string[];
      starter_questions?: string[];
      enabled?: boolean;
      max_tool_calls?: number | null;
    },
  ): Promise<AuthoredSkill> {
    return bff<AuthoredSkill>(`/api/skills/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
  },
  /** **LIVE** — archive/unarchive, the product's whole delete (db/0018). */
  async archiveSkill(id: string, archived: boolean): Promise<AuthoredSkill> {
    return bff<AuthoredSkill>(`/api/skills/${id}/archive`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ archived }),
    });
  },

  // ---- admin --------------------------------------------------------------------
  /**
   * **Server-side.** Never filter a fetched page in the browser: once the
   * endpoint pages, a client-side filter searches only the rows that happen
   * to have arrived and reports the result as if it searched everything —
   * a total that is confidently wrong rather than visibly missing.
   *
   * `search` spans `display_name`, `display_name_en`, `username` and email
   * server-side, which is the both-names rule enforced where the data lives:
   * someone who knows a colleague only by their Latin spelling and someone
   * who knows only the Persian one are looking for the same person.
   *
   * `sort: "default"` keeps **pending on top** — it is what an admin opens
   * this screen to act on, and burying it under an alphabetical list is how
   * someone waits a week for approval. `last_seen` sorts nulls last, matching
   * the never-seen rendering.
   */
  async members(query?: {
    search?: string;
    status?: UserStatus;
    role?: Role;
    sort?: MemberSort;
  }): Promise<User[]> {
    /*
     * **LIVE** — `GET /api/admin/members`, forwarded param-for-param to
     * `GET /v1/admin/members`. Nothing is filtered or re-sorted on this side:
     * the server owns the query (searching the four identity columns,
     * pending-first default, nulls-last `last_seen`), and a client that
     * re-sorted would quietly undo the pending-on-top decision the sort
     * exists for.
     */
    const params = new URLSearchParams();
    if (query?.search) params.set("search", query.search);
    if (query?.status) params.set("status", query.status);
    if (query?.role) params.set("role", query.role);
    if (query?.sort) params.set("sort", query.sort);
    const suffix = params.size > 0 ? `?${params}` : "";
    /*
     * The BARE listing (no query) is cached briefly (user directive,
     * 2026-08-23 speed pass): it is what every table re-fetches per
     * navigation just to resolve owner names. QUERIED listings — the
     * Management screen someone is acting on — stay uncached, and any
     * write still clears the whole cache, so acting on the list is
     * always answered by a fresh read.
     */
    if (suffix === "") {
      const { members } = await cachedRead("members", () =>
        bff<{ members: User[] }>("/api/admin/members"));
      return members;
    }
    const { members } = await bff<{ members: User[] }>(`/api/admin/members${suffix}`);
    return members;
  },
  /**
   * **LIVE** — `GET /api/admin/members/stats`, a SEPARATE unfiltered read.
   *
   * Deliberately not derived from whatever `members(query)` returned:
   * tiles that move when you type describe the QUERY, not the organisation.
   * That is the counting lie one level up from client-side filtering, and it
   * is worse because a filtered total still looks like a fact about the org.
   *
   * `trend.history_since === null` travels through untouched — it means the
   * history log was not recording, and the UI renders "—" rather than a
   * fabricated zero.
   */
  /**
   * MEMBER PRIVILEGES (db/0101). The vocabulary travels WITH the decisions
   * — a client holding its own copy of the capability list would drift
   * from the routes that enforce it, and the drift would show as a switch
   * for something nothing checks.
   */
  async capabilities(): Promise<CapabilityState> {
    return bff<CapabilityState>("/api/admin/capabilities");
  },

  async setCapability(
    role: string,
    capability: string,
    allowed: boolean,
  ): Promise<CapabilityState> {
    return bff<CapabilityState>("/api/admin/capabilities", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role, capability, allowed }),
    });
  },

  /* memberStats LEFT the client (user directive, 2026-08-26: the three
     counter tiles at the top of Management · Users were removed). The
     SERVER route survives — a count of an org's members is a real
     question and something will ask it again — but nothing in the product
     asks it today, and a client method with no caller is the shape this
     codebase has shipped defects behind before. Recorded here, at the
     consumer, because that is where the next person looks for it. */

  /**
   * **LIVE** — `POST /api/admin/members/:id` → core's accept. Acceptance has
   * its OWN endpoint rather than being `setUserStatus(id, "active")`: core's
   * PATCH refuses pending members wholesale (`status <> 'pending'` in the
   * update), so activation cannot happen through a general-purpose edit —
   * and a client that spelled accept as a status write would 404 against
   * the real wire while passing against any fixture.
   */
  async acceptMember(id: string): Promise<User> {
    return bff<User>(`/api/admin/members/${id}`, { method: "POST" });
  },
  /**
   * **LIVE** — `DELETE /api/admin/members/:id` → tombstone. This is what
   * "reject" is on the real wire: a pending member cannot be PATCHed (see
   * acceptMember) and there is no softer refuse-registration op — the
   * owner-only true delete is the one door. Callers hide the button from
   * non-owners rather than letting them collect a 403.
   */
  async rejectMember(id: string, reason: string): Promise<void> {
    await fetch(`/api/admin/members/${id}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason }),
    }).then((r) => {
      if (!r.ok) throw new BffError(r.status);
    });
  },
  /** **LIVE** — `PATCH /api/admin/members/:id` with `{status}` (decided members only). */
  async setUserStatus(id: string, status: "active" | "disabled"): Promise<User> {
    return bff<User>(`/api/admin/members/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
  },
  /** **LIVE** — admin rename (0064-era): display name and/or username;
   *  `username: null` clears. Core owns the format and the taken/retired
   *  distinction; the refusal's own sentence is what the form shows. */
  async renameMember(
    id: string,
    patch: { display_name?: string; username?: string | null },
  ): Promise<User> {
    return bff<User>(`/api/admin/members/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
  },
  /** **LIVE** — `PATCH /api/admin/members/:id` with `{role}` (owner not assignable, M23). */
  async setUserRole(id: string, role: Role): Promise<User> {
    return bff<User>(`/api/admin/members/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role }),
    });
  },

  // ---- invitations (D23–D25, Part 4) -----------------------------------------
  /** **LIVE** — the org's invitations, prefixes only. */
  async invitations(): Promise<Invitation[]> {
    const { invitations } = await bff<{ invitations: Invitation[] }>("/api/admin/invitations");
    return invitations;
  },
  /** **LIVE** — issue. The token comes back HERE and never again. */
  async createInvitation(email: string, role?: Role, ttlDays?: number): Promise<MintedInvitation> {
    return bff<MintedInvitation>("/api/admin/invitations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, role, ttl_days: ttlDays }),
    });
  },
  /** **LIVE** — revoke; re-inviting is a fresh issue (terms immutable, D24). */
  async revokeInvitation(id: string): Promise<Invitation> {
    return bff<Invitation>(`/api/admin/invitations/${id}/revoke`, { method: "POST" });
  },
  /**
   * Rename / re-locale / re-curate the org — `PATCH /v1/admin/org`.
   *
   * **Not `Partial<Pick<Org, …>>` any more, and not nullable.** Three separate
   * corrections live in this one signature:
   *
   *  - `default_call_scope` is gone. It is not on `OrgRecord` and core/'s
   *    update does not accept it, so the old body sent the one field the
   *    server ignores while omitting the two it takes. A save that changes
   *    nothing and reports success.
   *  - `allowed_models` belongs HERE. Model curation is a field on the org,
   *    not its own endpoint; `setModelAllowed` used to aim at
   *    `/v1/admin/models/{id}`, which has never been registered.
   *  - **No `| null`.** core/ updates with `coalesce($n, column)` and every one
   *    of these columns is NOT NULL — there is no clear operation to express.
   *    Omission already means "leave alone", so a nullable parameter would be
   *    a SECOND spelling of it, which is the two-spellings problem we removed
   *    from the preference fields a few hours ago. (FE3 proposed
   *    `name?: string | null`; the coalesce is why it should not be.)
   *
   * Still a fixture: the BFF route needs its GET corrected first — it asks for
   * `/v1/admin/org`, the one path core/ deliberately never registered, and the
   * truthful 404 got recorded as "the feature isn't built".
   */
  async updateOrg(patch: {
    name?: string;
    locale?: string;
    allowed_models?: string[];
    glossary?: string[];
    /* db/0102's public face. Declared here rather than cast at the call
       site: a cast against a wire type is a drift report somebody decided
       not to file, and this one had a real cost — the BFF was dropping
       every key beyond the first three and the save returned a 400 that
       read as "the feature is not built". */
    public_email?: string | null;
    description?: string | null;
    website_url?: string | null;
    location?: string | null;
    logo_url?: string | null;
    social_links?: string[] | null;
    /** db/0075 — the workspace's autonomy cap. Wire field kept; the control
        left with the dial (2026-08-28 directive) and nothing sends it. */
    autonomy_ceiling?: string;
    /** db/0112 — the invitation domain wall; [] clears it. */
    allowed_email_domains?: string[];
  }): Promise<Org> {
    /* **LIVE** — `PATCH /api/admin/org` → `PATCH /v1/admin/org` (admin). */
    return bff<Org>("/api/admin/org", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
  },

  /**
   * THE ORG LOGO — a real file (db/0103).
   *
   * Bytes up, bytes down, its own route: the org row is read on every page
   * that shows the organisation's name, and half a megabyte riding that
   * read would be paid for on every navigation. `has_logo` on the record
   * says whether there is one; this URL serves it.
   *
   * The MIME the image comes back under is the one core SNIFFED from the
   * file, never the one the uploader claimed.
   */
  async uploadOrgLogo(file: Blob): Promise<{ uploaded: boolean; mime: string }> {
    return bff<{ uploaded: boolean; mime: string }>("/api/org/logo", {
      method: "POST",
      headers: { "content-type": file.type || "application/octet-stream" },
      body: file,
    });
  },

  async clearOrgLogo(): Promise<void> {
    await bff("/api/org/logo", { method: "DELETE" });
  },

  /**
   * Where the current logo lives. `version` is a cache-buster, not a
   * parameter the server reads: the URL never changes when the image does,
   * so without it a fresh upload keeps showing the old picture and the
   * screen quietly disagrees with the record.
   */
  orgLogoUrl(version = 0): string {
    return version > 0 ? `/api/org/logo?v=${version}` : "/api/org/logo";
  },

  /**
   * M41 P1 — the workflow engine's manual trigger and run ledger.
   * **LIVE** — `/api/workflows/…` → core `/v1/workflows/…`.
   */
  async runWorkflow(ref: string): Promise<{ run_id: string; status: string }> {
    return bff<{ run_id: string; status: string }>(
      `/api/workflows/${encodeURIComponent(ref)}/run`,
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
    );
  },

  /** M41 - the runnable engine catalogue (the Run button's honest source). */
  async engineWorkflows(): Promise<{ id: string; handle: string; name: string; description: string }[]> {
    const { workflows } = await bff<{ workflows: { id: string; handle: string; name: string; description: string }[] }>(
      "/api/workflows/engine");
    return workflows;
  },

  async workflowRuns(): Promise<WorkflowRunRecord[]> {
    const { runs } = await bff<{ runs: WorkflowRunRecord[] }>("/api/workflows/runs");
    return runs;
  },

  async workflowRun(id: string): Promise<WorkflowRunDetail> {
    return bff<WorkflowRunDetail>(`/api/workflows/runs/${encodeURIComponent(id)}`);
  },

  /** M41 P3/W14 — the decision, on the run, by its owner. */
  async decideWorkflowRun(
    id: string, stepId: string, decision: "approve" | "reject",
  ): Promise<{ decision: string; resumed: boolean }> {
    return bff(`/api/workflows/runs/${encodeURIComponent(id)}/decide`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ step_id: stepId, decision }),
    });
  },

  /** M41 P5 — the builder (admin; core holds the walls). */
  async authoredWorkflows(): Promise<AuthoredWorkflow[]> {
    const { workflows } = await bff<{ workflows: AuthoredWorkflow[] }>("/api/workflows/manage");
    return workflows;
  },
  async createAuthoredWorkflow(input: { name: string; description?: string }): Promise<AuthoredWorkflow> {
    return bff<AuthoredWorkflow>("/api/workflows/manage", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  },
  async patchWorkflow(
    id: string,
    patch: { enabled?: boolean; name?: string; trigger_event?: string | null; current_version_id?: string },
  ): Promise<AuthoredWorkflow> {
    return bff<AuthoredWorkflow>(`/api/workflows/manage/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
  },
  /** remove a workflow — core archives it, so its runs stay readable */
  async removeWorkflow(id: string): Promise<void> {
    await bff<void>(`/api/workflows/manage/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
  async publishWorkflow(
    id: string, body: { graph: unknown; max_autonomy: string },
  ): Promise<{ version: number; version_id: string }> {
    return bff(`/api/workflows/manage/${encodeURIComponent(id)}/publish`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  },
  async workflowGraph(id: string): Promise<{ graph: unknown; max_autonomy: string }> {
    return bff(`/api/workflows/manage/${encodeURIComponent(id)}/graph`);
  },
  async autoApplyRules(): Promise<{ kind: string; allowed: boolean }[]> {
    const { rules } = await bff<{ rules: { kind: string; allowed: boolean }[] }>("/api/workflows/auto-apply");
    return rules;
  },
  /**
   * M43 — the replies waiting for a person. `session` narrows to the ones
   * written in one conversation, which is how the thread shows its own.
   */
  async mailDrafts(filter: { status?: string; session?: string } = {}): Promise<MailDraft[]> {
    const query = new URLSearchParams();
    if (filter.status) query.set("status", filter.status);
    if (filter.session) query.set("session", filter.session);
    const suffix = query.toString();
    const { drafts } = await bff<{ drafts: MailDraft[] }>(
      `/api/mail/drafts${suffix ? `?${suffix}` : ""}`);
    return drafts;
  },
  /** the message a draft answers — read from the provider, never stored */
  async mailDraftSource(id: string): Promise<MailSourceMessage> {
    return bff<MailSourceMessage>(`/api/mail/drafts/${encodeURIComponent(id)}/source`);
  },
  async sendMailDraft(id: string): Promise<MailDraft> {
    return bff<MailDraft>(`/api/mail/drafts/${encodeURIComponent(id)}/send`, { method: "POST" });
  },
  async discardMailDraft(id: string): Promise<MailDraft> {
    return bff<MailDraft>(`/api/mail/drafts/${encodeURIComponent(id)}/discard`, { method: "POST" });
  },

  /** the shipped LIBRARY — every installable starter, from the registry itself */
  async workflowStarters(): Promise<StarterWorkflow[]> {
    const { starters } = await bff<{ starters: StarterWorkflow[] }>("/api/workflows/starters");
    return starters;
  },
  /** install a SHIPPED starter — create+publish+enable in one press */
  async installStarter(key: string): Promise<void> {
    await bff("/api/workflows/starters", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key }),
    });
  },
  async setAutoApplyRule(kind: string, allowed: boolean): Promise<void> {
    await bff("/api/workflows/auto-apply", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, allowed }),
    });
  },

  /** db/0112 - the standing assistant voice. null clears; absent leaves. */
  async updateAssistant(patch: {
    assistant_reply_language?: string | null;
    assistant_reply_length?: string | null;
    assistant_instructions?: string | null;
    post_call_brief?: boolean;
    /** db/0115 — the person's own "draft replies to my new mail" switch. */
    auto_draft_replies?: boolean;
    auto_meeting_prep?: boolean;
    /* 0128: the spoken voice per language */
    assistant_voice_fa?: string;
    assistant_voice_en?: string;
  }): Promise<Me> {
    return bff<Me>("/api/me/assistant", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
  },

  /** db/0112 - the caller's own devices (Security 43). */
  async mySessions(): Promise<{ sessions: AuthSessionRow[]; current: string | null }> {
    return bff<{ sessions: AuthSessionRow[]; current: string | null }>("/api/me/sessions");
  },

  /** 0126 — end one of the caller's own sessions; the device signs out on
      its next refresh */
  async endMySession(handle: string): Promise<void> {
    await bff<null>("/api/me/sessions", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handle }),
    });
  },

  /**
   * db/0137 — set a member's password, for someone you outrank.
   *
   * **LIVE.** Returns how many of their sessions the reset ended: setting a
   * password does not sign anyone out on its own, so that count is the part
   * that says the door actually closed.
   */
  async setMemberPassword(memberId: string, password: string): Promise<{ sessions_ended: number }> {
    return bff<{ sessions_ended: number }>(
      `/api/admin/members/${encodeURIComponent(memberId)}/password`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      },
    );
  },

  /**
   * db/0135 — every live session in the org, for an admin or owner.
   *
   * **LIVE.** The server refuses a non-admin, so this is only ever called
   * behind the same role check the screen uses for the section itself.
   */
  async orgSessions(): Promise<OrgSessionRow[]> {
    const { sessions } = await bff<{ sessions: OrgSessionRow[] }>("/api/admin/sessions");
    return sessions;
  },

  /**
   * db/0135 — end one session belonging to someone the caller outranks.
   *
   * **LIVE.** The rank rule lives in the database; a refusal arrives as a
   * BffError rather than being predicted here.
   */
  async endMemberSession(userId: string, handle: string): Promise<void> {
    await bff<null>(`/api/admin/sessions/${encodeURIComponent(userId)}/${encodeURIComponent(handle)}`, {
      method: "DELETE",
    });
  },

  /** db/0112 - consent withdrawal is self-service (Security 59). */
  async deleteMyVoiceprint(): Promise<void> {
    await bff("/api/me/voiceprint", { method: "DELETE" });
  },

  // ---- gateway (M17) ----------------------------------------------------------
  async gatewayKeys(): Promise<GatewayKey[]> {
    /* **LIVE** — `GET /api/gateway/keys` (admin; M17). */
    const { keys } = await bff<{ keys: GatewayKey[] }>("/api/gateway/keys");
    return keys;
  },
  /**
   * Mint. The token comes back HERE and nowhere else — mirroring core/, which
   * stores only a sha256 and a display prefix. The caller must treat this
   * return value as the one and only chance to show it.
   */
  /**
   * `actorId` is REQUIRED here on purpose. core/ defaults it to the creating
   * admin, which is a sensible API default and a poor UI one: it turns a
   * key's authority into an accident. An optional parameter would let that
   * accident back in through the type system, so the caller must choose.
   */
  async createGatewayKey(
    name: string,
    allowAssistant: boolean,
    actorId: string,
    expiresAt: string | null = null,
  ): Promise<GatewayKeyCreated> {
    /* **LIVE** — the token comes back HERE and nowhere else (core stores a
       sha256 + prefix). `actor_id` is the picker's choice, NOT me.id, and it
       now genuinely travels — the BFF used to drop it, which made the
       acts-as picker a control that did nothing. */
    return bff<GatewayKeyCreated>("/api/gateway/keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        allow_assistant: allowAssistant,
        actor_id: actorId,
        expires_at: expiresAt,
      }),
    });
  },
  /** **LIVE** — revoke, not delete: the row stays, with a date on it. */
  async revokeGatewayKey(id: string): Promise<GatewayKey[]> {
    const res = await fetch(`/api/gateway/keys/${id}`, { method: "DELETE" });
    if (!res.ok) throw new BffError(res.status);
    return api.gatewayKeys();
  },
  /**
   * Approve or refuse an inferred write.
   *
   * The body carries **only** `run_id` — core/ re-reads the proposal from the
   * `agent_run.steps` row the agent wrote. Sending the payload back would make
   * "what was proposed" and "what was approved" two independent claims, and
   * `after` is a possibly-excerpted DISPLAY value, so writing it would
   * silently truncate the change to whatever the card had room for.
   *
   * Returns "stale" for core/'s 404 — the segment was deleted or the call
   * changed hands between propose and confirm. That is an outcome, not a
   * fault, and the caller must not offer a retry for it.
   */
  async decideProposal(
    proposalId: string,
    runId: string,
    decision: "confirm" | "reject",
  ): Promise<"ok" | "stale"> {
    // Phase A: the mock always succeeds. The stale branch is reachable the
    // moment this becomes a fetch — it is core/ that decides, not us.
    void proposalId;
    void runId;
    void decision;
    return wait("ok");
  },

  /**
   * Persisted conversations, newest first.
   *
   * These were empty, on the reasoning that a populated list makes the UI
   * look finished. **That was the wrong trade and Front-end 2 corrected it:**
   * with both reads empty the RESUME path can never render, and an
   * unrenderable branch is the thing that ships broken. A list that looks
   * fuller than reality is a cosmetic problem someone can see; a branch
   * nobody can reach is the one they can't.
   *
   * Titles are SERVER-derived from the first question and never rewritten —
   * the client must not re-derive them, or two spellings of one title drift.
   */
  async agentSessions(archived = false): Promise<AssistantSession[]> {
    /* **LIVE** — `GET /api/assistant/sessions`, core's own ordering (most
       recently active first, nulls last). Titles are server-derived and the
       owner may rename them (M27); the client never re-derives one. */
    const { sessions } = await bff<{ sessions: AssistantSession[] }>(
      `/api/assistant/sessions?archived=${archived}`,
    );
    return sessions;
  },
  /**
   * **LIVE** — messages for resume, through the BFF. Returns `AgentMessage[]`
   * so a resumed conversation renders through the SAME component as a live
   * one — two renderers for one conversation is the drift shape, and the
   * resumed half is the one nobody looks at.
   *
   * The wire's `tool_calls` are CODES ({id, name} — arguments quote
   * transcripts and stay on the audit surface), so they normalize to a
   * settled shape: a resumed thread shows WHICH tools ran, not their live
   * progress, and inventing a state would be manufacturing an event the
   * server has no record of.
   */
  async agentMessages(sessionId: string): Promise<AgentMessage[]> {
    const { messages } = await bff<{
      messages: {
        id: string; role: "user" | "assistant" | "tool"; content: string;
        tool_calls: { id?: string; name?: string }[];
        agent_run_id: string | null; truncated: boolean;
      }[];
    }>(`/api/assistant/sessions/${sessionId}/messages`);
    /*
     * `tool` rows are filtered, not mapped: the thread renders what was SAID,
     * and nothing writes tool-role rows today — but the enum allows them, and
     * a future one must not crash a component whose union is user|assistant.
     */
    return messages
      .filter((m): m is typeof m & { role: "user" | "assistant" } => m.role !== "tool")
      .map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      tool_calls: (m.tool_calls ?? []).map((c, i) => ({
        id: c.id ?? `tc-${i}`,
        name: c.name ?? "tool",
        label: c.name ?? "tool",
        state: "ok" as const,
      })),
      proposal: null,
      run_id: m.agent_run_id ?? undefined,
      truncated: m.truncated,
    }));
  },

  // ---- the assistant experience (M27) ----------------------------------------
  /** **LIVE** — owner rename; the returned row is the adopted truth. */
  async renameSession(sessionId: string, title: string): Promise<AssistantSession> {
    return bff<AssistantSession>(`/api/assistant/sessions/${sessionId}/title`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title }),
    });
  },
  /** **LIVE** — archive/unarchive a conversation (Q5: never a delete). */
  async archiveSession(sessionId: string, archived: boolean): Promise<void> {
    await bff(`/api/assistant/sessions/${sessionId}/${archived ? "archive" : "unarchive"}`, {
      method: "POST",
    });
  },
  /** **LIVE** — a verdict on one answer; pressing the other thumb updates it. */
  async messageFeedback(messageId: string, verdict: "up" | "down", note?: string): Promise<void> {
    const res = await fetch(`/api/assistant/messages/${messageId}/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ verdict, note }),
    });
    if (!res.ok) throw new BffError(res.status);
  },
  /** **LIVE** — the caller's verdicts for one thread, keyed by message id. */
  async sessionFeedback(sessionId: string): Promise<Record<string, string>> {
    const { feedback } = await bff<{ feedback: Record<string, string> }>(
      `/api/assistant/sessions/${sessionId}/feedback`,
    );
    return feedback;
  },
  /** **LIVE** — the owner's share state + toggle (org-scoped, M27). */
  async shareState(sessionId: string): Promise<boolean> {
    const { shared } = await bff<{ shared: boolean }>(`/api/assistant/sessions/${sessionId}/share`);
    return shared;
  },
  async setShared(sessionId: string, shared: boolean): Promise<boolean> {
    const res = await bff<{ shared: boolean }>(`/api/assistant/sessions/${sessionId}/share`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ shared }),
    });
    return res.shared;
  },
  /** **LIVE** — a colleague's shared thread, read-only, through db/0058's doors. */
  async sharedThread(
    sessionId: string,
  ): Promise<{ session: { id: string; title: string }; messages: AgentMessage[] }> {
    return bff(`/api/assistant/shared/${sessionId}`);
  },

  // ---- agent ------------------------------------------------------------------------
  // agentRuns was DELETED here (2026-08-20 tenancy audit): zero callers, no
  // server wire, and the fixture served the SAME fabricated runs to every
  // tenant. A runs surface returns when core exposes one to read.
  /**
   * Emits the EXACT SSE vocabulary core/ will send (backend-specified):
   * text_delta · tool_call (started → one terminal state per id) · proposal ·
   * done (always last, including on failure). The assistant reduces these,
   * so swapping this generator for a real EventSource is transport-only.
   *
   * The scripted run also exercises a `denied` tool outcome, because denied
   * and blocked are normal refusals the UI must render as such — not errors.
   */
  /**
   * `sessionId` omitted starts a new conversation; supplied continues one.
   *
   * The `session` event is emitted FIRST and is the only place a newly
   * created id ever appears — a caller that ignores it on a `created: true`
   * turn has lost the handle to a conversation the server is now persisting,
   * and the loss is silent because the answer still renders perfectly.
   */
  async *ask(
    question: string,
    ctx: { page: string; callIds: string[] },
    sessionId?: string,
    opts?: {
      model?: string; skill?: string; web?: boolean; signal?: AbortSignal;
      agent?: string; workflow?: string; connectorProvider?: ConnectorProvider; sourceId?: string;
      /** the UI locale — the assistant answers in the interface language */
      locale?: string;
      /** M33: client tools THIS surface can perform (validated server-side). */
      clientTools?: string[];
      /** M34: where the user is — route + optional entity, IDs only. */
      surface?: { route: string; entity?: { kind: string; id: string } };
    },
  ): AsyncGenerator<AgentEvent> {
    /* **LIVE** — the real stream, through the BFF's SSE passthrough. The
       vocabulary is core/'s SseEvent union verbatim (session first, then
       deltas/tools/proposals, done always last), so this swap was
       transport-only — exactly what the mock's contract promised.

       `call_ids` carries EVERY attached source; `call_id` stays beside it
       for a core that predates the plural wire (it truncated to the first
       chip — a control that read as wired and dropped the rest). `web`
       rides only when true, so an older core sees nothing new. */
    try {
      yield* streamAssistant(
        '/api/assistant/ask',
        {
          question,
          session_id: sessionId,
          call_id: ctx.callIds[0],
          ...(ctx.callIds.length > 1 ? { call_ids: ctx.callIds } : {}),
          model: opts?.model,
          skill: opts?.skill,
          agent: opts?.agent,
          workflow: opts?.workflow,
          connector_provider: opts?.connectorProvider,
          source_id: opts?.sourceId,
          ...(opts?.web ? { web: true } : {}),
          ...(opts?.locale ? { locale: opts.locale } : {}),
          ...(opts?.clientTools?.length ? { client_tools: opts.clientTools } : {}),
          ...(opts?.surface ? { context: opts.surface } : {}),
        },
        opts?.signal,
      );
    } finally {
      /*
       * An ask WRITES a conversation (the user turn lands even on a failed
       * run), but it rides its own SSE fetch, not bff() — so the one-place
       * announcer never fires for it and every history surface stayed
       * stale until reload (user report, 2026-08-22: "any talk with the
       * orb must count in history"). Announced here, once, however the
       * stream ends — done, error, or abort.
       */
      announceChange("sessions");
    }
  },

  /** M33: answer a `client_tool_call` — performed, declined, or failed. */
  async deliverToolResult(callId: string, ok: boolean, detail: string): Promise<void> {
    await bff("/api/assistant/tool-result", {
      method: "POST",
      body: JSON.stringify({ call_id: callId, ok, detail }),
      headers: { "content-type": "application/json" },
    });
  },

  /* [REVISED 2026-08-28, user directive] setAutonomy left with the M36 dial:
     watch and act are gone from the product, assist is pinned server-side
     (PINNED_AUTONOMY in core), and a client method with no control behind it
     is a producer with no consumer. */

  /** M35: agent-initiated cards. `unavailable` = db/0074 pending, not "no news". */
  async cards(): Promise<{ cards: AgentCardItem[]; unavailable?: string }> {
    return bff<{ cards: AgentCardItem[]; unavailable?: string }>("/api/cards");
  },
  async markCardRead(cardId: string): Promise<void> {
    await bff(`/api/cards/${cardId}/read`, { method: "POST" });
  },
  async weeklyDigest(): Promise<{ enabled: boolean; available: boolean }> {
    return bff<{ enabled: boolean; available: boolean }>("/api/rules/weekly-digest");
  },
  async setWeeklyDigest(enabled: boolean): Promise<void> {
    await bff("/api/rules/weekly-digest", {
      method: "PUT",
      body: JSON.stringify({ enabled }),
      headers: { "content-type": "application/json" },
    });
  },

  /** M38: open a live-transcription relay session (503 = lane not configured).
      `ticket` + `direct_url` let the browser stream to core WITHOUT the
      serverless hop — the lag fix; both nullable for an older core. */
  async liveSttStart(format?: "pcm16k"): Promise<{ session_id: string; ticket?: string; direct_url?: string | null }> {
    return bff<{ session_id: string; ticket?: string; direct_url?: string | null }>(
      "/api/live-stt/start", {
        method: "POST",
        ...(format
          ? { headers: { "content-type": "application/json" }, body: JSON.stringify({ format }) }
          : {}),
      });
  },
  /** M38: one audio chunk to the relay — binary, so raw fetch. Fire-and-forget. */
  async liveSttAudio(sessionId: string, chunk: Blob): Promise<void> {
    const response = await fetch(`/api/live-stt/${encodeURIComponent(sessionId)}/audio`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: chunk,
    });
    if (!response.ok) throw new BffError(response.status, undefined, "live_stt_audio_failed");
  },
  async liveSttStop(sessionId: string): Promise<void> {
    await bff(`/api/live-stt/${encodeURIComponent(sessionId)}/stop`, { method: "POST" });
  },

  /**
   * M37: the platform's own voice — Persian TTS from the server, for the
   * browsers that ship no fa voice (Windows Chrome). Binary, so it skips
   * the JSON-shaped bff() helper deliberately.
   */
  async tts(text: string, lang: "fa" | "en" = "fa"): Promise<Blob> {
    const response = await fetch("/api/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, lang }),
    });
    if (!response.ok) throw new BffError(response.status, undefined, "tts_failed");
    return response.blob();
  },

  /** Phase C: one run's reasoning trace — codes only, never arguments. */
  async runTrace(runId: string): Promise<RunTrace> {
    return bff<RunTrace>(`/api/assistant/runs/${runId}/trace`);
  },
  /** Phase C: org agent-governance aggregates (admin). `cards: null` = not measured. */
  async agentStats(): Promise<AgentStats> {
    return bff<AgentStats>("/api/admin/agent-stats");
  },

  /**
   * **LIVE** — regenerate (M27): re-answers the session's standing question
   * as a fresh run, optionally on a different model. Same stream, same
   * reducer; no user turn is written because the person did not ask again.
   */
  async *regenerate(
    sessionId: string,
    opts?: { model?: string; signal?: AbortSignal; locale?: string },
  ): AsyncGenerator<AgentEvent> {
    yield* streamAssistant(
      `/api/assistant/sessions/${sessionId}/regenerate`,
      { model: opts?.model, ...(opts?.locale ? { locale: opts.locale } : {}) },
      opts?.signal,
    );
  },

  // ---- audit trail (M25, Settings · COMPLIANCE) ------------------------------
  /**
   * **LIVE, with no fixture stage.** `GET /v1/admin/audit` exists and is
   * admin-gated on core/ today, so this method's first body is the real fetch
   * — there was never a mock to erase.
   *
   * `cursor` is **opaque and passed back verbatim.** It is not a timestamp,
   * even though it contains one: `cursor.at` carries Postgres's microsecond
   * text, while `entry.at` is the millisecond value rendered for display. They
   * are deliberately different values, and building a cursor out of what is on
   * screen would silently re-open the page-boundary skip the composite cursor
   * exists to close. Take it from `next_cursor`, hand it back unchanged, never
   * construct one.
   *
   * `next_cursor === null` is the end of the feed, and it is the ONLY reliable
   * end signal — a short page happens to mean the same thing today, but that
   * is a fact about the query plan rather than a promise.
   */
  async audit(query?: {
    limit?: number;
    cursor?: AuditCursor;
    source?: AuditSource;
  }): Promise<AuditPage> {
    const params = new URLSearchParams();
    if (query?.limit !== undefined) params.set("limit", String(query.limit));
    if (query?.source) params.set("source", query.source);
    if (query?.cursor) {
      // all three or none — core/ rejects a partial cursor rather than
      // half-applying it, so there is no half to send
      params.set("cursor_at", query.cursor.at);
      params.set("cursor_source", query.cursor.source);
      params.set("cursor_id", query.cursor.id);
    }
    const suffix = params.size > 0 ? `?${params}` : "";
    return bff<AuditPage>(`/api/admin/audit${suffix}`);
  },

  // ---- service health (M25, Management · Server) -----------------------------
  /**
   * **LIVE, no fixture stage** — same as `audit()`, for the same reason.
   *
   * Returned untouched. Every metric carries its own `measured_at`, and a null
   * there is NOT MEASURED — the screen renders "—" and never a number. There
   * is deliberately no defaulting here (`?? 0`, `|| "—"`, a merge with an
   * empty shape): a helper that filled a gap would erase the one distinction
   * this payload exists to carry, and it would do it before any screen could
   * notice.
   */
  async serverHealth(): Promise<ServerHealth> {
    return bff<ServerHealth>("/api/admin/server");
  },
};
