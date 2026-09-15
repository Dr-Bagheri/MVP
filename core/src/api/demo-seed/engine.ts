/**
 * The demo SEEDING ENGINE (M52) — what a demo organisation contains, written
 * by the product's own hands.
 *
 * Every content row here is created the way the screen creates it: the board
 * through createTasksRepo, the folders and meetings through
 * createMeetingsRepo, the directory through createDirectoryRepo, the
 * organisation's glossary through createOrgRepo, the presenter's preferences
 * through createMembersRepo, the calls through uploads.createCall, the
 * roster and the transcript through the WORKER's own `upsertSpeakers` and
 * `writeTranscript`, the presenter's conversation history through
 * createSessionsRepo's own `resolveForAsk` and `append`, and the meeting's
 * decisions and action items through
 * `meetings.extractItems` — which slices the summary this file just wrote and
 * badges each item `ai` because it runs on the agent role (db/0160). All of
 * it under the demo OWNER's identity, so RLS, the column triggers and the
 * speaker-link wall are the same walls a person meets.
 *
 * That is a deliberate change of altitude from db/scripts/seed-demo*.mjs,
 * which write the same rows as the database owner. Those scripts still exist
 * and still work; this exists because a demo organisation created from the
 * console must be a demo organisation the product could have produced. A seed
 * that writes rows the product cannot is a demo of something we do not ship.
 *
 * What it costs, said out loud rather than discovered: `created_at` on most
 * rows is the moment of seeding, not the demo's fictional past. Only the
 * things a reader actually reads a date on — the call's `started_at`, a
 * card's deadline and its `done_at`, a meeting's `scheduled_at` — are moved
 * onto the timeline, because those are the ones a repo or the owner's own
 * grant can move.
 */

import type { Identity } from "../../agent/types.ts";
import type { Db } from "../../db/identity.ts";
import type { TasksRepo } from "../tasks.ts";
import type { MeetingsRepo } from "../meetings.ts";
import type { DirectoryRepo } from "../directory.ts";
import type { MembersRepo } from "../members.ts";
import type { OrgRepo } from "../org.ts";
import type { ModelsRepo } from "../models.ts";
import { ValidationError } from "../errors.ts";
import type { UploadsRepo } from "../uploads.ts";
import type { Lifecycle, PartRow } from "../../worker/lifecycle.ts";
import type { MappedSegment } from "../../worker/transcript-mapping.ts";
import { upsertSpeakers, writeTranscript } from "../../worker/steps.ts";
import { hasSegmentLanguage } from "../../db/capabilities.ts";
import type {
  DemoConversationKey, DemoPack, DemoPerson, DemoPersonKey, DemoRecord, DemoRecordKey,
} from "./pack.ts";
import { demoAudioPath } from "./pack.ts";
import type { DemoTimeline } from "./timeline.ts";
import { dayAfterAt, dayBeforeAt, doneAt, taskDueAt } from "./timeline.ts";
import type { DemoStorage } from "./storage.ts";
import { DEMO_BUCKET, seededPartPath } from "./storage.ts";
import type { DemoAssetReader } from "./assets.ts";
import { bundledDemoAudio } from "./assets.ts";
import { createHash } from "node:crypto";
import {
  backdateCall, backdateConversation, insertPart, insertSummary, readCallState,
  readMeetingItems, setMeetingItemOwner, setSpeakerSample,
} from "./writes.ts";
import type { SessionsRepo } from "../sessions.ts";
import { titleFrom } from "../sessions.ts";
/* THE PRODUCT'S OWN RESOLVER, imported rather than re-stated. `resolveOwner`
   is the summarizer's rule for turning a name somebody SPOKE into an account —
   folded on both sides, matched WHOLE, and null when two people match — and
   `foldName` is the single spelling it compares in (ي/ى → ی, ك → ک, ZWNJ
   dropped). A demo-local copy would be a second resolution rule, and the first
   week the two disagreed the demo would be showing behaviour the product does
   not have. */
import { resolveOwner } from "../../worker/extract-decisions.ts";
import { foldName } from "../../agent/router.ts";

/**
 * The model a seeded summary is attributed to.
 *
 * It is a real model name and the text was NOT produced by it, which is a
 * thing worth being uncomfortable about — so the provenance says `demo_seed`
 * on every transcript line beside it, and `echo.org.demo` says the whole
 * organisation is a demo. Naming a model the product actually serves is what
 * makes the summary card render as it will on a customer's first real call;
 * naming a fake one would put a string on screen that no deployment can
 * explain.
 */
export const DEMO_SUMMARY_MODEL = "google/gemini-3.1-pro-preview";

/**
 * The model a seeded organisation is LEFT RUNNING ON, when the deployment
 * names none.
 *
 * Found live (2026-09-09): a console-seeded demo org had `allowed_models = []`
 * and the presenter's `preferred_model = null`, so on a deployment without
 * `WORKER_SUMMARY_MODEL` the summarizer walked M5's ladder to the bottom and
 * skipped — "no model available for the call owner" — and the demo's one live
 * recording got no summary. Everything above worked; the demo failed at the
 * exact moment it was being shown.
 *
 * This is the runbook's own operator value (docs/PLATFORM-OPERATIONS-RUNBOOK
 * .md, the M5 env rung), so a deployment that reads this file and one that
 * reads the env agree. It is still checked against the catalogue and the
 * product exclusion at seed time — a constant is not exempt from the wall.
 */
export const DEMO_DEFAULT_MODEL = "google/gemini-2.5-flash";

export interface DemoRepos {
  tasks: TasksRepo;
  meetings: MeetingsRepo;
  directory: DirectoryRepo;
  members: MembersRepo;
  org: OrgRepo;
  uploads: UploadsRepo;
  lifecycle: Lifecycle;
  /**
   * The model wall and the person's own pick. `assertAskable` is the same
   * catalogue-plus-exclusion check every route that names a model passes;
   * `choose` is the product's one writer of `preferred_model`. Seeding
   * through them rather than writing the column means a demo cannot be
   * left on a model the product would then refuse.
   */
  models: Pick<ModelsRepo, "assertAskable" | "choose">;
  /**
   * The assistant's own conversation store. `resolveForAsk` is the product's
   * ONLY way a thread comes into existence — it opens one lazily on an ask
   * and titles it from the question — and `append` is its only way a turn
   * gets said. Seeding through them means the demo's history is history the
   * hub could have produced, rather than rows shaped like it.
   */
  sessions: Pick<SessionsRepo, "resolveForAsk" | "append">;
}

/** One structured line, fields first — the api's own `log.warn` shape. */
export type SeedWarn = (fields: Record<string, unknown>, message: string) => void;

export interface SeedContentInput {
  db: Db;
  repos: DemoRepos;
  /** the demo OWNER — every write below is theirs */
  identity: Identity;
  pack: DemoPack;
  timeline: DemoTimeline;
  /** the ids the door seated, by pack key */
  userIds: Record<DemoPersonKey, string>;
  /** null when the deployment has no storage configured at all */
  storage: DemoStorage | null;
  /**
   * Where the bundled recordings are read from when the `_demo` object is
   * not in the bucket. Defaults to the files under core/assets/demo-audio;
   * a test hands in bytes or an absence. See assets.ts.
   */
  assets?: DemoAssetReader | undefined;
  /**
   * The deployment's M5 env rung (`WORKER_SUMMARY_MODEL`), read ONCE by the
   * entrypoint and handed in — the engine never reads the environment, so a
   * test can hand it a value and a value can be absent on purpose. null =
   * not set, and `DEMO_DEFAULT_MODEL` stands in.
   */
  defaultModel: string | null;
  /** Where a non-fatal finding goes besides the report. Codes only. */
  warn?: SeedWarn | undefined;
  /** Where a noteworthy non-finding goes (the one-time cache fill). Codes only. */
  info?: SeedWarn | undefined;
  /**
   * Called as each stage of `contentStages(pack)` BEGINS. The seed takes
   * minutes, and the console's progress modal shows exactly what this
   * reports — so the stage names here are the stage names on screen, and
   * the list a job carries is derived from the same function (rule 10:
   * the producer owns the shape).
   */
  progress?: SeedProgress;
}

/** What the engine reports as it goes; see `demo-seed/jobs.ts`. */
export type SeedProgress = (stage: string) => void;

/**
 * The stages `seedDemoContent` announces, in the order it announces them.
 *
 * Derived from the pack rather than written out, because the records are the
 * bulk of the work (audio copies, hundreds of transcript rows each) and a
 * list that forgot one would show a bar that stalls on "board" for two
 * minutes — which is the stuck screen this exists to replace.
 */
export function contentStages(pack: Pick<DemoPack, "records">): string[] {
  return [
    "people",
    "board",
    ...pack.records.flatMap((record) => [
      `${record.key}_audio`,
      `${record.key}_transcript`,
      `${record.key}_summary`,
    ]),
    "tasks",
    "upcoming",
    "conversations",
    "glossary",
  ];
}

export interface SeededRecord {
  key: DemoRecordKey;
  callId: string;
  meetingId: string;
  segments: number;
  speakers: number;
  items: number;
  /**
   * How many action items ended up owned by an ACCOUNT (db/0211's `owner_id`),
   * rather than only by the name the summary said. Reported rather than
   * counted silently, because it is the number whose being zero was the whole
   * defect: no owner, no aftermath card, and nothing in the log either.
   */
  owners: number;
  /** db/0217's bell cards this record's aftermath delivered. */
  cards: number;
  /** false when the pre-generated audio was not in the bucket */
  audio: boolean;
}

export interface SeededConversation {
  key: DemoConversationKey;
  sessionId: string;
  /**
   * What the sidebar will show. Not a pack field and not a second rule —
   * `sessions.titleFrom`, the same function `resolveForAsk` titled the row
   * with, so the console and the sidebar cannot disagree.
   */
  title: string;
  turns: number;
  /** when the sidebar will say it last moved */
  lastMessageAt: string;
}

export interface SeedReport {
  persons: number;
  columns: number;
  topics: number;
  tasks: number;
  records: SeededRecord[];
  /** the upcoming, unrecorded meetings — one id per pack entry, in order */
  upcomingMeetingIds: string[];
  /** how many upcoming meetings were seeded (= the pack's list) */
  meetings: number;
  /**
   * The presenter's seeded conversation history — one entry per pack
   * conversation, in the pack's order. Reported rather than counted, because
   * "five conversations" and "five conversations with fourteen turns between
   * them" are different demos, and the console is the only place anybody
   * learns which one was written.
   */
  conversations: SeededConversation[];
  glossary: string[];
  /**
   * The model the organisation was curated to and the presenter set to —
   * ONE id, written to both `org.allowed_models` and the owner's
   * `preferred_model`. null when it could not be set, in which case
   * `warnings` says why and the summarizer will skip until an operator
   * sets one (M5: a missing model may cost a summary, never a call).
   */
  model: string | null;
  /**
   * Everything that did not go as intended but did not stop the seed. Rule
   * 12: a demo seeded without its audio is a different outcome from a demo
   * seeded with it, and the console must be able to tell them apart.
   */
  warnings: string[];
}

/** The seed writes a lot of rows; a failure names the step it was on. */
export class DemoSeedError extends Error {
  readonly step: string;
  constructor(step: string, cause: unknown) {
    super(`the demo seed failed at ${step}: ${describe(cause)}`);
    this.name = "DemoSeedError";
    this.step = step;
  }
}

const describe = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

async function step<T>(name: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (cause) {
    throw new DemoSeedError(name, cause);
  }
}

// ── the content ────────────────────────────────────────────────────────────

export async function seedDemoContent(input: SeedContentInput): Promise<SeedReport> {
  const { repos, identity, pack, timeline, userIds } = input;
  const warnings: string[] = [];
  const progress: SeedProgress = input.progress ?? (() => {});

  /* THE DIRECTORY. Members first, each linked to their account, then the two
     people with no account. The link is what makes a voice resolve to a
     colleague on the review tab; without it every speaker reads as a label. */
  progress("people");
  const personIds = await step("directory", async () => {
    const ids: Record<string, string> = {};
    for (const person of pack.people) {
      const row = await repos.directory.create(identity, {
        displayName: person.displayName,
        title: person.personTitle,
      });
      await repos.directory.update(identity, row.id, {
        team: person.team,
        appUserId: userIds[person.key],
      });
      ids[person.key] = row.id;
    }
    for (const outsider of pack.outsiders) {
      const row = await repos.directory.create(identity, {
        displayName: outsider.displayName,
        title: outsider.personTitle,
      });
      ids[outsider.key] = row.id;
    }
    return ids;
  });

  /* THE BOARD's columns. Created explicitly rather than letting `board()`
     seed its four defaults on first read: the pack names them, and a read
     that writes is a read this seed should not be relying on. */
  progress("board");
  const columnIds = await step("columns", async () => {
    const ids: Record<string, string> = {};
    for (const column of pack.columns) {
      const row = await repos.tasks.createColumn(identity, column.name);
      await repos.tasks.updateColumn(identity, row.id, { tone: column.tone });
      ids[column.key] = row.id;
    }
    return ids;
  });

  const topicIds = await step("folders", async () => {
    const ids: Record<string, string> = {};
    for (const topic of pack.topics) {
      const row = await repos.meetings.createTopic(identity, topic.name);
      ids[topic.key] = row.id;
    }
    return ids;
  });

  /* THE RECORDS, before the cards, because the presenter's one open card
     points at the pricing call and a card cannot link to a call that does
     not exist yet. */
  const records: SeededRecord[] = [];
  for (const record of pack.records) {
    records.push(await step(`record:${record.key}`, () =>
      seedRecord(input, record, personIds, topicIds, warnings)));
  }
  const callByRecord = new Map(records.map((r) => [r.key, r.callId]));

  progress("tasks");
  const tasks = await step("board", async () => {
    let made = 0;
    const total = pack.tasks.filter((t) => t.done).length;
    let doneIndex = 0;
    for (const task of pack.tasks) {
      const due = task.dueFirstTuesday === true
        ? timeline.quoteDueAt
        : task.dueDays === null ? null : taskDueAt(timeline.demoDate, task.dueDays);
      const created = await repos.tasks.create(identity, {
        title: task.title,
        column_id: columnIds[task.columnKey],
        description: task.description ?? undefined,
        priority: task.priority,
        due_at: due === null ? undefined : due.toISOString(),
        assignees: [userIds[task.assignee]],
        ...(task.linkedRecord !== undefined
          ? { call_id: callByRecord.get(task.linkedRecord) }
          : {}),
      });
      if (task.done) {
        /* `done` is a state stamp and the column move is separate — the pack
           already files finished work in the finished column, so this is the
           checkbox and nothing else. */
        await repos.tasks.update(identity, created.id, { done: true });
        doneIndex++;
        void doneAt(timeline.demoDate, doneIndex - 1, total);
      }
      made++;
    }
    return made;
  });

  /* THE UPCOMING MEETINGS — the things on the board that have not happened.
     The presenter hosts each (they create it) and the pack names who else
     is in the room. The weekly 1:1's description says out loud that it
     recurs: the schema has no recurrence for meetings, so the sentence IS
     the fact the assistant reads. The customer demo is the environment the
     pricing call promised, so "what is happening tomorrow?" has an answer
     that ties back to the recording. */
  progress("upcoming");
  const upcomingMeetingIds = await step("upcoming", async () => {
    const ids: string[] = [];
    for (const upcoming of pack.upcoming) {
      const at = upcoming.when.kind === "offset"
        ? timeline.upcomingAt
        : dayAfterAt(
          timeline.demoDate, upcoming.when.daysAfter, upcoming.when.hour, upcoming.when.minute,
        );
      const meeting = await repos.meetings.create(identity, {
        title: upcoming.title,
        scheduled_at: at.toISOString(),
        duration_minutes: upcoming.durationMinutes,
        mode: upcoming.mode,
        topic_id: topicIds[upcoming.topicKey],
        location: upcoming.location,
        description: upcoming.description,
      });
      await repos.meetings.addAttendees(
        identity, meeting.id, upcoming.attendees.map((key) => userIds[key]),
      );
      ids.push(meeting.id);
    }
    return ids;
  });

  /* THE CONVERSATIONS — the presenter's week with the assistant.
     The hub IS the product's first page (M22), and a seeded organisation
     that opened it on "No conversations yet" was a demo of an empty product
     on the one surface whose claim is that this team has been using it for
     weeks. */
  progress("conversations");
  const conversations = await step("conversations", () =>
    seedConversations(input));

  progress("glossary");
  await step("glossary", () =>
    repos.org.update(identity, { glossary: [...pack.glossary] }));

  /* THE PRESENTER'S PREFERENCES. The zone is what makes every meeting on
     screen read at the hour it was seeded for; the reply language is what
     makes the assistant answer in the language the content is written in. */
  await step("preferences", async () => {
    await repos.members.updateProfile(identity, {
      timezone: "Asia/Tehran",
      locale: pack.language,
    });
    await repos.members.updateAssistantPrefs(identity, {
      assistant_reply_language: pack.language,
    });
  });

  /* THE MODEL. The org is curated to one model and the presenter prefers
     it, so M5's ladder has a top rung on this deployment whether or not
     WORKER_SUMMARY_MODEL is set. Through the product's own wall: a model
     the catalogue does not carry, or one the product bars, is NOT written —
     a seeded pointer at a refused model would fail every run in the demo
     with a sentence naming a model nobody typed. Both fields stay empty
     and the report says so. */
  const model = await step("model", () =>
    seedModel(input, warnings));

  return {
    persons: Object.keys(personIds).length,
    columns: Object.keys(columnIds).length,
    topics: Object.keys(topicIds).length,
    tasks,
    records,
    upcomingMeetingIds,
    meetings: upcomingMeetingIds.length,
    conversations,
    glossary: [...pack.glossary],
    model,
    warnings,
  };
}

/**
 * Curate the organisation and set the presenter to ONE servable model.
 *
 * The candidate is the deployment's env rung when set, else the runbook's
 * default — never both in turn: an operator who set `WORKER_SUMMARY_MODEL`
 * to a barred or retired id should learn that from this warning, not have
 * the seed quietly pick a different model and leave the misconfiguration
 * serving every other org.
 *
 * ORDER: the person's pick first, then the org's curation. `choose` is the
 * stricter check (catalogue, exclusion, and tool capability where known),
 * so if it refuses, nothing has been written yet and the org is left
 * uncurated — one empty state, not a curated org whose owner has no
 * preference.
 */
async function seedModel(
  input: SeedContentInput, warnings: string[],
): Promise<string | null> {
  const { repos, identity } = input;
  const candidate = input.defaultModel !== null && input.defaultModel.trim() !== ""
    ? input.defaultModel.trim()
    : DEMO_DEFAULT_MODEL;
  const source = input.defaultModel !== null && input.defaultModel.trim() !== ""
    ? "WORKER_SUMMARY_MODEL"
    : "default";
  try {
    /* the same wall every route that names a model passes: catalogue
       membership plus the product exclusion — synchronous, no network */
    repos.models.assertAskable(candidate);
    await repos.models.choose(identity, candidate);
  } catch (cause) {
    if (!(cause instanceof ValidationError)) throw cause;
    input.warn?.(
      { event: "demo_model_unservable", model: candidate, source, reason: cause.message },
      "the demo could not be seeded with a model — the summarizer will skip until one is set",
    );
    warnings.push(
      `no model could be set for the demo (${source}: ${candidate} — ${cause.message}); `
      + "summaries will be skipped until an operator curates the org or sets WORKER_SUMMARY_MODEL",
    );
    return null;
  }
  await repos.org.update(identity, { allowedModels: [candidate] });
  return candidate;
}

// ── the conversation history ───────────────────────────────────────────────

/**
 * The presenter's past conversations with the assistant.
 *
 * Written the way the hub writes one: `resolveForAsk` with no session id
 * opens the thread and titles it from the first question (its rule 1 and rule
 * 3), and every turn goes through `append`, which allocates `seq` from the
 * thread itself. Nothing here writes `echo.agent_message` directly, so the
 * seeded history obeys the same policies, the same seq rule and the same
 * title rule as a conversation somebody actually had.
 *
 * **The assistant's turns carry no run and no tool calls, on purpose.** An
 * `agent_run` is the audit record of ONE MODEL INVOCATION (invariant 5) — it
 * has a status, a token count and a replayable step trace — and none of these
 * answers was invoked. Minting a run per turn, or filling `tool_calls` with
 * the tool codes an answer "would have" used, would put a trace on an audit
 * surface for an execution that never happened: the fabricated-provenance
 * failure this codebase already refused for the transcript, where every
 * seeded segment says `source: "demo_seed"` instead of `ml`. `agent_run_id`
 * is nullable precisely because a turn can exist without a run, and the
 * reader loses nothing — `truncated` derives to false, and the thread renders
 * as the record of what was said, which is all it ever was (rule 4).
 *
 * **One conversation is a single human turn with no answer.** That is a real
 * state — a session exists because something was said in it, and an assistant
 * turn is only written when a run produced TEXT — so a sidebar in which every
 * thread ends in a tidy answer is a sidebar that has never seen a Tuesday.
 *
 * The clock is the one thing a repo cannot do: `append` stamps
 * `last_message_at = now()` because the sidebar's order depends on it. See
 * `backdateConversation` in writes.ts, including what it deliberately does
 * NOT move.
 */
async function seedConversations(
  input: SeedContentInput,
): Promise<SeededConversation[]> {
  const { db, repos, identity, pack, timeline } = input;
  const seeded: SeededConversation[] = [];
  for (const conversation of pack.conversations) {
    const first = conversation.turns[0];
    if (first === undefined || first.role !== "user") {
      /* a build fault, not a runtime degradation: the product opens a thread
         from a QUESTION, so a pack conversation that starts with an answer
         describes something the hub could not have produced */
      throw new Error(
        `the ${pack.language} pack's "${conversation.key}" conversation does not start with a question`,
      );
    }
    const { id } = await repos.sessions.resolveForAsk(identity, null, first.text);
    for (const turn of conversation.turns) {
      await repos.sessions.append(identity, {
        sessionId: id, role: turn.role, content: turn.text,
      });
    }
    /* ONE MINUTE PER TURN. It is a claim about ORDER, not about typing
       speed: `created_at` is when the thread was opened and
       `last_message_at` is when it stopped, and the two being equal on a
       six-turn conversation is the only reading a viewer could call wrong. */
    const openedAt = dayBeforeAt(
      timeline.demoDate, conversation.daysBefore, conversation.hour, conversation.minute,
    );
    const lastAt = new Date(
      openedAt.getTime() + (conversation.turns.length - 1) * 60_000,
    );
    await backdateConversation(db, identity, id, {
      createdAt: openedAt, lastMessageAt: lastAt,
    });
    seeded.push({
      key: conversation.key,
      sessionId: id,
      title: titleFrom(first.text),
      turns: conversation.turns.length,
      lastMessageAt: lastAt.toISOString(),
    });
  }
  return seeded;
}

// ── one record ─────────────────────────────────────────────────────────────

async function seedRecord(
  input: SeedContentInput,
  record: DemoRecord,
  personIds: Record<string, string>,
  topicIds: Record<string, string>,
  warnings: string[],
): Promise<SeededRecord> {
  const { db, repos, identity, pack, timeline } = input;
  const progress: SeedProgress = input.progress ?? (() => {});
  const startedAt = record.key === "prior" ? timeline.priorAt : timeline.pricingAt;
  const audio = record.audio;

  if (audio.parts.length === 0 || audio.lines.length !== record.lines.length) {
    /* The pack and its generated timings disagree — that is a build fault,
       not a runtime degradation, and seeding a record whose click-to-seek
       lands nowhere would look like a product bug forever. */
    throw new Error(
      `the ${pack.language} pack's ${record.key} audio has ${audio.lines.length} measured lines for ${record.lines.length} written ones — re-run core/scripts/demo-audio-build.mjs`,
    );
  }

  progress(`${record.key}_audio`);
  const call = await repos.uploads.createCall(identity, {
    title: record.title,
    scope: "org",
    source: "web",
    language: pack.language,
  });

  /* THE AUDIO. Copy the pre-generated object into this call's own path. If
     the object is not in the bucket yet, fill it ONCE from the recording
     that ships in the repository — after checking the bytes are the ones the
     pack measured, because an upload of the wrong file would make every
     click-to-seek land on the wrong sentence for every demo after it. A
     missing artefact in BOTH places, or a mismatch, is a WARNING and a
     `missing` part row, never a failure: the transcript, the summary and the
     items are the demo, and the player being grey is a thing an operator
     can be told about. */
  let hasAudio = false;
  const parts: PartRow[] = [];
  const readAsset = input.assets ?? bundledDemoAudio;
  for (const part of audio.parts) {
    const source = demoAudioPath(pack.language, record.key, part.idx);
    const destination = seededPartPath(call.id, part.idx);
    let copied = false;
    if (input.storage === null) {
      warnings.push(
        `no storage is configured on this deployment, so ${record.key} was seeded without audio`,
      );
    } else {
      let present = await input.storage.has(source);
      if (!present) {
        const asset = await readAsset(pack.language, record.key, part.idx);
        if (asset.bytes === null) {
          warnings.push(
            `the demo audio ${source} is not in the ${DEMO_BUCKET} bucket and the bundled file ${asset.path} is missing, so ${record.key} was seeded without audio — run core/scripts/demo-audio-build.mjs`,
          );
        } else {
          const digest = createHash("sha256").update(asset.bytes).digest("hex");
          if (digest !== part.sha256) {
            /* never a wrong file: the pack's sha256 is a MEASUREMENT of the
               bytes its timings were taken from, and a file that disagrees
               is not the recording those timings describe */
            input.warn?.(
              {
                event: "demo_audio_asset_mismatch",
                language: pack.language, record: record.key, idx: part.idx,
                path: asset.path, expected: part.sha256, actual: digest,
              },
              "the bundled demo audio does not match the pack's measurement — not uploaded",
            );
            warnings.push(
              `the bundled demo audio ${asset.path} does not match the ${pack.language} pack's ${record.key} sha256 (expected ${part.sha256}, got ${digest}), so ${record.key} was seeded without audio — re-run core/scripts/demo-audio-build.mjs`,
            );
          } else {
            await input.storage.upload(source, asset.bytes, "audio/wav");
            input.info?.(
              {
                event: "demo_audio_asset_uploaded",
                language: pack.language, record: record.key, idx: part.idx,
                key: source, bytes: asset.bytes.byteLength,
              },
              "the demo audio cache was filled from the bundled recording",
            );
            present = true;
          }
        }
      }
      if (present) {
        copied = await input.storage.copy(source, destination);
        if (!copied) {
          /* `has` said yes and `copy` said no — the object went between the
             two calls, or the provider disagrees with itself. Named as its
             own nothing rather than folded into "missing". */
          warnings.push(
            `the demo audio ${source} is not in the ${DEMO_BUCKET} bucket, so ${record.key} was seeded without audio — run core/scripts/demo-audio-build.mjs`,
          );
        }
      }
    }
    hasAudio = hasAudio || copied;
    const partId = await insertPart(db, identity, {
      callId: call.id,
      orgId: identity.orgId,
      idx: part.idx,
      offsetMs: part.offsetMs,
      durationMs: part.durationMs,
      bucket: DEMO_BUCKET,
      path: destination,
      byteSize: part.byteSize,
      sha256: part.sha256,
      hasAudio: copied,
    });
    parts.push({
      id: partId,
      call_id: call.id,
      idx: part.idx,
      offset_ms: part.offsetMs,
      duration_ms: part.durationMs,
      storage_bucket: DEMO_BUCKET,
      storage_path: destination,
      audio_sha256: part.sha256,
      status: "diarized",
      missing: !copied,
      call_language: pack.language,
    } as PartRow);
  }

  /* THE ROSTER AND THE TRANSCRIPT, through the worker's own writers. The
     labels the pack carries ("S1·1") are exactly what `upsertSpeakers`
     produces from a diarizer label "S1" on part 0, so nothing here
     re-implements the roster's naming rule. */
  progress(`${record.key}_transcript`);
  const withLanguage = await hasSegmentLanguage(db);
  const speakerIds = new Map<string, string>();
  let segments = 0;
  for (const part of parts) {
    const mapped: MappedSegment[] = [];
    record.lines.forEach((line, i) => {
      const at = audio.lines[i];
      if (at === undefined || at.partIdx !== part.idx) return;
      mapped.push({
        partId: part.id,
        seq: i,
        startMs: at.startMs,
        endMs: at.endMs,
        text: line.text,
        speaker: `S${line.speaker + 1}`,
        language: pack.language,
        words: wordsFor(line.text, at.startMs, at.endMs),
      } as MappedSegment);
    });
    if (mapped.length === 0) continue;
    await db.withIdentity(identity, async (tx) => {
      const ids = await upsertSpeakers(tx, identity.orgId, part, mapped, {
        provenance: { diarization: { source: "demo_seed" } },
        words: [],
      });
      for (const [label, id] of ids) speakerIds.set(label, id);
      await writeTranscript(
        tx, identity.orgId, part, mapped,
        {
          /* `source` overrides the writer's own "ml" — nothing from ml/
             produced this, and a provenance that said so would be the
             fabricated-provenance failure this codebase keeps naming. */
          provenance: { source: "demo_seed", lane: "soniox", seeded: true },
          degraded: false,
          words: [],
        },
        ids,
        { language: withLanguage },
      );
    });
    segments += mapped.length;
  }

  /* THE VOICES GET NAMES. `directory.updateSpeaker` is the product's own
     link path and db/0093's trigger admits only the call's OWNER — which is
     who we are. */
  let linked = 0;
  for (let i = 0; i < record.speakerLabels.length; i++) {
    const speakerId = speakerIds.get(`S${i + 1}`);
    if (speakerId === undefined) continue;
    const personId = i === 0
      ? personIds.owner
      : personIds[record.outsider];
    await repos.directory.updateSpeaker(identity, call.id, speakerId, { personId });
    const first = record.lines.findIndex((l) => l.speaker === i);
    const at = first >= 0 ? audio.lines[first] : undefined;
    if (at !== undefined) {
      await setSpeakerSample(db, identity, speakerId, at.startMs, at.endMs);
    }
    linked++;
  }

  progress(`${record.key}_summary`);
  const summaryId = await insertSummary(db, identity, {
    callId: call.id,
    orgId: identity.orgId,
    body: record.summary,
    model: DEMO_SUMMARY_MODEL,
  });
  if (summaryId === "") throw new Error("the summary was not written");

  await backdateCall(db, identity, call.id, {
    startedAt,
    durationMs: audio.totalMs,
    language: pack.language,
  });
  await repos.lifecycle.setCallStatus(identity, call.id, "ready");

  /* The pointer is moved by db/0008's trigger on the summary insert, never by
     us — so read it back rather than assume it. A `ready` call with no
     current summary renders as a record whose summary tab is empty, which
     looks like the summarizer failed. */
  const state = await readCallState(db, identity, call.id);
  if (state === null || state.status !== "ready" || state.current_summary_id === null) {
    warnings.push(
      `${record.key}: the call settled as ${state?.status ?? "unreadable"} with ${state?.current_summary_id === null ? "no" : "a"} current summary`,
    );
  }

  const meeting = await repos.meetings.create(identity, {
    title: record.title,
    scheduled_at: startedAt.toISOString(),
    duration_minutes: Math.max(1, Math.ceil(audio.totalMs / 60_000)),
    mode: "in_person",
    topic_id: record.topicKey === null ? undefined : topicIds[record.topicKey],
    location: record.location,
    description: record.description,
    invitees: [pack.outsiders.find((o) => o.key === record.outsider)?.displayName ?? ""],
  });
  await repos.meetings.update(identity, meeting.id, { call_id: call.id });
  await repos.meetings.addAttendees(identity, meeting.id, [identity.userId]);
  await repos.meetings.markAttended(identity, meeting.id);

  /* THE DECISIONS AND ACTION ITEMS come out of the summary the same way they
     do after a real call — `extractItems` slices the headings, `splitOwner`
     reads the "— owner: Name" marker, and the rows are badged `ai` because
     the write runs on the agent role. Writing them by hand would badge them
     `user` and would be a second implementation of the extractor. */
  const extracted = await repos.meetings.extractItems(identity, meeting.id, call.id);
  if (extracted.added !== record.items.length) {
    warnings.push(
      `${record.key}: the summary yielded ${extracted.added} items, the pack expects ${record.items.length}`,
    );
  }

  /*
   * THE SPOKEN OWNER BECOMES AN ACCOUNT.
   *
   * `extractItems` writes db/0160's free-text `owner` and leaves db/0211's
   * `owner_id` NULL — it slices prose and holds no roster. db/0217's aftermath
   * door then joins `app_user` ON `owner_id`, so every demo organisation got
   * zero commitment cards, no error, and nothing in the log: the demo of the
   * feature whose whole point is that the platform tells people what they owe
   * was the one place it told nobody.
   *
   * The resolution is the product's own (`resolveOwner`, folded and whole) over
   * the PACK's five people, which is why it is reliable rather than fuzzy: the
   * summaries say «— owner: Alex Turner» / «— مسئول: علی نجفی» and the pack is
   * where those names were written. «NAI» is an outsider with no account and
   * resolves to nobody, on purpose.
   */
  const roster = demoOwnerRoster(pack, input.userIds);
  const items = await readMeetingItems(db, identity, meeting.id);
  let owners = 0;
  for (const item of items) {
    if (item.kind !== "action" || item.owner === null || item.ownerId !== null) continue;
    const ownerId = resolveOwner(item.owner, roster, foldName);
    if (ownerId === null) continue;
    await setMeetingItemOwner(db, identity, item.id, ownerId);
    owners += 1;
  }
  /* A record whose actions ALL resolved to nobody is that picture exactly,
     and it has to be loud: every demo pack names at least one colleague as an
     owner, so zero means the marker, the fold or the roster stopped agreeing —
     and the symptom downstream is an empty bell, which looks like a feature
     that does not exist. */
  if (owners === 0 && items.some((item) => item.kind === "action")) {
    warnings.push(
      `${record.key}: no action item resolved to a demo account, so nobody will be told what they owe`,
    );
  }

  /*
   * AND THE AFTERMATH IS DELIVERED (db/0217). The worker does this at the end
   * of its summarize step; the seed writes the summary itself and so has to
   * make the same call, or the cards the fix above made possible would still
   * never be written. The identity is the demo OWNER, who created this meeting
   * — the door checks the caller is the host and reads every recipient from the
   * meeting's own rows, so there is nothing to supply but the item ids.
   *
   * BEST-EFFORT, the same posture call-steps.ts takes: a card that could not be
   * written must not cost the demo its records, and the forfeit is said out
   * loud in the report (M21) rather than swallowed.
   */
  let cards = 0;
  try {
    cards = await repos.meetings.deliverMeetingCards(
      identity, meeting.id, items.map((item) => item.id),
    );
  } catch (cause) {
    warnings.push(
      `${record.key}: the meeting's aftermath could not be delivered, so the bell will be empty (${describe(cause)})`,
    );
  }

  return {
    key: record.key,
    callId: call.id,
    meetingId: meeting.id,
    segments,
    speakers: linked,
    items: extracted.added,
    owners,
    cards,
    audio: hasAudio,
  };
}

/**
 * Word spans, spread evenly inside a measured line — M20's middle rung.
 *
 * Evenly is a claim we can make: the line's start and end are measurements,
 * and nothing here knows where inside it each word fell. It is the same
 * approximation db/scripts/seed-demo-records.mjs makes, and it is why a
 * seeded transcript highlights by line rather than by syllable.
 */
export function wordsFor(
  text: string, startMs: number, endMs: number,
): { w: string; startMs: number; endMs: number }[] {
  const words = text.split(/\s+/).filter(Boolean);
  const span = endMs - startMs;
  return words.map((w, i) => ({
    w,
    startMs: startMs + Math.round((span * i) / words.length),
    endMs: startMs + Math.round((span * (i + 1)) / words.length),
  }));
}

/**
 * THE PACK'S PEOPLE AS A ROSTER, for resolving a name the summary spoke.
 *
 * The same shape `meetings.roster` returns and the same three candidates it
 * carries — the display name, db/0039's Latin spelling when there is one, and
 * the handle — so `resolveOwner` is asked the identical question here and in
 * the live summarizer.
 *
 * It is built from the PACK rather than read back from `app_user`, and that is
 * the one deliberate difference. The pack is where these five names were
 * written; the accounts were seated FROM it one statement run earlier. Reading
 * the database to learn what this file already knows would make the resolution
 * depend on a round trip that can only ever agree — and on a bad day, disagree
 * for reasons (an RLS surprise, a re-seed that found an account by handle)
 * that have nothing to do with who owes what.
 *
 * The OUTSIDERS are deliberately absent. «NAI» owns an action item in both
 * packs and has no account to own it with, so the item keeps its spoken name
 * and no `owner_id` — which is db/0211's own "exactly or not at all", and the
 * reason a demo must still render an unowned action correctly.
 */
export function demoOwnerRoster(
  pack: Pick<DemoPack, "people">,
  userIds: Record<DemoPersonKey, string>,
): { id: string; names: string[] }[] {
  return pack.people.map((person: DemoPerson) => ({
    id: userIds[person.key],
    names: [person.displayName, person.displayNameEn, person.username]
      .filter((name): name is string => typeof name === "string" && name.trim() !== ""),
  }));
}

/** The pack's people, in the order the door wants them. */
export function peopleForDoor(
  pack: DemoPack,
  ids: Record<DemoPersonKey, string>,
  emails: Record<DemoPersonKey, string>,
): Record<string, unknown>[] {
  return pack.people.map((person: DemoPerson) => ({
    id: ids[person.key],
    email: emails[person.key],
    display_name: person.displayName,
    display_name_en: person.displayNameEn,
    username: person.username,
    job_title: person.jobTitle,
    role: person.key === "owner" ? "owner" : "member",
  }));
}
