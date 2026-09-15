#!/usr/bin/env node
// Seed TWO prior recorded meetings — with real, playable audio — on top of the
// "پیشرو داده" demo organisation, so the live demo has history to ask about.
//
//   node scripts/seed-demo-records.mjs                      # seed (idempotent)
//   node scripts/seed-demo-records.mjs --reset              # remove only what this seeded
//   node scripts/seed-demo-records.mjs --audio-dir <dir>  # where the wavs are built
//   node scripts/seed-demo-records.mjs --ffmpeg-dir "C:\...\ffmpeg\bin"
//   node scripts/seed-demo-records.mjs --skip-upload        # db only (audio stays local)
//
// What it guarantees (idempotent — every row is keyed by a fixed UUID under
// the de00002x prefix; running twice is the same end state):
//   • two directory people with no account: "NAI" and "Pasargad — Ms. Moradi"
//   • MEETING 1 "Weekly meeting with NAI" — Mon 2026-09-01 09:00 Asia/Tehran,
//     in person, in the "1 on 1" folder: the Aseman contract is close to
//     signing, the custom-reports rollout gets the internal codename
//     "Simorgh", Ali Najafi owns the Simorgh acceptance checklist, Sara
//     reviews Hamid's support macros, the Pasargad Bank demo is next week.
//   • MEETING 2 "Pasargad Bank — pricing call" — Thu 2026-09-04 14:00 Tehran:
//     a quote for 40 users plus the custom-reports module, to be sent by
//     Tuesday the ninth with the support SLA wording, demo environment first.
//     Plus one OPEN task on the board: "Send Pasargad Bank the price quote".
//   • for each: echo.call (owner Sara, scope org, ready, en) → call_part rows
//     with the audio in Storage → call_speaker rows linked to the directory →
//     transcript_segment rows whose timings come from the MEASURED clips →
//     one English summary with "Decisions:" / "Action items:" and an
//     "— owner: Name" marker on every action (the platform's own extractor
//     parses that shape) → echo.meeting_item rows → echo.meeting linked.
//   • "Simorgh", "Aseman", "Pasargad" appended to echo.org.glossary so the
//     transcriber is biased to spell the codename the same way live.
//
// THE AUDIO IS REAL. Each transcript line is synthesised with Windows SAPI
// (System.Speech: "Microsoft Zira Desktop" for Sara, "Microsoft David Desktop"
// for the other voice) through lib/sapi-say.ps1, measured with ffprobe,
// spliced with 700 ms gaps into parts of at most six minutes (16 kHz mono
// 16-bit PCM wav), and uploaded to the `call-audio` bucket at
// <org>/<call>/part-N.wav. start_ms/end_ms (and the per-word timings, spread
// evenly inside each line) are derived from where each clip actually landed,
// so click-to-seek lands on the right sentence. Clips are cached beside a
// sidecar of their text; a changed line re-synthesises only itself.
//
// --reset removes: the task + assignee, the meeting items, the meetings, the
// summaries, the segments, the speakers, the parts, the calls, the two people
// (only if nothing else references them), the three glossary terms, and the
// storage objects. It never touches the org, the members, the board, or the
// pre-existing seeded records (de00000x…).
//
//
// SUPERSEDED FOR NEW ORGANISATIONS, KEPT FOR THIS ONE (M52, 2026-09-09).
// The platform console's Demo tab now seeds a whole demo organisation on any
// date, in English or Persian, through the product's own repositories — see
// core/src/api/demo-seed/ and ARCHITECTURE.md M52. This script still targets
// the hand-seeded org de000000-0000-4000-8000-000000000001 and still works;
// it is the LOCAL path (owner altitude, fixed UUIDs) and the console is the
// product one. If you are seeding a demo for somebody to present, use the
// console: it mints real sign-in accounts, which this script cannot.
// THIS IS A SCRIPT AND MUST NEVER BECOME A MIGRATION (see seed-dev.mjs).
// Reads DATABASE_URL (the owner connection), SUPABASE_URL and
// SUPABASE_SERVICE_KEY from the environment, or from ../.env.dev when that
// file exists. Never prints a secret.

import { readFileSync, existsSync, writeFileSync, mkdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import pg from 'pg'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const flag = (name, dflt) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt
}
const RESET = args.includes('--reset')
const SKIP_UPLOAD = args.includes('--skip-upload')
const AUDIO_DIR = resolve(flag('--audio-dir', process.env.DEMO_AUDIO_DIR ?? join(tmpdir(), 'neurai-demo-audio')))
const FFMPEG_DIR = flag('--ffmpeg-dir', process.env.FFMPEG_DIR ?? '')
const ffbin = (name) => (FFMPEG_DIR ? join(FFMPEG_DIR, process.platform === 'win32' ? `${name}.exe` : name) : name)

const ORG = 'de000000-0000-4000-8000-000000000001' // پیشرو داده
const SARA_USER = 'de000001-0000-4000-8000-000000000001'
const SARA_PERSON = 'de000002-0000-4000-8000-000000000001'
const ALI_USER = 'de000001-0000-4000-8000-000000000004'
const TOPIC_1ON1 = 'de000010-0000-4000-8000-0000000000a1' // same folder seed-demo.mjs uses
const BUCKET = 'call-audio'
const GLOSSARY_TERMS = ['Simorgh', 'Aseman', 'Pasargad']
const SAMPLE_RATE = 16000
const GAP_MS = 700
const LEAD_MS = 600
const TAIL_MS = 400
const PART_MAX_MS = 6 * 60 * 1000

// ── fixed ids (prefix de00002x; suffix = meeting(4) + ordinal(8)) ──────────
const uid = (kind, meeting, n) =>
  `de0000${kind}-0000-4000-8000-${String(meeting).padStart(4, '0')}${String(n).padStart(8, '0')}`
const PERSON_NAI = uid('21', 0, 1)
const PERSON_MORADI = uid('21', 0, 2)
const CALL = (m) => uid('22', m, 1)
const PART = (m, idx) => uid('23', m, idx)
const SPEAKER = (m, k) => uid('24', m, k)
const SEGMENT = (m, seq) => uid('25', m, seq)
const SUMMARY = (m) => uid('26', m, 1)
const MEETING = (m) => uid('27', m, 1)
const ITEM = (m, i) => uid('28', m, i)
const TASK_QUOTE = uid('29', 2, 1)

const VOICE_SARA = 'Microsoft Zira Desktop'
const VOICE_OTHER = 'Microsoft David Desktop'

// ── the two meetings ───────────────────────────────────────────────────────
// speakers[0] is always Sara; speakers[1] the other voice. Lines carry the
// speaker index. Items point at the LINE they came from, so at_ms is derived
// from the measured timeline rather than typed.
const MEETINGS = [
  {
    m: 1,
    title: 'Weekly meeting with NAI',
    description: 'Weekly 1:1 with NAI — Aseman contract, the Simorgh codename, support macros, next week\u2019s Pasargad demo.',
    startedAt: '2026-09-01T05:30:00.000Z', // Monday 09:00 Asia/Tehran
    location: 'Meeting room A',
    topicId: TOPIC_1ON1,
    invitees: ['NAI'],
    speakers: [
      { label: 'S1·1', personId: SARA_PERSON, voice: VOICE_SARA },
      { label: 'S2·1', personId: PERSON_NAI, voice: VOICE_OTHER },
    ],
    lines: [
      [0, 'Good morning, NAI. Let\u2019s do our weekly one-on-one. I want to cover Aseman, the support macros, and next week\u2019s demo.'],
      [1, 'Good morning, Sara. Sounds good. Let\u2019s start with Aseman, since that one has a deadline attached.'],
      [0, 'The Aseman contract is close to signing. Their legal team has the draft, and the last commercial point was closed on Thursday.'],
      [1, 'That is good news. What is left before their signature?'],
      [0, 'Mostly the custom-reports module. They want to see how the rollout will be staged before they sign.'],
      [1, 'We keep calling it the Aseman custom-reports module rollout, which is a mouthful. Can we give it a short name?'],
      [0, 'Yes. Let\u2019s just call the whole custom-reports rollout Simorgh internally. Simorgh is the codename for everything under that module for Aseman.'],
      [1, 'Simorgh. Noted. So the Simorgh rollout covers the report builder, the scheduled exports, and the staging environment?'],
      [0, 'Exactly. Three pieces, one codename. Anything Aseman-specific under custom reports is Simorgh from now on.'],
      [1, 'Then here is my concern. The Simorgh acceptance checklist does not exist yet, and Aseman\u2019s legal review will ask what delivered means.'],
      [0, 'You are right. If the checklist is written after their legal review, we will be negotiating acceptance criteria twice.'],
      [1, 'So the Simorgh acceptance checklist has to be written before Aseman\u2019s legal review starts. Who should own it?'],
      [0, 'Ali Najafi. He built most of the report builder, and he already knows what the staging data looks like.'],
      [1, 'Agreed. Ali Najafi owns the Simorgh acceptance checklist, and it is due before Aseman\u2019s legal review.'],
      [0, 'I will tell Ali today. He should keep it short: one page, measurable items, nothing that needs interpretation.'],
      [1, 'Good. Second topic. Hamid finished the new support macros last week. Have you looked at them?'],
      [0, 'Not yet. I will review Hamid\u2019s support macros this week and send him comments before Friday.'],
      [1, 'Please check the tone as well as the content. Two of them read a bit abrupt in the draft I saw.'],
      [0, 'Understood. I will review the macros for tone too. That one is mine.'],
      [1, 'Third topic. Pasargad Bank. Their demo is next week, right?'],
      [0, 'Yes, the Pasargad Bank demo is next week. They want to see the reporting platform, and they asked about the custom-reports module as well.'],
      [1, 'So Simorgh is relevant to Pasargad too, even if the codename stays internal.'],
      [0, 'Right. Externally it is still the custom-reports module. Internally, the Simorgh checklist will help us with Pasargad as well.'],
      [1, 'Do you need anything from me for the demo?'],
      [0, 'Mina is preparing the demo environment. If you could check the sample data with her on Wednesday, that would help.'],
      [1, 'I will do that. To recap: Simorgh is the internal codename for the Aseman custom-reports rollout, and Ali Najafi owns the Simorgh acceptance checklist before Aseman\u2019s legal review.'],
      [0, 'And I review Hamid\u2019s support macros this week, and the Pasargad Bank demo is next week.'],
      [1, 'Perfect. Same time next Monday. Thanks, Sara.'],
      [0, 'Thanks, NAI. Talk next week.'],
    ],
    summary: [
      'Weekly 1:1 — Sara Ahmadi and NAI',
      '',
      'The Aseman contract is close to signing: Aseman\u2019s legal team has the draft and the last commercial point was closed on Thursday. What remains is the custom-reports module, which Aseman wants to see staged before they sign. The two agreed to call the whole Aseman custom-reports rollout "Simorgh" internally; Simorgh covers the report builder, the scheduled exports and the staging environment, and stays an internal name.',
      '',
      'NAI raised that the Simorgh acceptance checklist does not exist yet and that Aseman\u2019s legal review will ask what "delivered" means. Writing it afterwards would mean negotiating acceptance criteria twice, so the checklist must be written before Aseman\u2019s legal review. Ali Najafi owns it: one page, measurable items, nothing that needs interpretation.',
      '',
      'Hamid finished the new support macros last week; Sara will review them this week for content and tone and send comments before Friday. The Pasargad Bank demo is next week — Mina is preparing the demo environment and NAI will check the sample data with her on Wednesday. Pasargad also asked about the custom-reports module, so the Simorgh checklist will help there too.',
      '',
      'Decisions:',
      '- The Aseman custom-reports module rollout is codenamed "Simorgh" internally (report builder, scheduled exports, staging environment).',
      '- The Simorgh acceptance checklist is written BEFORE Aseman\u2019s legal review, and Ali Najafi owns it.',
      '- Externally the module keeps its name; Simorgh stays internal.',
      '',
      'Action items:',
      '- Write the Simorgh acceptance checklist before Aseman\u2019s legal review — owner: Ali Najafi',
      '- Review the new support macros for content and tone and send comments before Friday — owner: Sara Ahmadi',
      '- Check the Pasargad demo sample data with Mina on Wednesday — owner: NAI',
    ].join('\n'),
    items: [
      { kind: 'decision', body: 'The Aseman custom-reports module rollout is codenamed "Simorgh" internally.', line: 6 },
      { kind: 'decision', body: 'The Simorgh acceptance checklist is written before Aseman\u2019s legal review; Ali Najafi owns it.', line: 13 },
      { kind: 'decision', body: 'Externally the module keeps its name; Simorgh stays internal.', line: 22 },
      { kind: 'action', body: 'Write the Simorgh acceptance checklist before Aseman\u2019s legal review', owner: 'Ali Najafi', line: 13 },
      { kind: 'action', body: 'Review the new support macros for content and tone and send comments before Friday', owner: 'Sara Ahmadi', line: 16 },
      { kind: 'action', body: 'Check the Pasargad demo sample data with Mina on Wednesday', owner: 'NAI', line: 25 },
    ],
  },
  {
    m: 2,
    title: 'Pasargad Bank — pricing call',
    description: 'Pricing call with Pasargad Bank — quote for 40 users plus the custom-reports module.',
    startedAt: '2026-09-04T10:30:00.000Z', // Thursday 14:00 Asia/Tehran
    location: 'Meeting room A',
    topicId: null,
    invitees: ['Pasargad — Ms. Moradi'],
    speakers: [
      { label: 'S1·1', personId: SARA_PERSON, voice: VOICE_SARA },
      { label: 'S2·1', personId: PERSON_MORADI, voice: VOICE_OTHER },
    ],
    lines: [
      [1, 'Hello Ms. Ahmadi, this is Moradi from Pasargad Bank. Thank you for taking the call.'],
      [0, 'Hello Ms. Moradi, good to hear from you. How can I help today?'],
      [1, 'We would like a price quote for the reporting platform. We have forty users to start with, and we also want the custom-reports module.'],
      [0, 'Forty users plus the custom-reports module. Let me confirm the tiers so we are looking at the same thing.'],
      [1, 'Please do.'],
      [0, 'The platform is priced in three tiers: up to twenty users, up to fifty users, and above fifty. Forty users falls in the second tier.'],
      [1, 'And the custom-reports module is priced separately?'],
      [0, 'Yes. The custom-reports module is a flat annual add-on on top of the tier, and it includes the report builder and the scheduled exports.'],
      [1, 'Understood. When can we have the quote in writing?'],
      [0, 'I will send the price quote by Tuesday. That is Tuesday the ninth, so you have it before your internal meeting on Wednesday.'],
      [1, 'Tuesday the ninth works. One request: please include the support SLA wording in the quote itself, not as a separate document.'],
      [0, 'Of course. I will include the support SLA wording in the quote, with the response times for each severity.'],
      [1, 'Our procurement team reads only the quote, so that will save us a round.'],
      [0, 'Noted. Also, our demo environment for Pasargad will be ready before the quote goes out, so your team can try it alongside the numbers.'],
      [1, 'That would be helpful. Can we agree that the demo environment is ready before the quote is sent?'],
      [0, 'Yes, let\u2019s agree on that. Demo environment first, then the quote by Tuesday the ninth.'],
      [1, 'One more thing. Does the second tier include onboarding for all forty users?'],
      [0, 'It includes two onboarding sessions. Additional sessions are listed as an option in the quote, so you can decide later.'],
      [1, 'Good. Then I will wait for the quote on Tuesday. Thank you, Ms. Ahmadi.'],
      [0, 'Thank you, Ms. Moradi. You will have it by Tuesday. Goodbye.'],
    ],
    summary: [
      'Pricing call — Pasargad Bank (Ms. Moradi) and Sara Ahmadi',
      '',
      'Ms. Moradi asked for a price quote for the reporting platform for forty users plus the custom-reports module. Sara confirmed the tiers: up to twenty users, up to fifty, and above fifty — forty users falls in the second tier — and the custom-reports module is a flat annual add-on that includes the report builder and the scheduled exports. The second tier includes two onboarding sessions; additional sessions go into the quote as an option.',
      '',
      'Sara will send the price quote by Tuesday 9 September, before Pasargad\u2019s internal meeting on Wednesday. Ms. Moradi asked for the support SLA wording to be included in the quote itself, with the response times per severity, because their procurement team reads only the quote. Both agreed that the Pasargad demo environment will be ready before the quote goes out.',
      '',
      'Decisions:',
      '- Pasargad Bank is quoted on the second tier (up to fifty users) plus the custom-reports add-on.',
      '- The support SLA wording goes inside the quote, not as a separate document.',
      '- The demo environment is ready before the quote is sent.',
      '',
      'Action items:',
      '- Send Pasargad Bank the price quote for 40 users plus the custom-reports module by Tuesday 9 September — owner: Sara Ahmadi',
      '- Include the support SLA wording in the quote — owner: Sara Ahmadi',
      '- Have the Pasargad demo environment ready before the quote goes out — owner: Sara Ahmadi',
    ].join('\n'),
    items: [
      { kind: 'decision', body: 'Pasargad Bank is quoted on the second tier (up to fifty users) plus the custom-reports add-on.', line: 5 },
      { kind: 'decision', body: 'The support SLA wording goes inside the quote, not as a separate document.', line: 11 },
      { kind: 'decision', body: 'The demo environment is ready before the quote is sent.', line: 15 },
      { kind: 'action', body: 'Send Pasargad Bank the price quote for 40 users plus the custom-reports module by Tuesday 9 September', owner: 'Sara Ahmadi', line: 9 },
      { kind: 'action', body: 'Include the support SLA wording in the quote', owner: 'Sara Ahmadi', line: 11 },
      { kind: 'action', body: 'Have the Pasargad demo environment ready before the quote goes out', owner: 'Sara Ahmadi', line: 13 },
    ],
    task: {
      id: TASK_QUOTE,
      title: 'Send Pasargad Bank the price quote',
      description: 'Quote for 40 users plus the custom-reports module. Include the support SLA wording (response times per severity). Demo environment goes live first.',
      priority: 'medium',
      dueAt: '2026-09-09T13:00:00.000Z',
      assignee: SARA_USER,
    },
  },
]

// ── env ────────────────────────────────────────────────────────────────────
function loadEnv() {
  const file = resolve(here, '..', '..', '.env.dev')
  if (!existsSync(file)) return
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq < 1) continue
    const k = t.slice(0, eq).trim()
    const v = t.slice(eq + 1).trim()
    if (v !== '' && process.env[k] === undefined) process.env[k] = v
  }
}
loadEnv()

const raw = process.env.DATABASE_URL
if (!raw) {
  console.error('no connection: set DATABASE_URL (owner) or provide ../.env.dev')
  process.exit(2)
}
const host = raw.slice(raw.lastIndexOf('@') + 1)
const local = /^(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(host)
const SUPABASE_URL = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '')
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? ''
const canUpload = !SKIP_UPLOAD && SUPABASE_URL !== '' && SERVICE_KEY !== ''
if (!RESET && !canUpload) {
  console.warn(SKIP_UPLOAD
    ? '  ⚠ --skip-upload: the audio will NOT be in Storage; playback will 404 until it is'
    : '  ⚠ SUPABASE_URL / SUPABASE_SERVICE_KEY missing: audio will NOT be uploaded (rows still point at Storage paths)')
}

// ── storage helpers (REST, service role; the bucket has no policies by design — M10) ──
const storageHeaders = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
async function storageList(prefix) {
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${BUCKET}`, {
    method: 'POST',
    headers: { ...storageHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ prefix, limit: 100, offset: 0 }),
  })
  if (!r.ok) throw new Error(`storage list ${prefix}: HTTP ${r.status}`)
  const rows = await r.json()
  return Array.isArray(rows) ? rows.map((o) => ({ name: o.name, size: o.metadata?.size ?? null })) : []
}
async function storageUpload(path, bytes) {
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'PUT',
    headers: { ...storageHeaders, 'content-type': 'audio/wav', 'x-upsert': 'true' },
    body: bytes,
  })
  if (!r.ok) throw new Error(`storage upload ${path}: HTTP ${r.status}`)
}
async function storageDelete(paths) {
  if (paths.length === 0) return 0
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}`, {
    method: 'DELETE',
    headers: { ...storageHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ prefixes: paths }),
  })
  if (!r.ok) throw new Error(`storage delete: HTTP ${r.status}`)
  const rows = await r.json()
  return Array.isArray(rows) ? rows.length : 0
}

// ── wav helpers ────────────────────────────────────────────────────────────
function readPcm16k(file) {
  const b = readFileSync(file)
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`not a wav: ${file}`)
  let p = 12
  let fmt = null
  let data = null
  while (p + 8 <= b.length) {
    const id = b.toString('ascii', p, p + 4)
    const size = b.readUInt32LE(p + 4)
    const body = p + 8
    if (id === 'fmt ') fmt = { format: b.readUInt16LE(body), channels: b.readUInt16LE(body + 2), rate: b.readUInt32LE(body + 4), bits: b.readUInt16LE(body + 14) }
    if (id === 'data') data = b.subarray(body, Math.min(body + size, b.length))
    p = body + size + (size % 2)
  }
  if (!fmt || !data) throw new Error(`wav without fmt/data: ${file}`)
  if (fmt.format !== 1 || fmt.channels !== 1 || fmt.rate !== SAMPLE_RATE || fmt.bits !== 16) {
    throw new Error(`wav is not 16 kHz mono 16-bit PCM: ${file} (${JSON.stringify(fmt)})`)
  }
  return data
}
function wavFromPcm(pcm) {
  const h = Buffer.alloc(44)
  h.write('RIFF', 0, 'ascii'); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8, 'ascii')
  h.write('fmt ', 12, 'ascii'); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22)
  h.writeUInt32LE(SAMPLE_RATE, 24); h.writeUInt32LE(SAMPLE_RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34)
  h.write('data', 36, 'ascii'); h.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([h, pcm])
}
const msToBytes = (ms) => Math.round((ms / 1000) * SAMPLE_RATE) * 2
const bytesToMs = (bytes) => Math.round(((bytes / 2) / SAMPLE_RATE) * 1000)
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

function ffprobeMs(file) {
  const r = spawnSync(ffbin('ffprobe'), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`ffprobe failed on ${file}: ${(r.stderr || r.error?.message || '').trim()}`)
  const sec = Number(String(r.stdout).trim())
  if (!Number.isFinite(sec)) throw new Error(`ffprobe gave no duration for ${file}`)
  return Math.round(sec * 1000)
}
function ffmpegNormalize(input, output) {
  const r = spawnSync(ffbin('ffmpeg'), ['-y', '-v', 'error', '-i', input, '-ac', '1', '-ar', String(SAMPLE_RATE), '-sample_fmt', 's16', '-f', 'wav', output], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`ffmpeg failed on ${input}: ${(r.stderr || r.error?.message || '').trim()}`)
}

// ── audio build: synthesise (cached) → normalise → measure → splice ────────
function buildAudio(meeting) {
  const dir = join(AUDIO_DIR, `meeting-${meeting.m}`)
  mkdirSync(dir, { recursive: true })

  // 1. synthesise only the lines whose text changed (sidecar = the text)
  const manifest = []
  meeting.lines.forEach(([sp, text], i) => {
    const raw = join(dir, `line-${String(i).padStart(2, '0')}.raw.wav`)
    const side = raw + '.txt'
    const voice = meeting.speakers[sp].voice
    const stamp = `${voice}\n${text}`
    const cached = existsSync(raw) && existsSync(side) && readFileSync(side, 'utf8') === stamp
    if (!cached) manifest.push({ voice, text, out: raw, rate: 0, _side: side, _stamp: stamp })
  })
  if (manifest.length > 0) {
    const manifestPath = join(dir, 'manifest.json')
    writeFileSync(manifestPath, JSON.stringify(manifest.map(({ _side, _stamp, ...m }) => m)), 'utf8')
    const ps1 = join(here, 'lib', 'sapi-say.ps1')
    const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1, '-Manifest', manifestPath], { encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`SAPI synthesis failed: ${(r.stderr || r.stdout || r.error?.message || '').trim()}`)
    for (const m of manifest) writeFileSync(m._side, m._stamp, 'utf8')
    console.log(`  meeting ${meeting.m}: synthesised ${manifest.length} line(s) with SAPI`)
  } else {
    console.log(`  meeting ${meeting.m}: all ${meeting.lines.length} clips cached`)
  }

  // 2. normalise + measure every clip (two instruments: ffprobe's duration
  //    and the PCM byte count must agree, or the splice would drift)
  const clips = meeting.lines.map(([sp, text], i) => {
    const raw = join(dir, `line-${String(i).padStart(2, '0')}.raw.wav`)
    const norm = join(dir, `line-${String(i).padStart(2, '0')}.wav`)
    if (!existsSync(norm) || statSync(norm).mtimeMs < statSync(raw).mtimeMs) ffmpegNormalize(raw, norm)
    const pcm = readPcm16k(norm)
    const probed = ffprobeMs(norm)
    const counted = bytesToMs(pcm.length)
    if (Math.abs(probed - counted) > 5) throw new Error(`clip ${i}: ffprobe says ${probed} ms, the PCM says ${counted} ms`)
    return { i, sp, text, pcm, ms: probed }
  })

  // 3. splice: LEAD, then clip + GAP …, into parts of ≤ PART_MAX_MS
  const parts = []
  const segments = []
  let part = null
  let cursor = 0 // absolute ms
  const openPart = () => {
    part = { idx: parts.length, offset_ms: cursor, buffers: [Buffer.alloc(msToBytes(LEAD_MS))], within: LEAD_MS }
    cursor += LEAD_MS
    parts.push(part)
  }
  const closePart = () => {
    part.buffers.push(Buffer.alloc(msToBytes(TAIL_MS)))
    part.within += TAIL_MS
    cursor = part.offset_ms + part.within
    part.pcm = Buffer.concat(part.buffers)
    part.duration_ms = bytesToMs(part.pcm.length)
    delete part.buffers
  }
  openPart()
  for (const c of clips) {
    if (part.within + c.ms + GAP_MS + TAIL_MS > PART_MAX_MS) { closePart(); openPart() }
    const start_ms = part.offset_ms + part.within
    const end_ms = start_ms + c.ms
    segments.push({ seq: c.i, sp: c.sp, text: c.text, start_ms, end_ms, partIdx: part.idx })
    part.buffers.push(c.pcm, Buffer.alloc(msToBytes(GAP_MS)))
    part.within += c.ms + GAP_MS
  }
  closePart()

  for (const p of parts) {
    p.file = join(dir, `part-${p.idx}.wav`)
    const wav = wavFromPcm(p.pcm)
    writeFileSync(p.file, wav)
    p.byte_size = wav.length
    p.sha256 = sha256(wav)
    p.bytes = wav
    const probed = ffprobeMs(p.file)
    if (Math.abs(probed - p.duration_ms) > 5) throw new Error(`part ${p.idx}: ffprobe says ${probed} ms, the splice says ${p.duration_ms} ms`)
    delete p.pcm
  }
  const total_ms = parts.reduce((a, p) => Math.max(a, p.offset_ms + p.duration_ms), 0)
  writeFileSync(join(dir, 'timings.json'), JSON.stringify({ total_ms, parts: parts.map(({ bytes, ...p }) => p), segments }, null, 1), 'utf8')
  return { parts, segments, total_ms }
}

// evenly spread word timings inside a measured line — the middle rung of M20
function wordsFor(text, start_ms, end_ms) {
  const words = text.split(/\s+/).filter(Boolean)
  const span = end_ms - start_ms
  return words.map((w, i) => ({
    w,
    s: start_ms + Math.round((span * i) / words.length),
    e: start_ms + Math.round((span * (i + 1)) / words.length),
  }))
}

// ── db ─────────────────────────────────────────────────────────────────────
const db = new pg.Client({ connectionString: raw, ...(local ? {} : { ssl: { rejectUnauthorized: false } }) })
await db.connect()
console.log(`seed-demo-records: ${RESET ? 'RESET' : 'SEED'} against ${host.replace(/:\d+\/.*/, '')}`)
console.log(`  audio dir: ${AUDIO_DIR}`)

try {
  const org = await db.query('select id from echo.org where id = $1', [ORG])
  if (org.rowCount === 0) throw new Error(`demo org ${ORG} is missing — seed it first`)
  const sara = await db.query('select id from echo.app_user where id = $1 and org_id = $2', [SARA_USER, ORG])
  if (sara.rowCount === 0) throw new Error('Sara Ahmadi (host) is not a member of the demo org')

  // ── reset ────────────────────────────────────────────────────────────────
  if (RESET) {
    await db.query('begin')
    const callIds = MEETINGS.map((x) => CALL(x.m))
    const meetingIds = MEETINGS.map((x) => MEETING(x.m))
    await db.query('delete from echo.task_assignee where task_id = $1', [TASK_QUOTE])
    const t = await db.query('delete from echo.task where id = $1', [TASK_QUOTE])
    const items = await db.query('delete from echo.meeting_item where meeting_id = any($1)', [meetingIds])
    const mt = await db.query('delete from echo.meeting where id = any($1)', [meetingIds]) // attendees cascade
    await db.query('update echo.call set current_summary_id = null where id = any($1)', [callIds])
    const su = await db.query('delete from echo.summary where call_id = any($1)', [callIds])
    const sg = await db.query('delete from echo.transcript_segment where call_id = any($1)', [callIds])
    const sp = await db.query('delete from echo.call_speaker where call_id = any($1)', [callIds])
    const pt = await db.query('delete from echo.call_part where call_id = any($1)', [callIds])
    const cl = await db.query('delete from echo.call where id = any($1)', [callIds])
    let people = 0
    for (const pid of [PERSON_NAI, PERSON_MORADI]) {
      const used = await db.query('select count(*)::int as n from echo.call_speaker where person_id = $1', [pid])
      if (used.rows[0].n === 0) people += (await db.query('delete from echo.person where id = $1', [pid])).rowCount
      else console.warn(`  ⚠ person ${pid} still referenced by ${used.rows[0].n} speaker(s) — kept`)
    }
    await db.query(
      `update echo.org set glossary = array(select g from unnest(glossary) g where g <> all($2::text[])) where id = $1`,
      [ORG, GLOSSARY_TERMS],
    )
    await db.query('commit')
    console.log(`  removed: ${t.rowCount} task, ${items.rowCount} item(s), ${mt.rowCount} meeting(s), ${su.rowCount} summary(ies), ${sg.rowCount} segment(s), ${sp.rowCount} speaker(s), ${pt.rowCount} part(s), ${cl.rowCount} call(s), ${people} person(s); glossary terms dropped`)
    if (SUPABASE_URL && SERVICE_KEY) {
      let n = 0
      for (const id of callIds) {
        const objs = await storageList(`${ORG}/${id}`)
        n += await storageDelete(objs.map((o) => `${ORG}/${id}/${o.name}`))
      }
      console.log(`  removed ${n} storage object(s)`)
    } else {
      console.warn('  ⚠ no SUPABASE_URL/SERVICE_KEY — storage objects NOT removed')
    }
    console.log('done')
  } else {
    // ── audio first (outside the transaction: it is slow and touches no row) ──
    const built = new Map()
    for (const meeting of MEETINGS) built.set(meeting.m, buildAudio(meeting))

    // the summary's author: the org's own agent (as the summarizer writes), else the host
    const agent = await db.query(
      `select id from echo.app_user where org_id = $1 and email like 'roya.%@agents.neurai.invalid' limit 1`, [ORG])
    const AUTHOR = agent.rows[0]?.id ?? SARA_USER
    const ITEM_SOURCE = agent.rows[0] ? 'ai' : 'user' // 0160: source is a fact about the writer

    await db.query('begin')
    // The speaker-link trigger (0093/0098) asks echo.owns_call(), and the
    // meeting's recording trigger (0202) asks for the host — both read
    // echo.actor_id(). At owner altitude nobody is acting, so we act as the
    // host for this transaction: the links are stamped linked_by = Sara,
    // exactly as if she had made them on the review tab.
    await db.query(`select set_config('echo.actor_id', $1, true)`, [SARA_USER])

    // people with no account
    for (const [id, name] of [[PERSON_NAI, 'NAI'], [PERSON_MORADI, 'Pasargad — Ms. Moradi']]) {
      await db.query(
        `insert into echo.person (id, org_id, display_name, app_user_id, created_by)
         values ($1, $2, $3, null, $4)
         on conflict (id) do update set display_name = excluded.display_name, merged_into = null, merged_at = null, merged_by = null`,
        [id, ORG, name, SARA_USER],
      )
    }
    // the "1 on 1" folder (same id seed-demo.mjs uses; harmless if it already exists)
    await db.query(
      `insert into echo.meeting_topic (id, org_id, name, created_by) values ($1, $2, '1 on 1', $3)
       on conflict (id) do update set archived_at = null`,
      [TOPIC_1ON1, ORG, SARA_USER],
    )

    for (const meeting of MEETINGS) {
      const { parts, segments, total_ms } = built.get(meeting.m)
      const callId = CALL(meeting.m)
      const meetingId = MEETING(meeting.m)

      await db.query(
        `insert into echo.call (id, org_id, owner_id, title, scope, status, source, language, started_at, duration_ms, created_at)
         values ($1, $2, $3, $4, 'org', 'ready', 'web', 'en', $5, $6, $5)
         on conflict (id) do update set
           title = excluded.title, scope = 'org', status = 'ready', language = 'en',
           started_at = excluded.started_at, duration_ms = excluded.duration_ms,
           archived_at = null, failure_reason = null, updated_at = now()`,
        [callId, ORG, SARA_USER, meeting.title, meeting.startedAt, total_ms],
      )

      // parts — one row per spliced wav
      await db.query('delete from echo.call_part where call_id = $1 and idx >= $2', [callId, parts.length])
      for (const p of parts) {
        const path = `${ORG}/${callId}/part-${p.idx}.wav`
        await db.query(
          `insert into echo.call_part (id, call_id, org_id, idx, offset_ms, duration_ms, storage_bucket, storage_path,
                                       audio_format, byte_size, audio_sha256, status, has_word_timestamps, created_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, 'wav', $9, $10, 'diarized', true, $11)
           on conflict (id) do update set
             offset_ms = excluded.offset_ms, duration_ms = excluded.duration_ms, storage_path = excluded.storage_path,
             byte_size = excluded.byte_size, audio_sha256 = excluded.audio_sha256, status = 'diarized',
             missing = false, failure_reason = null, has_word_timestamps = true, updated_at = now()`,
          [PART(meeting.m, p.idx), callId, ORG, p.idx, p.offset_ms, p.duration_ms, BUCKET, path, p.byte_size, p.sha256, meeting.startedAt],
        )
        p.path = path
      }

      // speakers — linked to the directory (person_id/linked_by/linked_at all set: the CHECK wants 0 or 3)
      await db.query('delete from echo.transcript_segment where call_id = $1', [callId])
      await db.query('delete from echo.call_speaker where call_id = $1', [callId])
      for (let k = 0; k < meeting.speakers.length; k++) {
        const s = meeting.speakers[k]
        const first = segments.find((x) => x.sp === k)
        await db.query(
          `insert into echo.call_speaker (id, call_id, org_id, label, person_id, linked_by, linked_at, sample_start_ms, sample_end_ms, created_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $7)`,
          [SPEAKER(meeting.m, k + 1), callId, ORG, s.label, s.personId, SARA_USER, meeting.startedAt, first?.start_ms ?? null, first?.end_ms ?? null],
        )
      }

      // segments — timings from the measured clips; words spread inside each line
      for (const seg of segments) {
        await db.query(
          `insert into echo.transcript_segment
             (id, call_id, org_id, part_id, seq, start_ms, end_ms, call_speaker_id, text, confidence, words, provenance, language, created_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0.96, $10::jsonb, $11::jsonb, 'en', $12)`,
          [SEGMENT(meeting.m, seg.seq), callId, ORG, PART(meeting.m, seg.partIdx), seg.seq, seg.start_ms, seg.end_ms,
           SPEAKER(meeting.m, seg.sp + 1), seg.text, JSON.stringify(wordsFor(seg.text, seg.start_ms, seg.end_ms)),
           JSON.stringify({ lane: 'soniox', seeded: true }), meeting.startedAt],
        )
      }

      // summary — immutable; replace only when the body differs (delete-and-reinsert at owner altitude)
      const existing = await db.query('select body, model from echo.summary where id = $1', [SUMMARY(meeting.m)])
      const same = existing.rowCount === 1 && existing.rows[0].body === meeting.summary
      if (!same) {
        await db.query('update echo.call set current_summary_id = null where id = $1', [callId])
        await db.query('delete from echo.summary where call_id = $1', [callId])
        await db.query(
          `insert into echo.summary (id, call_id, org_id, body, model, created_by, grounding, created_at)
           values ($1, $2, $3, $4, 'google/gemini-3.1-pro-preview', $5, '{"clean":true}'::jsonb, $6)`,
          [SUMMARY(meeting.m), callId, ORG, meeting.summary, AUTHOR, meeting.startedAt],
        )
      }
      await db.query('update echo.call set current_summary_id = $2 where id = $1 and current_summary_id is distinct from $2', [callId, SUMMARY(meeting.m)])

      // the meeting, linked to its record
      await db.query(
        `insert into echo.meeting (id, org_id, title, scheduled_at, duration_minutes, mode, topic_id, location, description, invitees, call_id, created_by, created_at)
         values ($1, $2, $3, $4, $5, 'in_person', $6, $7, $8, $9, $10, $11, $4)
         on conflict (id) do update set
           title = excluded.title, scheduled_at = excluded.scheduled_at, duration_minutes = excluded.duration_minutes,
           mode = 'in_person', topic_id = excluded.topic_id, location = excluded.location, description = excluded.description,
           invitees = excluded.invitees, call_id = excluded.call_id, archived_at = null, updated_at = now()`,
        [meetingId, ORG, meeting.title, meeting.startedAt, Math.ceil(total_ms / 60000), meeting.topicId, meeting.location, meeting.description, meeting.invitees, callId, SARA_USER],
      )
      await db.query(
        `insert into echo.meeting_attendee (meeting_id, user_id, org_id, added_by, attended_at) values ($1, $2, $3, $2, $4)
         on conflict (meeting_id, user_id) do update set attended_at = excluded.attended_at`,
        [meetingId, SARA_USER, ORG, meeting.startedAt],
      )

      // items — decisions + actions with owners, pointing at the line they came from
      await db.query('delete from echo.meeting_item where meeting_id = $1', [meetingId])
      let pos = 0
      for (const it of meeting.items) {
        pos++
        const at = segments.find((x) => x.seq === it.line)?.start_ms ?? null
        await db.query(
          `insert into echo.meeting_item (id, meeting_id, org_id, kind, body, source, owner, at_ms, position, created_by, created_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [ITEM(meeting.m, pos), meetingId, ORG, it.kind, it.body, ITEM_SOURCE, it.owner ?? null, at, pos, AUTHOR, meeting.startedAt],
        )
      }

      // the open task on the board (meeting 2)
      if (meeting.task) {
        const col = await db.query(
          'select id from echo.task_column where org_id = $1 and archived_at is null order by position, created_at limit 1', [ORG])
        if (col.rowCount === 0) throw new Error('the org board has no column — seed the board first')
        const t = meeting.task
        await db.query(
          `insert into echo.task (id, org_id, column_id, call_id, title, description, priority, due_at, position, created_by, created_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8,
                   coalesce((select max(position) + 1 from echo.task where column_id = $3), 1), $9, $10)
           on conflict (id) do update set
             title = excluded.title, description = excluded.description, priority = excluded.priority,
             due_at = excluded.due_at, call_id = excluded.call_id, done_at = null, archived_at = null, updated_at = now()`,
          [t.id, ORG, col.rows[0].id, callId, t.title, t.description, t.priority, t.dueAt, SARA_USER, meeting.startedAt],
        )
        await db.query(
          `insert into echo.task_assignee (task_id, user_id, org_id) values ($1, $2, $3) on conflict do nothing`,
          [t.id, t.assignee, ORG],
        )
      }
    }

    // glossary — append what is missing, never duplicate, keep the bounds (≤200 terms, ≤60 chars)
    const g = await db.query('select glossary from echo.org where id = $1', [ORG])
    const have = g.rows[0].glossary ?? []
    const add = GLOSSARY_TERMS.filter((t) => t.length <= 60 && !have.includes(t))
    if (have.length + add.length > 200) throw new Error('glossary would exceed 200 terms')
    if (add.length) await db.query('update echo.org set glossary = glossary || $2::text[] where id = $1', [ORG, add])

    await db.query('commit')

    // ── upload (after commit: the rows already say where the audio lives) ──
    if (canUpload) {
      let up = 0
      let kept = 0
      for (const meeting of MEETINGS) {
        const { parts } = built.get(meeting.m)
        const have = await storageList(`${ORG}/${CALL(meeting.m)}`)
        for (const p of parts) {
          const there = have.find((o) => o.name === `part-${p.idx}.wav`)
          if (there && there.size === p.byte_size) { kept++; continue }
          await storageUpload(p.path, p.bytes)
          up++
        }
      }
      console.log(`  storage: uploaded ${up} part(s), ${kept} already present with the right size`)
    }

    // ── verify by re-querying ────────────────────────────────────────────
    console.log('  verification:')
    for (const meeting of MEETINGS) {
      const callId = CALL(meeting.m)
      const v = await db.query(
        `select c.status, c.duration_ms, c.current_summary_id,
                (select count(*)::int from echo.transcript_segment s where s.call_id = c.id) as segments,
                (select count(*)::int from echo.call_speaker s where s.call_id = c.id and s.person_id is not null) as linked_speakers,
                (select count(*)::int from echo.call_part p where p.call_id = c.id) as parts,
                (select id from echo.meeting m where m.call_id = c.id) as meeting_id,
                (select count(*)::int from echo.meeting_item i join echo.meeting m on m.id = i.meeting_id where m.call_id = c.id) as items
           from echo.call c where c.id = $1`, [callId])
      const r = v.rows[0]
      const objs = (SUPABASE_URL && SERVICE_KEY) ? await storageList(`${ORG}/${callId}`) : []
      const dur = `${Math.floor(r.duration_ms / 60000)}m${String(Math.round((r.duration_ms % 60000) / 1000)).padStart(2, '0')}s`
      console.log(`    call ${callId} "${meeting.title}": ${r.status}, ${dur}, ${r.parts} part(s), ${r.segments} segments, ${r.linked_speakers} linked speakers, summary ${r.current_summary_id ? 'set' : 'MISSING'}, meeting ${r.meeting_id ?? 'NOT LINKED'}, ${r.items} items`)
      console.log(`      storage: ${objs.length ? objs.map((o) => `${o.name}=${o.size}B`).join(', ') : '(not checked / none)'}`)
      if (meeting.task) {
        const t = await db.query(`select t.id, t.title, t.due_at, t.done_at, c.name as col, (select count(*)::int from echo.task_assignee a where a.task_id = t.id) as assignees
                                    from echo.task t join echo.task_column c on c.id = t.column_id where t.id = $1`, [meeting.task.id])
        const x = t.rows[0]
        console.log(`      task ${x?.id}: "${x?.title}" in "${x?.col}", due ${x?.due_at?.toISOString?.() ?? x?.due_at}, ${x?.done_at ? 'DONE' : 'open'}, ${x?.assignees} assignee(s)`)
      }
    }
    const gl = await db.query('select glossary from echo.org where id = $1', [ORG])
    console.log(`    glossary: [${gl.rows[0].glossary.join(', ')}] — Simorgh ${gl.rows[0].glossary.includes('Simorgh') ? 'present' : 'MISSING'}`)
    console.log('done')
  }
} catch (e) {
  await db.query('rollback').catch(() => {})
  console.error('seed-demo-records failed:', e.message)
  process.exitCode = 1
} finally {
  await db.end()
}
