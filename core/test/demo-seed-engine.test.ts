/**
 * The demo seeding engine, on fakes (M52).
 *
 * Two things are being proved here and they are different in kind.
 *
 * The ORDER is a safety property: `app_user.id` IS an `auth.users.id` for a
 * human (db/0171), so the identities must exist before the door seats them,
 * and if the door then refuses, the identities this call minted have to go.
 * One shared event log across the fake auth admin and the fake database is
 * what makes "before" assertable at all — two separate spies can each be
 * right about their own half and say nothing about the sequence.
 *
 * The AUDIO-MISSING branch is a rule-12 property: a seed whose artefact is
 * not in the bucket must still produce the demo and must SAY which nothing it
 * hit. Its control is the same seed with the artefact present — without that,
 * a version that always reported "no audio" would satisfy every assertion
 * about the missing case.
 *
 * The fake database is a SQL matcher rather than a hand-shaped `Db`, because
 * the engine's own writes (the part row, the summary, the transcript) are
 * statements, and a fake that answers `withIdentity` with a fixed object
 * cannot tell a correct statement from an absent one.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Db, SqlTx } from "../src/db/identity.ts";
import type { Identity } from "../src/agent/types.ts";
import { resetCapabilityCache } from "../src/db/capabilities.ts";
import { packFor } from "../src/api/demo-seed/packs.ts";
import { buildTimeline } from "../src/api/demo-seed/timeline.ts";
import {
  contentStages, DEMO_DEFAULT_MODEL, seedDemoContent, type DemoRepos,
} from "../src/api/demo-seed/engine.ts";
import { createModelsRepo } from "../src/api/models.ts";
import { titleFrom } from "../src/api/sessions.ts";
import { dayBeforeAt } from "../src/api/demo-seed/timeline.ts";
import { ValidationError } from "../src/api/errors.ts";
import { catalogue } from "../src/agent/pi.ts";
import type { DemoStorage } from "../src/api/demo-seed/storage.ts";
import type { DemoAssetReader } from "../src/api/demo-seed/assets.ts";
import { bundledDemoAudio, bundledDemoAudioPath } from "../src/api/demo-seed/assets.ts";
import { demoAudioPath } from "../src/api/demo-seed/pack.ts";
import { createDemoOrgsRepo } from "../src/api/demo-orgs.ts";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import type { AuthAdmin } from "../src/api/demo-seed/auth-users.ts";

const OWNER: Identity = {
  userId: "11111111-1111-4111-8111-111111111111",
  orgId: "22222222-2222-4222-8222-222222222222",
  role: "owner",
  isActive: true,
};

const USER_IDS = {
  owner: OWNER.userId,
  reza: "33333333-3333-4333-8333-333333333331",
  mina: "33333333-3333-4333-8333-333333333332",
  ali: "33333333-3333-4333-8333-333333333333",
  hamid: "33333333-3333-4333-8333-333333333334",
} as const;

interface Logged { sql: string; params: readonly unknown[] }

/** one row of db/0211's ledger, as `readMeetingItems` publishes it */
interface SeededItem { id: string; kind: string; owner: string | null; owner_id: string | null }

/**
 * A database that answers by matching the statement, and records the order.
 *
 * `items` is what the `meeting_item` read answers, and it defaults to NOTHING
 * for a reason worth writing down: that default is what left the owner
 * resolution loop — the one whose failure emptied the demo's bell — completely
 * uncovered. An empty ledger skips the loop, and a skipped loop looks exactly
 * like a loop that resolved everything. Tests about the resolution pass their
 * own rows; the rest keep the empty default, because the pack's real item count
 * is `extractItems`' subject and not theirs.
 */
function fakeDb(log: string[], items: SeededItem[] = []) {
  const statements: Logged[] = [];
  let speakerSeq = 0;
  let partSeq = 0;
  let summarySeq = 0;

  const answer = (sql: string): unknown[] => {
    if (sql.includes("information_schema")) return [{ exists: true }];
    if (sql.includes("insert into echo.call_part")) return [{ id: `part-${partSeq++}` }];
    if (sql.includes("insert into echo.call_speaker")) {
      /* upsertSpeakers RETURNS id AND label and pairs them by name — the
         fake has to honour that or it would hide a mis-pairing */
      return [
        { id: `speaker-${speakerSeq++}`, label: "S1·1" },
        { id: `speaker-${speakerSeq++}`, label: "S2·1" },
      ];
    }
    if (sql.includes("insert into echo.summary")) return [{ id: `summary-${summarySeq++}` }];
    if (sql.includes("select status::text")) {
      return [{ status: "ready", current_summary_id: "summary-0" }];
    }
    if (sql.includes("platform_create_demo_org")) {
      return [{ platform_create_demo_org: "99999999-9999-4999-8999-999999999999" }];
    }
    if (sql.includes("platform_demo_orgs")) return [];
    if (sql.includes("from echo.meeting_item")) return items;
    if (sql.includes("o.status as org_status")) {
      /* resolveIdentity's own read: the demo owner, seated and active — the
         state the door has just produced */
      return [{
        id: OWNER.userId, org_id: OWNER.orgId, role: "owner",
        status: "active", org_status: "active",
      }];
    }
    return [];
  };

  const tx = (async () => []) as unknown as SqlTx;
  (tx as unknown as { unsafe: SqlTx["unsafe"] }).unsafe = (async (
    sql: string, params?: unknown[],
  ) => {
    statements.push({ sql, params: params ?? [] });
    if (sql.includes("platform_create_demo_org")) log.push("door");
    return answer(sql) as never[];
  }) as SqlTx["unsafe"];

  const db = {
    withIdentity: <T,>(_who: Identity, fn: (t: SqlTx) => Promise<T>) => fn(tx),
    withActor: <T,>(_who: string, fn: (t: SqlTx) => Promise<T>) => fn(tx),
    withoutIdentity: <T,>(fn: (t: SqlTx) => Promise<T>) => fn(tx),
  } as unknown as Db;

  return { db, statements };
}

function fakeRepos(calls: string[]) {
  let n = 0;
  const id = (prefix: string) => `${prefix}-${n++}`;
  const record = <T,>(name: string, value: T) => {
    calls.push(name);
    return Promise.resolve(value);
  };
  return {
    calls,
    repos: {
      directory: {
        create: vi.fn((_i, input) => record("directory.create", { id: id("person"), display_name: input.displayName })),
        update: vi.fn(() => record("directory.update", {})),
        updateSpeaker: vi.fn(() => record("directory.updateSpeaker", {})),
      },
      tasks: {
        createColumn: vi.fn((_i, name) => record("tasks.createColumn", { id: id("column"), name })),
        updateColumn: vi.fn(() => record("tasks.updateColumn", undefined)),
        create: vi.fn(() => record("tasks.create", { id: id("task") })),
        update: vi.fn(() => record("tasks.update", { id: "task" })),
      },
      meetings: {
        createTopic: vi.fn((_i, name) => record("meetings.createTopic", { id: id("topic"), name })),
        create: vi.fn(() => record("meetings.create", { id: id("meeting") })),
        update: vi.fn(() => record("meetings.update", {})),
        addAttendees: vi.fn(() => record("meetings.addAttendees", {})),
        markAttended: vi.fn(() => record("meetings.markAttended", undefined)),
        extractItems: vi.fn(() => record("meetings.extractItems", { added: 6, found: 6 })),
        /* 0217's aftermath door. Missing here, the engine's best-effort catch
           turned a TypeError into a report warning, and every
           `report.warnings` assertion in this file failed for a reason that
           had nothing to do with what it was asserting. */
        deliverMeetingCards: vi.fn(() => record("meetings.deliverMeetingCards", 0)),
      },
      org: { update: vi.fn(() => record("org.update", {})) },
      members: {
        updateProfile: vi.fn(() => record("members.updateProfile", {})),
        updateAssistantPrefs: vi.fn(() => record("members.updateAssistantPrefs", {})),
      },
      models: {
        /* the REAL wall — catalogue membership plus the product exclusion,
           synchronous and network-free. A fake that said yes to everything
           could not tell a seeded model from a seeded refusal (rule 9). */
        assertAskable: createModelsRepo({} as unknown as Db).assertAskable,
        choose: vi.fn((_i, model: string | null) =>
          record("models.choose", { preferred_model: model })),
      },
      lifecycle: { setCallStatus: vi.fn(() => record("lifecycle.setCallStatus", undefined)) },
      uploads: { createCall: vi.fn(() => record("uploads.createCall", { id: id("call") })) },
      sessions: {
        /* the REAL title rule — `resolveForAsk` derives a thread's name from
           the question, and a fake that made one up could not tell a seeded
           title from an invented one (the pack carries no title on purpose) */
        resolveForAsk: vi.fn((_i, _s, question: string) =>
          record("sessions.resolveForAsk", { id: id("session"), created: true, title: titleFrom(question) })),
        append: vi.fn(() => record("sessions.append", { id: id("message") })),
      },
    } as unknown as DemoRepos,
  };
}

/**
 * A bucket that either has every `_demo` object or none. `upload` is a spy
 * that never succeeds in making the object appear — `has` keeps answering
 * what it was told — so a seed that uploads and then copies is exercising
 * the engine's own `present` bookkeeping, not a fake that turned itself on.
 */
const storageThat = (copies: boolean): DemoStorage & { upload: ReturnType<typeof vi.fn> } => ({
  has: async () => copies,
  copy: async () => copies,
  upload: vi.fn(async () => {}),
});

/** No bundled file for any record — the "nothing anywhere" branch. */
const noAssets: DemoAssetReader = async (language, record, idx) => ({
  path: `/bundle/${language}/${record}-${idx}.wav`,
  bytes: null,
});

const timelineFor = (pack: ReturnType<typeof packFor>) =>
  buildTimeline({
    demoDate: "2026-09-09",
    offsetMinutes: 20,
    prior: pack.records[0]!,
    pricing: pack.records[1]!,
    now: new Date("2026-09-09T08:15:00.000Z"),
  });

beforeEach(() => {
  resetCapabilityCache();
});

describe("seeding a demo organisation's content", () => {
  for (const language of ["en", "fa"] as const) {
    it(`${language}: writes the whole demo through the product's own repositories`, async () => {
      const pack = packFor(language);
      const order: string[] = [];
      const { db, statements } = fakeDb(order);
      const { repos, calls } = fakeRepos([]);

      const report = await seedDemoContent({
        db, repos, identity: OWNER, pack, timeline: timelineFor(pack),
        userIds: { ...USER_IDS }, defaultModel: null, storage: storageThat(true),
      });

      expect(report.persons).toBe(pack.people.length + pack.outsiders.length);
      expect(report.columns).toBe(4);
      expect(report.topics).toBe(2);
      expect(report.tasks).toBe(pack.tasks.length);
      expect(report.records).toHaveLength(2);
      expect(report.glossary).toEqual(pack.glossary);
      expect(report.warnings).toEqual([]);

      /* the RECORDS come before the board, because the presenter's one open
         card links to the pricing call and a card cannot point at a call
         that does not exist yet */
      expect(calls.indexOf("uploads.createCall")).toBeLessThan(calls.indexOf("tasks.create"));

      /* every finished card got the checkbox, and only those */
      expect((repos.tasks.update as ReturnType<typeof vi.fn>).mock.calls.length)
        .toBe(pack.tasks.filter((t) => t.done).length);

      /* the transcript and the roster went through the WORKER's own writers */
      expect(statements.some((s) => s.sql.includes("insert into echo.transcript_segment"))).toBe(true);
      expect(statements.some((s) => s.sql.includes("insert into echo.call_speaker"))).toBe(true);
      /* and the summary was written without ever naming current_summary_id —
         db/0008's trigger owns that pointer */
      const summaryWrite = statements.find((s) => s.sql.includes("insert into echo.summary"));
      expect(summaryWrite).toBeDefined();
      expect(summaryWrite!.sql).not.toContain("current_summary_id");
    });
  }

  it("puts the presenter's card on the timeline's Tuesday, linked to the pricing call", async () => {
    const pack = packFor("en");
    const timeline = timelineFor(pack);
    const { db } = fakeDb([]);
    const { repos } = fakeRepos([]);
    const report = await seedDemoContent({
      db, repos, identity: OWNER, pack, timeline,
      userIds: { ...USER_IDS }, defaultModel: null, storage: storageThat(true),
    });

    const created = (repos.tasks.create as ReturnType<typeof vi.fn>).mock.calls;
    const quote = created
      .map(([, input]) => input as Record<string, unknown>)
      .find((input) => input.due_at === timeline.quoteDueAt.toISOString());
    expect(quote, "no card carries the timeline's Tuesday").toBeDefined();
    expect(quote!.call_id).toBe(report.records.find((r) => r.key === "pricing")!.callId);
    expect(quote!.assignees).toEqual([OWNER.userId]);
    expect(quote!.priority).toBe("medium");
  });

  it("schedules the upcoming meeting at the timeline's instant, in person", async () => {
    const pack = packFor("fa");
    const timeline = timelineFor(pack);
    const { db } = fakeDb([]);
    const { repos } = fakeRepos([]);
    await seedDemoContent({
      db, repos, identity: OWNER, pack, timeline,
      userIds: { ...USER_IDS }, defaultModel: null, storage: storageThat(true),
    });
    const meetings = (repos.meetings.create as ReturnType<typeof vi.fn>).mock.calls
      .map(([, input]) => input as Record<string, unknown>);
    const weekly = pack.upcoming.find((u) => u.key === "weekly")!;
    const upcoming = meetings.find((m) => m.title === weekly.title
      && m.scheduled_at === timeline.upcomingAt.toISOString());
    expect(upcoming, "the upcoming meeting is not on the timeline").toBeDefined();
    expect(upcoming!.mode).toBe("in_person");
    /* the schema has no recurrence for meetings, so the SENTENCE is the fact
       the assistant reads — a description that lost it would make "does this
       repeat?" unanswerable */
    expect(String(upcoming!.description)).toContain("هفته");
  });

  it("seeds EVERY upcoming meeting in the pack, and the customer demo is tomorrow at ten", async () => {
    for (const language of ["fa", "en"] as const) {
      const pack = packFor(language);
      const timeline = timelineFor(pack);
      const { db } = fakeDb([]);
      const { repos } = fakeRepos([]);
      const report = await seedDemoContent({
        db, repos, identity: OWNER, pack, timeline,
        userIds: { ...USER_IDS }, defaultModel: null, storage: storageThat(true),
      });
      const created = (repos.meetings.create as ReturnType<typeof vi.fn>).mock.calls
        .map(([, input]) => input as Record<string, unknown>);
      /* the two records are meetings too; the upcoming ones are the ones
         scheduled on or after the demo day */
      const future = created.filter((m) =>
        String(m.scheduled_at) >= "2026-09-09T00:00:00.000Z");
      expect(future.map((m) => m.title), language).toEqual(pack.upcoming.map((u) => u.title));
      expect(report.meetings, language).toBe(pack.upcoming.length);
      expect(report.upcomingMeetingIds, language).toHaveLength(pack.upcoming.length);

      const demo = pack.upcoming.find((u) => u.key === "customerDemo")!;
      const seeded = future.find((m) => m.title === demo.title)!;
      // 9 Sep + 1 = 10 Sep at 10:00 Tehran = 06:30 UTC — never "now"-relative
      expect(seeded.scheduled_at, language).toBe("2026-09-10T06:30:00.000Z");
      expect(seeded.duration_minutes, language).toBe(45);
      expect(seeded.mode, language).toBe("in_person");
      /* the customer's name is the pack's own — fa says پاسارگاد, en says
         Harbor Bank; a title in the other language is the packs disagreeing */
      expect(String(seeded.title), language)
        .toContain(language === "fa" ? "پاسارگاد" : "Harbor Bank");

      /* the presenter hosts (creates) it and Ali/Alex — who owns "Prepare
         the demo environment" — is in the room */
      const demoId = report.upcomingMeetingIds[pack.upcoming.indexOf(demo)]!;
      const attendees = (repos.meetings.addAttendees as ReturnType<typeof vi.fn>).mock.calls
        .find(([, id]) => id === demoId)!;
      expect(attendees, language).toBeDefined();
      expect(attendees[2], language).toEqual([OWNER.userId, USER_IDS.ali]);
    }
  });

  it("backdates each record onto its own instant", async () => {
    const pack = packFor("en");
    const timeline = timelineFor(pack);
    const { db, statements } = fakeDb([]);
    const { repos } = fakeRepos([]);
    await seedDemoContent({
      db, repos, identity: OWNER, pack, timeline,
      userIds: { ...USER_IDS }, defaultModel: null, storage: storageThat(true),
    });
    const backdates = statements
      .filter((s) => s.sql.includes("set started_at"))
      .map((s) => s.params[1]);
    expect(backdates).toEqual([
      timeline.priorAt.toISOString(),
      timeline.pricingAt.toISOString(),
    ]);
  });

  it("lets the meeting's items come out of the summary, never out of the pack", async () => {
    const pack = packFor("en");
    const { db } = fakeDb([]);
    const { repos } = fakeRepos([]);
    await seedDemoContent({
      db, repos, identity: OWNER, pack, timeline: timelineFor(pack),
      userIds: { ...USER_IDS }, defaultModel: null, storage: storageThat(true),
    });
    /* extractItems slices the summary and badges each row `ai` because it
       runs on the agent role (db/0160). Writing them by hand would badge
       them `user` and would be a second implementation of the extractor. */
    const extracted = (repos.meetings.extractItems as ReturnType<typeof vi.fn>).mock.calls;
    expect(extracted).toHaveLength(2);
    for (const [, meetingId, callId] of extracted) {
      expect(String(meetingId)).toMatch(/^meeting-/);
      expect(String(callId)).toMatch(/^call-/);
    }
  });

  describe("the presenter's conversation history", () => {
    /*
     * The gap this closes: a freshly seeded demo organisation opened the hub
     * — the product's FIRST page, the surface whose whole claim is "this team
     * has been working in here for weeks" — on "No conversations yet".
     *
     * Two properties are being proved and they are different in kind. That
     * the threads go through the PRODUCT's own writers is the M52 altitude
     * property: `resolveForAsk` is the only way a conversation comes into
     * existence and it is what titles the row, so a seed that wrote
     * `agent_session` directly would be seeding rows the hub could not have
     * produced. That they land in the PAST is a rendering property: the
     * sidebar reads `last_message_at`, `append` stamps it `now()` by design,
     * and without the backdate every seeded thread reads "just now" — five
     * conversations that all happened in the same second, which is the
     * opposite of the working week this exists to show.
     */
    const seed = async (language: "en" | "fa") => {
      const pack = packFor(language);
      const timeline = timelineFor(pack);
      const { db, statements } = fakeDb([]);
      const { repos, calls } = fakeRepos([]);
      const report = await seedDemoContent({
        db, repos, identity: OWNER, pack, timeline,
        userIds: { ...USER_IDS }, defaultModel: null, storage: storageThat(true),
      });
      return { pack, timeline, report, repos, statements, calls };
    };

    for (const language of ["en", "fa"] as const) {
      it(`${language}: opens every conversation through the hub's own resolveForAsk, titled from its first question`, async () => {
        const { pack, report, repos } = await seed(language);

        expect(report.conversations.map((c) => c.key), language)
          .toEqual(pack.conversations.map((c) => c.key));

        const opened = (repos.sessions.resolveForAsk as ReturnType<typeof vi.fn>).mock.calls;
        expect(opened, language).toHaveLength(pack.conversations.length);
        for (const [i, conversation] of pack.conversations.entries()) {
          const [who, sessionId, question] = opened[i]!;
          expect(who, language).toBe(OWNER);
          /* null, never an id: the product opens a thread LAZILY on an ask,
             and a "new chat" that pre-creates a row is the empty-sidebar
             shape sessions.ts refused */
          expect(sessionId, language).toBeNull();
          expect(question, language).toBe(conversation.turns[0]!.text);
          /* and the title the console reports is the one the repo derived */
          expect(report.conversations[i]!.title, language)
            .toBe(titleFrom(conversation.turns[0]!.text));
        }
      });

      it(`${language}: says every turn through append, in order, with no run and no tool calls`, async () => {
        const { pack, report, repos } = await seed(language);
        const appended = (repos.sessions.append as ReturnType<typeof vi.fn>).mock.calls
          .map(([, message]) => message as Record<string, unknown>);

        const expected = pack.conversations.flatMap((c) => c.turns);
        expect(appended.map((m) => m.content), language).toEqual(expected.map((t) => t.text));
        expect(appended.map((m) => m.role), language).toEqual(expected.map((t) => t.role));
        expect(report.conversations.map((c) => c.turns), language)
          .toEqual(pack.conversations.map((c) => c.turns.length));

        /* NOTHING RAN. An agent_run is the audit record of one model
           invocation (invariant 5) and none of these answers was invoked, so
           a run id or a tool-call code here would be a step trace for an
           execution that never happened — the fabricated-provenance failure
           the transcript's `source: "demo_seed"` already refuses. */
        for (const message of appended) {
          expect(message.agentRunId, language).toBeUndefined();
          expect(message.toolCalls, language).toBeUndefined();
        }
      });

      it(`${language}: backdates each thread onto its own day, and never onto the demo day`, async () => {
        const { pack, timeline, report, statements } = await seed(language);
        const backdates = statements.filter((s) =>
          s.sql.includes("update echo.agent_session") && s.sql.includes("set created_at"));
        expect(backdates, language).toHaveLength(pack.conversations.length);

        for (const [i, conversation] of pack.conversations.entries()) {
          const opened = dayBeforeAt(
            timeline.demoDate, conversation.daysBefore, conversation.hour, conversation.minute,
          );
          /* one minute per turn AFTER the first — an ordering claim, not a
             typing speed; a six-turn thread that opened and closed in the
             same second is the only reading a viewer could call wrong */
          const last = new Date(opened.getTime() + (conversation.turns.length - 1) * 60_000);
          expect(backdates[i]!.params[1], `${language}/${conversation.key}`)
            .toBe(opened.toISOString());
          expect(backdates[i]!.params[2], `${language}/${conversation.key}`)
            .toBe(last.toISOString());
          expect(report.conversations[i]!.lastMessageAt, language).toBe(last.toISOString());
          /* strictly in the past on the demo day: a conversation stamped
             later than the demo starts sorts above everything and reads as
             something the presenter has not said yet */
          expect(last.toISOString() < `${timeline.demoDate}T00:00:00.000Z`, `${language}/${conversation.key}`)
            .toBe(true);
        }
      });

      it(`${language}: leaves the TURNS' own stamps alone — the wall, not an omission`, async () => {
        /* db/0016 grants echo_app `select, insert` on echo.agent_message and
           nothing else. The control that makes the assertion above mean
           something: the backdate moves the thread's two stamps and NOTHING
           reaches for the messages, so a later version that "tidied up" by
           updating them would fail here rather than 42501 on a real seed. */
        const { statements } = await seed(language);
        expect(statements.some((s) => s.sql.includes("update echo.agent_message")), language)
          .toBe(false);
      });
    }

    it("writes the conversations AFTER the board and the meetings they talk about", async () => {
      /* not an FK — nothing joins a thread to a card — but the seed reads as
         a week that happened, and a history written before the work it
         discusses is a ledger nobody could have kept */
      const { calls } = await seed("en");
      expect(calls.indexOf("sessions.resolveForAsk"))
        .toBeGreaterThan(calls.lastIndexOf("tasks.create"));
      expect(calls.indexOf("sessions.resolveForAsk"))
        .toBeGreaterThan(calls.lastIndexOf("meetings.create"));
    });

    it("refuses a pack conversation that does not open with a question", async () => {
      /* the hub opens a thread FROM a question — `resolveForAsk` titles the
         row with it — so a conversation starting with an answer describes
         something the product cannot produce. A build fault, loud. */
      const pack = packFor("en");
      const broken = {
        ...pack,
        conversations: [{
          ...pack.conversations[0]!,
          turns: [{ role: "assistant" as const, text: "here you go" }],
        }],
      };
      const { db } = fakeDb([]);
      const { repos } = fakeRepos([]);
      await expect(seedDemoContent({
        db, repos, identity: OWNER, pack: broken, timeline: timelineFor(pack),
        userIds: { ...USER_IDS }, defaultModel: null, storage: storageThat(true),
      })).rejects.toThrow(/does not start with a question/);
    });
  });

  describe("the model the demo is left running on", () => {
    /* Found live (2026-09-09): a seeded org had allowed_models = [] and the
       presenter preferred_model = null, so on a deployment with no
       WORKER_SUMMARY_MODEL the summarizer skipped and the demo's live
       recording got no summary. ONE servable model is now written to both,
       through the product's own wall. */
    const chosen = (repos: DemoRepos) =>
      (repos.models.choose as unknown as ReturnType<typeof vi.fn>).mock.calls
        .map(([, model]) => model as string | null);
    const curated = (repos: DemoRepos) =>
      (repos.org.update as unknown as ReturnType<typeof vi.fn>).mock.calls
        .map(([, patch]) => (patch as { allowedModels?: string[] }).allowedModels)
        .filter((m): m is string[] => m !== undefined);

    it("curates the org and sets the owner to the deployment's env rung when it is set", async () => {
      const pack = packFor("en");
      const { db } = fakeDb([]);
      const { repos } = fakeRepos([]);
      const warn = vi.fn();
      /* a real catalogue id that is NOT the default — so "the env rung was
         used" is distinguishable from "the default was used" */
      const env = "openai/gpt-5.6-luna";
      expect(catalogue().some((m) => m.id === env)).toBe(true);
      const report = await seedDemoContent({
        db, repos, identity: OWNER, pack, timeline: timelineFor(pack),
        userIds: { ...USER_IDS }, defaultModel: env, storage: storageThat(true), warn,
      });
      expect(report.model).toBe(env);
      expect(chosen(repos)).toEqual([env]);
      expect(curated(repos)).toEqual([[env]]);
      expect(report.warnings).toEqual([]);
      expect(warn).not.toHaveBeenCalled();
      /* the owner's pick is written under the OWNER's identity — RLS is the
         wall, and a write as anybody else would be a different feature */
      expect((repos.models.choose as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0])
        .toBe(OWNER);
    });

    it("falls back to the runbook's default when the deployment names none", async () => {
      const pack = packFor("fa");
      const { db } = fakeDb([]);
      const { repos } = fakeRepos([]);
      const report = await seedDemoContent({
        db, repos, identity: OWNER, pack, timeline: timelineFor(pack),
        userIds: { ...USER_IDS }, defaultModel: null, storage: storageThat(true),
      });
      expect(report.model).toBe(DEMO_DEFAULT_MODEL);
      expect(chosen(repos)).toEqual([DEMO_DEFAULT_MODEL]);
      expect(curated(repos)).toEqual([[DEMO_DEFAULT_MODEL]]);
      /* the default must itself be a model this product serves, or every
         env-less deployment would seed a refusal — pinned against the real
         catalogue, the way model-ranking.test.ts pins the suggestion list */
      expect(catalogue().some((m) => m.id === DEMO_DEFAULT_MODEL)).toBe(true);
      expect(() => repos.models.assertAskable(DEMO_DEFAULT_MODEL)).not.toThrow();
    });

    it("writes NOTHING and says so when the env rung names a barred model", async () => {
      const pack = packFor("en");
      const { db } = fakeDb([]);
      const { repos } = fakeRepos([]);
      const warn = vi.fn();
      /* spelled the way the catalogue spells it — the leading `~` is what
         defeated the first no-Claude filter (2026-08-27), so the fixture is
         the real id, not the id the rule expects */
      const barred = catalogue().find((m) => m.id.toLowerCase().includes("claude"))?.id
        ?? "anthropic/claude-sonnet-4";
      const report = await seedDemoContent({
        db, repos, identity: OWNER, pack, timeline: timelineFor(pack),
        userIds: { ...USER_IDS }, defaultModel: barred, storage: storageThat(true), warn,
      });
      expect(report.model).toBeNull();
      expect(chosen(repos)).toEqual([]);
      expect(curated(repos)).toEqual([]);
      /* not silently the default either: an operator who set a barred
         WORKER_SUMMARY_MODEL learns it from this line, not from a demo that
         happened to work on a different model */
      expect(report.warnings).toHaveLength(1);
      expect(report.warnings[0]).toContain(barred);
      expect(report.warnings[0]).toContain("WORKER_SUMMARY_MODEL");
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]![0]).toMatchObject({
        event: "demo_model_unservable", model: barred, source: "WORKER_SUMMARY_MODEL",
      });
      /* and the rest of the demo still stands — a missing model may cost a
         summary, never the seed */
      expect(report.records).toHaveLength(2);
      expect(report.tasks).toBe(pack.tasks.length);
    });

    it("writes NOTHING for a model the catalogue does not carry", async () => {
      const pack = packFor("en");
      const { db } = fakeDb([]);
      const { repos } = fakeRepos([]);
      const report = await seedDemoContent({
        db, repos, identity: OWNER, pack, timeline: timelineFor(pack),
        userIds: { ...USER_IDS }, defaultModel: "acme/not-a-model", storage: storageThat(true),
      });
      expect(report.model).toBeNull();
      expect(chosen(repos)).toEqual([]);
      expect(curated(repos)).toEqual([]);
      expect(report.warnings.join("\n")).toContain("acme/not-a-model");
    });

    it("leaves the org uncurated when the person's pick is refused after the wall", async () => {
      /* `choose` is the stricter check (tool capability, where known). If
         it refuses, the org must NOT already be curated to that model — one
         empty state, not a curated org whose owner has no preference. */
      const pack = packFor("en");
      const { db } = fakeDb([]);
      const { repos } = fakeRepos([]);
      (repos.models.choose as unknown as ReturnType<typeof vi.fn>).mockImplementation(() =>
        Promise.reject(new ValidationError("model cannot call tools: x")));
      const report = await seedDemoContent({
        db, repos, identity: OWNER, pack, timeline: timelineFor(pack),
        userIds: { ...USER_IDS }, defaultModel: null, storage: storageThat(true),
      });
      expect(report.model).toBeNull();
      expect(curated(repos)).toEqual([]);
      expect(report.warnings.join("\n")).toContain("cannot call tools");
    });

    it("did not add a stage: the list the console shows is unchanged", () => {
      /* the model is written inside the last announced stage. A new stage
         here would change what the progress modal shows and what the job
         ledger carries — pinned whole, not by length */
      expect(contentStages(packFor("en"))).toEqual([
        "people", "board",
        "prior_audio", "prior_transcript", "prior_summary",
        "pricing_audio", "pricing_transcript", "pricing_summary",
        "tasks", "upcoming", "conversations", "glossary",
      ]);
    });
  });

  describe("when the pre-generated audio is not in the bucket", () => {
    it("seeds the record anyway, marks the part missing, and says so — when the bundle is missing too", async () => {
      const pack = packFor("en");
      const { db, statements } = fakeDb([]);
      const { repos } = fakeRepos([]);
      const storage = storageThat(false);
      const report = await seedDemoContent({
        db, repos, identity: OWNER, pack, timeline: timelineFor(pack),
        userIds: { ...USER_IDS }, defaultModel: null, storage, assets: noAssets,
      });

      // the demo is still a demo
      expect(report.records).toHaveLength(2);
      expect(report.tasks).toBe(pack.tasks.length);
      expect(statements.some((s) => s.sql.includes("insert into echo.transcript_segment"))).toBe(true);

      // ...and it names WHICH nothing, per record: the object's key AND the
      // bundled path it looked at, and the script that produces both
      expect(report.records.every((r) => r.audio === false)).toBe(true);
      expect(report.warnings).toHaveLength(2);
      expect(report.warnings.join("\n")).toContain("_demo/en/prior/part-0.wav");
      expect(report.warnings.join("\n")).toContain("/bundle/en/prior-0.wav");
      expect(report.warnings.join("\n")).toContain("/bundle/en/pricing-0.wav");
      expect(report.warnings.join("\n")).toContain("demo-audio-build");
      // nothing was uploaded — there was nothing to upload
      expect(storage.upload).not.toHaveBeenCalled();

      // the part row carries the absence, so the player is grey rather than 404
      const parts = statements.filter((s) => s.sql.includes("insert into echo.call_part"));
      expect(parts).toHaveLength(2);
      for (const part of parts) expect(part.params.at(-1)).toBe(true);
    });

    it("fills the cache from the BUNDLED recording, then copies — with the real bytes", async () => {
      /* the default reader on purpose (rule 9: a fixture from reality). This
         is the one assertion that core/assets/demo-audio and the generated
         audio.<lang>.ts describe the same bytes, and that the module URL
         resolves through a path with a space in it. */
      for (const language of ["en", "fa"] as const) {
        const pack = packFor(language);
        const { db, statements } = fakeDb([]);
        const { repos } = fakeRepos([]);
        const storage = storageThat(false);
        const copies: [string, string][] = [];
        storage.copy = async (source, destination) => {
          copies.push([source, destination]);
          return true;
        };
        const info = vi.fn();
        const warn = vi.fn();
        const report = await seedDemoContent({
          db, repos, identity: OWNER, pack, timeline: timelineFor(pack),
          userIds: { ...USER_IDS }, defaultModel: null, storage, info, warn,
        });

        expect(report.warnings, language).toEqual([]);
        expect(report.records.every((r) => r.audio === true), language).toBe(true);
        expect(warn, language).not.toHaveBeenCalled();

        /* one upload per part, under the `_demo` key, with bytes whose
           sha256 IS the pack's — the file on disk, not a fake's */
        const uploads = storage.upload.mock.calls as [string, Uint8Array, string][];
        expect(uploads.map(([key]) => key), language).toEqual(
          pack.records.flatMap((r) => r.audio.parts.map((p) => demoAudioPath(language, r.key, p.idx))),
        );
        for (const record of pack.records) {
          for (const part of record.audio.parts) {
            const upload = uploads.find(([key]) => key === demoAudioPath(language, record.key, part.idx))!;
            expect(upload[2], language).toBe("audio/wav");
            expect(upload[1].byteLength, language).toBe(part.byteSize);
            expect(createHash("sha256").update(upload[1]).digest("hex"), language).toBe(part.sha256);
          }
        }
        /* the upload precedes the copy of the same key */
        for (const [source] of copies) {
          expect(uploads.findIndex(([key]) => key === source), language).toBeGreaterThan(-1);
        }
        expect(copies.map(([source]) => source), language).toEqual(uploads.map(([key]) => key));
        /* said out loud, once per upload, codes and sizes only */
        expect(info.mock.calls.map(([fields]) => (fields as { event: string }).event), language)
          .toEqual(uploads.map(() => "demo_audio_asset_uploaded"));
        expect(info.mock.calls[0]![0], language).toMatchObject({
          language, record: "prior", idx: 0, key: demoAudioPath(language, "prior", 0),
        });
        /* the player is NOT grey */
        for (const part of statements.filter((s) => s.sql.includes("insert into echo.call_part"))) {
          expect(part.params.at(-1), language).toBe(false);
        }
      }
    });

    it("resolves the bundled path decoded, and the four recordings are there", () => {
      for (const language of ["en", "fa"] as const) {
        for (const record of ["prior", "pricing"] as const) {
          const path = bundledDemoAudioPath(language, record, 0);
          expect(path).not.toContain("%20");
          expect(path.endsWith(`${language}/${record}.wav`) || path.endsWith(`${language}\\${record}.wav`)).toBe(true);
          expect(existsSync(path), path).toBe(true);
        }
      }
    });

    it("answers a missing bundled file with its path rather than throwing", async () => {
      /* `idx: 7` names a part no record has — the ENOENT branch */
      const asset = await bundledDemoAudio("en", "prior", 7);
      expect(asset.bytes).toBeNull();
      expect(asset.path.endsWith("prior-part-7.wav")).toBe(true);
    });

    it("refuses to upload a bundled file whose sha256 is not the pack's — and warns loudly", async () => {
      const pack = packFor("en");
      const { db, statements } = fakeDb([]);
      const { repos } = fakeRepos([]);
      const storage = storageThat(false);
      const warn = vi.fn();
      const info = vi.fn();
      /* plausible bytes — a RIFF header and the right length is what a stale
         or hand-edited file would look like; only the hash tells them apart */
      const wrongBytes: DemoAssetReader = async (language, record, idx) => ({
        path: `/bundle/${language}/${record}-${idx}.wav`,
        bytes: new Uint8Array(Buffer.from("RIFF....WAVEfmt not the recording the pack measured")),
      });
      const report = await seedDemoContent({
        db, repos, identity: OWNER, pack, timeline: timelineFor(pack),
        userIds: { ...USER_IDS }, defaultModel: null, storage, assets: wrongBytes, warn, info,
      });

      expect(storage.upload).not.toHaveBeenCalled();
      expect(info).not.toHaveBeenCalled();
      expect(report.records.every((r) => r.audio === false)).toBe(true);
      expect(warn).toHaveBeenCalledTimes(2);
      expect(warn.mock.calls[0]![0]).toMatchObject({
        event: "demo_audio_asset_mismatch",
        language: "en", record: "prior", idx: 0,
        path: "/bundle/en/prior-0.wav",
        expected: pack.records[0]!.audio.parts[0]!.sha256,
      });
      expect((warn.mock.calls[0]![0] as { actual: string }).actual).toMatch(/^[0-9a-f]{64}$/);
      expect(report.warnings).toHaveLength(2);
      expect(report.warnings[0]).toContain("/bundle/en/prior-0.wav");
      expect(report.warnings[0]).toContain(pack.records[0]!.audio.parts[0]!.sha256);
      expect(report.warnings[0]).toContain("demo-audio-build");
      /* and the demo is still a demo, with a grey player */
      expect(report.records).toHaveLength(2);
      for (const part of statements.filter((s) => s.sql.includes("insert into echo.call_part"))) {
        expect(part.params.at(-1)).toBe(true);
      }
    });

    it("uploads NOTHING when the object is already in the bucket — the control", async () => {
      const pack = packFor("en");
      const { db } = fakeDb([]);
      const { repos } = fakeRepos([]);
      const storage = storageThat(true);
      /* a reader that would EXPLODE if consulted — presence must short-circuit it */
      const neverRead: DemoAssetReader = async () => {
        throw new Error("the bundle was read although the object was present");
      };
      const info = vi.fn();
      const report = await seedDemoContent({
        db, repos, identity: OWNER, pack, timeline: timelineFor(pack),
        userIds: { ...USER_IDS }, defaultModel: null, storage, assets: neverRead, info,
      });
      expect(storage.upload).not.toHaveBeenCalled();
      expect(info).not.toHaveBeenCalled();
      expect(report.warnings).toEqual([]);
      expect(report.records.every((r) => r.audio === true)).toBe(true);
    });

    it("marks nothing missing when the artefact IS there — the control", async () => {
      const pack = packFor("en");
      const { db, statements } = fakeDb([]);
      const { repos } = fakeRepos([]);
      const report = await seedDemoContent({
        db, repos, identity: OWNER, pack, timeline: timelineFor(pack),
        userIds: { ...USER_IDS }, defaultModel: null, storage: storageThat(true),
      });
      expect(report.warnings).toEqual([]);
      expect(report.records.every((r) => r.audio === true)).toBe(true);
      for (const part of statements.filter((s) => s.sql.includes("insert into echo.call_part"))) {
        expect(part.params.at(-1)).toBe(false);
      }
    });

    it("says so when the deployment has no storage at all — a different nothing", async () => {
      const pack = packFor("en");
      const { db } = fakeDb([]);
      const { repos } = fakeRepos([]);
      const report = await seedDemoContent({
        db, repos, identity: OWNER, pack, timeline: timelineFor(pack),
        userIds: { ...USER_IDS }, defaultModel: null, storage: null,
      });
      expect(report.warnings.join("\n")).toContain("no storage is configured");
      expect(report.warnings.join("\n")).not.toContain("is not in the call-audio bucket");
    });
  });
});

describe("creating the organisation", () => {
  const authThat = (
    log: string[], fail?: { at: number }, removeFails = false,
  ): { admin: AuthAdmin; created: string[]; removed: string[] } => {
    const created: string[] = [];
    const removed: string[] = [];
    let n = 0;
    return {
      created, removed,
      admin: {
        async create(email) {
          if (fail !== undefined && n === fail.at) throw new Error("auth refused");
          const id = `44444444-4444-4444-8444-00000000000${n++}`;
          created.push(email);
          log.push(`auth:${email}`);
          return { id, email };
        },
        async remove(id) {
          if (removeFails) throw new Error("cannot remove");
          removed.push(id);
          log.push(`unmint:${id}`);
        },
      },
    };
  };

  const input = {
    name: "Demo Org For A Test",
    language: "en",
    demo_date: "2026-09-09",
    offset_minutes: 20,
    reason: "a test of the seeding order",
  };

  it("mints every identity BEFORE the door is asked to seat them", async () => {
    const order: string[] = [];
    const { db } = fakeDb(order);
    const { repos } = fakeRepos([]);
    const auth = authThat(order);
    const repo = createDemoOrgsRepo({
      db, repos, auth: auth.admin, storage: storageThat(true),
      now: () => new Date("2026-09-09T08:15:00.000Z"),
    });

    const result = await repo.create(OWNER, input);
    expect(result.org_id).toBe("99999999-9999-4999-8999-999999999999");

    /* the load-bearing assertion: db/0171 refuses a human app_user whose id
       is not an auth identity, so a door called first cannot work */
    const doorAt = order.indexOf("door");
    expect(doorAt).toBeGreaterThan(-1);
    expect(order.slice(0, doorAt).filter((e) => e.startsWith("auth:"))).toHaveLength(5);
    expect(order.slice(doorAt).some((e) => e.startsWith("auth:"))).toBe(false);
  });

  it("hands the door the ids the auth service returned, one of them the owner", async () => {
    const { db, statements } = fakeDb([]);
    const { repos } = fakeRepos([]);
    const auth = authThat([]);
    const repo = createDemoOrgsRepo({
      db, repos, auth: auth.admin, storage: storageThat(true),
      now: () => new Date("2026-09-09T08:15:00.000Z"),
    });
    await repo.create(OWNER, input);

    const call = statements.find((s) => s.sql.includes("platform_create_demo_org"));
    expect(call).toBeDefined();
    /* the people ride as a serialised string, so the cast must travel with
       the value: `$5::jsonb` hands the door a JSON STRING and it refuses
       "people must be a json array" (found on the console, 2026-09-09) */
    expect(call!.sql).toMatch(/\$5::text::jsonb/);
    const people = JSON.parse(String(call!.params[4])) as Record<string, string>[];
    expect(people).toHaveLength(5);
    expect(people.filter((p) => p.role === "owner")).toHaveLength(1);
    expect(people.map((p) => p.id)).toEqual([
      "44444444-4444-4444-8444-000000000000",
      "44444444-4444-4444-8444-000000000001",
      "44444444-4444-4444-8444-000000000002",
      "44444444-4444-4444-8444-000000000003",
      "44444444-4444-4444-8444-000000000004",
    ]);
    /* the presenter's default address is derived, not typed */
    expect(people[0]!.email).toBe("demo-demo-org-for-a-test-20260909@demo.neurai.invalid");
  });

  it("returns the presenter's password once and never sends it to the door", async () => {
    const { db, statements } = fakeDb([]);
    const { repos } = fakeRepos([]);
    const auth = authThat([]);
    const repo = createDemoOrgsRepo({
      db, repos, auth: auth.admin, storage: storageThat(true),
      now: () => new Date("2026-09-09T08:15:00.000Z"),
    });
    const result = await repo.create(OWNER, input);

    expect(result.owner.password.length).toBeGreaterThanOrEqual(24);
    expect(result.owner.email).toBe(result.owner.email.toLowerCase());
    /* nothing that reaches the database may carry it — not the people
       payload, not the audit reason */
    for (const statement of statements) {
      expect(JSON.stringify(statement.params)).not.toContain(result.owner.password);
    }
  });

  it("removes every identity it minted when the door refuses", async () => {
    const order: string[] = [];
    const { db } = fakeDb(order);
    const { repos } = fakeRepos([]);
    const auth = authThat(order);
    /* the door refuses — the state this unwind exists for */
    const failing = {
      ...db,
      withIdentity: <T,>(_who: Identity, fn: (t: SqlTx) => Promise<T>) => {
        const tx = (async () => []) as unknown as SqlTx;
        (tx as unknown as { unsafe: SqlTx["unsafe"] }).unsafe = (async (sql: string) => {
          if (sql.includes("platform_create_demo_org")) {
            const error = new Error("an active organization already has this name");
            (error as { code?: string }).code = "23505";
            throw error;
          }
          return [] as never[];
        }) as SqlTx["unsafe"];
        return fn(tx);
      },
    } as unknown as Db;

    const repo = createDemoOrgsRepo({
      db: failing, repos, auth: auth.admin, storage: storageThat(true),
      now: () => new Date("2026-09-09T08:15:00.000Z"),
    });
    await expect(repo.create(OWNER, input)).rejects.toThrow(/already has this name/);
    expect(auth.removed).toHaveLength(5);
    expect(order.filter((e) => e.startsWith("unmint:"))).toHaveLength(5);
  });

  it("NAMES the identities it could not remove rather than swallowing them", async () => {
    const order: string[] = [];
    const { db } = fakeDb(order);
    const { repos } = fakeRepos([]);
    /* the third create fails, and the clean-up of the first two fails too —
       an operator has to be told which accounts are standing */
    const auth = authThat(order, { at: 2 }, true);
    const repo = createDemoOrgsRepo({
      db, repos, auth: auth.admin, storage: storageThat(true),
      now: () => new Date("2026-09-09T08:15:00.000Z"),
    });
    await expect(repo.create(OWNER, input)).rejects.toThrow(
      /2 auth identity\/identities could not be removed and remain: 44444444-4444-4444-8444-000000000000, 44444444-4444-4444-8444-000000000001/,
    );
  });

  it("refuses before minting anything when auth is not configured", async () => {
    const { db } = fakeDb([]);
    const { repos } = fakeRepos([]);
    const repo = createDemoOrgsRepo({
      db, repos, auth: null, storage: storageThat(true),
      now: () => new Date("2026-09-09T08:15:00.000Z"),
    });
    await expect(repo.create(OWNER, input)).rejects.toThrow(/Supabase auth configuration/);
  });

  it("refuses a language, a date and an offset it cannot honour", async () => {
    const { db } = fakeDb([]);
    const { repos } = fakeRepos([]);
    const auth = authThat([]);
    const repo = createDemoOrgsRepo({
      db, repos, auth: auth.admin, storage: storageThat(true),
      now: () => new Date("2026-09-09T08:15:00.000Z"),
    });
    await expect(repo.create(OWNER, { ...input, language: "de" })).rejects.toThrow(/en or fa/);
    await expect(repo.create(OWNER, { ...input, demo_date: "2026-02-30" })).rejects.toThrow(/real YYYY-MM-DD/);
    await expect(repo.create(OWNER, { ...input, offset_minutes: 0 })).rejects.toThrow(/1 and 1440/);
    await expect(repo.create(OWNER, { ...input, reason: "x" })).rejects.toThrow(/reason is required/);
    /* nothing was minted on any of those paths */
    expect(auth.created).toEqual([]);
  });

  it("announces exactly the stages it promised, in the order it promised them", async () => {
    /* rule 10: the job's stage list and the engine's announcements come from
       ONE function — this is the assertion that keeps them one. A stage the
       list forgot would show a bar stalled on the stage before it; a stage
       announced out of order would show a bar going backwards. */
    const { db } = fakeDb([]);
    const { repos } = fakeRepos([]);
    const auth = authThat([]);
    const repo = createDemoOrgsRepo({
      db, repos, auth: auth.admin, storage: storageThat(true),
      now: () => new Date("2026-09-09T08:15:00.000Z"),
    });
    const prepared = repo.prepareCreate(OWNER, input);
    /* the refusal is SYNCHRONOUS and nothing has been minted: a route can
       answer 400 before it opens a job */
    expect(auth.created).toEqual([]);
    expect(() => repo.prepareCreate(OWNER, { ...input, language: "de" })).toThrow(/en or fa/);

    const announced: string[] = [];
    await prepared.run((stage) => announced.push(stage));
    expect(announced).toEqual(prepared.stages);
    expect(prepared.stages.slice(0, 2)).toEqual(["identities", "organization"]);
    expect(prepared.stages).toContain("prior_transcript");
    expect(prepared.stages).toContain("pricing_summary");
  });
});

/**
 * THE SPOKEN OWNER BECOMES AN ACCOUNT, and nothing watched it.
 *
 * `extractItems` slices prose: it writes db/0160's free-text `owner` and leaves
 * db/0211's `owner_id` NULL, because a prose slicer holds no roster. db/0217's
 * aftermath door then joins `app_user` ON `owner_id` — so with the resolution
 * loop broken, every demo organisation got zero commitment cards, no error, and
 * nothing in the log. The demo of the feature whose whole point is that the
 * platform tells people what they owe was the one place it told nobody.
 *
 * WHY IT WAS UNCOVERED, which is the part worth fixing permanently: the fake
 * answered `[]` to the `meeting_item` read, so the loop had nothing to iterate
 * and every assertion about the seed passed. An empty ledger and a ledger whose
 * every owner resolved produce the same zero updates. The rows below are that
 * missing input, and they are the PACK's own names — the summaries really do say
 * «— owner: Alex Turner» and «— مسئول: علی نجفی», and «NAI» really is an
 * outsider with no account.
 */
describe("the spoken owner becomes an account", () => {
  /* THREE rows, and the third is the one that makes the other two mean
     something: two names that both resolve cannot tell "resolved the right
     people" from "resolved everybody it was handed". */
  const EN_ITEMS: SeededItem[] = [
    { id: "item-alex", kind: "action", owner: "Alex Turner", owner_id: null },
    { id: "item-sarah", kind: "action", owner: "Sarah Mitchell", owner_id: null },
    { id: "item-nai", kind: "action", owner: "NAI", owner_id: null },
  ];

  const ownerUpdates = (statements: Logged[]): Logged[] =>
    statements.filter((s) => s.sql.includes("update echo.meeting_item"));

  const seed = async (language: "en" | "fa", items: SeededItem[]) => {
    const pack = packFor(language);
    const { db, statements } = fakeDb([], items);
    const { repos } = fakeRepos([]);
    const report = await seedDemoContent({
      db, repos, identity: OWNER, pack, timeline: timelineFor(pack),
      userIds: { ...USER_IDS }, defaultModel: null, storage: storageThat(true),
    });
    return { report, statements, pack };
  };

  it("gives each commitment the account its name resolved to — and the outsider none", async () => {
    const { report, statements } = await seed("en", EN_ITEMS);

    /* two per record, and the pack seeds two records */
    expect(report.records.map((r) => r.owners)).toEqual([2, 2]);
    const updates = ownerUpdates(statements);
    expect(updates).toHaveLength(2 * report.records.length);

    /* WHO, by id. A loop that resolved to the wrong colleague writes the same
       number of rows and is wrong in the only way that reaches a person's bell. */
    expect(new Set(updates.map((s) => s.params[1])))
      .toEqual(new Set([USER_IDS.ali, OWNER.userId]));

    /*
     * THE NEGATIVE IS THE DISCRIMINATING HALF. «NAI» is an outsider with no
     * account, so the item keeps its spoken name and no `owner_id` — db/0211's
     * own "exactly or not at all". A loop that matched loosely, or that assigned
     * the host as a fallback, passes every assertion above.
     */
    expect(updates.map((s) => s.params[0])).not.toContain("item-nai");
    expect(report.warnings).toEqual([]);
  });

  it("the update names the WALL it writes through: owner_id, on an action, and nothing else", async () => {
    /* `source` must not drift here (db/0160's immutability trigger refuses it
       for every role) and neither must `kind` — the statement is the wall's own
       spelling and a widened one would make a decision ownable by this path */
    const { statements } = await seed("en", EN_ITEMS);
    const [update] = ownerUpdates(statements);
    expect(update!.sql).toContain("set owner_id = $2");
    expect(update!.sql).toContain("kind = 'action'");
    expect(update!.sql).not.toContain("source");
  });

  it("folds an ARABIC-KEYBOARD spelling onto the Persian account", async () => {
    /*
     * «علي نجفي» is what an Arabic keyboard produces for «علی نجفی»: Arabic yeh
     * U+064A where Persian has U+06CC. `foldName` is the product's own fold and
     * this is the case it exists for — unfolded, the commonest mis-spelling of a
     * name in this market resolves to nobody, and the symptom is an empty bell
     * for the one person the demo is being shown to.
     *
     * Asserted here rather than on `foldName` directly, because what went wrong
     * was never the fold: it was whether this loop asked for it.
     */
    const { report, statements } = await seed("fa", [
      { id: "item-ali", kind: "action", owner: "علي نجفي", owner_id: null },
    ]);
    expect(report.records.map((r) => r.owners)).toEqual([1, 1]);
    expect(ownerUpdates(statements).map((s) => s.params[1]))
      .toEqual([USER_IDS.ali, USER_IDS.ali]);
  });

  it("says so LOUDLY when NOTHING resolved — an empty bell reads as a missing feature", async () => {
    /*
     * Every pack names at least one colleague as an owner, so zero resolutions
     * means the marker, the fold or the roster have stopped agreeing. The forfeit
     * is said out loud (M21) because the downstream symptom — a bell with nothing
     * in it — is indistinguishable from a feature that was never built, which is
     * exactly how this went unnoticed.
     */
    const { report, pack } = await seed("en", [
      { id: "item-nai", kind: "action", owner: "NAI", owner_id: null },
    ]);
    expect(report.records.map((r) => r.owners)).toEqual([0, 0]);
    for (const record of pack.records) {
      expect(
        report.warnings.some((w) => w.startsWith(`${record.key}:`) && w.includes("owe")),
        `${record.key} resolved nobody and said nothing`,
      ).toBe(true);
    }
  });

  it("touches neither a decision nor a row the extractor already owned", async () => {
    /*
     * The two skips, and both are real: a DECISION has no owner to tell (0160's
     * five kinds, and only `action` is something somebody owes), and a row that
     * already carries an `owner_id` was resolved by the writer that made it —
     * overwriting it here would let this seed's pack-shaped roster outrank the
     * product's own answer.
     */
    const { statements } = await seed("en", [
      { id: "item-decision", kind: "decision", owner: "Alex Turner", owner_id: null },
      { id: "item-taken", kind: "action", owner: "Alex Turner", owner_id: USER_IDS.ali },
      { id: "item-open", kind: "action", owner: "Sarah Mitchell", owner_id: null },
    ]);
    /* one per record, and the same row each time */
    expect(ownerUpdates(statements).map((s) => s.params[0])).toEqual(["item-open", "item-open"]);
  });
});
