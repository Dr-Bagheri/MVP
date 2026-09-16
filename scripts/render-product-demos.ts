/**
 * Render the shipped onboarding films from deterministic, code-drawn scenes.
 * Node 22+, FFmpeg, and @napi-rs/canvas 0.1.80 are required ONLY to rebuild.
 * NEURAI_RENDER_MODULES can point at an isolated directory's node_modules.
 * Usage: node --experimental-strip-types scripts/render-product-demos.ts
 * Optional: --locale=en --scene=meeting --theme=dark --poster-only
 * Source mapping and reproduction instructions: docs/PRODUCT-DEMOS.md.
 */
import { createRequire } from "node:module";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { once } from "node:events";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(process.env.NEURAI_RENDER_MODULES
  ? join(process.env.NEURAI_RENDER_MODULES, "loader.cjs") : import.meta.url);
const { createCanvas, GlobalFonts } = require("@napi-rs/canvas");
for (const weight of ["Regular", "Medium", "SemiBold", "Bold"]) {
  GlobalFonts.registerFromPath(join(root, "web/src/app/fonts", `Vazirmatn-${weight}.ttf`), "Vazirmatn");
}

const W = 1280, H = 960, FPS = 24, SECONDS = 10;
const scenes = ["meeting", "ask", "tasks", "team", "connect"] as const;
type Scene = typeof scenes[number];
type Locale = "en" | "fa";
type Ctx = CanvasRenderingContext2D;
const canvas = createCanvas(W, H);
const ctx: Ctx = canvas.getContext("2d");
const css = readFileSync(join(root, "web/src/app/globals.css"), "utf8");
const dark = process.argv.includes("--theme=dark");
const themeCss = css.match(dark
  ? /\n\s*:root\s*\{([\s\S]*?)\n\s*\}/
  : /\n\s*\[data-theme="light"\]\s*\{([\s\S]*?)\n\s*\}/)?.[1];
if (!themeCss) throw new Error("The selected theme token block is missing");
const tone = (name: string, fallback: string) => {
  const rgb = themeCss.match(new RegExp(`--${name}:\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)`));
  return rgb ? `rgb(${rgb[1]},${rgb[2]},${rgb[3]})` : fallback;
};
const color = {
  paper: tone("bg", "#f6f5f1"), ink: tone("fg", "#1c1a16"),
  muted: tone("fg-muted", "#47443d"), subtle: tone("fg-subtle", "#777b74"),
  green: tone("accent", "#087d43"), white: tone("surface", "#fff"),
  well: tone("field", "#fbfaf7"), line: tone("border", "#e8e7e2"),
  mint: dark ? tone("accent-soft", "#1a2e2b") : "#e8f2e9",
  forest: "#173c32", warm: dark ? tone("surface-2", "#242a30") : "#eee9df",
  lilac: dark ? "#343047" : "#e6dff1", onGreen: tone("on-accent", "#fff"),
};
const copy = {
  en: {
    titles: ["Be in the conversation.", "Your memory. On demand.", "Make the next step happen.", "Better, together.", "Bring your day into focus."],
    subs: ["Echo keeps the words. You keep the connection.", "Ask a question. Go back to the source.", "From a plan to progress, in one workspace.", "Start on your own. Invite your team when you’re ready.", "Connect your calendar. See what’s coming."],
    labels: ["Meetings", "Assistant", "Tasks", "Your team", "Connections"],
    captions: [
      ["Record a conversation in Echo.", "Read the transcript and review the summary."],
      ["Ask about a meeting in your workspace.", "Follow the answer back to its source."],
      ["Give the next step an owner and a due date.", "Move it forward as the work happens."],
      ["Invite a teammate by email.", "Choose a role. They join after accepting."],
      ["Choose a calendar connection.", "Authorize access, then review your events."],
    ],
    sample: "Illustrative demo · sample workspace", product: "NeurAI Platform",
    meeting: "Product planning", private: "Private", recording: "Recording", transcript: "Transcript", summary: "Summary",
    speaker1: "Sara", speaker2: "Amir", line1: "Let’s launch the new website on Monday.", line2: "I’ll share the final design before Friday.", line3: "Perfect. Let’s review it together tomorrow.",
    saved: "Recording saved", overview: "A clear record of the conversation", decision: "Decision", decisionText: "Website launch planned for Monday.", action: "Next step", actionText: "Amir to share the final design by Friday.",
    ask: "What did we decide about the launch?", search: "Reading your meeting…", answer: "The website launch is planned for Monday.", answer2: "Amir will share the final design by Friday.", source: "Source · Product planning", sourceTime: "Transcript · 00:12", askHint: "Ask your assistant…",
    board: "Website launch", todo: "To do", doing: "In progress", done: "Done", task1: "Share the final design", task2: "Review launch checklist", task3: "Prepare the announcement", friday: "Friday", tomorrow: "Tomorrow", owner: "Assigned to Amir", updated: "Progress, kept in view",
    invite: "Invite people", workspace: "Your workspace", teamLead: "A place for your team’s work.", email: "Teammate’s email", role: "Role", member: "Member", ownerRole: "Owner", send: "Send invitation", sent: "Invitation sent", pending: "Pending acceptance", inviteNote: "Access follows their role and your sharing choices.",
    connections: "Integrations", calendar: "Calendar", choose: "Choose a connection", connect: "Connect", permission: "Your permission comes first", permissionText: "Choose the account and approve calendar access.", authorized: "After you authorize", nextMeeting: "Calendar events", prep: "Available from your connected calendar", prepDetail: "Review your connected calendar’s events in NeurAI.",
  },
  fa: {
    titles: ["در گفت‌وگو حضور داشته باش.", "حافظه‌ات، همیشه در دسترس.", "قدم بعدی را بردار.", "با هم، بهتر پیش بروید.", "روزت را روشن‌تر شروع کن."],
    subs: ["اکو حرف‌ها را نگه می‌دارد؛ تو ارتباط را.", "سؤال بپرس و به منبع پاسخ برگرد.", "از برنامه تا پیشرفت، در یک فضای کاری.", "تنها شروع کن؛ هر وقت آماده‌ای، تیم را دعوت کن.", "تقویمت را وصل کن و رویدادهایت را ببین."],
    labels: ["جلسات", "دستیار", "کارها", "تیم شما", "اتصال‌ها"],
    captions: [
      ["گفت‌وگو را با اکو ضبط کن.", "رونوشت را بخوان و خلاصه را مرور کن."],
      ["دربارهٔ یکی از جلساتت سؤال بپرس.", "از پاسخ، مستقیم به منبع آن برگرد."],
      ["برای قدم بعدی، مسئول و مهلت تعیین کن.", "با پیشرفت کار، آن را روی برد جابه‌جا کن."],
      ["همکارت را با ایمیل دعوت کن.", "نقش را انتخاب کن؛ با پذیرش دعوت به شما می‌پیوندد."],
      ["یک اتصال تقویم انتخاب کن.", "دسترسی را تأیید کن؛ سپس رویدادها را ببین."],
    ],
    sample: "نمایش نمونه · فضای کاری فرضی", product: "پلتفرم NeurAI",
    meeting: "برنامه‌ریزی محصول", private: "خصوصی", recording: "در حال ضبط", transcript: "رونوشت", summary: "خلاصه",
    speaker1: "سارا", speaker2: "امیر", line1: "بیایید سایت جدید را دوشنبه منتشر کنیم.", line2: "طرح نهایی را تا جمعه به اشتراک می‌گذارم.", line3: "عالیه. فردا با هم مرورش می‌کنیم.",
    saved: "ضبط ذخیره شد", overview: "روایتی روشن از گفت‌وگو", decision: "تصمیم", decisionText: "انتشار سایت برای دوشنبه برنامه‌ریزی شد.", action: "قدم بعدی", actionText: "امیر طرح نهایی را تا جمعه به اشتراک می‌گذارد.",
    ask: "برای انتشار سایت چه تصمیمی گرفتیم؟", search: "در حال خواندن جلسهٔ شما…", answer: "انتشار سایت برای دوشنبه برنامه‌ریزی شده است.", answer2: "امیر طرح نهایی را تا جمعه به اشتراک می‌گذارد.", source: "منبع · برنامه‌ریزی محصول", sourceTime: "رونوشت · ۰۰:۱۲", askHint: "از دستیار بپرس…",
    board: "انتشار سایت", todo: "برای انجام", doing: "در حال انجام", done: "انجام‌شده", task1: "اشتراک طرح نهایی", task2: "مرور چک‌لیست انتشار", task3: "آماده‌سازی اطلاعیه", friday: "جمعه", tomorrow: "فردا", owner: "مسئول: امیر", updated: "پیشرفت، پیش چشم شما",
    invite: "دعوت همکار", workspace: "فضای کاری شما", teamLead: "جایی برای کارهای تیم شما.", email: "ایمیل همکار", role: "نقش", member: "عضو", ownerRole: "مالک", send: "ارسال دعوت", sent: "دعوت ارسال شد", pending: "در انتظار پذیرش", inviteNote: "دسترسی با نقش و انتخاب‌های اشتراک‌گذاری شما تعیین می‌شود.",
    connections: "اتصال‌ها", calendar: "تقویم", choose: "یک اتصال انتخاب کن", connect: "اتصال", permission: "اجازهٔ شما، قدم اول است", permissionText: "حساب را انتخاب و دسترسی به تقویم را تأیید کن.", authorized: "پس از تأیید شما", nextMeeting: "رویدادهای تقویم", prep: "در دسترس از تقویم متصل شما", prepDetail: "رویدادهای تقویم متصل خود را در NeurAI مرور کن.",
  },
};
let locale: Locale = "en";
let c = copy.en;
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const ease = (v: number) => { const n = clamp(v); return n * n * (3 - 2 * n); };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const digits = (v: string) => locale === "fa" ? v.replace(/\d/g, n => "۰۱۲۳۴۵۶۷۸۹"[Number(n)]!) : v;

function rect(x: number, y: number, w: number, h: number, r = 20, fill = color.white, shadow = false) {
  ctx.save();
  if (shadow) { ctx.shadowColor = "#223b2520"; ctx.shadowBlur = 35; ctx.shadowOffsetY = 16; }
  ctx.fillStyle = fill; ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill(); ctx.restore();
}
function line(x: number, y: number, x2: number, y2: number, ink = color.line, width = 1) {
  ctx.strokeStyle = ink; ctx.lineWidth = width; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke();
}
function dot(x: number, y: number, r: number, ink: string) {
  ctx.fillStyle = ink; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
}
function text(value: string, x: number, y: number, size = 24, ink = color.ink, bold = false, align: CanvasTextAlign = "start", width?: number) {
  ctx.save(); ctx.direction = locale === "fa" ? "rtl" : "ltr";
  ctx.font = `${bold ? 700 : 400} ${size}px Vazirmatn`;
  // Skia's Canvas start/end alignment is not bidi-aware: use physical alignment.
  ctx.textAlign = align === "start" ? (locale === "fa" ? "right" : "left") : align;
  ctx.textBaseline = "middle"; ctx.fillStyle = ink;
  if (width && ctx.measureText(value).width > width) {
    let short = value;
    while (short.length && ctx.measureText(short + "…").width > width) short = short.slice(0, -1);
    value = short + "…";
  }
  // An explicit bidi paragraph keeps Persian sentence punctuation at its end.
  ctx.fillText(locale === "fa" ? `\u202B${value}\u202C` : value, x, y); ctx.restore();
}
function label(value: string, x: number, y: number, w: number, size = 24, ink = color.ink, bold = false) {
  text(value, locale === "fa" ? x + w : x, y, size, ink, bold, "start", w);
}
function pill(value: string, x: number, y: number, w: number, fill = color.mint, ink = color.green) {
  rect(x, y, w, 38, 19, fill); text(value, x + w / 2, y + 19, 18, ink, true, "center");
}
function reveal(at: number, start: number, fn: () => void) {
  const p = ease((at - start) / .6); if (p <= 0) return;
  ctx.save(); ctx.globalAlpha *= p; ctx.translate(0, (1 - p) * 18); fn(); ctx.restore();
}
function check(x: number, y: number, scale = 1, ink = color.green) {
  ctx.save(); ctx.strokeStyle = ink; ctx.lineWidth = 3 * scale; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(x - 7 * scale, y); ctx.lineTo(x - 2 * scale, y + 5 * scale); ctx.lineTo(x + 8 * scale, y - 6 * scale); ctx.stroke(); ctx.restore();
}
function avatar(name: string, x: number, y: number, fill = color.mint) {
  dot(x, y, 22, fill); text(name.slice(0, 1), x, y + 1, 22, color.ink, true, "center");
}
function cursor(x: number, y: number, press = 0) {
  ctx.save(); ctx.translate(x, y);
  if (press > 0) { ctx.globalAlpha = press * .22; dot(0, 0, 23 + (1 - press) * 18, color.green); ctx.globalAlpha = 1; }
  ctx.shadowColor = "#0003"; ctx.shadowBlur = 8;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(3, 28); ctx.lineTo(10, 20); ctx.lineTo(18, 33); ctx.lineTo(24, 29); ctx.lineTo(16, 16); ctx.lineTo(27, 13); ctx.closePath();
  ctx.fillStyle = color.forest; ctx.fill(); ctx.strokeStyle = color.white; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
}
function frame(scene: Scene, t: number) {
  const i = scenes.indexOf(scene);
  ctx.clearRect(0, 0, W, H); rect(0, 0, W, H, 0, color.paper);
  const g = ctx.createRadialGradient(850 + Math.sin(t / 3) * 40, 500, 20, 670, 470, 750);
  g.addColorStop(0, dark ? "#164d3840" : "#dcebdd"); g.addColorStop(.6, "#eeeae200"); g.addColorStop(1, "#f6f5f100");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // A slow orbital line suggests the voice assistant without becoming a second UI.
  ctx.save(); ctx.strokeStyle = dark ? "#69c4970c" : "#0b79410c"; ctx.lineWidth = 1;
  for (let n = 0; n < 3; n++) { ctx.beginPath(); ctx.ellipse(690, 516, 520 + n * 70, 295 + n * 40, -.15 + n * .12, 0, Math.PI * 2); ctx.stroke(); }
  ctx.restore();
  pill(`${digits(String(i + 1).padStart(2, "0"))} / ${digits("05")}  ·  ${c.labels[i]}`, 60, 42, 224);
  text(c.product, 1218, 60, 21, color.muted, true, "right");
  text(c.titles[i]!, 640, 129, locale === "fa" ? 49 : 52, color.ink, true, "center");
  text(c.subs[i]!, 640, 187, 25, color.muted, false, "center");
}
function windowFrame(title: string, side: string) {
  rect(104, 249, 1072, 530, 24, dark ? "#1b2025f8" : "#ffffffed", true);
  rect(104, 249, 1072, 63, 24, dark ? "#242a30b0" : "#ffffffa0");
  (dark ? ["#596773", "#596773", "#62a987"] : ["#d4d8d0", "#d4d8d0", "#a8cbb3"]).forEach((v, i) => dot(137 + i * 21, 280, 5, v));
  text(title, 640, 281, 20, color.muted, true, "center");
  line(105, 311, 1175, 311);
  if (side) pill(side, 974, 263, 166, color.warm, color.muted);
}
function meeting(t: number) {
  windowFrame(c.meeting, "Echo");
  if (t < 5.2) {
    const fade = 1 - ease((t - 4.6) / .6);
    ctx.save(); ctx.globalAlpha = fade;
    rect(132, 337, 320, 414, 18, color.forest);
    text("Echo", 292, 385, 26, "#e0eee5", true, "center");
    for (let i = 0; i < 39; i++) {
      const n = i / 38, amp = Math.sin(n * Math.PI) * (18 + 65 * Math.abs(Math.sin(i * 2.19 + t * 4.5) * Math.cos(i * .3 - t * 2)));
      rect(163 + i * 6.6, 486 - amp / 2, 3.8, amp, 2, i % 4 === 0 ? "#d8fce5" : "#72ca92");
    }
    text(digits(`00:${String(12 + Math.floor(t)).padStart(2, "0")}`), 292, 571, 43, "#fff", false, "center");
    dot(238, 628, 5, "#f4a59a"); text(c.recording, 302, 627, 18, "#d7e9df", false, "center");
    dot(292, 700, 23, "#d96963"); rect(284, 692, 16, 16, 4, "#fff");
    label(c.transcript, 486, 357, 649, 22, color.muted, true);
    [c.line1, c.line2, c.line3].forEach((v, i) => reveal(t, .6 + i * 1.12, () => {
      const y = 421 + i * 109;
      const name = i % 2 ? c.speaker2 : c.speaker1;
      avatar(name, locale === "fa" ? 1106 : 510, y, i % 2 ? color.lilac : color.mint);
      label(`${name}  ·  ${digits(`00:${12 + i * 4}`)}`, locale === "fa" ? 494 : 549, y, 523, 18, color.subtle, true);
      label(v, 491, y + 45, 641, 25);
    }));
    ctx.restore();
  }
  reveal(t, 4.9, () => {
    label(c.overview, 149, 361, 935, 31, color.ink, true);
    pill(c.saved, 150, 399, 222);
    rect(146, 464, 988, 110, 16, color.well);
    rect(146, 590, 988, 110, 16, color.mint);
    label(c.decision, 179, 493, 912, 20, color.green, true);
    label(c.decisionText, 179, 537, 912, 27);
    reveal(t, 5.9, () => { label(c.action, 179, 620, 912, 20, color.green, true); label(c.actionText, 179, 663, 912, 26); });
    label(`${c.summary}  ·  ${c.transcript}`, 155, 741, 936, 19, color.muted);
  });
}
function orb(x: number, y: number, t: number) {
  for (let i = 0; i < 150; i++) {
    const a = i * 2.39996 + t * (.06 + i % 3 * .025), r = 40 * Math.sqrt((i + .5) / 150);
    dot(x + Math.cos(a) * r, y + Math.sin(a) * r, .9 + i % 5 * .22, i % 3 === 0 ? "#758edd" : i % 3 === 1 ? "#af81c9" : "#42916e");
  }
}
function ask(t: number) {
  windowFrame(c.labels[1]!, "");
  orb(177, 382, t); label("NeurAI", 241, 377, 763, 27, color.ink, true);
  reveal(t, .35, () => {
    rect(289, 428, 832, 69, 19, color.mint);
    label(c.ask.slice(0, Math.floor(clamp((t - .35) / 1.15) * c.ask.length)), 318, 462, 773, 27);
  });
  reveal(t, 2.1, () => {
    if (t < 3.6) { label(c.search, 239, 550, 862, 21, color.subtle); return; }
    label(c.answer, 239, 546, 862, 27, color.ink, true);
    reveal(t, 4.1, () => label(c.answer2, 239, 590, 862, 25));
    reveal(t, 4.6, () => {
      rect(235, 632, 863, 68, 12, color.well);
      dot(263, 663, 6, color.green);
      label(c.source, 290, 657, 522, 21, color.green, true);
      label(c.sourceTime, 824, 665, 248, 18, color.muted);
    });
  });
  line(147, 723, 1132, 723); label(c.askHint, 171, 751, 942, 20, color.subtle);
  if (t > 6) cursor(lerp(1152, 912, ease((t - 6) / 1.3)), lerp(740, 672, ease((t - 6) / 1.3)), t > 7.3 && t < 7.7 ? 1 - (t - 7.3) / .4 : 0);
}
function taskCard(title: string, x: number, y: number, who: string, due: string, floating = false) {
  rect(x, y, 295, 161, 15, color.white, floating);
  label(title, x + 19, y + 35, 257, 22, color.ink, true);
  line(x + 20, y + 71, x + 275, y + 71);
  avatar(who, x + 39, y + 114, color.lilac);
  label(due, x + 77, y + 114, 193, 19, color.muted);
}
function tasks(t: number) {
  windowFrame(c.board, c.labels[2]!);
  const headings = [c.todo, c.doing, c.done];
  headings.forEach((h, i) => {
    const x = 133 + i * 340;
    rect(x, 337, 322, 413, 16, dark ? (i === 2 ? color.mint : color.well) : (i === 2 ? "#e9f0e7" : "#f0f0eb"));
    dot(x + 23, 369, 5, i === 2 ? color.green : "#9d9b91");
    label(h, x + 39, 369, 264, 21, color.muted, true);
  });
  taskCard(c.task2, 487, 412, c.speaker1, c.tomorrow);
  taskCard(c.task3, 148, 592, c.speaker1, c.friday);
  const travel = ease((t - 2.5) / 1.45), done = ease((t - 6) / 1.3);
  const x = lerp(148, 828, travel), y = 412 - Math.sin(travel * Math.PI) * 20;
  taskCard(c.task1, x, y, c.speaker2, c.friday, travel > 0 && travel < 1);
  if (travel >= 1) { dot(x + 265, y + 29, 12, color.mint); check(x + 265, y + 29, .8); }
  if (t > 1 && t < 6.3) cursor(x + 163, y + 56, t > 2 && t < 2.5 ? .8 : 0);
  if (done > 0) { ctx.save(); ctx.globalAlpha = done; pill(c.updated, 827, 668, 286); ctx.restore(); }
}
function team(t: number) {
  windowFrame(c.workspace, "");
  label(c.teamLead, 155, 363, 963, 31, color.ink, true);
  avatar(c.speaker1, 180, 435); label(c.speaker1, 218, 428, 357, 24, color.ink, true);
  label(c.ownerRole, 218, 460, 357, 18, color.muted);
  rect(613, 409, 518, 321, 20, color.white, true);
  label(c.invite, 644, 450, 454, 26, color.ink, true);
  label(c.email, 644, 500, 452, 17, color.muted);
  rect(639, 523, 462, 54, 9, color.well);
  text("amir@example.com".slice(0, Math.floor(clamp((t - .5) / 1.7) * 16)), 660, 550, 23, color.ink, false, "left");
  label(`${c.role} · ${c.member}`, 644, 610, 450, 21);
  const sent = t > 4.2;
  rect(639, 647, 462, 53, 12, sent ? color.mint : color.green);
  text(sent ? c.sent : c.send, 870, 674, 22, sent ? color.green : color.onGreen, true, "center");
  reveal(t, 4.3, () => {
    avatar(c.speaker2, 180, 540, color.lilac); label(c.speaker2, 218, 526, 344, 24, color.ink, true);
    label(c.pending, 218, 560, 344, 18, color.muted);
    label(c.inviteNote, 151, 744, 989, 19, color.muted);
  });
  if (t > 2.5 && t < 4.7) cursor(lerp(1118, 916, ease((t - 2.5) / 1.3)), lerp(753, 674, ease((t - 2.5) / 1.3)), t > 4 ? .7 : 0);
}
function connect(t: number) {
  windowFrame(c.connections, "");
  if (t < 4.7) {
    ctx.save(); ctx.globalAlpha = 1 - ease((t - 4.2) / .5);
    label(c.choose, 152, 369, 973, 31, color.ink, true);
    ["Google", "Microsoft"].forEach((provider, i) => {
      const x = 151 + i * 516;
      rect(x, 415, 489, 157, 17, i === 0 ? color.mint : color.well);
      dot(x + 47, 464, 24, color.white); text(provider[0]!, x + 47, 466, 27, color.green, true, "center");
      text(provider, x + 86, 457, 26, color.ink, true, "left");
      label(c.calendar, x + 25, 531, 290, 21, color.muted);
      pill(c.connect, x + 338, 513, 126, color.white);
    });
    reveal(t, 2.3, () => {
      rect(151, 607, 1005, 119, 17, color.forest);
      label(c.permission, 184, 644, 936, 27, "#f1f6f0", true);
      label(c.permissionText, 184, 689, 936, 24, "#c6ddcf");
    });
    ctx.restore();
  }
  reveal(t, 4.5, () => {
    pill(c.authorized, 155, 339, 282);
    label(c.nextMeeting, 155, 424, 957, 22, color.muted);
    rect(150, 463, 986, 235, 20, color.mint);
    label(c.meeting, 185, 514, 914, 32, color.ink, true);
    label(`${c.tomorrow}  ·  ${digits("10:00")}`, 185, 560, 914, 23, color.muted);
    rect(179, 607, 928, 58, 12, color.white);
    label(c.prep, 207, 637, 871, 25, color.green, true);
    label(c.prepDetail, 157, 741, 965, 20, color.muted);
  });
}
function draw(scene: Scene, at: number) {
  frame(scene, at);
  // Gentle camera settle: less than 1% zoom, no large flying UI transitions.
  ctx.save(); const zoom = 1 + .006 * Math.sin(at * .24); ctx.translate(640, 514); ctx.scale(zoom, zoom); ctx.translate(-640, -514);
  const enter = ease(at / .55); ctx.globalAlpha = enter; ctx.translate(0, (1 - enter) * 18);
  ({ meeting, ask, tasks, team, connect })[scene](at); ctx.restore();
  const idx = scenes.indexOf(scene), sentence = c.captions[idx]![at < 4.8 ? 0 : 1]!;
  text(sentence, 640, 835, 26, color.ink, true, "center");
  text(c.sample, 640, 898, 18, color.subtle, false, "center");
  rect(498, 868, 284, 3, 2, color.line); rect(498, 868, Math.max(3, 284 * at / SECONDS), 3, 2, color.green);
}
async function encode(scene: Scene, out: string) {
  const file = join(out, `${scene}.mp4`);
  // Feed raw frames over stdin. No temporary frame directory and no shell interpolation.
  const ff = spawn(process.env.FFMPEG_PATH || "ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo", "-pixel_format", "rgba", "-video_size", `${W}x${H}`, "-framerate", String(FPS), "-i", "pipe:0", "-an", "-c:v", "libx264", "-preset", "fast", "-crf", "23", "-pix_fmt", "yuv420p", "-movflags", "+faststart", file], { stdio: ["pipe", "inherit", "inherit"] });
  const finished = once(ff, "close");
  for (let f = 0; f < FPS * SECONDS; f++) {
    draw(scene, f / FPS);
    const bytes = Buffer.from(ctx.getImageData(0, 0, W, H).data.buffer);
    if (!ff.stdin.write(bytes)) await once(ff.stdin, "drain");
  }
  ff.stdin.end();
  const [code] = await finished;
  if (code !== 0) throw new Error(`FFmpeg failed for ${locale}/${scene}: ${code}`);
}
const localeArg = process.argv.find(a => a.startsWith("--locale="))?.split("=")[1];
const sceneArg = process.argv.find(a => a.startsWith("--scene="))?.split("=")[1];
for (const lang of ["en", "fa"] as const) {
  if (localeArg && localeArg !== lang) continue;
  locale = lang; c = copy[locale];
  const out = join(root, "web/public/demo", locale, dark ? "dark" : ""); mkdirSync(out, { recursive: true });
  for (const scene of scenes) {
    if (sceneArg && sceneArg !== scene) continue;
    draw(scene, scene === "meeting" ? 3.9 : 8.4);
    writeFileSync(join(out, `${scene}.jpg`), canvas.toBuffer("image/jpeg", 90));
    if (!process.argv.includes("--poster-only")) await encode(scene, out);
    const i = scenes.indexOf(scene);
    writeFileSync(join(out, `${scene}.vtt`), `WEBVTT\n\n00:00.000 --> 00:04.800\n${c.captions[i]![0]}\n\n00:04.800 --> 00:10.000\n${c.captions[i]![1]}\n`, "utf8");
    console.log(`Rendered ${locale}/${dark ? "dark/" : ""}${scene}${process.argv.includes("--poster-only") ? " poster" : " (10s, 1280×960)"}`);
  }
}
