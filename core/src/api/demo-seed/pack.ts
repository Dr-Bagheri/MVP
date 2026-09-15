/**
 * The DEMO CONTENT PACK — one shape, one pack per language (M52).
 *
 * A demo organisation's content is DATA, not code: the same engine writes an
 * English demo and a Persian demo, and the only difference between them is
 * which pack it reads. That is the whole reason the two packs must have the
 * SAME STRUCTURE — same people, same columns, same task count, same number of
 * dialogue lines per record, same number of items — because a structural
 * difference between them is a feature that exists in one language and not
 * the other, which is precisely the failure Persian-first exists to prevent.
 * `content-packs.test.ts` asserts that equality; it is the check that makes
 * "the packs are the same demo" a fact rather than an intention.
 *
 * Two things are deliberately NOT in here:
 *
 *   • absolute dates. Every time in a seeded org is derived from the demo
 *     DATE the operator picks (see timeline.ts), so a pack carries day
 *     offsets and wall-clock times and never a calendar day. A pack with a
 *     date in it would be a demo that silently rots.
 *
 *   • the audio bytes. `audio` carries the MEASURED timings of speech that
 *     was synthesised once, offline, by core/scripts/demo-audio-build.mjs,
 *     committed under core/assets/demo-audio/<language>/<record>.wav, and
 *     cached in Storage under `_demo/<language>/<record>/part-N.wav` by the
 *     first seed that finds the bucket empty (assets.ts). The seed COPIES
 *     that object; it never synthesises anything. So a seed is
 *     deterministic, costs no TTS, and a transcript's click-to-seek lands on
 *     the sentence it was measured against.
 *
 * The dialogue is deliberately free of any absolute date. "by Tuesday" is a
 * promise the timeline can honour on any demo date; "by Tuesday the ninth"
 * would be a recording that contradicts the board four days later, and the
 * audio cannot be re-cut per demo.
 */

/** The two content languages a demo organisation can be written in. */
export const DEMO_LANGUAGES = ["en", "fa"] as const;
export type DemoLanguage = (typeof DEMO_LANGUAGES)[number];

/** Stable keys — the engine addresses pack entries by key, never by index. */
export const DEMO_PEOPLE_KEYS = ["owner", "reza", "mina", "ali", "hamid"] as const;
export type DemoPersonKey = (typeof DEMO_PEOPLE_KEYS)[number];

export const DEMO_OUTSIDER_KEYS = ["nai", "pasargad"] as const;
export type DemoOutsiderKey = (typeof DEMO_OUTSIDER_KEYS)[number];

export const DEMO_COLUMN_KEYS = ["backlog", "todo", "doing", "done"] as const;
export type DemoColumnKey = (typeof DEMO_COLUMN_KEYS)[number];

export const DEMO_TOPIC_KEYS = ["customers", "oneOnOne"] as const;
export type DemoTopicKey = (typeof DEMO_TOPIC_KEYS)[number];

export const DEMO_RECORD_KEYS = ["prior", "pricing"] as const;
export type DemoRecordKey = (typeof DEMO_RECORD_KEYS)[number];

/**
 * The conversations the presenter has already had with the assistant.
 *
 * The hub IS the product's first page (M22), and a freshly seeded demo
 * organisation used to open it on "No conversations yet" — the one surface
 * whose whole claim is "you have been using this for weeks" was the one
 * surface that said nobody ever had. These five are that week: five keys,
 * five shapes of ask, deliberately not five of the same one.
 */
export const DEMO_CONVERSATION_KEYS = [
  "simorgh", "board", "quote", "weekly", "unanswered",
] as const;
export type DemoConversationKey = (typeof DEMO_CONVERSATION_KEYS)[number];

export interface DemoPerson {
  key: DemoPersonKey;
  /** the account handle — ASCII, per db/0039; identical in both packs */
  username: string;
  /** what this org calls them; the pack's language decides the script */
  displayName: string;
  /**
   * db/0039's Latin name. NULL in the English pack ON PURPOSE: the column is
   * the LATIN spelling, and putting the Persian name in it would make an
   * English UI render Persian for an English-content organisation — the
   * fallback (M24) is the display name unchanged, which is right here.
   */
  displayNameEn: string | null;
  jobTitle: string;
  /** echo.person.title — one of the directory's own rank words */
  personTitle: string;
  team: string;
}

export interface DemoOutsider {
  key: DemoOutsiderKey;
  displayName: string;
  personTitle: string;
}

export interface DemoColumn {
  key: DemoColumnKey;
  name: string;
  tone: string;
}

export interface DemoTask {
  key: string;
  columnKey: DemoColumnKey;
  title: string;
  description: string | null;
  priority: "low" | "medium" | "high" | "critical";
  assignee: DemoPersonKey;
  done: boolean;
  /** whole days from the demo date, at 13:30 UTC; null = no deadline */
  dueDays: number | null;
  /**
   * The presenter's ONE open card. Its due date is the first Tuesday
   * STRICTLY AFTER the pricing call's day, at 13:00 UTC — "by Tuesday" is
   * said on that call, so the Tuesday it names is counted from the call and
   * never from the demo date — and it is linked to the pricing call, so the
   * card and the sentence that created it are one click apart.
   */
  dueFirstTuesday?: boolean;
  linkedRecord?: DemoRecordKey;
}

export interface DemoTopic {
  key: DemoTopicKey;
  name: string;
}

/**
 * When an upcoming meeting starts, relative to the demo date.
 *
 *   • `offset` — `offsetMinutes` from NOW when the demo is today, else
 *     09:00 Tehran plus the offset (see timeline.ts). The one meeting that
 *     is "starting in twenty minutes" in front of the customer.
 *   • `day` — a whole number of days after the demo date at a Tehran wall
 *     time. Deterministic on every demo date, and never "now"-relative,
 *     because a meeting tomorrow morning is a fact about the calendar.
 */
export type DemoUpcomingWhen =
  | { kind: "offset" }
  | { kind: "day"; daysAfter: number; hour: number; minute: number };

export interface DemoUpcoming {
  key: string;
  title: string;
  description: string;
  location: string;
  topicKey: DemoTopicKey;
  mode: "in_person" | "online";
  durationMinutes: number;
  when: DemoUpcomingWhen;
  /** the presenter is the host and is always first; the rest are attendees */
  attendees: DemoPersonKey[];
}

/** One synthesised line: which speaker said it, and what they said. */
export interface DemoLine {
  /** 0 = the presenter, 1 = the other voice */
  speaker: 0 | 1;
  text: string;
}

export interface DemoItem {
  kind: "decision" | "action";
  /** the dialogue line this came from — the item's `at_ms` is its start */
  line: number;
}

/** A measured part of the pre-generated speech. */
export interface DemoAudioPart {
  idx: number;
  offsetMs: number;
  durationMs: number;
  byteSize: number;
  sha256: string;
}

/** Where each dialogue line actually landed in the spliced audio. */
export interface DemoAudioLine {
  startMs: number;
  endMs: number;
  partIdx: number;
}

export interface DemoAudio {
  totalMs: number;
  parts: DemoAudioPart[];
  lines: DemoAudioLine[];
}

/**
 * A voice: a Soniox Text-to-Speech voice NAME (`Emma`, `Adrian`, `Nina`…).
 * Every Soniox voice speaks every supported language with the same timbre,
 * so both packs name the SAME three voices — one cast, two languages — and
 * the old edge-tts asymmetry (two fa-IR voices, the second woman being the
 * first pitched down) is gone with the pitch/rate offsets that carried it.
 * `speed` is Soniox's speaking-rate multiplier (0.7–1.3), unset = 1.
 */
export interface DemoVoice {
  voice: string;
  speed?: number;
}

export interface DemoRecord {
  key: DemoRecordKey;
  title: string;
  description: string;
  location: string;
  topicKey: DemoTopicKey | null;
  /** the outside person on the other side of the table */
  outsider: DemoOutsiderKey;
  /** whole days BEFORE the demo date */
  daysBefore: number;
  /** wall-clock start in Asia/Tehran */
  hour: number;
  minute: number;
  /** true for the pricing call: a Friday or Saturday moves back to Thursday */
  avoidWeekend: boolean;
  speakerLabels: [string, string];
  voices: [DemoVoice, DemoVoice];
  lines: DemoLine[];
  /** the whole summary body, headings included — the extractor reads it */
  summary: string;
  items: DemoItem[];
  /** measured once, offline; empty until the generator has run */
  audio: DemoAudio;
}

/**
 * One turn in a seeded conversation.
 *
 * Only `user` and `assistant`. The role enum has a third value (`tool`) and
 * nothing here writes it: a tool turn is the transcript of an execution, and
 * no execution produced any of this. Same reason the engine leaves
 * `agent_run_id` and `tool_calls` empty — see its conversations stage.
 */
export interface DemoTurn {
  role: "user" | "assistant";
  text: string;
}

/**
 * One conversation in the sidebar.
 *
 * **No title.** The product derives a conversation's title from its first
 * question (`sessions.titleFrom`) and never rewrites it, so a pack title
 * would be a second spelling of a fact that already has an owner — and a
 * seeded thread whose name did not match its first line is a thread the
 * product could not have produced, which is the whole altitude argument of
 * M52. The cost is real and accepted: the first turn has to READ like a
 * title, and `demo-content-packs.test.ts` asserts it is short enough to be
 * one un-truncated. The refused alternative was carrying a title and calling
 * `sessions.rename` — five renames in one week is not a thing anybody does.
 *
 * **No absolute dates and no relative ones either.** The pack's dialogue
 * already avoids "by Tuesday the ninth"; a conversation must also avoid "the
 * demo is tomorrow", because it is read on a day the timeline chooses and
 * the meeting it would be talking about moves with the demo date. What a
 * turn may say is what is TRUE on every demo date: who owns which card, what
 * a meeting decided, what a codename covers.
 */
export interface DemoConversation {
  key: DemoConversationKey;
  /** whole days BEFORE the demo date — the day the thread was opened */
  daysBefore: number;
  /** wall-clock start in Asia/Tehran; the thread runs on from there */
  hour: number;
  minute: number;
  /**
   * The recording this conversation talks about, or null.
   *
   * Nothing in the schema joins a thread to a call and the seed writes no
   * link — this is a TIMELINE constraint, and it is data because the pricing
   * call MOVES: it steps back off the Iranian weekend, so "three days before
   * the demo" is only safely after it because something checks. The check is
   * in demo-timeline.test.ts, over a year of demo dates.
   */
  afterRecord: DemoRecordKey | null;
  /** what was said, in order; the first is always the human's */
  turns: DemoTurn[];
}

export interface DemoPack {
  language: DemoLanguage;
  /** the form's default organisation name for this language */
  orgName: string;
  glossary: string[];
  people: DemoPerson[];
  outsiders: DemoOutsider[];
  columns: DemoColumn[];
  topics: DemoTopic[];
  tasks: DemoTask[];
  /** the meetings that have not happened yet, in the order they will */
  upcoming: DemoUpcoming[];
  records: DemoRecord[];
  /** the presenter's week with the assistant, oldest first */
  conversations: DemoConversation[];
}

/** The storage key a record's pre-generated audio lives under. */
export const demoAudioPath = (
  language: DemoLanguage,
  record: DemoRecordKey,
  idx: number,
): string => `_demo/${language}/${record}/part-${idx}.wav`;

/**
 * The file name the same part ships under in `core/assets/demo-audio/<lang>/`.
 * Part 0 is `<record>.wav` — every record today is one part; a second part
 * would be `<record>-part-1.wav`, so the generator and the seeder agree on
 * the name from ONE function rather than two spellings.
 */
export const bundledDemoAudioFile = (record: DemoRecordKey, idx: number): string =>
  idx === 0 ? `${record}.wav` : `${record}-part-${idx}.wav`;
