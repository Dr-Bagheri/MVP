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
  GATEWAY,
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
    const filtered = opts?.includeArchived ? visible : visible.filter((c) => !c.archived);
    return wait(filtered);
  },
  async getCall(id: string): Promise<Call | null> {
    return wait(calls.find((c) => c.id === id) ?? null);
  },
  async setScope(id: string, scope: CallScope) {
    calls = calls.map((c) => (c.id === id ? { ...c, scope } : c));
    return wait(calls.find((c) => c.id === id)!);
  },
  async setArchived(id: string, archived: boolean) {
    calls = calls.map((c) => (c.id === id ? { ...c, archived } : c));
    return wait(true);
  },
  /** Soft delete with a 30-day purge window (M11). Never the agent's path. */
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
  async gateway() {
    return wait(GATEWAY);
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
      yield {
        type: "proposal",
        id: "pr-1",
        kind: "correct_transcript",
        summary: "اصلاح خط ۰۰:۴۱ — «زمان پاسخ‌گویی بحرانی» به‌جای «زمان پاسخ‌گوی بحرانی»",
        payload: { call_id: ctx.callIds[0] ?? "c-1", row_id: "t-3" },
      };
    }

    yield { type: "done", runId: `run-${Date.now()}`, failed: false };
  },
};
