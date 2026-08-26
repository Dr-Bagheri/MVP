import fs from "node:fs/promises";
import path from "node:path";
import { Presentation, PresentationFile } from "@oai/artifact-tool";

const ROOT = "C:/Users/amirreza/Desktop/mvp";
const OUT = path.join(ROOT, "deliverables/neurai-platform-final");
const RENDER = path.join(OUT, "build/rendered-pptx");
const ASSET = path.join(OUT, "build/assets");
const SCREEN = path.join(ROOT, "docs/screenshots");
const BRAND = path.join(ROOT, "web/public/brand/neurai-mark-light-transparent.png");

const C = {
  ink: "#181424",
  muted: "#716A7C",
  paper: "#FAF8FC",
  white: "#FFFFFF",
  line: "#DDD7E5",
  purple: "#9B6DFF",
  purple2: "#6F43E7",
  violetPale: "#EEE7FF",
  indigo: "#0C0922",
  indigo2: "#191034",
  coral: "#FF6F61",
  coralPale: "#FFF0ED",
  cyan: "#63D8FF",
  cyanPale: "#EAF9FF",
  green: "#2E9B72",
  amber: "#D39024",
};

const W = 1280;
const H = 720;
const M = 64;

async function blob(file) {
  return new Uint8Array(await fs.readFile(file));
}

async function writeBlob(file, b) {
  await fs.writeFile(file, new Uint8Array(await b.arrayBuffer()));
}

function rect(slide, x, y, w, h, fill, radius = "rounded-xl", line = "none", name) {
  const geometry = radius === "rect" ? "rect" : "roundRect";
  const safeRadius = radius === "rounded-l-xl" || radius === "rounded-r-xl" ? "rounded-xl" : radius;
  return slide.shapes.add({
    geometry,
    ...(name ? { name } : {}),
    position: { left: x, top: y, width: w, height: h },
    fill,
    line: { style: "solid", fill: line, width: line === "none" ? 0 : 1 },
    ...(geometry === "roundRect" ? { borderRadius: safeRadius } : {}),
  });
}

function label(slide, text, x, y, w, h, opts = {}) {
  const s = slide.shapes.add({
    geometry: "textbox",
    position: { left: x, top: y, width: w, height: h },
    fill: "none",
    line: { style: "solid", fill: "none", width: 0 },
  });
  s.text = text;
  s.text.style = {
    fontSize: opts.size ?? 18,
    bold: opts.bold ?? false,
    color: opts.color ?? C.ink,
    alignment: opts.align ?? "left",
    verticalAlignment: opts.vAlign ?? "top",
    autoFit: "shrinkText",
    wrap: "square",
    insets: { top: opts.padY ?? 0, right: opts.padX ?? 0, bottom: opts.padY ?? 0, left: opts.padX ?? 0 },
  };
  return s;
}

function titleBlock(slide, eyebrow, title, subtitle = "", dark = false) {
  label(slide, eyebrow.toUpperCase(), M, 38, 500, 26, { size: 13, bold: true, color: dark ? C.purple : C.purple2 });
  label(slide, title, M, 76, 1152, 72, { size: 38, bold: true, color: dark ? C.white : C.ink });
  if (subtitle) label(slide, subtitle, M, 145, 1110, 44, { size: 18, color: dark ? "#D2CAE8" : C.muted });
}

function footer(slide, n, dark = false) {
  const line = slide.shapes.add({ geometry: "rect", position: { left: M, top: 681, width: 1152, height: 1.5 }, fill: dark ? "#3A3155" : C.line, line: { style: "solid", fill: "none", width: 0 } });
  label(slide, "NEURAI PLATFORM", M, 690, 220, 18, { size: 10, bold: true, color: dark ? C.purple : C.purple2 });
  label(slide, String(n).padStart(2, "0"), 1132, 688, 84, 18, { size: 10, bold: true, color: dark ? "#9288A9" : C.muted, align: "right" });
  return line;
}

function note(slide, text, sources) {
  slide.speakerNotes.textFrame.setText(`${text}\n\n[Sources]\n${sources.map((s) => `- ${s}`).join("\n")}`);
  slide.speakerNotes.setVisible(true);
}

function addPill(slide, text, x, y, w, fill, color, border = "none") {
  const b = rect(slide, x, y, w, 34, fill, "rounded-full", border);
  label(slide, text, x + 10, y + 3, w - 20, 26, { size: 14, bold: true, color, align: "center", vAlign: "middle" });
  return b;
}

function addCard(slide, { x, y, w, h, number, title, body, accent = C.purple, fill = C.white, dark = false }) {
  rect(slide, x, y, w, h, fill, "rounded-2xl", dark ? "#3B3154" : C.line);
  rect(slide, x + 18, y + 18, 38, 38, accent, "rounded-full", "none");
  label(slide, number, x + 18, y + 21, 38, 30, { size: 15, bold: true, color: dark && accent === C.cyan ? C.indigo : C.white, align: "center", vAlign: "middle" });
  label(slide, title, x + 72, y + 18, w - 90, 34, { size: 19, bold: true, color: dark ? C.white : C.ink });
  label(slide, body, x + 18, y + 68, w - 36, h - 82, { size: 15.5, color: dark ? "#D8D2E6" : C.muted });
}

async function addImage(slide, file, x, y, w, h, alt, fit = "cover", radius = "rounded-2xl") {
  const geometry = radius === "rect" ? "rect" : "roundRect";
  return slide.images.add({
    blob: await blob(file),
    contentType: file.toLowerCase().endsWith(".jpg") ? "image/jpeg" : "image/png",
    alt,
    fit,
    geometry,
    ...(geometry === "roundRect" ? { borderRadius: radius } : {}),
    position: { left: x, top: y, width: w, height: h },
  });
}

function connect(slide, a, b, color = C.purple, fromSide = "right", toSide = "left", dashed = false, kind = "elbow") {
  const connector = slide.shapes.connect(a, b, {
    kind,
    fromSide,
    toSide,
    line: { style: dashed ? "dashed" : "solid", fill: color, width: 2.2 },
    tail: { type: "arrow", width: "med", length: "med" },
  });
  connector.bringToFront();
  return connector;
}

function node(slide, text, sub, x, y, w, h, fill, color = C.white, border = "none") {
  const n = rect(slide, x, y, w, h, fill, "rounded-xl", border);
  label(slide, text, x + 12, y + 10, w - 24, 28, { size: 17, bold: true, color, align: "center" });
  if (sub) label(slide, sub, x + 12, y + 40, w - 24, h - 48, { size: 12.5, color: color === C.white ? "#E4DFF1" : C.muted, align: "center" });
  return n;
}

const p = Presentation.create({ slideSize: { width: W, height: H } });

// 1 — cover
{
  const s = p.slides.add();
  s.background.fill = C.indigo;
  await addImage(s, path.join(ASSET, "ai-native-hero.png"), 0, 0, W, H, "Conversation waveforms becoming governed organizational memory", "cover", "rect");
  rect(s, 0, 0, W, H, { color: C.indigo, transparency: 36 }, "rect", "none");
  rect(s, 0, 0, 620, H, { color: C.indigo, transparency: 8 }, "rect", "none");
  await addImage(s, BRAND, 66, 56, 76, 76, "NeurAI mark", "contain", "rect");
  label(s, "NEURAI PLATFORM", 66, 152, 420, 34, { size: 15, bold: true, color: C.purple });
  label(s, "AI that is present\nbefore it is prompted", 66, 202, 590, 180, { size: 53, bold: true, color: C.white });
  label(s, "The Persian-first operating surface for\norganizational memory—beginning with Echo", 70, 410, 540, 86, { size: 23, color: "#DED7F2" });
  addPill(s, "PRESENT  ·  EVIDENCE-BACKED  ·  AUTHORITY-AWARE", 70, 540, 466, C.violetPale, C.purple2);
  label(s, "Executive product & architecture demo  ·  August 2026", 70, 621, 520, 28, { size: 13, color: "#AAA0C2" });
  note(s, "Open with the ambition: AI should be present where work happens, but it must remain evidence-backed and authority-aware. Echo is the first app, not a separate brand.", [
    "C:/Users/amirreza/Desktop/mvp/docs/PLATFORM-BRIEF.md",
    "C:/Users/amirreza/Desktop/mvp/docs/AI-NATIVE-PLAN.md",
    "C:/Users/amirreza/Desktop/mvp/ARCHITECTURE.md (M22, M33–M36)",
  ]);
}

// 2 — problem
{
  const s = p.slides.add();
  s.background.fill = C.paper;
  titleBlock(s, "The problem", "Truth is created in conversation—and disappears into fragments", "Organizations lose source, ownership, continuity, and follow-through.");
  const cards = [
    ["01", "Source", "Notes drift away from the moment and the speaker who created them.", C.coral, C.coralPale],
    ["02", "Ownership", "Generic AI sees copied context, not the caller’s real authority.", C.purple2, C.violetPale],
    ["03", "Continuity", "Each meeting restarts the story; past commitments stay buried.", C.cyan, C.cyanPale],
    ["04", "Follow-through", "Insights stop at a summary instead of entering governed action.", C.green, "#EAF7F2"],
  ];
  cards.forEach((c, i) => addCard(s, { x: M + i * 286, y: 245, w: 266, h: 270, number: c[0], title: c[1], body: c[2], accent: c[3], fill: c[4] }));
  rect(s, 64, 553, 1152, 72, C.indigo, "rounded-xl", "none");
  label(s, "Meeting notes are a feature.  Organizational memory is infrastructure.", 92, 568, 1096, 42, { size: 25, bold: true, color: C.white, align: "center", vAlign: "middle" });
  footer(s, 2);
  note(s, "Frame the problem as organizational memory loss, not meeting inconvenience. The transcript must remain the source of truth and derived artifacts must carry provenance.", [
    "C:/Users/amirreza/Desktop/mvp/docs/SPEC.md",
    "C:/Users/amirreza/Desktop/mvp/ARCHITECTURE.md (invariants 4–5)",
  ]);
}

// 3 — Echo wedge
{
  const s = p.slides.add();
  s.background.fill = C.indigo;
  titleBlock(s, "Why Echo first", "The wedge is a conversation. The asset is memory.", "One flow delivers immediate value and compounds into the platform.", true);
  const xs = [72, 304, 536, 768, 1000];
  const titles = ["CAPTURE", "TRUTH", "MEMORY", "REASON", "ACT"];
  const subs = ["Browser + Echo Mobile", "Transcript + timing", "Versions + provenance", "Cross-call agent", "Tools + consent"];
  const colors = [C.coral, C.purple, C.cyan, C.purple2, C.green];
  const nodes = titles.map((t, i) => node(s, t, subs[i], xs[i], 284, 176, 128, colors[i], i === 2 ? C.indigo : C.white));
  for (let i = 0; i < nodes.length - 1; i++) connect(s, nodes[i], nodes[i + 1], "#8775B9");
  label(s, "Immediate product value", 72, 452, 330, 30, { size: 16, bold: true, color: C.coral });
  label(s, "record · transcribe · summarize · search", 72, 486, 420, 34, { size: 18, color: "#DDD5ED" });
  label(s, "Compounding platform value", 704, 452, 360, 30, { size: 16, bold: true, color: C.cyan });
  label(s, "memory · signals · workflows · more apps", 704, 486, 460, 34, { size: 18, color: "#DDD5ED" });
  rect(s, 72, 570, 1092, 62, "#211844", "rounded-xl", "#3A2D62");
  label(s, "A horizontal assistant without a truth source is generic.  A meeting tool without a platform is bounded.", 96, 585, 1044, 34, { size: 20, bold: true, color: C.white, align: "center" });
  footer(s, 3, true);
  note(s, "Walk the audience from Capture to Act. Echo provides both the first customer outcome and the governed memory substrate future NeurAI Platform apps can reuse.", [
    "C:/Users/amirreza/Desktop/mvp/docs/PLATFORM-BRIEF.md",
    "C:/Users/amirreza/Desktop/mvp/docs/SPEC.md",
    "C:/Users/amirreza/Desktop/mvp/ARCHITECTURE.md (M1, M4, M22)",
  ]);
}

// 4 — product screens
{
  const s = p.slides.add();
  s.background.fill = C.paper;
  titleBlock(s, "The experience", "One calm product surface—from question to captured truth", "Actual current screens: Persian-first platform hub and Echo recording workspace.");
  rect(s, 54, 214, 562, 422, C.white, "rounded-2xl", C.line);
  rect(s, 664, 214, 562, 422, C.white, "rounded-2xl", C.line);
  await addImage(s, path.join(SCREEN, "hub-fa.png"), 70, 230, 530, 300, "Persian NeurAI Platform hub", "cover");
  await addImage(s, path.join(SCREEN, "new-meeting-recording.png"), 680, 230, 530, 300, "Echo recording workspace", "cover");
  addPill(s, "PLATFORM HUB", 82, 546, 150, C.violetPale, C.purple2);
  label(s, "Ask across permitted memory. Attach sources. Choose agent, model, and web mode.", 82, 582, 508, 42, { size: 15.5, color: C.muted });
  addPill(s, "ECHO CAPTURE", 692, 546, 150, C.coralPale, "#B44235");
  label(s, "Waveform, live transcript, agenda, notes, and explicit recording controls.", 692, 582, 508, 42, { size: 15.5, color: C.muted });
  footer(s, 4);
  note(s, "These are repository screenshots, not conceptual mockups. Show the hub as the shared NeurAI Platform surface and Echo capture as the first deep app experience.", [
    "C:/Users/amirreza/Desktop/mvp/docs/screenshots/hub-fa.png",
    "C:/Users/amirreza/Desktop/mvp/docs/screenshots/new-meeting-recording.png",
    "C:/Users/amirreza/Desktop/mvp/web/src/app/[locale]/page.tsx",
  ]);
}

// 5 — AI-native primitives
{
  const s = p.slides.add();
  s.background.fill = C.paper;
  titleBlock(s, "The AI-native model", "Presence + hands + signals—governed by autonomy", "The assistant becomes an operating layer, not an isolated chat box.");
  const center = node(s, "AUTONOMY", "Watch → Assist → Act\ncontrols consequence", 510, 320, 260, 142, C.indigo, C.white);
  const a = node(s, "PRESENCE", "Hub + contextual panes\nwhere work already lives", 92, 244, 280, 126, C.purple2, C.white);
  const b = node(s, "HANDS", "Memory tools + visible\nproduct actions", 92, 442, 280, 126, C.coral, C.white);
  const c = node(s, "SIGNALS", "Call events + rules +\ntimely briefs", 908, 344, 280, 126, C.cyan, C.indigo);
  connect(s, a, center, C.purple2, "right", "left");
  connect(s, b, center, C.coral, "right", "left");
  connect(s, center, c, C.cyan, "right", "left");
  addPill(s, "WATCH", 450, 512, 116, "#ECE9F1", C.muted);
  addPill(s, "ASSIST", 582, 512, 116, C.violetPale, C.purple2);
  addPill(s, "ACT", 714, 512, 116, C.coralPale, "#B44235");
  label(s, "Autonomy changes exposed effects—not the model’s authority.", 348, 584, 584, 36, { size: 22, bold: true, color: C.ink, align: "center" });
  footer(s, 5);
  note(s, "Define the platform vocabulary. Presence is where the assistant appears; hands are typed tools; signals are proactive events; autonomy controls when write effects require consent.", [
    "C:/Users/amirreza/Desktop/mvp/docs/AI-NATIVE-PLAN.md",
    "C:/Users/amirreza/Desktop/mvp/ARCHITECTURE.md (M33–M36)",
    "C:/Users/amirreza/Desktop/mvp/core/src/agent/client-tools.ts",
    "C:/Users/amirreza/Desktop/mvp/core/src/worker/signal-step.ts",
  ]);
}

// 6 — architecture
{
  const s = p.slides.add();
  s.background.fill = C.indigo;
  titleBlock(s, "The architecture", "Four parts. Three planes. Explicit authority at every seam.", "A deliberately small topology with strong boundaries—not a maze of nominal services.", true);
  rect(s, 60, 216, 1160, 120, "#15112E", "rounded-xl", "#352B51");
  rect(s, 60, 354, 1160, 126, "#171334", "rounded-xl", "#352B51");
  rect(s, 60, 498, 1160, 132, "#15112E", "rounded-xl", "#352B51");
  label(s, "EXPERIENCE", 74, 232, 112, 22, { size: 11, bold: true, color: C.cyan });
  label(s, "CONTROL", 74, 370, 112, 22, { size: 11, bold: true, color: C.purple });
  label(s, "DATA", 74, 514, 112, 22, { size: 11, bold: true, color: C.coral });
  const browser = node(s, "Browser", "Next.js UI\nIndexedDB buffer", 210, 246, 210, 70, C.purple2);
  const bff = node(s, "BFF", "secure cookies · proxy", 498, 246, 190, 70, C.purple);
  const mobile = node(s, "Echo Mobile", "Android recorder", 766, 246, 210, 70, "#4E3A72");
  const core = node(s, "Core API", "Fastify · identity · SSE", 210, 390, 210, 70, C.purple2);
  const worker = node(s, "Worker", "pgmq · lifecycle · retry", 498, 390, 190, 70, C.coral);
  const ml = node(s, "ML", "stateless speech facade", 766, 390, 210, 70, C.cyan, C.indigo);
  const ext = node(s, "Providers / Connectors", "Soniox · OpenRouter · webhooks", 1000, 390, 190, 70, "#3B3154");
  const supa = node(s, "Supabase", "Postgres · Auth · Storage · RLS · grants · pgmq", 352, 540, 530, 70, C.coral);
  connect(s, browser, bff, C.purple, "right", "left", false, "straight");
  connect(s, mobile, core, "#7768A0", "left", "right", true, "curved");
  connect(s, bff, core, C.purple, "bottom", "top", false, "straight");
  connect(s, core, worker, C.coral, "right", "left", false, "straight");
  connect(s, worker, ml, C.cyan, "right", "left", false, "straight");
  connect(s, ml, ext, "#7768A0", "right", "left", false, "straight");
  connect(s, core, supa, C.coral, "bottom", "top", false, "straight");
  connect(s, worker, supa, C.coral, "bottom", "top", false, "straight");
  label(s, "short-lived signed media URL", 712, 470, 280, 22, { size: 11.5, color: "#AAA0C2", align: "center" });
  footer(s, 6, true);
  note(s, "Explain the authority boundaries, not every route. Browser uses the BFF. Core owns identity and control. Worker handles durable jobs. ML is stateless and productless. Supabase is the final data wall.", [
    "C:/Users/amirreza/Desktop/mvp/ARCHITECTURE.md (M1–M3, M7–M9, M12, M38)",
    "C:/Users/amirreza/Desktop/mvp/core/src/db/identity.ts",
    "C:/Users/amirreza/Desktop/mvp/core/src/worker/steps.ts",
    "C:/Users/amirreza/Desktop/mvp/ml/src/pipeline.ts",
  ]);
}

// 7 — trust wall
{
  const s = p.slides.add();
  s.background.fill = C.paper;
  titleBlock(s, "Trust as architecture", "The agent borrows authority—never invents it", "JWT, identity, RLS, grants, policy, consent, and audit form one wall.");
  const steps = [
    ["1", "JWT", "Verify signature + subject", C.purple2],
    ["2", "Identity", "Active user + org + role", C.purple],
    ["3", "RLS", "Filter rows by actor", C.cyan],
    ["4", "Grants", "Hard ceiling; agent no DELETE", C.coral],
    ["5", "Policy", "Tool list + roles + budgets", C.green],
    ["6", "Consent & audit", "Propose, confirm, record", C.indigo],
  ];
  const boxes = [];
  steps.forEach((x, i) => {
    const y = 216 + i * 69;
    const b = rect(s, 150 + i * 22, y, 880 - i * 44, 54, i === 5 ? C.indigo : C.white, "rounded-xl", i === 5 ? "none" : C.line);
    boxes.push(b);
    rect(s, 168 + i * 22, y + 10, 34, 34, x[3], "rounded-full", "none");
    label(s, x[0], 168 + i * 22, y + 14, 34, 26, { size: 14, bold: true, color: x[3] === C.cyan ? C.indigo : C.white, align: "center" });
    label(s, x[1], 222 + i * 22, y + 9, 218, 32, { size: 19, bold: true, color: i === 5 ? C.white : C.ink });
    label(s, x[2], 500 + i * 4, y + 12, 470 - i * 34, 28, { size: 15.5, color: i === 5 ? "#D6CEE8" : C.muted, align: "right" });
  });
  rect(s, 1010, 236, 170, 342, C.coralPale, "rounded-2xl", "#FFD0C8");
  label(s, "THE RESULT", 1032, 260, 126, 24, { size: 12, bold: true, color: "#B44235", align: "center" });
  label(s, "A model can be wrong\nwithout becoming\nomnipotent.", 1030, 316, 130, 150, { size: 25, bold: true, color: C.ink, align: "center", vAlign: "middle" });
  label(s, "Prompts guide.\nThe wall enforces.", 1030, 500, 130, 62, { size: 15, bold: true, color: C.muted, align: "center" });
  footer(s, 7);
  note(s, "Describe the wall bottom-up. No database handle exists without an identity. RLS and database grants are the hard enforcement. Agent tools are centrally vetoed and consequential content writes are proposed first.", [
    "C:/Users/amirreza/Desktop/mvp/ARCHITECTURE.md (M3, M4, M10, M11)",
    "C:/Users/amirreza/Desktop/mvp/core/src/db/identity.ts",
    "C:/Users/amirreza/Desktop/mvp/core/src/agent/runtime.ts",
    "C:/Users/amirreza/Desktop/mvp/core/src/agent/policy.ts",
  ]);
}

// 8 — Persian speech
{
  const s = p.slides.add();
  s.background.fill = C.indigo;
  titleBlock(s, "Persian-first speech", "Accuracy is a pipeline. Trust survives when fidelity changes.", "RTL, names, mixed language, speakers, timing, and voice identity are one product system.", true);
  await addImage(s, path.join(SCREEN, "speakers-enrollment.png"), 728, 216, 478, 374, "Echo speaker directory and voice enrollment", "cover");
  rect(s, 70, 216, 610, 122, "#181335", "rounded-2xl", "#382D58");
  const names = ["PROBE", "VAD", "STT", "DIARIZE", "VOICE"];
  const cols = [C.coral, C.green, C.purple, C.cyan, C.amber];
  names.forEach((n, i) => addPill(s, n, 92 + i * 113, 250, 96, cols[i], n === "DIARIZE" ? C.indigo : C.white));
  label(s, "ffmpeg → local speech detection → Soniox / fallback → speaker structure → conservative directory match", 92, 302, 566, 24, { size: 12.5, color: "#CFC7E1", align: "center" });
  label(s, "THE TIMING LADDER", 70, 384, 300, 26, { size: 13, bold: true, color: C.cyan });
  const w1 = node(s, "WORD", "click a word", 70, 424, 168, 86, C.purple2);
  const w2 = node(s, "LINE", "click a segment", 282, 424, 168, 86, C.purple);
  const w3 = node(s, "ANCHORED SPAN", "honest coarse seek", 494, 424, 186, 86, C.coral);
  connect(s, w1, w2, "#7F72A8"); connect(s, w2, w3, "#7F72A8");
  rect(s, 70, 548, 610, 68, "#211844", "rounded-xl", "#392C60");
  label(s, "No timestamps never becomes ‘nothing’. It becomes a real speech span—with provenance.", 88, 564, 574, 38, { size: 17, bold: true, color: C.white, align: "center" });
  footer(s, 8, true);
  note(s, "Use the timing ladder as the technical proof of honest degradation. Persian-first also includes RTL, normalization, glossary bias, mixed-language hints, voice enrollment, and Jalali-capable display.", [
    "C:/Users/amirreza/Desktop/mvp/ARCHITECTURE.md (M6, M19, M20, M37–M40)",
    "C:/Users/amirreza/Desktop/mvp/ml/src/pipeline.ts",
    "C:/Users/amirreza/Desktop/mvp/core/src/worker/transcript-mapping.ts",
    "C:/Users/amirreza/Desktop/mvp/core/src/worker/voice-match.ts",
    "C:/Users/amirreza/Desktop/mvp/docs/screenshots/speakers-enrollment.png",
  ]);
}

// 9 — competitors
{
  const s = p.slides.add();
  s.background.fill = C.paper;
  titleBlock(s, "Competitive position", "The category is proven. Our opening is still distinct.", "Three excellent reference competitors—compared on strategy, not feature-count theatre.");
  const x0 = 58, y0 = 218;
  const cols = [190, 292, 292, 390];
  const heads = ["PLATFORM", "BEST-KNOWN STRENGTH", "CLOSEST OVERLAP", "NEURAI STRATEGIC CONTRAST"];
  let x = x0;
  heads.forEach((h, i) => {
    rect(s, x, y0, cols[i], 50, i === 3 ? C.purple2 : C.indigo, i === 0 ? "rounded-l-xl" : i === 3 ? "rounded-r-xl" : "rect", "none");
    label(s, h, x + 10, y0 + 8, cols[i] - 20, 34, { size: 12, bold: true, color: C.white, align: i === 0 ? "left" : "center", vAlign: "middle" });
    x += cols[i];
  });
  const rows = [
    ["GONG", "Revenue AI, deal signals, coaching, forecasting", "Capture + cross-conversation intelligence + action", "General AI-native platform; caller-bound authority; Persian-first wedge"],
    ["OTTER.AI", "General meeting capture, summaries, AI chat", "Meeting knowledge + live transcription + assistant Q&A", "Official May 2026 language list omits Persian; NeurAI is Persian-first end to end"],
    ["FIREFLIES.AI", "Meeting automation, AskFred, skills, integrations", "Cross-meeting Q&A + custom insight + workflows", "Identity/RLS/grants flow into product actions; visible Watch → Assist → Act"],
  ];
  rows.forEach((row, ri) => {
    let xx = x0;
    row.forEach((cell, ci) => {
      const fill = ri % 2 === 0 ? C.white : "#F4F1F8";
      rect(s, xx, y0 + 50 + ri * 110, cols[ci], 104, fill, "rect", C.line);
      label(s, cell, xx + 14, y0 + 64 + ri * 110, cols[ci] - 28, 78, { size: ci === 0 ? 16 : 14, bold: ci === 0 || ci === 3, color: ci === 3 ? C.purple2 : C.ink, align: ci === 0 ? "left" : "center", vAlign: "middle" });
      xx += cols[ci];
    });
  });
  rect(s, 58, 614, 1164, 46, C.cyanPale, "rounded-xl", "#BEEFFF");
  label(s, "Win the underserved Persian-first trust surface—then compound Echo’s memory into more apps.", 80, 622, 1120, 28, { size: 18, bold: true, color: C.ink, align: "center" });
  footer(s, 9);
  note(s, "Acknowledge competitor strengths. The comparison is public positioning, not an independent accuracy or security benchmark. The differentiators are Persian-first depth, authority-aware action, and the broader platform thesis.", [
    "https://www.gong.io/conversation-intelligence",
    "https://otter.ai/",
    "https://help.otter.ai/hc/en-us/articles/26660468516631-Transcribe-conversations-in-English-Spanish-French-German-Japanese-or-Chinese-Simplified",
    "https://fireflies.ai/",
    "https://docs.fireflies.ai/askfred/overview",
    "C:/Users/amirreza/Desktop/mvp/docs/PLATFORM-BRIEF.md",
  ]);
}

// 10 — expansion and close
{
  const s = p.slides.add();
  s.background.fill = C.indigo;
  titleBlock(s, "The expansion thesis", "Echo is the beginning—not the boundary", "One governed memory substrate can power an entire AI-native platform.", true);
  const a = node(s, "ECHO", "conversation truth", 84, 268, 208, 98, C.coral);
  const b = node(s, "SHARED AGENT", "cross-memory reasoning", 350, 268, 230, 98, C.purple2);
  const c = node(s, "SIGNALS", "timely follow-through", 638, 268, 208, 98, C.cyan, C.indigo);
  const d = node(s, "MORE APPS", "projects · knowledge · service", 904, 268, 278, 98, C.green);
  connect(s, a, b, "#75689C"); connect(s, b, c, "#75689C"); connect(s, c, d, "#75689C");
  rect(s, 84, 430, 1098, 74, "#201743", "rounded-xl", "#3C2E64");
  label(s, "New apps add a source of truth or a governed action surface—never a second identity, memory, or unbounded agent.", 110, 446, 1046, 42, { size: 19, bold: true, color: C.white, align: "center" });
  label(s, "Capture what happened.  Explain what it means.\nAct only with authority.  Learn across time.", 144, 544, 992, 78, { size: 31, bold: true, color: C.white, align: "center" });
  addPill(s, "PERSIAN-FIRST BY CONSTRUCTION", 448, 630, 384, C.violetPale, C.purple2);
  footer(s, 10, true);
  note(s, "Close on disciplined ambition. Echo proves the substrate. Future apps reuse identity, memory, tools, connectors, and audit instead of forking them.", [
    "C:/Users/amirreza/Desktop/mvp/docs/PLATFORM-BRIEF.md",
    "C:/Users/amirreza/Desktop/mvp/docs/AI-NATIVE-PLAN.md",
    "C:/Users/amirreza/Desktop/mvp/ARCHITECTURE.md (M22, M30–M36)",
  ]);
}

await fs.mkdir(RENDER, { recursive: true });
for (const [i, s] of p.slides.items.entries()) {
  const stem = `slide-${String(i + 1).padStart(2, "0")}`;
  await writeBlob(path.join(RENDER, `${stem}.png`), await p.export({ slide: s, format: "png", scale: 1 }));
  const layout = await s.export({ format: "layout" });
  await fs.writeFile(path.join(RENDER, `${stem}.layout.json`), await layout.text());
}
await writeBlob(path.join(RENDER, "deck-montage.webp"), await p.export({ format: "webp", montage: true, scale: 1 }));
const pptx = await PresentationFile.exportPptx(p);
await pptx.save(path.join(OUT, "NeurAI-Platform-Executive-Demo-10-Slides.pptx"));

console.log(path.join(OUT, "NeurAI-Platform-Executive-Demo-10-Slides.pptx"));
