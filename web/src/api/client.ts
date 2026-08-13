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
  ModelsResponse,
  Org,
  Role,
  SearchHit,
  Skill,
  Speaker,
  SummaryVersion,
  TranscriptSegment,
  User,
  UserStatus,
} from "./types";

const LATENCY = 180;
const wait = <T,>(value: T, ms = LATENCY): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

// mutable session copies so Phase-A interactions persist while the tab lives
let calls: Call[] = structuredClone(CALLS);
let users: User[] = structuredClone(USERS);
let models: AdminModelRow[] = structuredClone(MODELS);
let gatewayKeys: GatewayKey[] = structuredClone(GATEWAY_KEYS);
let gatewayWebhooks: GatewayWebhook[] = structuredClone(GATEWAY_WEBHOOKS);
let me: User = structuredClone(ME);
let org: Org = structuredClone(ORG);
const transcripts: Record<string, TranscriptSegment[]> = structuredClone(TRANSCRIPT);
const speakers: Record<string, Speaker[]> = structuredClone(SPEAKERS);
const summaries: Record<string, SummaryVersion[]> = structuredClone(SUMMARIES);

export const api = {
  // ---- session ---------------------------------------------------------------
  async me(): Promise<User> {
    return wait(me);
  },
  async org(): Promise<Org> {
    return wait(org);
  },
  async updateProfile(patch: Partial<Pick<User, "display_name" | "locale" | "model_id">>) {
    me = { ...me, ...patch };
    users = users.map((u) => (u.id === me.id ? me : u));
    return wait(me);
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
  async setModelAllowed(id: string, allowed: boolean) {
    models = models.map((m) => (m.id === id ? { ...m, allowed } : m));
    return wait(models);
  },
  async skills(): Promise<Skill[]> {
    return wait(SKILLS);
  },

  // ---- admin --------------------------------------------------------------------
  async members(): Promise<User[]> {
    return wait(users);
  },
  async setUserStatus(id: string, status: UserStatus) {
    users = users.map((u) => (u.id === id ? { ...u, status } : u));
    return wait(users);
  },
  async setUserRole(id: string, role: Role) {
    users = users.map((u) => (u.id === id ? { ...u, role } : u));
    return wait(users);
  },
  async updateOrg(patch: Partial<Pick<Org, "name" | "default_call_scope">>) {
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
  async *ask(
    question: string,
    ctx: { page: string; callIds: string[] },
  ): AsyncGenerator<AgentEvent> {
    const wantsWrite = /اصلاح|تصحیح|عوض کن|تغییر بده/.test(question);

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
};
