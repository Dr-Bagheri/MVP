/**
 * THE swap point. Every screen talks only to `api`; Phase A serves the
 * fixtures in mock-data.ts, and when core/ lands each body becomes a fetch to
 * the BFF route (web/ holds the session — the browser never sees a token, M1).
 * Signatures and types do not change.
 */
import {
  AGENT_RUNS,
  CALLS,
  CONNECTORS,
  DIRECTORY,
  GATEWAY_DELIVERIES,
  GATEWAY_KEYS,
  GATEWAY_WEBHOOKS,
  ME,
  MODELS,
  ORG,
  SKILLS,
  SPEAKERS,
  SUMMARIES,
  TRANSCRIPT,
  USERS,
} from "./mock-data";
import type {
  AgentEvent,
  AgentMessage,
  AssistantSession,
  AuditCursor,
  AuditPage,
  AuditSource,
  CalendarPreference,
  Call,
  CallScope,
  DirectoryPerson,
  GatewayDelivery,
  GatewayEvent,
  GatewayKey,
  GatewayKeyCreated,
  GatewayWebhook,
  GatewayWebhookCreated,
  AdminModelRow,
  Me,
  MemberSort,
  MemberStats,
  ModelsResponse,
  Org,
  Role,
  SearchHit,
  ServerHealth,
  Skill,
  Speaker,
  SummaryVersion,
  TranscriptSegment,
  User,
  UserStatus,
} from "./types";

/**
 * Persisted conversations. Titles are the server's, derived from the first
 * question — never re-derived here.
 */
const AGENT_SESSIONS: AssistantSession[] = [
  {
    id: "sess-1",
    title: "مهم‌ترین نکات مذاکرهٔ تمدید قرارداد",
    created_at: new Date(Date.now() - 3_600_000).toISOString(),
    updated_at: new Date(Date.now() - 3_400_000).toISOString(),
    message_count: 4,
  },
  {
    id: "sess-2",
    title: "اقدام‌های باز از جلسهٔ محصول",
    created_at: new Date(Date.now() - 86_400_000).toISOString(),
    updated_at: new Date(Date.now() - 86_000_000).toISOString(),
    message_count: 2,
  },
  {
    // ends in an UNANSWERED question — count is 1, and that is the point
    id: "sess-3",
    title: "خلاصهٔ تماس پشتیبانی",
    created_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    updated_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    message_count: 1,
  },
];

const turn = (id: string, role: "user" | "assistant", content: string): AgentMessage => ({
  id,
  role,
  content,
  tool_calls: [],
  proposal: null,
  session_id: id.split("-m")[0],
});

/**
 * Resume payloads.
 *
 * `sess-3` ends with a USER message and no assistant reply — the failed-run
 * shape, confirmed on the wire: a turn is written only on delivery, so a run
 * that failed leaves the question standing alone. There is deliberately no
 * assistant message carrying `failed: true`; that flag belongs to the LIVE
 * stream, where the client watched the failure happen. Rendering one here
 * would manufacture an event the server has no record of.
 *
 * Without this fixture that branch is unreachable, which is exactly how it
 * would have shipped wrong.
 */
const AGENT_THREADS: Record<string, AgentMessage[]> = {
  "sess-1": [
    turn("sess-1-m1", "user", "مهم‌ترین نکات این مذاکره چه بود؟"),
    turn(
      "sess-1-m2",
      "assistant",
      "توافق بر کاهش زمان پاسخ‌گویی بحرانی به دو ساعت، در ازای قرارداد دوساله.",
    ),
    turn("sess-1-m3", "user", "چه چیزی هنوز باز مانده؟"),
    turn("sess-1-m4", "assistant", "تأیید نهایی به بررسی مدیر طرف مقابل موکول شد."),
  ],
  "sess-2": [
    turn("sess-2-m1", "user", "اقدام‌های باز را فهرست کن."),
    turn("sess-2-m2", "assistant", "دو مورد: برآورد زمانی تیم، و بازبینی ترتیب انتشار."),
  ],
  "sess-3": [turn("sess-3-m1", "user", "این تماس را خلاصه کن.")],
};

const LATENCY = 180;
const wait = <T,>(value: T, ms = LATENCY): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

// mutable session copies so Phase-A interactions persist while the tab lives
let calls: Call[] = structuredClone(CALLS);
let users: User[] = structuredClone(USERS);
let models: AdminModelRow[] = structuredClone(MODELS);
let gatewayKeys: GatewayKey[] = structuredClone(GATEWAY_KEYS);
let gatewayWebhooks: GatewayWebhook[] = structuredClone(GATEWAY_WEBHOOKS);
let me: Me = structuredClone(ME);
let org: Org = structuredClone(ORG);
const transcripts: Record<string, TranscriptSegment[]> = structuredClone(TRANSCRIPT);
const speakers: Record<string, Speaker[]> = structuredClone(SPEAKERS);
const summaries: Record<string, SummaryVersion[]> = structuredClone(SUMMARIES);

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
  return (await response.json()) as T;
}

export const api = {
  // ---- session ---------------------------------------------------------------
  /**
   * Returns `Me`, not `User`: preferences live on core/'s `MeRecord` and a
   * members-list row genuinely does not carry them. Typing this as `User`
   * would push every consumer into `me.calendar ?? "auto"`, and that fallback
   * cannot tell "they chose auto" from "the payload never had it".
   */
  async me(): Promise<Me> {
    return wait(me);
  },
  async org(): Promise<Org> {
    return wait(org);
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
    calendar?: CalendarPreference;
    timezone?: string;
    locale?: string;
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
   * The model preference (M5). Still a fixture: its real home is
   * `PUT /v1/models/preferred`, a different route from the profile patch —
   * core/ added it precisely because `preferred_model` was being written by
   * something that no longer had a caller.
   */
  async setPreferredModel(modelId: string | null): Promise<User> {
    me = { ...me, model_id: modelId };
    users = users.map((u) => (u.id === me.id ? me : u));
    return wait(me);
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
  /** Visibility mirrors the RLS rule: own calls + org-scoped; admins read all. */
  async listCalls(opts?: { includeArchived?: boolean }): Promise<Call[]> {
    const visible = calls.filter((c) => {
      if (c.deleted_at) return me.role === "admin";
      if (me.role === "admin") return true;
      return c.owner_id === me.id || c.scope === "org";
    });
    // `archived_at` is a timestamp, not a flag — "when" carries more than
    // "whether", and null is the un-archived state
    const filtered = opts?.includeArchived
      ? visible
      : visible.filter((c) => c.archived_at === null);
    return wait(filtered);
  },
  async getCall(id: string): Promise<Call | null> {
    return wait(calls.find((c) => c.id === id) ?? null);
  },
  async setScope(id: string, scope: CallScope) {
    calls = calls.map((c) => (c.id === id ? { ...c, scope } : c));
    return wait(calls.find((c) => c.id === id)!);
  },
  /**
   * Archive/unarchive are LIVE and verified end-to-end against core/
   * (`archived_at` null → timestamp → null on a real row). This body swaps to
   * `POST /api/calls/:id/archive` with the rest of the read path.
   */
  async setArchived(id: string, archived: boolean) {
    calls = calls.map((c) =>
      c.id === id ? { ...c, archived_at: archived ? new Date().toISOString() : null } : c,
    );
    return wait(true);
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
  async deleteCall(id: string) {
    calls = calls.map((c) =>
      c.id === id ? { ...c, deleted_at: new Date().toISOString() } : c,
    );
    return wait(true);
  },
  async restoreCall(id: string) {
    calls = calls.map((c) => (c.id === id ? { ...c, deleted_at: null } : c));
    return wait(true);
  },

  // ---- transcript & speakers --------------------------------------------------
  async getTranscript(callId: string): Promise<TranscriptSegment[]> {
    return wait(transcripts[callId] ?? []);
  },
  async correctLine(callId: string, rowId: string, text: string) {
    const rows = transcripts[callId] ?? [];
    transcripts[callId] = rows.map((r) =>
      r.id === rowId ? { ...r, text, edited: true, edited_by: me.id } : r,
    );
    return wait(true);
  },
  async getSpeakers(callId: string): Promise<Speaker[]> {
    return wait(speakers[callId] ?? []);
  },
  async renameSpeaker(callId: string, speakerId: string, label: string) {
    speakers[callId] = (speakers[callId] ?? []).map((s) =>
      s.id === speakerId ? { ...s, label } : s,
    );
    return wait(true);
  },
  /** Directory links happen only by the owner's deliberate act (M11). */
  async linkSpeaker(callId: string, speakerId: string, person: DirectoryPerson | null) {
    speakers[callId] = (speakers[callId] ?? []).map((s) =>
      s.id === speakerId
        ? { ...s, person_id: person?.id ?? null, person_name: person?.name ?? null }
        : s,
    );
    return wait(true);
  },
  async directory(): Promise<DirectoryPerson[]> {
    return wait(DIRECTORY);
  },

  // ---- summaries --------------------------------------------------------------
  async getSummaries(callId: string): Promise<SummaryVersion[]> {
    return wait(summaries[callId] ?? []);
  },

  // ---- search -----------------------------------------------------------------
  async search(query: string): Promise<SearchHit[]> {
    const q = query.trim();
    if (!q) return wait([]);
    const hits: SearchHit[] = [];
    /*
     * The server highlights the RAW text while MATCHING folded, so a hit can
     * legitimately come back with no <mark> at all. Mirroring that here keeps
     * the unmarked path reachable — a mock that always marks would leave the
     * "looks right with zero marks" claim untested (rule 9). Every third hit
     * is returned unmarked to stand in for a fold-only match.
     */
    const mark = (text: string, marked: boolean) =>
      marked ? text.split(q).join(`<mark>${q}</mark>`) : text;

    for (const call of calls) {
      if (call.deleted_at) continue;
      for (const segment of transcripts[call.id] ?? []) {
        if (segment.text.includes(q)) {
          hits.push({
            call_id: call.id,
            call_title: call.title,
            kind: "transcript",
            start_ms: segment.start_ms,
            end_ms: segment.end_ms,
            snippet: mark(segment.text, hits.length % 3 !== 2),
          });
        }
      }
      for (const version of summaries[call.id] ?? []) {
        if (version.content.includes(q)) {
          hits.push({
            call_id: call.id,
            call_title: call.title,
            kind: "summary",
            // a summary is about the whole call — no honest timestamp exists
            start_ms: null,
            end_ms: null,
            snippet: mark(version.content.slice(0, 180), hits.length % 3 !== 2),
          });
        }
      }
    }
    return wait(hits);
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
    const allowed = models.filter((m) => m.allowed);
    return wait({
      models: allowed.map((m) => ({
        id: m.id,
        name: m.label,
        reasoning: m.suggested,
        selected: m.id === me.model_id,
      })),
      preferred_model: me.model_id,
      curated: models.some((m) => !m.allowed),
      tool_capability_filtered: false,
    });
  },
  /** Phase-A only: the admin allow-list has no core/ endpoint yet. */
  async adminModels(): Promise<AdminModelRow[]> {
    return wait(models);
  },
  /**
   * Toggle one model in the org's allow-list.
   *
   * **Reads as a per-model write and is not one.** Curation is a single
   * `allowed_models` array on the org, so this composes the whole next array
   * and sends it through `updateOrg` — there is no `/v1/admin/models/{id}`,
   * and aiming at one produced a 404 that read as "not built yet".
   *
   * Composing the array from the CURRENT rows means two admins toggling at the
   * same time will clobber each other's edit — last write wins over the whole
   * list, not the one checkbox. That is a property of the wire (the field is
   * the unit), not something this can fix locally, and it is worth knowing
   * before someone reports it as a lost setting.
   */
  async setModelAllowed(id: string, allowed: boolean) {
    models = models.map((m) => (m.id === id ? { ...m, allowed } : m));
    await api.updateOrg({ allowed_models: models.filter((m) => m.allowed).map((m) => m.id) });
    return wait(models);
  },
  async skills(): Promise<Skill[]> {
    return wait(SKILLS);
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
    // the mock filters HERE to mirror where the server filters — a mock that
    // returned everything would let a client-side filter look correct
    let rows = users;
    if (query?.status) rows = rows.filter((u) => u.status === query.status);
    if (query?.role) rows = rows.filter((u) => u.role === query.role);
    if (query?.search) {
      const q = query.search.toLowerCase();
      /*
       * `username` is nullable (it is null until chosen), so the fields are
       * narrowed rather than defaulted — `?? ""` on each was the old shape and
       * it hid the nullability behind a value that matches every empty query.
       *
       * `email` is in the list because core/'s `MemberQuery` searches it too
       * (members.ts). A mock that searched three of the server's four fields
       * would make a working search look broken for anyone who typed an
       * address — the mock disagreeing with the server it stands in for.
       */
      rows = rows.filter((u) =>
        [u.display_name, u.display_name_en, u.username, u.email]
          .filter((f): f is string => typeof f === "string")
          .some((f) => f.toLowerCase().includes(q)),
      );
    }
    const sorted = [...rows];
    switch (query?.sort) {
      case "name":
        sorted.sort((a, b) => a.display_name.localeCompare(b.display_name, "fa"));
        break;
      case "created":
        sorted.sort((a, b) => b.created_at.localeCompare(a.created_at));
        break;
      case "last_seen":
        // nulls LAST — never-seen is not "oldest", it is a different fact
        sorted.sort((a, b) =>
          a.last_seen_at === b.last_seen_at
            ? 0
            : !a.last_seen_at
              ? 1
              : !b.last_seen_at
                ? -1
                : b.last_seen_at.localeCompare(a.last_seen_at),
        );
        break;
      case "status":
        sorted.sort((a, b) => a.status.localeCompare(b.status));
        break;
      default:
        // pending first — the queue is why an admin opened this screen
        sorted.sort((a, b) =>
          a.status === b.status ? 0 : a.status === "pending" ? -1 : b.status === "pending" ? 1 : 0,
        );
    }
    return wait(sorted);
  },
  /**
   * Counts for the stat tiles, from a SEPARATE unfiltered read.
   *
   * Deliberately not derived from whatever `members(query)` returned:
   * tiles that move when you type describe the QUERY, not the organisation.
   * That is the counting lie one level up from client-side filtering, and it
   * is worse because a filtered total still looks like a fact about the org.
   *
   * `history_since: null` is the mock's value on purpose — the log is hours
   * old, every org is in the null case, and it is the branch that renders
   * "—". A fixture returning a real date would leave the honest-dash path
   * unrendered, which is the branch most likely to ship wrong.
   */
  async memberStats(): Promise<MemberStats> {
    return wait({
      total: users.length,
      active: users.filter((u) => u.status === "active").length,
      inactive: users.filter((u) => u.status !== "active").length,
      trend: {
        window_days: 30,
        activated: 0,
        disabled: 0,
        joined: 0,
        history_since: null,
      },
    });
  },
  async setUserStatus(id: string, status: UserStatus) {
    users = users.map((u) => (u.id === id ? { ...u, status } : u));
    return wait(users);
  },
  async setUserRole(id: string, role: Role) {
    users = users.map((u) => (u.id === id ? { ...u, role } : u));
    return wait(users);
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
  async updateOrg(patch: { name?: string; locale?: string; allowed_models?: string[] }) {
    org = { ...org, ...patch };
    return wait(org);
  },

  // ---- connectors & gateway --------------------------------------------------------
  async connectors() {
    return wait(CONNECTORS);
  },
  async gatewayKeys(): Promise<GatewayKey[]> {
    return wait(gatewayKeys);
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
    const created: GatewayKeyCreated = {
      id: `gk-${gatewayKeys.length + 1}`,
      name,
      token_prefix: "echo_sk_test",
      // the picker's choice, NOT `me.id` — otherwise it is a control that
      // does nothing and a disabled-actor key can never be minted
      actor_id: actorId,
      last_used_at: null,
      expires_at: expiresAt,
      revoked_at: null,
      created_at: new Date().toISOString(),
      allow_assistant: allowAssistant,
      token: `echo_sk_test_FAKE_MINTED_${String(gatewayKeys.length + 1).padStart(6, "0")}`,
    };
    const { token: _token, ...stored } = created;
    gatewayKeys = [stored, ...gatewayKeys];
    return wait(created);
  },
  /** Revoke, not delete — the row stays, with a date on it. */
  async revokeGatewayKey(id: string): Promise<GatewayKey[]> {
    gatewayKeys = gatewayKeys.map((k) =>
      k.id === id ? { ...k, revoked_at: new Date().toISOString() } : k,
    );
    return wait(gatewayKeys);
  },
  async gatewayWebhooks(): Promise<GatewayWebhook[]> {
    return wait(gatewayWebhooks);
  },
  async setWebhookEnabled(id: string, enabled: boolean): Promise<GatewayWebhook[]> {
    gatewayWebhooks = gatewayWebhooks.map((w) => (w.id === id ? { ...w, enabled } : w));
    return wait(gatewayWebhooks);
  },
  /**
   * Create. `secret` comes back once — same one-way-door rule as a key token.
   *
   * `events` is forwarded verbatim and never client-filtered: core/ 400s an
   * unknown event BY NAME, and swallowing it here would recreate exactly the
   * silence that naming it prevents.
   */
  async createGatewayWebhook(
    url: string,
    events: GatewayEvent[],
  ): Promise<GatewayWebhookCreated> {
    const created: GatewayWebhookCreated = {
      id: `wh-${gatewayWebhooks.length + 1}`,
      url,
      events,
      enabled: true,
      created_at: new Date().toISOString(),
      secret: `whsec_test_FAKE_MINTED_${String(gatewayWebhooks.length + 1).padStart(6, "0")}`,
    };
    const { secret: _secret, ...stored } = created;
    gatewayWebhooks = [stored, ...gatewayWebhooks];
    return wait(created);
  },
  /**
   * `webhookId` is a SERVER filter — the BFF forwards it and core/ pages at
   * limit 50. Filtering client-side would silently drop a quiet webhook's
   * deliveries off the end of a busy one's page, so the mock filters here to
   * mirror where the real filtering happens.
   */
  async gatewayDeliveries(webhookId?: string): Promise<GatewayDelivery[]> {
    const rows = webhookId
      ? GATEWAY_DELIVERIES.filter((d) => d.webhook_id === webhookId)
      : GATEWAY_DELIVERIES;
    return wait(rows);
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
  async agentSessions(): Promise<AssistantSession[]> {
    return wait(AGENT_SESSIONS);
  },
  /**
   * Messages for resume. Returns `AgentMessage[]` so a resumed conversation
   * renders through the SAME component as a live one — two renderers for one
   * conversation is the drift shape, and the resumed half is the one nobody
   * looks at.
   */
  async agentMessages(sessionId: string): Promise<AgentMessage[]> {
    return wait(AGENT_THREADS[sessionId] ?? []);
  },

  // ---- agent ------------------------------------------------------------------------
  async agentRuns() {
    return wait(AGENT_RUNS);
  },
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
  ): AsyncGenerator<AgentEvent> {
    const wantsWrite = /اصلاح|تصحیح|عوض کن|تغییر بده/.test(question);

    /*
     * FIRST, and `created` reflects which path ran. A mock that always
     * created would leave the continue-existing branch unexercised — the
     * branch that matters, since it is the one every message after the first
     * takes.
     */
    yield {
      type: "session",
      id: sessionId ?? `sess-${Date.now()}`,
      created: sessionId === undefined,
    };

    yield {
      type: "tool_call",
      id: "tc-1",
      name: "search_transcripts",
      label: `جست‌وجو: «${question.slice(0, 20)}»`,
      state: "started",
    };
    await wait(null, 420);
    yield {
      type: "tool_call",
      id: "tc-1",
      name: "search_transcripts",
      label: "۳ بازه پیدا شد",
      state: "ok",
      ms: 412,
    };

    if (ctx.callIds.length > 0) {
      yield {
        type: "tool_call",
        id: "tc-2",
        name: "read_window",
        label: "خواندن بازهٔ تماس",
        state: "started",
      };
      await wait(null, 380);
      yield {
        type: "tool_call",
        id: "tc-2",
        name: "read_window",
        label: "۲ بازه خوانده شد",
        state: "ok",
        ms: 377,
      };
    } else {
      // a call outside the caller's reach: the tool's own scope check refuses
      yield {
        type: "tool_call",
        id: "tc-3",
        name: "read_window",
        label: "خارج از دسترسی شما",
        state: "denied",
        ms: 8,
      };
    }

    const answer = wantsWrite
      ? "پیشنهاد اصلاح آماده است؛ پیش از اعمال، تأیید شما لازم است."
      : `بر پایهٔ چیزی که در ${ctx.callIds.length > 0 ? "تماس‌های انتخاب‌شده" : "این صفحه"} پیدا شد: مهم‌ترین نکته، توافق بر کاهش زمان پاسخ‌گویی بحرانی به دو ساعت در ازای قرارداد دوساله بود. تأیید نهایی به بررسی مدیر طرف مقابل موکول شد.`;

    for (const delta of answer.match(/.{1,28}/g) ?? []) {
      yield { type: "text_delta", delta };
      await wait(null, 60);
    }

    if (wantsWrite) {
      /*
       * `before` is the CURRENT value and core/ spends a query fetching it, so
       * a card can show before/after rather than asking for blind consent. The
       * fixture carried none, which made that branch unreachable — the card
       * would have looked finished while never rendering the half that makes
       * it a decision (rule 9).
       *
       * `before`/`after` are a matched pair — same keys on both sides, so
       * the reader compares values rather than reconciling shapes. Both are
       * DISPLAY values and may be excerpted; the authoritative payload lives
       * server-side and is re-read at confirm.
       */
      yield {
        type: "proposal",
        id: "pr-1",
        kind: "correct_transcript",
        summary: "اصلاح خط ۰۰:۴۱ — «زمان پاسخ‌گویی بحرانی» به‌جای «زمان پاسخ‌گوی بحرانی»",
        payload: {
          call_id: ctx.callIds[0] ?? "c-1",
          row_id: "t-3",
          before: { text: "زمان پاسخ‌گوی بحرانی باید به دو ساعت کاهش پیدا کند." },
          after: { text: "زمان پاسخ‌گویی بحرانی باید به دو ساعت کاهش پیدا کند." },
        },
      };
    }

    yield { type: "done", runId: `run-${Date.now()}`, failed: false };
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
