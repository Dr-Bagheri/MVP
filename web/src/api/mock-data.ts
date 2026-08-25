import type {
  AgentRun,
  Call,
  CallPart,
  Connector,
  DirectoryPerson,
  GatewayDelivery,
  GatewayKey,
  GatewayWebhook,
  Me,
  Org,
  Speaker,

  TranscriptSegment,
  TranscriptWord,
  User,
} from "./types";

/** Phase-A fixtures. Persian content throughout — summaries are always fa. */

const day = 86_400_000;
const now = Date.now();
const iso = (offset: number) => new Date(now - offset).toISOString();

export const ORG: Org = {
  id: "org-1",
  name: "شرکت داده‌پرداز آریا",
  status: "active",
  /*
   * `default_call_scope` is GONE — it was never a column and never on this
   * wire. What replaces it is not a rename: `locale`, `allowed_models` and
   * `created_at` are what the org actually carries, and the fixture said none
   * of them.
   *
   * `allowed_models` is non-empty on purpose. Empty would exercise only the
   * "org has curated nothing" path, and the curation screen's whole subject is
   * a list with things in it.
   */
  locale: "fa",
  /*
   * Ids taken from the MODELS fixture below, and **no `anthropic/*`** — the
   * catalogue exclusion is a locked directive, and a fixture is exactly where
   * a barred vendor slips back in unnoticed: nothing type-checks a model id,
   * and an allow-list is the one place a wrong one looks authoritative.
   *
   * `meta/llama-4-scout` is deliberately NOT here, so the fixture has a model
   * the org has NOT allowed. An allow-list containing everything cannot tell a
   * working filter from a missing one.
   */
  allowed_models: ["google/gemini-3.1-pro", "google/gemini-3.1-flash", "openai/gpt-5.2"],
  created_at: iso(400 * day),
};

/**
 * `Me`, not `User` — the signed-in person carries preferences that a
 * members-list row does not. The fixture states all three explicitly rather
 * than leaning on a default, because `auto` IS a choice here: a fixture that
 * omitted `calendar` would exercise the "not carried" path on every screen and
 * never the chosen-value one.
 */
export const ME: Me = {
  id: "u-1",
  org_id: ORG.id,
  username: "sara",
  email: "sara@example.com",
  display_name: "سارا محمدی",
  display_name_en: "Sara Mohammadi",
  avatar_url: null,
  role: "admin",
  status: "active",
  locale: "fa",
  calendar: "auto",
  timezone: "auto",
  model_id: "google/gemini-3.1-pro",
  created_at: iso(60 * day),
};

export const USERS: User[] = [
  ME,
  {
    id: "u-2",
    org_id: ORG.id,
    username: "amir",
    email: "amir@example.com",
    display_name: "امیر رضایی",
    display_name_en: "Amir Rezaei",
    avatar_url: null,
    role: "member",
    status: "active",
    locale: "fa",
    model_id: "google/gemini-3.1-flash",
    created_at: iso(40 * day),
  },
  {
    id: "u-3",
    org_id: ORG.id,
    username: "negar",
    email: "negar@example.com",
    display_name: "نگار کریمی",
    avatar_url: null,
    role: "member",
    status: "pending",
    locale: "fa",
    model_id: null,
    created_at: iso(2 * day),
  },
  {
    id: "u-4",
    org_id: ORG.id,
    username: "hamid",
    email: "hamid@example.com",
    display_name: "حمید توکلی",
    avatar_url: null,
    role: "member",
    status: "pending",
    locale: "fa",
    model_id: null,
    created_at: iso(6 * 3_600_000),
  },
  {
    id: "u-5",
    org_id: ORG.id,
    username: "reza",
    email: "reza@example.com",
    display_name: "رضا احمدی",
    avatar_url: null,
    role: "member",
    status: "disabled",
    locale: "fa",
    model_id: null,
    created_at: iso(120 * day),
  },
];

/* MODELS fixture left with the Part-3 wire: the curation menu reads GET /v1/admin/models. */

/**
 * Parts now carry the WIRE's field names, because the type is core/'s
 * (`@echo/core/wire`) rather than a transcription of it.
 *
 * What changed and why it matters: `index`→`idx`, `starts_at_seconds`→
 * `offset_ms`, `duration_seconds`→`duration_ms` (**a factor of 1000, silent**
 * — the old fixtures would have rendered a 30-minute part as 1.8 seconds
 * against the real api), and `audio_url` is gone entirely because no such
 * field exists: a client never addresses storage directly.
 *
 * `has_word_timestamps` is new here and is the per-part fact that the
 * call-level `transcript_timing` aggregates. The fixtures already asserted
 * that relationship in prose; now it is data, so a "mixed" call whose parts
 * all claim word timing is a contradiction something can actually catch.
 */
const CALL_1_PARTS: CallPart[] = [
  {
    id: "p-1",
    idx: 0,
    offset_ms: 0,
    duration_ms: 1_800_000,
    status: "diarized",
    has_word_timestamps: true,
    missing: false,
    failure_reason: null,
    audio_format: "webm",
    byte_size: 28_800_000,
  },
  {
    id: "p-2",
    idx: 1,
    offset_ms: 1_800_000,
    duration_ms: 1_140_000,
    status: "diarized",
    has_word_timestamps: true,
    missing: false,
    failure_reason: null,
    audio_format: "webm",
    byte_size: 18_240_000,
  },
];

export const CALLS: Call[] = [
  {
    id: "c-1",
    org_id: ORG.id,
    owner_id: ME.id,
    owner_name: ME.display_name,
    title: "مذاکرهٔ تمدید قرارداد — شرکت پیشرو",
    scope: "org",
    language: "fa",
    source: "web",
    status: "ready",
    duration_ms: 2940000,
    started_at: iso(day),
    /* the row's own last write (0004's trigger); a fixture whose
       last change is its recording is the ordinary case */
    updated_at: iso(day),
    archived_at: null,
    deleted_at: null,
    purge_after: null,
    parts: CALL_1_PARTS,
    current_summary_id: "sum-2",
    transcript_timing: "full",
  },
  {
    id: "c-2",
    org_id: ORG.id,
    owner_id: "u-2",
    owner_name: "امیر رضایی",
    title: "تماس پشتیبانی — مشکل یکپارچه‌سازی",
    scope: "private",
    language: "fa",
    source: "web",
    status: "summarizing",
    duration_ms: 1320000,
    started_at: iso(3 * 3_600_000),
    /* the row's own last write (0004's trigger); a fixture whose
       last change is its recording is the ordinary case */
    updated_at: iso(3 * 3_600_000),
    archived_at: null,
    deleted_at: null,
    purge_after: null,
    parts: [
      {
        id: "p-3",
        idx: 0,
        offset_ms: 0,
        duration_ms: 1_320_000,
        status: "diarized",
        has_word_timestamps: true,
        missing: false,
        failure_reason: null,
        audio_format: "webm",
        byte_size: 21_120_000,
      },
    ],
    current_summary_id: null,
    // status "summarizing": the transcript is DONE, only the summary is
    // pending — so timing is known and not null.
    transcript_timing: "full",
  },
  {
    id: "c-3",
    org_id: ORG.id,
    owner_id: ME.id,
    owner_name: ME.display_name,
    title: "جلسهٔ هم‌ترازی محصول",
    scope: "private",
    language: "fa",
    source: "web",
    status: "ready",
    duration_ms: 2100000,
    started_at: iso(5 * day),
    /* the row's own last write (0004's trigger); a fixture whose
       last change is its recording is the ordinary case */
    updated_at: iso(5 * day),
    archived_at: iso(9 * day),
    deleted_at: null,
    purge_after: null,
    /**
     * A genuinely HALF-SEEKABLE call (M20): its two parts went down
     * different lanes. Part 0 is primary — full word timing, click-a-word.
     * Part 1 is the prose-only fallback, which arrives as ONE segment
     * anchored to the speech span inside that part (click-a-span) — coarse
     * but true timing, never zeroed.
     *
     * Hence "mixed" below — the state the old boolean could not express,
     * since it collapsed "one part degraded" and "entirely prose" into the
     * same false. It describes the WHOLE call: the UI may use it to explain
     * provenance but must never gate a row's interaction on it.
     */
    parts: [
      {
        id: "p-4",
        idx: 0,
        offset_ms: 0,
        duration_ms: 1_800_000,
        status: "diarized",
        // the primary lane: this part is why the call is "mixed" and not "none"
        has_word_timestamps: true,
        missing: false,
        failure_reason: null,
        audio_format: "webm",
        byte_size: 28_800_000,
      },
      {
        id: "p-4b",
        idx: 1,
        offset_ms: 1_800_000,
        duration_ms: 300_000,
        // prose-only lane still finishes the DAG — degraded ≠ failed (M20)
        status: "diarized",
        // ...and THIS is why it is not "full". The disagreement between the two
        // parts is now stated in data rather than only in the prose above.
        has_word_timestamps: false,
        missing: false,
        failure_reason: null,
        audio_format: "webm",
        byte_size: 4_800_000,
      },
    ],
    current_summary_id: "sum-1",
    transcript_timing: "mixed",
  },
  {
    id: "c-4",
    org_id: ORG.id,
    owner_id: "u-2",
    owner_name: "امیر رضایی",
    title: "تماس اکتشافی — مشتری بانکی",
    scope: "private",
    language: "fa",
    source: "web",
    status: "failed",
    duration_ms: 420000,
    started_at: iso(8 * day),
    /* the row's own last write (0004's trigger); a fixture whose
       last change is its recording is the ordinary case */
    updated_at: iso(8 * day),
    archived_at: null,
    deleted_at: null,
    purge_after: null,
    parts: [
      {
        id: "p-5",
        idx: 0,
        offset_ms: 0,
        duration_ms: 420_000,
        status: "failed",
        has_word_timestamps: false,
        /*
         * `missing` is false and `failure_reason` is set: the bytes DID
         * arrive, transcription failed on them. The two say different things —
         * missing means the recording never reached us, which is a gap nobody
         * can retry away. Collapsing them would tell someone their audio was
         * lost when it is sitting on disk.
         */
        missing: false,
        failure_reason: "asr_engine_error",
        audio_format: "webm",
        byte_size: 6_720_000,
      },
    ],
    current_summary_id: null,
    // failed before any transcript existed — null, NOT "none". "none" would
    // assert a real prose-only transcript; there is no transcript at all.
    transcript_timing: null,
  },
  {
    id: "c-5",
    org_id: ORG.id,
    owner_id: "u-2",
    owner_name: "امیر رضایی",
    title: "تماس آزمایشی (حذف‌شده)",
    scope: "private",
    language: "fa",
    source: "web",
    status: "ready",
    duration_ms: 180000,
    started_at: iso(12 * day),
    /* the row's own last write (0004's trigger); a fixture whose
       last change is its recording is the ordinary case */
    updated_at: iso(12 * day),
    archived_at: null,
    deleted_at: iso(4 * day),
    purge_after: null,
    parts: [],
    current_summary_id: null,
    transcript_timing: null,
  },
  {
    id: "c-6",
    org_id: ORG.id,
    owner_id: ME.id,
    owner_name: ME.display_name,
    title: "جلسهٔ فروش — در حال پردازش",
    scope: "org",
    language: "fa",
    source: "web",
    /**
     * MID-TRANSCRIPTION showing the TRANSIENT "none" — the value the
     * suppression gate exists to hide, and the only fixture that can exercise
     * it (rule 9: without this the branch is unreachable and green means
     * nothing).
     *
     * The window is real: the worker asserts a part's `has_word_timestamps`
     * flag ONCE, AFTER writing that part's segments. In between, the part
     * counts as transcribed-but-not-timed, so the call reports "none" for an
     * instant before settling. "none" is the strongest degraded claim there
     * is — flashing it on a healthy call would be a visible lie.
     *
     * Part 0 transcribed but not yet flagged timed; part 1 not transcribed at
     * all. Untranscribed parts are NOT counted as untimed — they are not
     * counted — so transcribed=1, timed=0 → "none". An earlier version of
     * this fixture said "mixed" here, which the endpoint cannot emit in this
     * state: it encoded my model rather than the server's, which is precisely
     * what rule 9 warns a derived-from-prose fixture will do.
     *
     * `processing` is the real mid-transcription status — the per-part DAG
     * runs inside it. An earlier version said `transcribing`, which is not a
     * member of `echo.call_status` at all.
     */
    status: "processing",
    duration_ms: 2400000,
    started_at: iso(2 * 3_600_000),
    /* the row's own last write (0004's trigger); a fixture whose
       last change is its recording is the ordinary case */
    updated_at: iso(2 * 3_600_000),
    archived_at: null,
    deleted_at: null,
    purge_after: null,
    parts: [
      {
        id: "p-6",
        idx: 0,
        offset_ms: 0,
        duration_ms: 1_800_000,
        // segments written, not yet diarized — which is exactly the window in
        // which its word-timing flag is unasserted and the call reads "none"
        status: "transcribed",
        // false because the worker has not asserted it YET, not because this
        // part is degraded. Same value, two very different futures.
        has_word_timestamps: false,
        missing: false,
        failure_reason: null,
        audio_format: "webm",
        byte_size: 28_800_000,
      },
      {
        id: "p-6b",
        idx: 1,
        offset_ms: 1_800_000,
        duration_ms: 600_000,
        // hasn't reached transcription — contributes NO evidence either way
        status: "transcoded",
        has_word_timestamps: false,
        missing: false,
        failure_reason: null,
        audio_format: "webm",
        byte_size: 9_600_000,
      },
    ],
    current_summary_id: null,
    transcript_timing: "none",
  },
];

export const SPEAKERS: Record<string, Speaker[]> = {
  "c-3": [
    {
      id: "s3-1",
      call_id: "c-3",
      label: "گویندهٔ ۱",
      person_id: null,
      person_name: null,
      sample_start_ms: 8_000,
      talk_seconds: 640,
    },
    {
      id: "s3-2",
      call_id: "c-3",
      label: "گویندهٔ ۲",
      person_id: null,
      person_name: null,
      sample_start_ms: 27_000,
      talk_seconds: 520,
    },
  ],
  "c-1": [
    {
      id: "s-1",
      call_id: "c-1",
      label: "گویندهٔ ۱",
      person_id: "d-1",
      person_name: "سارا محمدی",
      sample_start_ms: 12_000,
      talk_seconds: 1240,
    },
    {
      id: "s-2",
      call_id: "c-1",
      label: "گویندهٔ ۲",
      person_id: "d-2",
      person_name: "آقای شریفی (پیشرو)",
      sample_start_ms: 41_000,
      talk_seconds: 1490,
    },
    {
      id: "s-3",
      call_id: "c-1",
      label: "گویندهٔ ۳",
      person_id: null,
      person_name: null,
      sample_start_ms: 902_000,
      talk_seconds: 210,
    },
  ],
};

export const DIRECTORY: DirectoryPerson[] = [
  { id: "d-1", org_id: ORG.id, name: "سارا محمدی", linked_calls: 14 },
  { id: "d-2", org_id: ORG.id, name: "آقای شریفی (پیشرو)", linked_calls: 4 },
  { id: "d-3", org_id: ORG.id, name: "امیر رضایی", linked_calls: 9 },
];

/**
 * Word-level timing for the primary-lane fixtures: the real STT returns these
 * per word; here they're distributed across the row's span so click-a-word
 * seeks somewhere honest.
 */
function wordsFor(text: string, startMs: number, endMs: number): TranscriptWord[] {
  const tokens = text.split(/\s+/).filter(Boolean);
  const step = (endMs - startMs) / Math.max(1, tokens.length);
  return tokens.map((token, i) => ({
    w: token,
    start_ms: Math.round(startMs + i * step),
    end_ms: Math.round(startMs + (i + 1) * step),
  }));
}

/**
 * Fixture rows carry `part_index` (and the row's own call_id) so the
 * generator can apply word timing PER PART. The wire has neither: segments
 * arrive flat under a `{ call_id, segments }` envelope and are ordered by
 * `seq`. Both are stripped below, so nothing downstream can accidentally
 * depend on a field the real endpoint will never send.
 */
type RawRow = Omit<TranscriptSegment, "seq" | "part_id"> & {
  part_index: number;
  call_id: string;
  edited_by: string | null;
};

const RAW_TRANSCRIPT: Record<string, RawRow[]> = {
  "c-1": [
    {
      id: "t-1",
      call_id: "c-1",
      part_index: 0,
      start_ms: 12_000,
      end_ms: 21_400,
      speaker_id: "s-1",
      channel: 0,
      text: "سلام، وقت‌تان بخیر. جلسهٔ امروز دربارهٔ تمدید قرارداد و شرایط سال آینده است.",
      words: [],
      edited: false,
      edited_by: null,
    },
    {
      id: "t-2",
      call_id: "c-1",
      part_index: 0,
      start_ms: 22_000,
      end_ms: 38_900,
      speaker_id: "s-2",
      channel: 1,
      text: "بله، ما هم آماده‌ایم. صادقانه بگویم، بندی که بیشتر برایمان مهم است سطح خدمات و زمان پاسخ‌گویی است.",
      words: [],
      edited: false,
      edited_by: null,
    },
    {
      id: "t-3",
      call_id: "c-1",
      part_index: 0,
      start_ms: 41_000,
      end_ms: 63_500,
      speaker_id: "s-1",
      channel: 0,
      text: "کاملاً منطقی است. پیشنهاد ما این است که زمان پاسخ‌گویی بحرانی را به دو ساعت کاهش دهیم و در مقابل، مدت قرارداد را دوساله ببندیم.",
      words: [],
      edited: true,
      edited_by: "u-1",
    },
    {
      id: "t-4",
      call_id: "c-1",
      part_index: 0,
      start_ms: 64_000,
      end_ms: 88_000,
      speaker_id: "s-2",
      channel: 1,
      text: "دوساله را باید با مدیرمان بررسی کنم. اما اگر تخفیف حجمی هم روی آن باشد، احتمال تأییدش بالاست.",
      words: [],
      edited: false,
      edited_by: null,
    },
    {
      id: "t-5",
      call_id: "c-1",
      part_index: 1,
      start_ms: 1_805_000,
      end_ms: 1_829_000,
      speaker_id: "s-1",
      channel: 0,
      text: "پس جمع‌بندی می‌کنم: پیش‌نویس با زمان پاسخ دو ساعته و تخفیف پلکانی تا پایان هفته برایتان می‌فرستم.",
      words: [],
      edited: false,
      edited_by: null,
    },
    {
      id: "t-6",
      call_id: "c-1",
      part_index: 1,
      start_ms: 1_830_000,
      end_ms: 1_851_000,
      speaker_id: "s-3",
      channel: null,
      text: "من هم بند جریمهٔ تأخیر را بازبینی می‌کنم و نظرم را تا دوشنبه می‌فرستم.",
      words: [],
      edited: false,
      edited_by: null,
    },
  ],
  // c-3 is the MIXED call: part 0 went down the primary lane and keeps full
  // word timing, part 1 fell back to prose. The call flag is false — but that
  // must not cost part 0 its words, which is the whole point of this fixture.
  "c-3": [
    {
      id: "t3-1",
      call_id: "c-3",
      part_index: 0,
      start_ms: 8_000,
      end_ms: 26_000,
      speaker_id: "s3-1",
      channel: null,
      text: "برای سه‌ماههٔ آینده، اولویت اول یکپارچه‌سازی گزارش‌ها است و بقیه بعد از آن می‌آید.",
      words: [],
      edited: false,
      edited_by: null,
    },
    {
      id: "t3-2",
      call_id: "c-3",
      part_index: 0,
      start_ms: 27_000,
      end_ms: 44_000,
      speaker_id: "s3-2",
      channel: null,
      text: "پس تیم من روی همان تمرکز می‌کند و تا جلسهٔ بعد یک برآورد زمانی می‌آورد.",
      words: [],
      edited: false,
      edited_by: null,
    },
    // part 1: prose-only fallback. ml/ anchors timing-less text to the span
    // of AUDIO IT CAME FROM — first speech to last speech — so the segment
    // sits INSET from the part boundaries (part is 30:00–35:00; speech runs
    // 30:02–34:54). That makes the middle rung click-a-SPAN, not
    // click-a-part: coarse, but pointing at real speech rather than at
    // leading silence.
    {
      id: "t3-3",
      call_id: "c-3",
      part_index: 1,
      start_ms: 1_802_400,
      end_ms: 2_094_000,
      speaker_id: "s3-1",
      channel: null,
      text: "در بخش پایانی جلسه، تیم دربارهٔ ترتیب انتشار و ریسک‌های زمان‌بندی صحبت کرد و قرار شد برآورد نهایی هفتهٔ آینده بازبینی شود.",
      words: [],
      edited: false,
      edited_by: null,
    },
  ],
  // c-6 mid-flight: part 0's segments have LANDED but its
  // has_word_timestamps flag is not asserted yet, so every row is wordless
  // and the call reads "none". Part 1 has no segments at all — an
  // untranscribed part contributes nothing in either direction.
  "c-6": [
    {
      id: "t6-1",
      call_id: "c-6",
      part_index: 0,
      start_ms: 4_000,
      end_ms: 21_000,
      speaker_id: "s6-1",
      channel: null,
      text: "امروز می‌خواهیم دربارهٔ شرایط قرارداد و زمان‌بندی تحویل صحبت کنیم.",
      words: [],
      edited: false,
      edited_by: null,
    },
    {
      id: "t6-2",
      call_id: "c-6",
      part_index: 0,
      start_ms: 22_000,
      end_ms: 39_000,
      speaker_id: "s6-2",
      channel: null,
      text: "بله، از طرف ما مشکلی نیست؛ فقط بند پشتیبانی باید دقیق‌تر نوشته شود.",
      words: [],
      edited: false,
      edited_by: null,
    },
  ],
};

/**
 * Which PARTS came off the primary lane. Word timing is a property of a part,
 * not of a call — Backend 1 confirmed there is no stored call-level column at
 * all: it's derived from `transcript_segment.words`. So the parts decide, and
 * `Call.transcript_timing` is downstream of this map, never the reverse.
 *
 * Keying the generator off the call-level value (as it did) quietly made every
 * row in a partially-degraded call wordless — the same wrong assumption the UI
 * held, which is exactly why the broken branch was unreachable and the fixture
 * looked fine. A generator must not share the code's assumption about the data
 * it generates, or it can only ever confirm it.
 */
const WORD_TIMED_PARTS: Record<string, readonly number[] | "all"> = {
  "c-1": "all",
  "c-3": [0], // part 0 primary, part 1 prose-only → "mixed"
  "c-6": [], // segments landed, timing flag not yet asserted → transient "none"
};

export const TRANSCRIPT: Record<string, TranscriptSegment[]> = Object.fromEntries(
  Object.entries(RAW_TRANSCRIPT).map(([callId, rows]) => [
    callId,
    rows.map(({ part_index, call_id: _callId, edited_by: _editedBy, ...row }, index) => {
      const timed = WORD_TIMED_PARTS[callId] ?? "all";
      const wordTimed = timed === "all" || timed.includes(part_index);
      const words = wordTimed ? wordsFor(row.text, row.start_ms, row.end_ms) : [];

      /*
       * Plant ONE genuinely zero-length word. Backend 2's clip has a real «و»
       * at 45128–45128, and only SEGMENT spans are required to be non-zero —
       * a zero-length word is legitimate data, not corruption. Without this,
       * a future `words.filter(w => w.end_ms > w.start_ms)` would look
       * harmless and silently drop real words in production; with it, the
       * word visibly disappears from this fixture instead.
       */
      const third = words[2];
      if (callId === "c-1" && index === 0 && third) {
        words[2] = { ...third, end_ms: third.start_ms };
      }

      return {
        ...row,
        seq: index,
        // the server knows part membership; the fixture resolves the same id
        // rather than leaving consumers to infer it from timestamps
        part_id: CALLS.find((call) => call.id === callId)?.parts?.[part_index]?.id ?? null,
        words,
      };
    }),
  ]),
);

/* SUMMARIES fixture removed with the wire adoption (rule 10): the type
   now carries the PRODUCER's field names (body/model), and a fixture kept
   in the old spelling would be a second belief about the same wire. */

/* SKILLS fixture left with the Part-2 swap (M29): the picker and the
   editor both read the live wire, and a fixture beside a live wire is two
   sources for one fact. */

export const CONNECTORS: Connector[] = [
  {
    id: "cn-1",
    name: "Slack",
    category: "chat",
    description: "ارسال خلاصهٔ تماس به کانال تیم.",
    status: "preview",
  },
  {
    id: "cn-2",
    name: "Microsoft Teams",
    category: "chat",
    description: "دریافت اعلان پایان پردازش.",
    status: "preview",
  },
  {
    id: "cn-3",
    name: "HubSpot",
    category: "crm",
    description: "پیوست خلاصه به رکورد معامله.",
    status: "preview",
  },
  {
    id: "cn-4",
    name: "Salesforce",
    category: "crm",
    description: "همگام‌سازی تماس‌ها با فرصت‌ها.",
    status: "preview",
  },
  {
    id: "cn-5",
    name: "Google Drive",
    category: "storage",
    description: "بایگانی فایل صوتی و رونوشت.",
    status: "preview",
  },
  {
    id: "cn-6",
    name: "Google Calendar",
    category: "calendar",
    description: "ساخت تماس از رویداد تقویم.",
    status: "preview",
  },
  {
    id: "cn-7",
    name: "Notion",
    category: "documents",
    description: "نوشتن خلاصه در صفحهٔ مشتری.",
    status: "preview",
  },
];

/*
 * Gateway fixtures (M17). Every secret here is unmistakably fake ON SIGHT: a
 * realistic-looking key costs more than it buys, because secret scanners fire
 * on every push and anyone grepping for a leak has to stop and prove this one
 * isn't. A fixture owes us the right shape-class, not realism.
 *
 * The list carries only `token_prefix` — never a full token — because that is
 * all core/ can return. The token exists exactly once, in the create
 * response, and there is no reveal endpoint to fall back on.
 */
export const GATEWAY_KEYS: GatewayKey[] = [
  {
    id: "gk-1",
    name: "CRM sync",
    token_prefix: "echo_sk_test",
    actor_id: ME.id,
    last_used_at: iso(2 * 3_600_000),
    expires_at: null,
    revoked_at: null,
    created_at: iso(21 * day),
    allow_assistant: false,
  },
  {
    id: "gk-2",
    name: "Weekly digest bot",
    token_prefix: "echo_sk_test",
    actor_id: "u-2",
    // never used — a real state, and distinct from "used long ago"
    last_used_at: null,
    expires_at: null,
    revoked_at: null,
    created_at: iso(4 * day),
    // the only assistant-capable key: this is the one that spends tokens
    allow_assistant: true,
  },
  {
    /*
     * Actor is DISABLED (u-5, رضا احمدی) while the key itself is un-revoked.
     * This is the row the acts-as design exists for: an admin removing an
     * employee needs to see which integrations die with them. Without it the
     * screen's whole reason for being is unreachable, and a branch nobody can
     * reach is a branch that ships broken (rules 9 and 12).
     *
     * Position matters: core/ orders `revoked_at nulls first, created_at
     * desc`, so an un-revoked key sits above gk-3 regardless of age. The
     * screen deliberately does not re-sort, so the fixture must arrive in the
     * order the server would send.
     */
    id: "gk-4",
    name: "Reza's exporter",
    token_prefix: "echo_sk_test",
    actor_id: "u-5",
    last_used_at: iso(30 * day),
    expires_at: null,
    revoked_at: null,
    created_at: iso(50 * day),
    allow_assistant: false,
  },
  {
    /* expires_at in the PAST — makes the `expired` chip reachable, and it is
       a different fact from revoked: nobody withdrew this key, it simply ran
       out. */
    id: "gk-5",
    name: "Quarterly audit export",
    token_prefix: "echo_sk_test",
    actor_id: ME.id,
    last_used_at: iso(35 * day),
    expires_at: iso(7 * day),
    revoked_at: null,
    created_at: iso(95 * day),
    allow_assistant: false,
  },
  {
    id: "gk-3",
    name: "Old prototype",
    token_prefix: "echo_sk_test",
    actor_id: "u-2",
    last_used_at: iso(40 * day),
    expires_at: null,
    // revoked, NOT deleted — the record of what existed survives
    revoked_at: iso(9 * day),
    created_at: iso(60 * day),
    allow_assistant: false,
  },
];

export const GATEWAY_WEBHOOKS: GatewayWebhook[] = [
  {
    id: "wh-1",
    url: "https://api.example.com/hooks/echo",
    events: ["call.transcribed", "call.summarized"],
    enabled: true,
    created_at: iso(14 * day),
  },
  {
    id: "wh-2",
    url: "https://staging.example.com/hooks/echo",
    events: ["call.failed"],
    enabled: false,
    created_at: iso(3 * day),
  },
];

export const GATEWAY_DELIVERIES: GatewayDelivery[] = [
  {
    id: "dl-1",
    webhook_id: "wh-1",
    event: "call.summarized",
    attempts: 1,
    response_code: 200,
    delivered_at: iso(2 * 3_600_000),
    failed_at: null,
    next_attempt_at: null,
    created_at: iso(2 * 3_600_000),
  },
  {
    // failing and still retrying — the state the log exists to make visible
    id: "dl-2",
    webhook_id: "wh-1",
    event: "call.transcribed",
    attempts: 3,
    response_code: 503,
    delivered_at: null,
    failed_at: iso(30 * 60_000),
    next_attempt_at: iso(-15 * 60_000),
    created_at: iso(90 * 60_000),
  },
  {
    /*
     * NOTHING ANSWERED. `response_code: null` is not "no data" — it means no
     * HTTP response ever came back at all (DNS failure, connection refused,
     * timeout, blocked address). It is the most informative thing that column
     * ever says, and it renders as "no response" rather than an em-dash,
     * which would read as absence. Still retrying.
     */
    id: "dl-3",
    webhook_id: "wh-2",
    event: "call.failed",
    attempts: 2,
    response_code: null,
    delivered_at: null,
    failed_at: iso(20 * 60_000),
    next_attempt_at: iso(-40 * 60_000),
    created_at: iso(45 * 60_000),
  },
  {
    /* TERMINAL failure — retries exhausted. `next_attempt_at: null` is what
       separates "gave up" from "still trying"; without it the UI cannot tell
       a fourth attempt from a final one. */
    id: "dl-4",
    webhook_id: "wh-1",
    event: "call.created",
    attempts: 6,
    response_code: 500,
    delivered_at: null,
    failed_at: iso(6 * 3_600_000),
    next_attempt_at: null,
    created_at: iso(7 * 3_600_000),
  },
  {
    /* QUEUED — accepted, not yet attempted. All three timestamps null and
       zero attempts, which is a different state from "failed with no
       response" even though both show no result. */
    id: "dl-5",
    webhook_id: "wh-1",
    event: "call.summarized",
    attempts: 0,
    response_code: null,
    delivered_at: null,
    failed_at: null,
    next_attempt_at: null,
    created_at: iso(4 * 60_000),
  },
];

export const AGENT_RUNS: AgentRun[] = [
  {
    id: "r-2",
    skill_slug: "call-recap",
    model_id: "google/gemini-3.1-pro",
    started_at: iso(day - 1_800_000),
    tokens_in: 18_420,
    tokens_out: 640,
    outcome: "ok",
  },
];
