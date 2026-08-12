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
  AgentMessage,
  AgentProposal,
  AgentToolCall,
  Call,
  CallScope,
  DirectoryPerson,
  ModelInfo,
  Org,
  Role,
  SearchHit,
  Skill,
  Speaker,
  SummaryVersion,
  TranscriptRow,
  User,
  UserStatus,
} from "./types";

const LATENCY = 180;
const wait = <T,>(value: T, ms = LATENCY): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

// mutable session copies so Phase-A interactions persist while the tab lives
let calls: Call[] = structuredClone(CALLS);
let users: User[] = structuredClone(USERS);
let models: ModelInfo[] = structuredClone(MODELS);
let me: User = structuredClone(ME);
let org: Org = structuredClone(ORG);
const transcripts: Record<string, TranscriptRow[]> = structuredClone(TRANSCRIPT);
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
  async getTranscript(callId: string): Promise<TranscriptRow[]> {
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
    for (const call of calls) {
      if (call.deleted_at) continue;
      for (const row of transcripts[call.id] ?? []) {
        if (row.text.includes(q)) {
          hits.push({
            call_id: call.id,
            call_title: call.title,
            source: "transcript",
            start_ms: row.start_ms,
            snippet: row.text,
          });
        }
      }
      for (const version of summaries[call.id] ?? []) {
        if (version.content.includes(q)) {
          hits.push({
            call_id: call.id,
            call_title: call.title,
            source: "summary",
            start_ms: null,
            snippet: version.content.slice(0, 180),
          });
        }
      }
    }
    return wait(hits);
  },

  // ---- models & skills ---------------------------------------------------------
  async models(): Promise<ModelInfo[]> {
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
   * Streams an answer the way the real SSE endpoint will: tool calls appear
   * as they run, text arrives in chunks, and an inferred write comes back as
   * a PROPOSAL rather than an applied change (SPEC).
   */
  async *ask(
    question: string,
    ctx: { page: string; callIds: string[] },
  ): AsyncGenerator<Partial<AgentMessage> & { done?: boolean }> {
    const wantsWrite = /اصلاح|تصحیح|عوض کن|تغییر بده/.test(question);
    const tools: AgentToolCall[] = [
      {
        id: "tc-1",
        name: "search_transcripts",
        args_summary: `«${question.slice(0, 24)}»`,
        state: "running",
      },
    ];
    yield { tool_calls: [...tools] };
    await wait(null, 420);

    tools[0] = { ...tools[0]!, state: "done", result_summary: "۳ بازه پیدا شد" };
    if (ctx.callIds.length > 0) {
      tools.push({
        id: "tc-2",
        name: "read_window",
        args_summary: ctx.callIds.join("، "),
        state: "running",
      });
    }
    yield { tool_calls: [...tools] };
    await wait(null, 380);

    if (tools[1]) tools[1] = { ...tools[1], state: "done", result_summary: "۲ بازه خوانده شد" };
    yield { tool_calls: [...tools] };

    const answer = wantsWrite
      ? "پیشنهاد اصلاح آماده است؛ پیش از اعمال، تأیید شما لازم است."
      : `بر پایهٔ چیزی که در ${ctx.callIds.length > 0 ? "تماس‌های انتخاب‌شده" : "این صفحه"} پیدا شد: مهم‌ترین نکته، توافق بر کاهش زمان پاسخ‌گویی بحرانی به دو ساعت در ازای قرارداد دوساله بود. تأیید نهایی به بررسی مدیر طرف مقابل موکول شد.`;

    let sent = "";
    for (const chunk of answer.match(/.{1,28}/g) ?? []) {
      sent += chunk;
      yield { content: sent, streaming: true, tool_calls: [...tools] };
      await wait(null, 60);
    }

    const proposal: AgentProposal | null = wantsWrite
      ? {
          id: "pr-1",
          kind: "correct_transcript",
          description:
            "اصلاح خط ۰۰:۴۱ — «زمان پاسخ‌گویی بحرانی» به‌جای «زمان پاسخ‌گوی بحرانی»",
          target_call_id: ctx.callIds[0] ?? "c-1",
        }
      : null;

    yield {
      content: sent,
      streaming: false,
      tool_calls: [...tools],
      proposal,
      model_id: me.model_id ?? "google/gemini-3.1-pro",
      done: true,
    };
  },
};
