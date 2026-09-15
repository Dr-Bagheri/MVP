#!/usr/bin/env node
// Fill in the seeded demo meetings that have a recording but nothing inside
// it — transcript, speakers, summary, decisions, action items, questions and
// risks — so every meeting in the demo org can be opened and read.
//
//   node scripts/seed-demo-transcripts.mjs
//   node scripts/seed-demo-transcripts.mjs --reset      # remove only these
//   node scripts/seed-demo-transcripts.mjs --force      # overwrite existing
//
// Scope: the seven de000008 calls that had zero segments. It never touches
// "Contract review — Aseman Co." (already written, bilingual) or the two
// de000022 calls with real audio from seed-demo-records.mjs — those are the
// ones the live demo leans on and they stay exactly as they are.
//
// Every conversation is written to its own meeting's subject and to the people
// actually on that meeting's attendee list, and the threads continue across
// meetings the way the org's real work would: the month-end export fix is
// agreed on the first sync, tested at the standup, and shipped by the second
// sync; the Pasargad demo is scoped in discovery and rehearsed the morning of;
// the Simorgh checklist is Ali's throughout. Searching "Simorgh" or "Pasargad"
// therefore returns a trail, which is what the cross-call summarisation beat
// in the demo needs.
//
// THERE IS NO AUDIO. These calls never had any (only the Aseman call has
// `call_part` rows), so the segments carry `part_id = null` and playback is
// not offered — the transcript reads and searches, and clicking a line has
// nothing to seek in. `provenance` is marked `{"seeded": true}` so a seeded
// line is never mistaken for something the transcriber produced.
//
// Idempotent — every row is keyed by a fixed UUID under the de00002a…de00002d
// prefixes; running twice is the same end state.
//
// THIS IS A SCRIPT AND MUST NEVER BECOME A MIGRATION (see seed-dev.mjs).
// Reads DATABASE_URL (the owner connection) from the environment, or from
// ../.env.dev when that file exists. Never prints a secret.

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import pg from 'pg'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const RESET = args.includes('--reset')
const FORCE = args.includes('--force')

const ORG = 'de000000-0000-4000-8000-000000000001' // پیشرو داده
const SARA_USER = 'de000001-0000-4000-8000-000000000001' // owns every seeded call
const MODEL = 'google/gemini-3.1-pro-preview'

// directory people (echo.person)
const P = {
  sara: 'de000002-0000-4000-8000-000000000001',
  reza: 'de000002-0000-4000-8000-000000000002',
  mina: 'de000002-0000-4000-8000-000000000003',
  ali: 'de000002-0000-4000-8000-000000000004',
  hamid: 'de000002-0000-4000-8000-000000000005',
  moradi: 'de000021-0000-4000-8000-000000000002', // Pasargad — Ms. Moradi
}
const NAME = {
  sara: 'Sara Ahmadi',
  reza: 'Reza Karimi',
  mina: 'Mina Rostami',
  ali: 'Ali Najafi',
  hamid: 'Hamid Sadeghi',
  moradi: 'Ms. Moradi',
}

// fixed ids: <kind><meeting ordinal, 4><row ordinal, 8>
const uid = (kind, meeting, n) =>
  `de0000${kind}-0000-4000-8000-${String(meeting).padStart(4, '0')}${String(n).padStart(8, '0')}`

// ── the meetings ───────────────────────────────────────────────────────────
// `cast` is speaker order; `lines` are [who, text]; `items` point at a line by
// index, which is where their `at_ms` comes from — so "jump to this decision"
// lands on the sentence that made it.
const MEETINGS = [
  {
    n: 1,
    call: 'de000008-0000-4000-8000-000000000003',
    meeting: 'de000007-0000-4000-8000-000000000003',
    heading: 'Weekly product sync — 1 September',
    cast: ['reza', 'mina', 'ali'],
    lines: [
      ['reza', "Let's start with the board. Ali, where is the custom-reports work?"],
      ['ali', 'The report builder is behind the flag on staging. Scheduled exports are half done — the weekly cadence works, the monthly one still misses the last day of the month.'],
      ['reza', 'Is that a blocker for Aseman?'],
      ['ali', "Only if they test month-end. I'd rather fix it this week than explain it."],
      ['mina', 'Aseman will test month-end. The whole reason they want the module is the monthly board pack.'],
      ['reza', 'Then it is this week. Ali, take the month-end fix.'],
      ['ali', 'Taking it.'],
      ['mina', 'Second thing — Pasargad. The demo is on the eighth and I need a demo environment with sample data that is not our own customers.'],
      ['reza', 'Use the anonymised set from the discovery call. Mina, can you have the environment up by Friday?'],
      ['mina', 'Friday works if nobody moves the staging database under me.'],
      ['ali', 'I will not touch it after Wednesday.'],
      ['reza', 'Third — mobile capture. The design critique is on Thursday, so I am not opening it here. Ali, you and I take it there.'],
      ['ali', 'Agreed.'],
      ['mina', "One risk from me: if Aseman's legal review slips past the fifteenth, the phase-one dates in the contract stop being real."],
      ['reza', 'Noted. Sara is chasing legal — I will flag it to her today.'],
      ['reza', 'Last thing, the support macros. Hamid finished them and Sara reviews them this week. Nothing for us.'],
      ['mina', 'Then we are done.'],
      ['reza', 'Done. Same time next week.'],
    ],
    narrative: [
      'The three open workstreams were reviewed: the Aseman custom-reports module, the Pasargad demo environment, and mobile capture.',
      'On custom reports, the report builder is behind a flag on staging and the scheduled exports are half finished — the weekly cadence works, the monthly one misses the last day of the month. Mina pushed back that Aseman will certainly test month-end, because the monthly board pack is the reason they want the module at all, so the fix was pulled into this week rather than explained away later.',
      'On Pasargad, the demo on the eighth needs an environment with sample data that is neither live customer data nor another customer’s. The anonymised set from the discovery call is used instead, with the environment standing up by Friday — conditional on the staging database not moving underneath it, which Ali agreed to leave alone after Wednesday.',
      'Mobile capture was deliberately not discussed; it belongs to Thursday’s design critique. The one risk raised was the Aseman legal review: if it slips past the fifteenth, the phase-one dates in the contract are no longer real.',
    ],
    items: [
      { kind: 'decision', at: 5, body: 'The month-end scheduled export is fixed this week, before Aseman tests month-end.' },
      { kind: 'decision', at: 8, body: 'The Pasargad demo runs on the anonymised discovery data set, not on customer data.' },
      { kind: 'decision', at: 11, body: "Mobile capture is left to Thursday's design critique." },
      { kind: 'action', at: 5, owner: 'ali', body: 'Fix the month-end scheduled export' },
      { kind: 'action', at: 8, owner: 'mina', body: 'Stand up the Pasargad demo environment by Friday' },
      { kind: 'action', at: 14, owner: 'reza', body: 'Flag the Aseman legal-review date risk to Sara' },
      { kind: 'question', at: 2, body: 'Does Aseman test month-end during acceptance?' },
      { kind: 'risk', at: 13, body: "Aseman's legal review slipping past the fifteenth makes the phase-one contract dates unreal." },
    ],
  },
  {
    n: 2,
    call: 'de000008-0000-4000-8000-000000000005',
    meeting: 'de000007-0000-4000-8000-000000000005',
    heading: 'Sales pipeline review — 2 September',
    cast: ['mina', 'sara'],
    lines: [
      ['mina', 'Four things in the pipeline worth talking about: Aseman, Pasargad Bank, the municipality tender, and the Rahvar renewal.'],
      ['sara', 'Start with the two that close this quarter.'],
      ['mina', 'Aseman is in legal. Commercially it is done — twelve percent for year one, delivery in two phases. The only thing that can move it now is their legal review.'],
      ['sara', 'And Pasargad?'],
      ['mina', 'Discovery is on Thursday. Forty users, and they asked about the custom-reports module specifically. Demo on the eighth, then pricing.'],
      ['sara', 'Put the quote after the demo, not before. They will anchor on the number and never look at the product.'],
      ['mina', 'Agreed. Demo first, quote the week after.'],
      ['mina', 'The municipality tender closes on the twentieth. It is a public tender, so it is mostly a paper exercise — but I need two reference customers who will let us name them.'],
      ['sara', "Aseman will not before signature. Use Rahvar, and ask Hamid for the support numbers."],
      ['mina', 'Rahvar is the fourth one. They are renewing and they want a discount on the renewal.'],
      ['sara', 'How much are they asking for?'],
      ['mina', 'Fifteen percent. They are hinting that they will shop around.'],
      ['sara', 'Renewals do not get new-logo discounts. Offer them the custom-reports module at the tier price instead — it costs us nothing and it is worth more to them than fifteen percent.'],
      ['mina', 'I will put that to them this week.'],
      ['sara', 'Anything at risk of slipping out of the quarter?'],
      ['mina', 'The municipality one. If the tender is delayed it lands next quarter, and there is nothing we can do about that.'],
      ['sara', 'Then plan the quarter without it.'],
    ],
    narrative: [
      'Four opportunities were reviewed: Aseman, Pasargad Bank, the municipality tender and the Rahvar renewal.',
      'Aseman is commercially closed — twelve percent for year one, delivery in two phases — and waiting only on the customer’s legal review. Pasargad is earlier: discovery on Thursday, a demo on the eighth, forty users, with explicit interest in the custom-reports module. Sara ruled that the quote follows the demo rather than preceding it, so the conversation is about the product before it is about the number.',
      'The municipality tender closes on the twentieth and needs two nameable reference customers; Aseman cannot be named before signature, so Rahvar plus support figures from Hamid will carry it. Rahvar itself is asking fifteen percent off its renewal and hinting at shopping around. The answer is the custom-reports module at tier price rather than a renewal discount — worth more to the customer and costing nothing to give.',
      'The tender is the one deal that may slip out of the quarter, and the quarter is planned as if it will.',
    ],
    items: [
      { kind: 'decision', at: 5, body: 'Pasargad gets the demo before the quote, not the other way round.' },
      { kind: 'decision', at: 12, body: 'The Rahvar renewal is answered with the custom-reports module at tier price, not a fifteen percent discount.' },
      { kind: 'decision', at: 16, body: 'The quarter is planned without the municipality tender.' },
      { kind: 'action', at: 13, owner: 'mina', body: 'Put the module-instead-of-discount offer to Rahvar this week' },
      { kind: 'action', at: 8, owner: 'mina', body: 'Ask Hamid for the support numbers for the tender references' },
      { kind: 'question', at: 7, body: 'Which two customers can we name as references before Aseman signs?' },
      { kind: 'risk', at: 15, body: 'A delayed municipality tender lands in next quarter, outside our control.' },
    ],
  },
  {
    n: 3,
    call: 'de000008-0000-4000-8000-000000000006',
    meeting: 'de000007-0000-4000-8000-000000000006',
    heading: 'Design critique — mobile capture — 4 September',
    cast: ['reza', 'ali'],
    lines: [
      ['reza', 'This is the mobile capture flow. Three screens: start, recording, and what you land on when you stop.'],
      ['ali', 'Start screen first. Why is the topic picker above the record button?'],
      ['reza', 'Because people forget to set it and then the recording lands nowhere.'],
      ['ali', 'They forget it because it is a chore. Make it optional at the start and ask once after they stop, when they already know what the meeting was.'],
      ['reza', 'That is better. It also makes the start screen one button.'],
      ['ali', 'Recording screen. What happens when the phone locks?'],
      ['reza', 'Right now the recording pauses. That is the thing I most want to change.'],
      ['ali', 'It has to keep recording. A meeting recorder that stops when the screen sleeps is not a recorder.'],
      ['reza', 'Then we need the persistent notification, and the live indicator has to be visible from the lock screen.'],
      ['ali', 'And when they come back, show elapsed time first, not the waveform. The waveform is decoration; the number is the reassurance.'],
      ['reza', 'Third screen — stop. Today it drops you on a spinner while the upload runs.'],
      ['ali', 'Show the transcript as it lands, partial. A spinner tells you nothing; three lines of your own meeting tell you it worked.'],
      ['reza', 'That is more work, but it is the right answer.'],
      ['ali', 'One risk: on a bad network the partial transcript will look stuck, and stuck is worse than a spinner.'],
      ['reza', "Then it needs an explicit 'waiting for network' state, not silence."],
      ['ali', 'Agreed. Write those three up and I will take the lock-screen work.'],
    ],
    narrative: [
      'The three screens of the mobile capture flow were critiqued: start, recording, and the screen you land on after stopping.',
      'On the start screen, the topic picker was moved out of the way: it is asked once after the recording stops, when the person already knows what the meeting was, rather than as a chore before they can press record. That reduces the start screen to a single button.',
      'The recording screen’s pause-on-lock behaviour was rejected outright — a recorder that stops when the screen sleeps is not a recorder. Keeping the capture alive requires a persistent notification, with the live indicator readable from the lock screen; on return, elapsed time is shown before the waveform, because the number is what reassures.',
      'The stop screen replaces its spinner with the partial transcript as it lands. The risk noted against that: on a poor network a partial transcript reads as stuck, which is worse than a spinner, so it needs an explicit waiting-for-network state rather than silence.',
    ],
    items: [
      { kind: 'decision', at: 3, body: 'The topic is asked after the recording stops, not before it starts.' },
      { kind: 'decision', at: 7, body: 'Recording continues while the phone is locked; a persistent notification carries the live indicator.' },
      { kind: 'decision', at: 11, body: 'The stop screen shows the partial transcript instead of a spinner.' },
      { kind: 'action', at: 15, owner: 'reza', body: 'Write up the three screen changes' },
      { kind: 'action', at: 15, owner: 'ali', body: 'Take the lock-screen recording work' },
      { kind: 'question', at: 14, body: 'What does the stop screen show when the network is unavailable?' },
      { kind: 'risk', at: 13, body: 'On a poor network the partial transcript can read as stuck, which is worse than a spinner.' },
    ],
  },
  {
    n: 4,
    call: 'de000008-0000-4000-8000-000000000007',
    meeting: 'de000007-0000-4000-8000-000000000007',
    heading: 'Pasargad discovery call — 4 September',
    cast: ['mina', 'moradi'],
    lines: [
      ['mina', 'Thank you for making time again after this morning. I want to understand what your team actually needs to see in the demo.'],
      ['moradi', 'Three things. Our monthly board pack, the branch-level reports, and whatever the auditors ask for.'],
      ['mina', 'Who builds the board pack today?'],
      ['moradi', 'Two people in finance, in Excel, for four days every month.'],
      ['mina', 'So the number that matters to you is four days, not the licence.'],
      ['moradi', 'Yes. If the module turns four days into one, the price is not the question.'],
      ['mina', 'Branch-level — how many branches, and does every branch manager get access?'],
      ['moradi', 'Forty-two branches. Managers see their own branch only; head office sees everything.'],
      ['mina', 'That is the second user tier and row-level permissions. Both exist today.'],
      ['moradi', 'The auditors are the part I cannot compromise on. They ask for the same report, six months later, unchanged.'],
      ['mina', 'Then the demo should show a scheduled export with a fixed template and its history, not just a live report.'],
      ['moradi', 'That would answer it.'],
      ['mina', 'One thing I need from you: sample data. I will not demo on your live data, and I would rather not demo on someone else’s.'],
      ['moradi', 'I can give you an anonymised month of branch figures by Sunday.'],
      ['mina', 'Then the demo on the eighth shows the board pack, branch permissions and the audit export, on your own anonymised numbers.'],
      ['moradi', 'Agreed. And send the quote after the demo — I want my colleagues to see the product first.'],
    ],
    narrative: [
      'A requirements session with Ms. Moradi following the morning’s pricing conversation, to scope what the demo on the eighth must actually show.',
      'Three needs came out of it. The monthly board pack is built today by two people in finance, in Excel, over four days every month — which makes four days, not the licence fee, the number that decides this. Branch-level reporting covers forty-two branches with managers restricted to their own branch and head office seeing everything, which maps onto the second user tier plus row-level permissions. The auditors are the non-negotiable: the same report, six months later, unchanged.',
      'That third requirement changes the demo — it has to show a scheduled export with a fixed template and its history, not only a live report. The demo will run on an anonymised month of Pasargad’s own branch figures, supplied by Sunday, rather than on live or third-party data. The quote follows the demo, at the customer’s own request.',
    ],
    items: [
      { kind: 'decision', at: 14, body: 'The demo covers the monthly board pack, branch-level permissions and the audit export.' },
      { kind: 'decision', at: 12, body: "The demo runs on Pasargad's anonymised branch data, not on live or third-party data." },
      { kind: 'decision', at: 15, body: 'The price quote follows the demo.' },
      { kind: 'action', at: 13, owner: 'moradi', body: 'Send an anonymised month of branch figures by Sunday' },
      { kind: 'action', at: 14, owner: 'mina', body: 'Build the demo around the board pack, branch permissions and the audit export' },
      { kind: 'question', at: 9, body: 'Do the auditors need the export template frozen, or only the output archived?' },
      { kind: 'risk', at: 7, body: 'Forty-two branches with row-level permissions is more setup than a standard demo environment.' },
    ],
  },
  {
    n: 5,
    call: 'de000008-0000-4000-8000-000000000008',
    meeting: 'de000007-0000-4000-8000-000000000008',
    heading: 'Engineering standup — 7 September',
    cast: ['reza', 'ali'],
    lines: [
      ['reza', 'Short one. Ali, month-end export.'],
      ['ali', 'Fixed and on staging since Thursday. The last day of the month is right now, including Esfand.'],
      ['reza', 'Tested against a leap year?'],
      ['ali', 'Not yet. I will add the case today.'],
      ['reza', 'The report builder behind the flag — are we turning it on for Aseman staging this week?'],
      ['ali', "Once the acceptance checklist exists. I do not want to turn it on and then find out what 'done' means."],
      ['reza', 'The checklist is yours.'],
      ['ali', 'It is. I am writing it after this.'],
      ['reza', 'Anything blocking you?'],
      ['ali', 'The staging database. Mina is building the Pasargad demo on it and I would rather not migrate underneath her.'],
      ['reza', 'Then do not. Migrations wait until after the demo on the eighth.'],
      ['ali', 'That is my only blocker.'],
      ['reza', 'Mine is the mobile lock-screen work — it needs a real device and the test phone has no SIM.'],
      ['ali', 'Take mine for the week.'],
    ],
    narrative: [
      'A short standup between Reza and Ali covering the month-end export, the report-builder flag, and what is blocking each of them.',
      'The month-end scheduled export agreed at last week’s sync is fixed and on staging, and now resolves the last day of the month correctly, Esfand included; the leap-year case is still missing from the tests and is being added today. The report-builder flag stays off for Aseman staging until the Simorgh acceptance checklist exists, on the grounds that turning it on first means discovering afterwards what "done" was supposed to mean. Ali owns that checklist and starts it straight after the standup.',
      'The one shared constraint is the staging database: Mina is building the Pasargad demo environment on it, so migrations wait until after the demo on the eighth. Reza’s own blocker — the mobile lock-screen work needing a device with a SIM — was solved in the room by borrowing Ali’s phone.',
    ],
    items: [
      { kind: 'decision', at: 10, body: 'No staging migrations until after the Pasargad demo on the eighth.' },
      { kind: 'decision', at: 5, body: 'The report-builder flag stays off for Aseman staging until the acceptance checklist exists.' },
      { kind: 'action', at: 3, owner: 'ali', body: 'Add the leap-year case to the month-end export test' },
      { kind: 'action', at: 7, owner: 'ali', body: 'Write the Simorgh acceptance checklist' },
      { kind: 'question', at: 2, body: 'Does the month-end export hold up on a leap year?' },
      { kind: 'risk', at: 12, body: 'The mobile lock-screen work needs a device with a SIM; the test phone has none.' },
    ],
  },
  {
    n: 6,
    call: 'de000008-0000-4000-8000-000000000009',
    meeting: 'de000007-0000-4000-8000-000000000009',
    heading: 'Hiring panel — backend — 7 September',
    // the candidate is not in the directory, so that speaker stays unlinked —
    // which is also what a real panel recording looks like before review.
    cast: ['reza', 'ali', null],
    lines: [
      ['reza', 'Thanks for coming in, Farshad. An hour: half on something you have built, half on a problem of ours.'],
      [null, 'That works.'],
      ['reza', 'Tell us about a system you owned end to end.'],
      [null, 'A payments reconciliation service. Two million rows a night, matched against three bank feeds. I owned it for two years, on-call included.'],
      ['ali', 'What broke most often?'],
      [null, 'The feeds. One bank changed its file format twice without telling us. After the second time I stopped trusting the format, validated every field on ingest, and rejected the file rather than the row.'],
      ['ali', 'Why the file rather than the row?'],
      [null, 'Because a half-loaded night is worse than a missing one. A missing night you notice.'],
      ['reza', 'Our problem, then. We store meeting transcripts and people want to search them in Persian and English in the same query. How would you approach it?'],
      [null, 'Fold the text before indexing — normalise the Arabic and Persian letter forms and the zero-width joiners — and keep the original for display. Then one index, not two.'],
      ['ali', 'That is what we do. What would you do about ranking when one language dominates the corpus?'],
      [null, 'Score per language and merge, rather than pretend one index has one distribution.'],
      ['reza', 'What do you want from your next role?'],
      [null, 'Ownership of something with real users, and a team that reviews properly. I have had review that was a rubber stamp and it costs more than it saves.'],
      ['ali', 'One reservation from me — most of your work is batch, and this role is streaming and interactive.'],
      [null, 'That is fair. The reconciliation service had a live query path, but it was not the hard part of the job.'],
      ['reza', 'We will come back to you this week either way.'],
      ['ali', 'Strong on data, and honest about the gap. I would take a second conversation on the streaming side.'],
      ['reza', 'Agreed. Set up a systems round with Hamid on call handling, and we decide after that.'],
    ],
    narrative: [
      'A backend panel with Farshad Ebrahimi, run by Reza and Ali: half the hour on the candidate’s own work, half on a problem of ours.',
      'The candidate owned a payments reconciliation service — two million rows a night against three bank feeds, on-call included — for two years. The strongest answer was about failure: after a bank changed its file format twice without warning, he moved validation to ingest and chose to reject the whole file rather than individual rows, on the reasoning that a half-loaded night is worse than a missing one, because a missing night gets noticed.',
      'On our own problem — searching Persian and English transcripts in one query — he proposed folding the text before indexing, normalising the Arabic and Persian letter forms and the zero-width joiners while keeping the original for display, and scoring per language before merging rather than assuming one distribution. That matches what the platform already does.',
      'The reservation is that his experience is batch-weighted while the role is streaming and interactive; he acknowledged it rather than talking around it. The panel did not decide, and instead put him to a systems round with Hamid on call handling.',
    ],
    items: [
      { kind: 'decision', at: 17, body: 'Farshad Ebrahimi goes to a second round rather than a decision now.' },
      { kind: 'decision', at: 18, body: 'The second round is a systems interview with Hamid, focused on the streaming and interactive path.' },
      { kind: 'action', at: 18, owner: 'reza', body: 'Set up the systems round with Hamid' },
      { kind: 'action', at: 16, owner: 'ali', body: 'Send Farshad feedback and the next step this week' },
      { kind: 'question', at: 14, body: 'Does batch-heavy experience transfer to the streaming path?' },
      { kind: 'risk', at: 14, body: "The candidate's experience is batch-weighted; the role is streaming and interactive." },
    ],
  },
  {
    n: 7,
    call: 'de000008-0000-4000-8000-00000000000a',
    meeting: 'de000007-0000-4000-8000-00000000000a',
    heading: 'Weekly product sync — 8 September',
    cast: ['reza', 'mina', 'ali'],
    lines: [
      ['reza', 'Short agenda: the Pasargad demo this afternoon, Aseman, and what we are not doing this week.'],
      ['mina', 'The demo environment is up. Forty-two branches, permissions per branch, and their anonymised month loaded on Sunday.'],
      ['reza', 'Have you run it end to end?'],
      ['mina', 'Twice. Board pack, branch view, audit export. The audit export takes eleven seconds, which is fine but it is a long eleven seconds in front of a customer.'],
      ['ali', 'Warm it before you present. Run it once at half past three and the second run is instant.'],
      ['mina', 'I will do that.'],
      ['reza', 'Aseman. Ali, the checklist?'],
      ['ali', 'Written. One page, eleven items, all measurable. It goes to their legal review with the draft.'],
      ['reza', 'Then the report-builder flag can go on for their staging.'],
      ['ali', 'Turning it on after this call.'],
      ['mina', 'One thing on Pasargad — they will ask for the quote in the room. We agreed the quote comes after the demo.'],
      ['reza', 'It does. Sara sends it, not you, and not today.'],
      ['mina', 'Then I will say the quote follows this week.'],
      ['reza', 'What are we not doing? Mobile capture. The lock-screen work is real, but it does not touch either of the two live deals, so it waits until next week.'],
      ['ali', 'Fine by me.'],
      ['mina', "Last risk — if Aseman's legal comes back with changes to the acceptance criteria, the checklist gets renegotiated and Ali's week disappears."],
      ['ali', 'Then I would rather they see it early. It goes to them today.'],
      ['reza', 'Good. That is the week.'],
    ],
    narrative: [
      'The sync on the morning of the Pasargad demo: the demo itself, Aseman, and what is deliberately not being worked on.',
      'The demo environment is up with forty-two branches, per-branch permissions and Pasargad’s anonymised month loaded on Sunday, and has been run end to end twice. The one rough edge is the audit export at eleven seconds — acceptable, but long in front of a customer — so it will be warmed half an hour before the session and the second run is instant.',
      'On Aseman, the Simorgh acceptance checklist is written: one page, eleven measurable items, going to the customer’s legal review with the draft today. With the checklist in existence, the report-builder flag is turned on for Aseman staging straight after the call. The quote for Pasargad follows the demo and is sent by Sara rather than offered in the room, whatever is asked there.',
      'Mobile capture is explicitly parked for a week: the lock-screen work is real but touches neither live deal. The risk carried forward is that Aseman’s legal may reopen the acceptance criteria, which would consume Ali’s week — the reason the checklist goes to them today rather than later.',
    ],
    items: [
      { kind: 'decision', at: 7, body: "The Simorgh acceptance checklist goes to Aseman's legal review today, with the draft." },
      { kind: 'decision', at: 8, body: 'The report-builder flag is turned on for Aseman staging now that the checklist exists.' },
      { kind: 'decision', at: 11, body: 'The Pasargad quote follows the demo and is sent by Sara, not offered in the room.' },
      { kind: 'decision', at: 13, body: 'Mobile capture lock-screen work waits until next week.' },
      { kind: 'action', at: 4, owner: 'mina', body: 'Warm the audit export before the demo' },
      { kind: 'action', at: 9, owner: 'ali', body: 'Turn on the report-builder flag for Aseman staging' },
      { kind: 'action', at: 16, owner: 'ali', body: "Send the acceptance checklist to Aseman's legal review today" },
      { kind: 'question', at: 10, body: 'Who sends the Pasargad quote, and when?' },
      { kind: 'risk', at: 15, body: "Aseman's legal may reopen the acceptance criteria, which would consume Ali's week." },
    ],
  },
]

// ── timing ─────────────────────────────────────────────────────────────────
// Lines are spread across the call's real duration: each gets an equal slot,
// and inside its slot it lasts as long as it takes to say (~380 ms a word,
// capped so a slot never overflows into the next one). Word timings are spread
// evenly inside the line, which is what click-to-seek reads.
const LEAD_MS = 5000
const TAIL_MS = 15000
const MS_PER_WORD = 380

function timeLines(lines, durationMs) {
  const usable = Math.max(60_000, durationMs - LEAD_MS - TAIL_MS)
  const slot = usable / lines.length
  return lines.map(([, text], i) => {
    const words = text.split(/\s+/).filter(Boolean)
    const start = Math.round(LEAD_MS + i * slot)
    const spoken = Math.min(Math.round(slot * 0.78), words.length * MS_PER_WORD + 800)
    const end = start + Math.max(1500, spoken)
    const step = (end - start) / words.length
    return {
      start,
      end,
      words: words.map((w, k) => ({
        w,
        s: Math.round(start + k * step),
        e: Math.round(start + (k + 1) * step),
      })),
    }
  })
}

/** The summary body, in the shape the platform's own extractor reads. */
function summaryBody(m) {
  const named = (o) => (o ? NAME[o] ?? o : null)
  const lines = [m.heading, '', ...m.narrative.flatMap((p) => [p, ''])]
  const decisions = m.items.filter((i) => i.kind === 'decision')
  const actions = m.items.filter((i) => i.kind === 'action')
  const questions = m.items.filter((i) => i.kind === 'question')
  const risks = m.items.filter((i) => i.kind === 'risk')
  if (decisions.length) {
    lines.push('Decisions:')
    for (const d of decisions) lines.push(`- ${d.body}`)
    lines.push('')
  }
  if (actions.length) {
    lines.push('Action items:')
    for (const a of actions) lines.push(`- ${a.body} — owner: ${named(a.owner)}`)
    lines.push('')
  }
  if (questions.length) {
    lines.push('Open questions:')
    for (const q of questions) lines.push(`- ${q.body}`)
    lines.push('')
  }
  if (risks.length) {
    lines.push('Risks:')
    for (const r of risks) lines.push(`- ${r.body}`)
    lines.push('')
  }
  return lines.join('\n').trimEnd() + '\n'
}

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
const db = new pg.Client({
  connectionString: raw,
  ...(local ? {} : { ssl: { rejectUnauthorized: false } }),
})
await db.connect()
console.log(`seed-demo-transcripts: ${RESET ? 'RESET' : 'SEED'} against ${host.replace(/:\d+\/.*/, '')}`)

try {
  await db.query('begin')
  // the speaker-link trigger asks echo.owns_call(), which reads
  // echo.actor_id(); at owner altitude nobody is acting, so act as the person
  // who owns every one of these calls.
  await db.query(`select set_config('echo.actor_id', $1, true)`, [SARA_USER])

  if (RESET) {
    let seg = 0
    let itm = 0
    for (const m of MEETINGS) {
      const s = await db.query('delete from echo.transcript_segment where call_id = $1', [m.call])
      seg += s.rowCount
      await db.query('update echo.call set current_summary_id = null where id = $1', [m.call])
      await db.query('delete from echo.summary where call_id = $1', [m.call])
      await db.query('delete from echo.call_speaker where call_id = $1', [m.call])
      const i = await db.query('delete from echo.meeting_item where meeting_id = $1', [m.meeting])
      itm += i.rowCount
    }
    await db.query('commit')
    console.log(`  removed ${seg} segment(s) and ${itm} item(s) across ${MEETINGS.length} meeting(s)`)
    await db.end()
    process.exit(0)
  }

  const agent = await db.query(
    `select id from echo.app_user where org_id = $1 and email like 'roya.%@agents.neurai.invalid' limit 1`,
    [ORG],
  )
  // 0160: source is a fact about the writer, so items only claim "ai" when an
  // agent identity actually exists to have written them.
  const AUTHOR = agent.rows[0]?.id ?? SARA_USER
  const SOURCE = agent.rows[0] ? 'ai' : 'user'

  let touched = 0
  let skipped = 0
  for (const m of MEETINGS) {
    const call = await db.query(
      'select id, duration_ms, started_at from echo.call where id = $1 and org_id = $2 and deleted_at is null',
      [m.call, ORG],
    )
    if (call.rowCount === 0) {
      console.warn(`  ⚠ call ${m.call} is missing — "${m.heading}" skipped`)
      skipped += 1
      continue
    }
    const existing = await db.query(
      `select (select count(*) from echo.transcript_segment where call_id = $1)::int segs,
              (select count(*) from echo.meeting_item where meeting_id = $2)::int items`,
      [m.call, m.meeting],
    )
    const { segs, items } = existing.rows[0]
    const mine = await db.query('select count(*)::int n from echo.transcript_segment where id = $1', [uid('2b', m.n, 0)])
    if ((segs > 0 || items > 0) && mine.rows[0].n === 0 && !FORCE) {
      console.log(`  · ${m.heading} — already has content that is not ours, left alone (--force to replace)`)
      skipped += 1
      continue
    }

    // speakers, in the order they first talk
    const speakerIds = m.cast.map((_, i) => uid('2a', m.n, i + 1))
    const timed = timeLines(m.lines, call.rows[0].duration_ms ?? 1_800_000)
    for (const [i, who] of m.cast.entries()) {
      const first = m.lines.findIndex(([w]) => w === who)
      const sample = first >= 0 ? timed[first] : timed[0]
      await db.query(
        `insert into echo.call_speaker (id, call_id, org_id, label, person_id, linked_by, linked_at, sample_start_ms, sample_end_ms)
         values ($1, $2, $3, $4, $5, $6, case when $5::uuid is null then null else now() end, $7, $8)
         on conflict (id) do update set
           label = excluded.label, person_id = excluded.person_id,
           sample_start_ms = excluded.sample_start_ms, sample_end_ms = excluded.sample_end_ms,
           updated_at = now()`,
        [
          speakerIds[i],
          m.call,
          ORG,
          `S${i + 1}·1`,
          who ? P[who] : null,
          who ? SARA_USER : null,
          sample.start,
          sample.end,
        ],
      )
    }

    await db.query('delete from echo.transcript_segment where call_id = $1', [m.call])
    for (const [seq, [who, text]] of m.lines.entries()) {
      const t = timed[seq]
      await db.query(
        `insert into echo.transcript_segment
           (id, call_id, org_id, part_id, seq, start_ms, end_ms, call_speaker_id, text, confidence, words, provenance, language)
         values ($1, $2, $3, null, $4, $5, $6, $7, $8, 0.94, $9::jsonb, '{"seeded": true}'::jsonb, 'en')`,
        [
          uid('2b', m.n, seq),
          m.call,
          ORG,
          seq,
          t.start,
          t.end,
          speakerIds[m.cast.indexOf(who)],
          text,
          JSON.stringify(t.words),
        ],
      )
    }

    // the summary, and the pointer that makes it the current one
    const summaryId = uid('2c', m.n, 1)
    await db.query(
      `insert into echo.summary (id, call_id, org_id, version, body, model, template, created_by, created_at)
       values ($1, $2, $3, 1, $4, $5, null, $6, $7)
       on conflict (id) do update set body = excluded.body, model = excluded.model, created_by = excluded.created_by`,
      [summaryId, m.call, ORG, summaryBody(m), MODEL, AUTHOR, call.rows[0].started_at],
    )
    await db.query('update echo.call set current_summary_id = $2, updated_at = now() where id = $1', [m.call, summaryId])

    // decisions, actions, questions, risks — positioned per kind, and anchored
    // at the line that produced them
    await db.query('delete from echo.meeting_item where meeting_id = $1', [m.meeting])
    const position = {}
    for (const [k, item] of m.items.entries()) {
      position[item.kind] = (position[item.kind] ?? 0) + 1
      await db.query(
        `insert into echo.meeting_item (id, meeting_id, org_id, kind, body, source, done, owner, at_ms, position, created_by, created_at)
         values ($1, $2, $3, $4, $5, $6, false, $7, $8, $9, $10, $11)`,
        [
          uid('2d', m.n, k),
          m.meeting,
          ORG,
          item.kind,
          item.body,
          SOURCE,
          item.owner ? NAME[item.owner] ?? item.owner : null,
          timed[item.at].start,
          position[item.kind],
          AUTHOR,
          call.rows[0].started_at,
        ],
      )
    }

    const counts = m.items.reduce((a, i) => ({ ...a, [i.kind]: (a[i.kind] ?? 0) + 1 }), {})
    console.log(
      `  · ${m.heading} — ${m.lines.length} lines, ${m.cast.length} speakers, ` +
        `${counts.decision ?? 0} decisions, ${counts.action ?? 0} actions, ` +
        `${counts.question ?? 0} questions, ${counts.risk ?? 0} risks`,
    )
    touched += 1
  }

  await db.query('commit')
  console.log(`  ${touched} meeting(s) filled in, ${skipped} left alone`)
  console.log('done')
} catch (e) {
  await db.query('rollback').catch(() => {})
  console.error('seed-demo-transcripts failed:', e.message)
  process.exitCode = 1
} finally {
  await db.end().catch(() => {})
}
