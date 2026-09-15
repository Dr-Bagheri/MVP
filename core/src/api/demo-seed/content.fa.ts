/**
 * The PERSIAN demo content pack (M52).
 *
 * This is not a translation of content.en.ts — it is the same demo, written
 * in Persian. Where a literal rendering would read as a translation, the
 * Persian says what a Persian-speaking team would actually say; the codename
 * is «سیمرغ», the customer is «آسمان», and the numbers are SPELLED («چهل
 * کاربر»), which is both what a person says aloud and what keeps the
 * synthesised speech free of the ASCII-digit trap.
 *
 * `NAI` keeps its Latin spelling on purpose: it is a company acronym, which
 * the one-language-per-screen rule (2026-09-06) exempts along with every
 * other brand name and handle. Everything a person wrote — names, titles,
 * folders, cards, dialogue, summaries — is Persian.
 *
 * Structure is IDENTICAL to the English pack by construction and by test:
 * the same five people with the same usernames and the same directory title
 * codes, the same four columns, the same twenty-three cards, the same two
 * records with the same number of lines and the same items pointing at the
 * same line numbers. content-packs.test.ts is what makes that a fact.
 *
 * The voices are the SAME three the English pack names: Soniox voices keep
 * their timbre across languages, so the Persian demo and the English demo are
 * one cast. (The earlier edge-tts generator had exactly two fa-IR voices and
 * the pricing call's second woman was the presenter pitched down; that
 * asymmetry no longer exists.) The choice and its reasons are recorded in
 * core/scripts/demo-audio-build.mjs.
 */

import type { DemoPack } from "./pack.ts";
import { AUDIO_FA } from "./audio.fa.ts";

/** the presenter, سارا */
const EMMA = { voice: "Emma" };
/** NAI, the director */
const ADRIAN = { voice: "Adrian" };
/** خانم مرادی — a second female voice chosen to sit far from Emma's */
const NINA = { voice: "Nina" };

export const PACK_FA: DemoPack = {
  language: "fa",
  orgName: "پیشرو داده (دمو)",
  glossary: ["سیمرغ", "آسمان", "پاسارگاد"],

  people: [
    {
      key: "owner",
      username: "sara",
      displayName: "سارا احمدی",
      displayNameEn: "Sara Ahmadi",
      jobTitle: "مدیر محصول",
      personTitle: "manager",
      team: "محصول",
    },
    {
      key: "reza",
      username: "reza",
      displayName: "رضا کریمی",
      displayNameEn: "Reza Karimi",
      jobTitle: "مدیر ارشد فنی",
      personTitle: "cto",
      team: "مهندسی",
    },
    {
      key: "mina",
      username: "mina",
      displayName: "مینا رستمی",
      displayNameEn: "Mina Rostami",
      jobTitle: "کارشناس فروش",
      personTitle: "employee",
      team: "فروش",
    },
    {
      key: "ali",
      username: "ali",
      displayName: "علی نجفی",
      displayNameEn: "Ali Najafi",
      jobTitle: "سرپرست مهندسی",
      personTitle: "lead",
      team: "مهندسی",
    },
    {
      key: "hamid",
      username: "hamid",
      displayName: "حمید صادقی",
      displayNameEn: "Hamid Sadeghi",
      jobTitle: "کارشناس پشتیبانی",
      personTitle: "employee",
      team: "پشتیبانی",
    },
  ],

  outsiders: [
    { key: "nai", displayName: "NAI", personTitle: "director" },
    { key: "pasargad", displayName: "پاسارگاد — خانم مرادی", personTitle: "manager" },
  ],

  columns: [
    { key: "backlog", name: "بک‌لاگ", tone: "grey" },
    { key: "todo", name: "برای انجام", tone: "blue" },
    { key: "doing", name: "در حال انجام", tone: "amber" },
    { key: "done", name: "انجام‌شده", tone: "green" },
  ],

  topics: [
    { key: "customers", name: "مشتری‌ها" },
    { key: "oneOnOne", name: "جلسات دونفره" },
  ],

  tasks: [
    /* ── هشت کارت باز؛ دقیقاً یکی از آن‌ها مال ارائه‌دهنده است ── */
    {
      key: "open-renewal",
      columnKey: "doing",
      title: "تدوین شرایط تمدید سه‌ماههٔ سوم",
      description: null,
      priority: "critical",
      assignee: "reza",
      done: false,
      dueDays: 2,
    },
    {
      key: "open-staging",
      columnKey: "todo",
      title: "انتقال دادهٔ استیجینگ آسمان",
      description: null,
      priority: "high",
      assignee: "ali",
      done: false,
      dueDays: 3,
    },
    {
      key: "open-onboarding",
      columnKey: "doing",
      title: "بازنویسی چک‌لیست راه‌اندازی آسمان",
      description: null,
      priority: "medium",
      assignee: "mina",
      done: false,
      dueDays: null,
    },
    {
      key: "open-room",
      columnKey: "backlog",
      title: "رزرو اتاق برنامه‌ریزی سه‌ماههٔ چهارم",
      description: null,
      priority: "low",
      assignee: "hamid",
      done: false,
      dueDays: null,
    },
    {
      key: "open-macros",
      columnKey: "backlog",
      title: "بازبینی ماکروهای جدید پشتیبانی",
      description: null,
      priority: "low",
      assignee: "hamid",
      done: false,
      dueDays: null,
    },
    {
      key: "open-demoenv",
      columnKey: "todo",
      title: "آماده‌سازی محیط دموی پاسارگاد",
      description: null,
      priority: "high",
      assignee: "ali",
      done: false,
      dueDays: null,
    },
    {
      key: "open-acceptance",
      columnKey: "todo",
      title: "جمع‌آوری معیارهای پذیرش فاز یک",
      description: null,
      priority: "medium",
      assignee: "reza",
      done: false,
      dueDays: null,
    },
    {
      key: "open-quote",
      columnKey: "backlog",
      title: "ارسال پیشنهاد قیمت به بانک پاسارگاد",
      description:
        "پیشنهاد قیمت برای چهل کاربر به‌علاوهٔ ماژول گزارش‌های سفارشی. متن توافق‌نامهٔ سطح خدمات پشتیبانی (زمان پاسخ هر سطح اهمیت) داخل خودش بیاید. محیط دمو اول آماده می‌شود.",
      priority: "medium",
      assignee: "owner",
      done: false,
      dueDays: null,
      dueFirstTuesday: true,
      linkedRecord: "pricing",
    },

    /* ── پانزده کارت انجام‌شده، پخش‌شده بین تیم ── */
    { key: "done-invoices-sep", columnKey: "done", title: "بستن صورت‌حساب‌های شهریور", description: null, priority: "medium", assignee: "mina", done: true, dueDays: null },
    { key: "done-export", columnKey: "done", title: "انتشار سرویس خروجی گزارش‌ها", description: null, priority: "medium", assignee: "ali", done: true, dueDays: null },
    { key: "done-release-notes", columnKey: "done", title: "انتشار یادداشت‌های نسخهٔ مرداد", description: null, priority: "medium", assignee: "mina", done: true, dueDays: null },
    { key: "done-onboard-support", columnKey: "done", title: "راه‌اندازی دو کارشناس جدید پشتیبانی", description: null, priority: "medium", assignee: "hamid", done: true, dueDays: null },
    { key: "done-data-model", columnKey: "done", title: "تأیید نهایی مدل دادهٔ آسمان", description: null, priority: "medium", assignee: "reza", done: true, dueDays: null },
    { key: "done-load-test", columnKey: "done", title: "اجرای آزمون بار روی خوشهٔ استیجینگ", description: null, priority: "medium", assignee: "ali", done: true, dueDays: null },
    { key: "done-pricing-copy", columnKey: "done", title: "به‌روزرسانی متن صفحهٔ قیمت‌ها", description: null, priority: "medium", assignee: "mina", done: true, dueDays: null },
    { key: "done-archive", columnKey: "done", title: "بایگانی پرونده‌های مشتریان سال گذشته", description: null, priority: "medium", assignee: "hamid", done: true, dueDays: null },
    { key: "done-backup", columnKey: "done", title: "انتقال پشتیبان‌گیری شبانه به مخزن جدید", description: null, priority: "medium", assignee: "ali", done: true, dueDays: null },
    { key: "done-procurement", columnKey: "done", title: "پاسخ به فرم تدارکات پاسارگاد", description: null, priority: "medium", assignee: "owner", done: true, dueDays: null },
    { key: "done-deck", columnKey: "done", title: "به‌روزرسانی ارائهٔ فروش شهریور", description: null, priority: "medium", assignee: "mina", done: true, dueDays: null },
    { key: "done-legacy-worker", columnKey: "done", title: "بازنشستگی سرویس قدیمی پیاده‌سازی متن", description: null, priority: "medium", assignee: "reza", done: true, dueDays: null },
    { key: "done-incident", columnKey: "done", title: "نوشتن گزارش رخداد قطعی مرداد", description: null, priority: "medium", assignee: "ali", done: true, dueDays: null },
    { key: "done-sla", columnKey: "done", title: "توافق بر متن توافق‌نامهٔ سطح خدمات پشتیبانی", description: null, priority: "medium", assignee: "hamid", done: true, dueDays: null },
    { key: "done-shared-drive", columnKey: "done", title: "راه‌اندازی درایو مشترک آسمان", description: null, priority: "medium", assignee: "mina", done: true, dueDays: null },
  ],

  upcoming: [
    {
      key: "weekly",
      title: "جلسهٔ هفتگی با NAI",
      description:
        "جلسهٔ هفتگی دونفره با NAI. این جلسه هر هفته تکرار می‌شود — جلسهٔ قبلی یک هفته پیش بود.",
      location: "اتاق جلسهٔ الف",
      topicKey: "oneOnOne",
      mode: "in_person",
      durationMinutes: 30,
      when: { kind: "offset" },
      attendees: ["owner"],
    },
    {
      key: "customerDemo",
      title: "دمو بانک پاسارگاد",
      description:
        "همان محیط دمویی که در تماس قیمت‌گذاری قول داده شد — بانک پاسارگاد سکوی گزارش‌گیری و ماژول گزارش‌های سفارشی را امتحان می‌کند. پیشنهاد قیمت بعد از این جلسه فرستاده می‌شود.",
      location: "اتاق جلسهٔ ب",
      topicKey: "customers",
      mode: "in_person",
      durationMinutes: 45,
      when: { kind: "day", daysAfter: 1, hour: 10, minute: 0 },
      attendees: ["owner", "ali"],
    },
  ],

  records: [
    {
      key: "prior",
      title: "جلسهٔ هفتگی با NAI",
      description:
        "جلسهٔ هفتگی دونفره با NAI — قرارداد آسمان، اسم رمز سیمرغ، ماکروهای پشتیبانی و دموی هفتهٔ آیندهٔ پاسارگاد.",
      location: "اتاق جلسهٔ الف",
      topicKey: "oneOnOne",
      outsider: "nai",
      daysBefore: 7,
      hour: 9,
      minute: 0,
      avoidWeekend: false,
      speakerLabels: ["S1·1", "S2·1"],
      voices: [EMMA, ADRIAN],
      lines: [
        { speaker: 0, text: "صبح بخیر NAI. برویم سراغ جلسهٔ هفتگی‌مان. می‌خواهم دربارهٔ آسمان، ماکروهای پشتیبانی و دموی هفتهٔ آینده صحبت کنیم." },
        { speaker: 1, text: "صبح بخیر سارا. خوب است. از آسمان شروع کنیم، چون آن یکی مهلت مشخص دارد." },
        { speaker: 0, text: "قرارداد آسمان نزدیک امضاست. تیم حقوقی‌شان پیش‌نویس را در اختیار دارد و آخرین بند تجاری پنجشنبه بسته شد." },
        { speaker: 1, text: "خبر خوبی است. تا امضا چه مانده؟" },
        { speaker: 0, text: "بیشترش ماژول گزارش‌های سفارشی است. می‌خواهند پیش از امضا ببینند استقرارش چطور مرحله‌بندی می‌شود." },
        { speaker: 1, text: "ما مدام می‌گوییم استقرار ماژول گزارش‌های سفارشی آسمان که خیلی طولانی است. می‌شود یک نام کوتاه برایش بگذاریم؟" },
        { speaker: 0, text: "بله. بیایید داخل تیم به کل استقرار گزارش‌های سفارشی بگوییم سیمرغ. سیمرغ اسم رمز هر چیزی است که زیر آن ماژول برای آسمان انجام می‌شود." },
        { speaker: 1, text: "سیمرغ. یادداشت کردم. پس سیمرغ شامل گزارش‌ساز، خروجی‌های زمان‌بندی‌شده و محیط استیجینگ می‌شود؟" },
        { speaker: 0, text: "دقیقاً. سه تکه، یک اسم رمز. از این به بعد هر چیزی که مخصوص آسمان و زیر گزارش‌های سفارشی است، سیمرغ است." },
        { speaker: 1, text: "پس نگرانی من این است: چک‌لیست پذیرش سیمرغ هنوز وجود ندارد و بررسی حقوقی آسمان خواهد پرسید تحویل‌شده یعنی چه." },
        { speaker: 0, text: "حق با شماست. اگر چک‌لیست پس از بررسی حقوقی نوشته شود، دو بار بر سر معیارهای پذیرش مذاکره می‌کنیم." },
        { speaker: 1, text: "پس چک‌لیست پذیرش سیمرغ باید پیش از شروع بررسی حقوقی آسمان نوشته شود. مسئولش چه کسی باشد؟" },
        { speaker: 0, text: "علی نجفی. بیشتر گزارش‌ساز را خودش ساخته و می‌داند دادهٔ استیجینگ چه شکلی است." },
        { speaker: 1, text: "موافقم. علی نجفی مسئول چک‌لیست پذیرش سیمرغ است و مهلتش پیش از بررسی حقوقی آسمان." },
        { speaker: 0, text: "امروز به علی می‌گویم. کوتاه نگهش دارد: یک صفحه، بندهای قابل اندازه‌گیری، بدون چیزی که تفسیر بخواهد." },
        { speaker: 1, text: "خوب است. موضوع دوم. حمید هفتهٔ گذشته ماکروهای جدید پشتیبانی را تمام کرد. نگاهشان کردی؟" },
        { speaker: 0, text: "هنوز نه. این هفته ماکروهای پشتیبانی حمید را بازبینی می‌کنم و پیش از جمعه نظرم را برایش می‌فرستم." },
        { speaker: 1, text: "لطفاً به لحنشان هم مثل محتوایشان توجه کن. دوتایشان در پیش‌نویسی که دیدم کمی تند بودند." },
        { speaker: 0, text: "متوجه‌ام. لحن را هم بازبینی می‌کنم. آن یکی با من است." },
        { speaker: 1, text: "موضوع سوم. بانک پاسارگاد. دمویشان هفتهٔ آینده است، درست است؟" },
        { speaker: 0, text: "بله، دموی بانک پاسارگاد هفتهٔ آینده است. می‌خواهند سکوی گزارش‌گیری را ببینند و دربارهٔ ماژول گزارش‌های سفارشی هم پرسیدند." },
        { speaker: 1, text: "پس سیمرغ به پاسارگاد هم ربط دارد، حتی اگر اسم رمز داخلی بماند." },
        { speaker: 0, text: "درست است. بیرون از تیم هنوز همان ماژول گزارش‌های سفارشی است. داخل تیم، چک‌لیست سیمرغ برای پاسارگاد هم به کارمان می‌آید." },
        { speaker: 1, text: "برای دمو از من کاری برمی‌آید؟" },
        { speaker: 0, text: "مینا دارد محیط دمو را آماده می‌کند. اگر چهارشنبه دادهٔ نمونه را با او بررسی کنی، کمک بزرگی است." },
        { speaker: 1, text: "حتماً. جمع‌بندی کنم: سیمرغ اسم رمز داخلی استقرار گزارش‌های سفارشی آسمان است و علی نجفی مسئول چک‌لیست پذیرش سیمرغ پیش از بررسی حقوقی آسمان است." },
        { speaker: 0, text: "و من این هفته ماکروهای پشتیبانی حمید را بازبینی می‌کنم و دموی بانک پاسارگاد هفتهٔ آینده است." },
        { speaker: 1, text: "عالی است. دوشنبهٔ آینده همین ساعت. ممنون سارا." },
        { speaker: 0, text: "ممنون NAI. هفتهٔ آینده صحبت می‌کنیم." },
      ],
      summary: [
        "جلسهٔ هفتگی دونفره — سارا احمدی و NAI",
        "",
        "قرارداد آسمان نزدیک امضاست: تیم حقوقی آسمان پیش‌نویس را در اختیار دارد و آخرین بند تجاری پنجشنبه بسته شد. آنچه مانده ماژول گزارش‌های سفارشی است که آسمان می‌خواهد پیش از امضا مرحله‌بندی استقرار آن را ببیند. دو طرف توافق کردند کل استقرار گزارش‌های سفارشی آسمان در داخل تیم سیمرغ نامیده شود؛ سیمرغ گزارش‌ساز، خروجی‌های زمان‌بندی‌شده و محیط استیجینگ را در بر می‌گیرد و نامی داخلی می‌ماند.",
        "",
        "NAI مطرح کرد که چک‌لیست پذیرش سیمرغ هنوز نوشته نشده و بررسی حقوقی آسمان خواهد پرسید تحویل‌شده یعنی چه. نوشتن آن پس از بررسی حقوقی یعنی دو بار مذاکره بر سر معیارهای پذیرش؛ بنابراین چک‌لیست باید پیش از بررسی حقوقی آسمان نوشته شود. مسئولیت آن با علی نجفی است: یک صفحه، بندهای قابل اندازه‌گیری، بدون چیزی که تفسیر بخواهد.",
        "",
        "حمید هفتهٔ گذشته ماکروهای جدید پشتیبانی را تمام کرد؛ سارا این هفته آن‌ها را از نظر محتوا و لحن بازبینی می‌کند و پیش از جمعه نظرش را می‌فرستد. دموی بانک پاسارگاد هفتهٔ آینده است — مینا محیط دمو را آماده می‌کند و NAI چهارشنبه دادهٔ نمونه را با او بررسی می‌کند. پاسارگاد هم دربارهٔ ماژول گزارش‌های سفارشی پرسیده است، پس چک‌لیست سیمرغ آنجا هم به کار می‌آید.",
        "",
        "تصمیم‌ها:",
        "- استقرار ماژول گزارش‌های سفارشی آسمان در داخل تیم سیمرغ نام دارد (گزارش‌ساز، خروجی‌های زمان‌بندی‌شده، محیط استیجینگ).",
        "- چک‌لیست پذیرش سیمرغ پیش از بررسی حقوقی آسمان نوشته می‌شود و مسئولیتش با علی نجفی است.",
        "- بیرون از تیم نام ماژول تغییر نمی‌کند؛ سیمرغ نامی داخلی می‌ماند.",
        "",
        "اقدامات بعدی:",
        "- نوشتن چک‌لیست پذیرش سیمرغ پیش از بررسی حقوقی آسمان — مسئول: علی نجفی",
        "- بازبینی ماکروهای جدید پشتیبانی از نظر محتوا و لحن و ارسال نظر پیش از جمعه — مسئول: سارا احمدی",
        "- بررسی دادهٔ نمونهٔ دموی پاسارگاد با مینا در روز چهارشنبه — مسئول: NAI",
      ].join("\n"),
      items: [
        { kind: "decision", line: 6 },
        { kind: "decision", line: 13 },
        { kind: "decision", line: 22 },
        { kind: "action", line: 13 },
        { kind: "action", line: 16 },
        { kind: "action", line: 25 },
      ],
      audio: AUDIO_FA.prior,
    },

    {
      key: "pricing",
      title: "تماس قیمت‌گذاری با بانک پاسارگاد",
      description:
        "تماس قیمت‌گذاری با بانک پاسارگاد — پیشنهاد قیمت برای چهل کاربر به‌علاوهٔ ماژول گزارش‌های سفارشی.",
      location: "اتاق جلسهٔ الف",
      topicKey: "customers",
      outsider: "pasargad",
      daysBefore: 4,
      hour: 14,
      minute: 0,
      avoidWeekend: true,
      speakerLabels: ["S1·1", "S2·1"],
      voices: [EMMA, NINA],
      lines: [
        { speaker: 1, text: "سلام خانم احمدی، مرادی هستم از بانک پاسارگاد. ممنون که وقت گذاشتید." },
        { speaker: 0, text: "سلام خانم مرادی، خوشحالم که صحبت می‌کنیم. امروز چه کمکی از من برمی‌آید؟" },
        { speaker: 1, text: "برای سکوی گزارش‌گیری یک پیشنهاد قیمت می‌خواهیم. برای شروع چهل کاربر داریم و ماژول گزارش‌های سفارشی را هم می‌خواهیم." },
        { speaker: 0, text: "چهل کاربر به‌علاوهٔ ماژول گزارش‌های سفارشی. اجازه بدهید سطح‌ها را مرور کنم تا هر دو یک چیز را ببینیم." },
        { speaker: 1, text: "بفرمایید." },
        { speaker: 0, text: "قیمت سکو در سه سطح است: تا بیست کاربر، تا پنجاه کاربر و بالای پنجاه. چهل کاربر در سطح دوم قرار می‌گیرد." },
        { speaker: 1, text: "و ماژول گزارش‌های سفارشی جداگانه قیمت‌گذاری می‌شود؟" },
        { speaker: 0, text: "بله. ماژول گزارش‌های سفارشی یک افزودنی سالانهٔ ثابت روی سطح است و گزارش‌ساز و خروجی‌های زمان‌بندی‌شده را شامل می‌شود." },
        { speaker: 1, text: "متوجه شدم. پیشنهاد قیمت را کِی به‌صورت مکتوب داریم؟" },
        { speaker: 0, text: "پیشنهاد قیمت را تا سه‌شنبه می‌فرستم، تا پیش از جلسهٔ داخلی چهارشنبه‌تان در اختیار داشته باشید." },
        { speaker: 1, text: "سه‌شنبه خوب است. یک درخواست: لطفاً متن توافق‌نامهٔ سطح خدمات پشتیبانی را داخل خود پیشنهاد قیمت بیاورید، نه به‌صورت سندی جدا." },
        { speaker: 0, text: "حتماً. متن توافق‌نامهٔ سطح خدمات پشتیبانی را با زمان پاسخ هر سطح اهمیت داخل پیشنهاد قیمت می‌آورم." },
        { speaker: 1, text: "تیم تدارکات ما فقط پیشنهاد قیمت را می‌خواند، پس این کار یک رفت‌وبرگشت را از ما کم می‌کند." },
        { speaker: 0, text: "یادداشت کردم. ضمناً محیط دموی ما برای پاسارگاد پیش از ارسال پیشنهاد قیمت آماده می‌شود تا تیم شما بتواند همراه با اعداد آن را امتحان کند." },
        { speaker: 1, text: "این کمک‌کننده است. می‌توانیم توافق کنیم که محیط دمو پیش از ارسال پیشنهاد قیمت آماده باشد؟" },
        { speaker: 0, text: "بله، روی همین توافق کنیم. اول محیط دمو، بعد پیشنهاد قیمت تا سه‌شنبه." },
        { speaker: 1, text: "یک نکتهٔ دیگر. آیا سطح دوم آموزش راه‌اندازی برای هر چهل کاربر را شامل می‌شود؟" },
        { speaker: 0, text: "دو جلسهٔ آموزش راه‌اندازی را شامل می‌شود. جلسات بیشتر به‌عنوان گزینه در پیشنهاد قیمت آورده می‌شود تا بعداً تصمیم بگیرید." },
        { speaker: 1, text: "خوب است. پس منتظر پیشنهاد قیمت در روز سه‌شنبه می‌مانم. ممنون خانم احمدی." },
        { speaker: 0, text: "ممنون خانم مرادی. تا سه‌شنبه دریافتش می‌کنید. خدانگهدار." },
      ],
      summary: [
        "جلسهٔ قیمت‌گذاری — بانک پاسارگاد (خانم مرادی) و سارا احمدی",
        "",
        "خانم مرادی برای سکوی گزارش‌گیری پیشنهاد قیمتی برای چهل کاربر به‌علاوهٔ ماژول گزارش‌های سفارشی خواست. سارا سطح‌ها را تأیید کرد: تا بیست کاربر، تا پنجاه کاربر و بالای پنجاه — چهل کاربر در سطح دوم قرار می‌گیرد — و ماژول گزارش‌های سفارشی افزودنی سالانهٔ ثابتی است که گزارش‌ساز و خروجی‌های زمان‌بندی‌شده را شامل می‌شود. سطح دوم دو جلسهٔ آموزش راه‌اندازی دارد؛ جلسات بیشتر به‌عنوان گزینه در پیشنهاد قیمت می‌آید.",
        "",
        "سارا پیشنهاد قیمت را تا سه‌شنبه، پیش از جلسهٔ داخلی چهارشنبهٔ پاسارگاد، می‌فرستد. خانم مرادی خواست متن توافق‌نامهٔ سطح خدمات پشتیبانی با زمان پاسخ هر سطح اهمیت داخل خود پیشنهاد قیمت بیاید، چون تیم تدارکات آن‌ها فقط پیشنهاد قیمت را می‌خواند. هر دو توافق کردند محیط دموی پاسارگاد پیش از ارسال پیشنهاد قیمت آماده باشد.",
        "",
        "تصمیم‌ها:",
        "- بانک پاسارگاد روی سطح دوم (تا پنجاه کاربر) به‌علاوهٔ افزودنی گزارش‌های سفارشی قیمت می‌گیرد.",
        "- متن توافق‌نامهٔ سطح خدمات پشتیبانی داخل پیشنهاد قیمت می‌آید، نه سندی جدا.",
        "- محیط دمو پیش از ارسال پیشنهاد قیمت آماده می‌شود.",
        "",
        "اقدامات بعدی:",
        "- ارسال پیشنهاد قیمت چهل کاربر به‌علاوهٔ ماژول گزارش‌های سفارشی به بانک پاسارگاد تا سه‌شنبه — مسئول: سارا احمدی",
        "- آوردن متن توافق‌نامهٔ سطح خدمات پشتیبانی داخل پیشنهاد قیمت — مسئول: سارا احمدی",
        "- آماده‌سازی محیط دموی پاسارگاد پیش از ارسال پیشنهاد قیمت — مسئول: سارا احمدی",
      ].join("\n"),
      items: [
        { kind: "decision", line: 5 },
        { kind: "decision", line: 11 },
        { kind: "decision", line: 15 },
        { kind: "action", line: 9 },
        { kind: "action", line: 11 },
        { kind: "action", line: 13 },
      ],
      audio: AUDIO_FA.pricing,
    },
  ],

  /*
   * ── THE PRESENTER'S WEEK WITH THE ASSISTANT ─────────────────────────────
   *
   * The same five conversations as the English pack — same keys, same days,
   * same number of turns in the same roles — written in Persian rather than
   * translated. The digits are Persian digits: a table on a Persian screen
   * that counts in ASCII is the same one-language-per-screen break as an
   * English sentence would be, and nothing here is spoken, so the
   * spelled-out-numbers rule the dialogue lives under does not apply.
   *
   * `NAI` keeps its Latin spelling for the same reason it does everywhere
   * else in this pack: it is a company acronym.
   */
  conversations: [
    {
      key: "simorgh",
      daysBefore: 6,
      hour: 10,
      minute: 12,
      afterRecord: "prior",
      turns: [
        {
          role: "user",
          text: "سیمرغ دقیقاً شامل چه چیزهایی است؟",
        },
        {
          role: "assistant",
          text: "سیمرغ اسم رمز داخلی این سازمان برای استقرار ماژول گزارش‌های سفارشی آسمان است؛ در جلسهٔ هفتگی دونفره با NAI روی آن توافق شد. سه بخش را در بر می‌گیرد: گزارش‌ساز، خروجی‌های زمان‌بندی‌شده و محیط استیجینگ. بیرون از شرکت همان نام ماژول گزارش‌های سفارشی به کار می‌رود؛ سیمرغ داخلی می‌ماند.",
        },
      ],
    },

    {
      key: "board",
      daysBefore: 5,
      hour: 9,
      minute: 40,
      afterRecord: null,
      turns: [
        {
          role: "user",
          text: "الان کارت‌های باز دست چه کسانی است؟",
        },
        {
          role: "assistant",
          text: [
            "هشت کارت باز است. به تفکیک مسئول:",
            "",
            "| مسئول | کارت باز | دارای مهلت |",
            "| --- | --- | --- |",
            "| رضا کریمی | ۲ | تدوین شرایط تمدید سه‌ماههٔ سوم |",
            "| علی نجفی | ۲ | انتقال دادهٔ استیجینگ آسمان |",
            "| حمید صادقی | ۲ | — |",
            "| مینا رستمی | ۱ | — |",
            "| سارا احمدی | ۱ | ارسال پیشنهاد قیمت به بانک پاسارگاد |",
            "",
            "فقط همین سه کارت مهلت دارند. پنج کارت دیگر — بازنویسی چک‌لیست راه‌اندازی آسمان، رزرو اتاق برنامه‌ریزی سه‌ماههٔ چهارم، بازبینی ماکروهای جدید پشتیبانی، آماده‌سازی محیط دموی پاسارگاد و جمع‌آوری معیارهای پذیرش فاز یک — مهلتی ندارند.",
          ].join("\n"),
        },
        {
          role: "user",
          text: "برای کدام‌یک از بی‌مهلت‌ها مهلت بگذارم؟",
        },
        {
          role: "assistant",
          text: "آماده‌سازی محیط دموی پاسارگاد. مسئولش علی نجفی است، تنها کارت بی‌مهلتی است که اولویت بالا خورده، و دموی پاسارگاد بدون آن برگزار نمی‌شود — بقیه یک چک‌لیست، یک رزرو اتاق، یک بازبینی ماکرو و یک فهرست معیار پذیرش‌اند و هرکدام می‌توانند یک هفته عقب بیفتند بی‌آنکه کسی بیرون از تیم متوجه شود.",
        },
      ],
    },

    {
      key: "quote",
      daysBefore: 3,
      hour: 16,
      minute: 20,
      afterRecord: "pricing",
      turns: [
        {
          role: "user",
          text: "نامهٔ پیشنهاد قیمت پاسارگاد را طبق همان تماس بنویس.",
        },
        {
          role: "assistant",
          text: [
            "این پیش‌نویس است، مطابق آنچه در تماس قیمت‌گذاری با خانم مرادی توافق شد.",
            "",
            "**موضوع: سکوی گزارش‌گیری — پیشنهاد قیمت شما**",
            "",
            "خانم مرادی عزیز،",
            "",
            "از وقتی که گذاشتید سپاسگزارم. پیشنهاد زیر چهل کاربر را روی سطح دوم — تا پنجاه کاربر — به‌همراه ماژول گزارش‌های سفارشی در بر می‌گیرد؛ این ماژول افزودنی سالانه است و گزارش‌ساز و خروجی‌های زمان‌بندی‌شده را شامل می‌شود. دو جلسهٔ راه‌اندازی گنجانده شده و جلسات بیشتر به‌صورت گزینه آمده تا تیم شما بعداً تصمیم بگیرد.",
            "",
            "متن توافق‌نامهٔ سطح خدمات پشتیبانی، با زمان پاسخ هر سطح اهمیت، داخل همین نامه آمده است و پیوست جداگانه ندارد.",
            "",
            "محیط دموی شما پیش از رسیدن این پیشنهاد به تیم تدارکات فعال خواهد بود تا بتوانند سکو را کنار اعداد امتحان کنند.",
            "",
            "با احترام،",
            "سارا احمدی",
            "",
            "بگویید چه چیزی عوض شود.",
          ].join("\n"),
        },
        {
          role: "user",
          text: "زمان پاسخ هر سطح اهمیت را کامل بنویس؛ تدارکات‌شان فقط همین نامه را می‌خواند.",
        },
        {
          role: "assistant",
          text: "انجام شد. بخش توافق‌نامهٔ سطح خدمات حالا زمان پاسخ هر سطح اهمیت را داخل متن نامه فهرست می‌کند و پیوند صفحهٔ سیاست پشتیبانی حذف شد — پیوند دقیقاً همان سند دومی است که خانم مرادی گفت تیم تدارکاتشان بازش نمی‌کند.",
        },
        {
          role: "user",
          text: "خوب است. عددها را نگذار تا رضا متن تمدید را تأیید کند.",
        },
        {
          role: "assistant",
          text: "انجام شد. پیش‌نویس حالا سطح و ماژول افزودنی را بدون هیچ قیمتی نام می‌برد و در پایان می‌گوید نسخهٔ قیمت‌دار پس از تأیید متن تمدید توسط رضا کریمی فرستاده می‌شود. چیزی ارسال نشده است؛ پیش‌نویس دست شماست.",
        },
      ],
    },

    {
      key: "weekly",
      daysBefore: 2,
      hour: 11,
      minute: 5,
      afterRecord: "prior",
      turns: [
        {
          role: "user",
          text: "در جلسهٔ هفتگی با NAI چه چیزی به گردن من افتاد؟",
        },
        {
          role: "assistant",
          text: "از آن جلسه یک مورد به عهدهٔ شماست: بازبینی ماکروهای جدید پشتیبانی حمید صادقی از نظر محتوا و لحن و فرستادن نظرتان پیش از جمعه. دو مورد دیگر جای دیگری رفت — چک‌لیست پذیرش سیمرغ با علی نجفی است و باید پیش از بررسی حقوقی آسمان نوشته شود، و NAI دادهٔ نمونهٔ دموی پاسارگاد را با مینا رستمی بررسی می‌کند.",
        },
        {
          role: "user",
          text: "معنی «تحویل‌شده» برای آسمان روشن شد؟",
        },
        {
          role: "assistant",
          text: "نه — همان چیزی است که چک‌لیست برای پاسخ به آن وجود دارد. تصمیم این بود که چک‌لیست پذیرش سیمرغ پیش از بررسی حقوقی آسمان نوشته شود، چون نوشتنش بعد از آن یعنی دو بار مذاکره بر سر معیارهای پذیرش. یک صفحه، بندهای قابل اندازه‌گیری، بدون چیزی که تفسیر بخواهد. هنوز نوشته نشده است.",
        },
      ],
    },

    {
      key: "unanswered",
      daysBefore: 1,
      hour: 18,
      minute: 47,
      afterRecord: "pricing",
      turns: [
        /* یک پیام و بس — پرسشی که کسی رهایش کرده است */
        {
          role: "user",
          text: "پیشنهاد قیمت پاسارگاد را با قرارداد پارسال آسمان مقایسه کن.",
        },
      ],
    },
  ],
};
