/**
 * The platform-provided voice-enrollment scripts (user directive,
 * 2026-08-23): a fixed passage the person reads aloud so the sample carries
 * the full weight of their voice. Each passage is an ORIGINAL text written
 * for phoneme coverage, not meaning:
 *
 * - fa: covers the Persian inventory including the letters that carry the
 *   distinctive fricatives/uvulars (ژ ق غ خ ع ح چ پ گ), long/short vowels,
 *   and ZWNJ-joined plurals — the shapes a Persian speaker's voice lives in.
 * - en: covers the English inventory including the dental fricatives
 *   (th both ways), /ʒ/ (measured, pleasure), affricates (June, children),
 *   /ŋ/, r/l clusters and the full diphthong set (bright, day, low, how,
 *   noisy).
 *
 * BOTH are always offered regardless of UI locale — the panel is bilingual
 * by design, and reading ONE of them is sufficient to save. That is why
 * these live here and not in the i18n catalogues: a message catalogue
 * serves the current locale; this content deliberately ignores it.
 */
export const ENROLLMENT_SCRIPTS = {
  fa:
    "صبح زود از خانه بیرون آمدم و در هوای خنک پاییز قدم زدم. " +
    "باغچهٔ کوچک ما پر از گل‌های زرد و بنفش بود و بوی چای تازه از آشپزخانه می‌آمد. " +
    "ژاله روی برگ‌ها نشسته بود و صدای گنجشک‌ها از لای شاخه‌ها شنیده می‌شد. " +
    "با خودم فکر کردم که همین چیزهای سادهٔ قشنگ، غروب‌های شلوغ و روزهای سخت را قابل تحمل می‌کنند. " +
    "سپس نفس عمیقی کشیدم و آرام به راهم ادامه دادم.",
  en:
    "On a bright June morning I walked through the quiet garden, counting five yellow roses near the old stone path. " +
    "A gentle breeze pushed thin clouds across the sky, while children enjoyed a noisy game and dogs jumped over the low wooden fence. " +
    "I measured my words with care, asking how such simple things could give the day this warm, easy pleasure. " +
    "Then I paused, took a deep breath, and finished my thought with a smile.",
} as const;

export type EnrollmentLang = keyof typeof ENROLLMENT_SCRIPTS;

/**
 * Reading the passage naturally takes ~20–30s. The floor keeps a too-short
 * take (a cough, a false start) from becoming a weak voiceprint — ml/'s
 * /embed refuses under 1.5s, but "accepted" is not "solid"; the ceiling
 * bounds the upload if someone walks away with the mic open.
 */
export const MIN_ENROLL_SECONDS = 8;
export const MAX_ENROLL_SECONDS = 90;
