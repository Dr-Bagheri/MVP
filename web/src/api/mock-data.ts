import type {
  AdminModelRow,
  AgentRun,
  Call,
  Connector,
  DirectoryPerson,
  GatewayConfig,
  Org,
  Skill,
  Speaker,
  SummaryVersion,
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
  default_call_scope: "private",
};

export const ME: User = {
  id: "u-1",
  org_id: ORG.id,
  username: "sara",
  display_name: "سارا محمدی",
  avatar_url: null,
  role: "admin",
  status: "active",
  locale: "fa",
  model_id: "google/gemini-3.1-pro",
  created_at: iso(60 * day),
};

export const USERS: User[] = [
  ME,
  {
    id: "u-2",
    org_id: ORG.id,
    username: "amir",
    display_name: "امیر رضایی",
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
    display_name: "رضا احمدی",
    avatar_url: null,
    role: "member",
    status: "disabled",
    locale: "fa",
    model_id: null,
    created_at: iso(120 * day),
  },
];

export const MODELS: AdminModelRow[] = [
  {
    id: "google/gemini-3.1-pro",
    label: "Gemini 3.1 Pro",
    provider: "Google",
    tool_capable: true,
    allowed: true,
    suggested: true,
  },
  {
    id: "google/gemini-3.1-flash",
    label: "Gemini 3.1 Flash",
    provider: "Google",
    tool_capable: true,
    allowed: true,
    suggested: false,
  },
  {
    id: "openai/gpt-5.2",
    label: "GPT-5.2",
    provider: "OpenAI",
    tool_capable: true,
    allowed: true,
    suggested: false,
  },
  {
    id: "deepseek/deepseek-v3.2",
    label: "DeepSeek V3.2",
    provider: "DeepSeek",
    tool_capable: true,
    allowed: false,
    suggested: false,
  },
  {
    id: "meta/llama-4-scout",
    label: "Llama 4 Scout",
    provider: "Meta",
    tool_capable: false,
    allowed: false,
    suggested: false,
  },
];

const CALL_1_PARTS = [
  {
    id: "p-1",
    index: 0,
    duration_seconds: 1800,
    starts_at_seconds: 0,
    audio_url: "/mock-audio/part-1",
    status: "diarized" as const,
  },
  {
    id: "p-2",
    index: 1,
    duration_seconds: 1140,
    starts_at_seconds: 1800,
    audio_url: "/mock-audio/part-2",
    status: "diarized" as const,
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
    status: "ready",
    duration_seconds: 2940,
    created_at: iso(day),
    archived: false,
    deleted_at: null,
    parts: CALL_1_PARTS,
    current_summary_version: 2,
    transcript_timing: "full",
  },
  {
    id: "c-2",
    org_id: ORG.id,
    owner_id: "u-2",
    owner_name: "امیر رضایی",
    title: "تماس پشتیبانی — مشکل یکپارچه‌سازی",
    scope: "private",
    status: "summarizing",
    duration_seconds: 1320,
    created_at: iso(3 * 3_600_000),
    archived: false,
    deleted_at: null,
    parts: [
      {
        id: "p-3",
        index: 0,
        duration_seconds: 1320,
        starts_at_seconds: 0,
        audio_url: "/mock-audio/part-3",
        status: "diarized",
      },
    ],
    current_summary_version: null,
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
    status: "ready",
    duration_seconds: 2100,
    created_at: iso(5 * day),
    archived: true,
    deleted_at: null,
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
        index: 0,
        duration_seconds: 1800,
        starts_at_seconds: 0,
        audio_url: "/mock-audio/part-4",
        status: "diarized",
      },
      {
        id: "p-4b",
        index: 1,
        duration_seconds: 300,
        starts_at_seconds: 1800,
        audio_url: "/mock-audio/part-4b",
        // prose-only lane still finishes the DAG — degraded ≠ failed (M20)
        status: "diarized",
      },
    ],
    current_summary_version: 1,
    transcript_timing: "mixed",
  },
  {
    id: "c-4",
    org_id: ORG.id,
    owner_id: "u-2",
    owner_name: "امیر رضایی",
    title: "تماس اکتشافی — مشتری بانکی",
    scope: "private",
    status: "failed",
    duration_seconds: 420,
    created_at: iso(8 * day),
    archived: false,
    deleted_at: null,
    parts: [
      {
        id: "p-5",
        index: 0,
        duration_seconds: 420,
        starts_at_seconds: 0,
        audio_url: "/mock-audio/part-5",
        status: "failed",
      },
    ],
    current_summary_version: null,
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
    status: "ready",
    duration_seconds: 180,
    created_at: iso(12 * day),
    archived: false,
    deleted_at: iso(4 * day),
    parts: [],
    current_summary_version: null,
    transcript_timing: null,
  },
  {
    id: "c-6",
    org_id: ORG.id,
    owner_id: ME.id,
    owner_name: ME.display_name,
    title: "جلسهٔ فروش — در حال پردازش",
    scope: "org",
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
    duration_seconds: 2400,
    created_at: iso(2 * 3_600_000),
    archived: false,
    deleted_at: null,
    parts: [
      {
        id: "p-6",
        index: 0,
        duration_seconds: 1800,
        starts_at_seconds: 0,
        audio_url: "/mock-audio/part-6",
        // segments written, not yet diarized — which is exactly the window in
        // which its word-timing flag is unasserted and the call reads "none"
        status: "transcribed",
      },
      {
        id: "p-6b",
        index: 1,
        duration_seconds: 600,
        starts_at_seconds: 1800,
        audio_url: "/mock-audio/part-6b",
        // hasn't reached transcription — contributes NO evidence either way
        status: "transcoded",
      },
    ],
    current_summary_version: null,
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
        part_id: CALLS.find((call) => call.id === callId)?.parts[part_index]?.id ?? null,
        words,
      };
    }),
  ]),
);

export const SUMMARIES: Record<string, SummaryVersion[]> = {
  "c-1": [
    {
      version: 1,
      content:
        "گفت‌وگو دربارهٔ تمدید قرارداد شرکت پیشرو بود. طرف مقابل روی سطح خدمات و زمان پاسخ‌گویی تمرکز داشت.",
      created_at: iso(day - 3_600_000),
      model_id: "google/gemini-3.1-flash",
      agent_run_id: "r-1",
    },
    {
      version: 2,
      content:
        "این چهارمین گفت‌وگو با شرکت پیشرو دربارهٔ همین قرارداد است. موضوع اصلی، تمدید قرارداد و شرایط سال آینده بود.\n\nطرف مقابل مهم‌ترین دغدغه‌اش را سطح خدمات و زمان پاسخ‌گویی اعلام کرد. پیشنهاد ما کاهش زمان پاسخ بحرانی به دو ساعت در ازای بستن قرارداد دوساله بود؛ نمایندهٔ پیشرو تأیید دوساله را منوط به بررسی با مدیرش کرد و افزود که وجود تخفیف حجمی احتمال تأیید را بالا می‌برد.\n\nقرار شد پیش‌نویس با زمان پاسخ دو ساعته و تخفیف پلکانی تا پایان هفته ارسال شود و بند جریمهٔ تأخیر تا دوشنبه بازبینی و اعلام نظر شود.",
      created_at: iso(day - 1_800_000),
      model_id: "google/gemini-3.1-pro",
      agent_run_id: "r-2",
    },
  ],
  "c-3": [
    {
      version: 1,
      content:
        "جلسهٔ هم‌ترازی محصول: اولویت‌های سه‌ماههٔ آینده مرور شد و دو اقدام مشخص به تیم سپرده شد.",
      created_at: iso(5 * day),
      model_id: "google/gemini-3.1-pro",
      agent_run_id: "r-3",
    },
  ],
};

export const SKILLS: Skill[] = [
  {
    id: "sk-1",
    level: "system",
    slug: "call-recap",
    name: "خلاصهٔ تماس",
    description: "خلاصهٔ ساخت‌یافتهٔ گفت‌وگو با تصمیم‌ها و ادامهٔ کار.",
    tools: ["search_transcripts", "read_window", "get_call"],
    model: null,
    editable: false,
  },
  {
    id: "sk-2",
    level: "system",
    slug: "action-items",
    name: "اقدام‌ها",
    description: "استخراج اقدام‌ها با مسئول و مهلت.",
    tools: ["read_window"],
    model: null,
    editable: false,
  },
  {
    id: "sk-3",
    level: "org",
    slug: "objection-finder",
    name: "یابندهٔ اعتراض‌ها",
    description: "اعتراض‌ها و نگرانی‌های مشتری و پاسخ داده‌شده به هرکدام.",
    tools: ["search_transcripts", "read_window"],
    model: "google/gemini-3.1-pro",
    editable: true,
  },
  {
    id: "sk-4",
    level: "org",
    slug: "pricing-mentions",
    name: "اشاره‌های قیمتی",
    description: "هر جا عدد، تخفیف یا شرط پرداخت گفته شده.",
    tools: ["search_transcripts", "read_window"],
    model: null,
    editable: true,
  },
  {
    id: "sk-5",
    level: "org",
    slug: "talk-ratio",
    name: "نسبت صحبت",
    description: "سهم صحبت هر گوینده در گفت‌وگو.",
    tools: ["get_call"],
    model: null,
    editable: true,
  },
  {
    id: "sk-6",
    level: "user",
    slug: "pre-call-brief",
    name: "برگهٔ پیش از تماس",
    description: "خلاصهٔ آنچه پیش از تماس بعدی باید بدانید.",
    tools: ["search_transcripts", "read_window", "get_call"],
    model: "google/gemini-3.1-pro",
    editable: true,
  },
];

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

export const GATEWAY: GatewayConfig = {
  /*
   * Unmistakably fake ON SIGHT. The earlier value was realistic down to the
   * `_live_` prefix and the entropy, which costs more than it buys: secret
   * scanners fire on every push, and anyone grepping the repo for a leaked
   * key has to stop and prove this one isn't. The screen masks to
   * `slice(0, 12)`, so a fixture only owes us the right shape-class —
   * realism is not part of the job. Mock secrets look fake unless a test
   * asserts on format, and then they get labeled.
   */
  api_key: "echo_sk_test_FAKE_PLACEHOLDER_000000",
  webhook_url: "https://api.example.com/hooks/echo",
  docs_url: "/connectors/gateway/docs",
};

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
