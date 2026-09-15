/**
 * The ENGLISH demo content pack (M52).
 *
 * The dialogue, the summaries and the board are the ones the live demo has
 * been rehearsed against — db/scripts/seed-demo-records.mjs is where they
 * were written and proven, and this file is their home now that the console
 * can seed a demo organisation on any date.
 *
 * Two deliberate departures from that script, both because a pack outlives
 * the day it was written:
 *
 *   • the pricing call promises the quote "by Tuesday", never "by Tuesday the
 *     ninth". The audio is synthesised ONCE; a spoken calendar date would
 *     contradict the board on every demo after the ninth, and nothing in the
 *     product could correct it.
 *   • the presenter carries exactly ONE open card. The demo line is "no major
 *     tasks", and a second open card on her board — even a medium one — makes
 *     the assistant's answer to "what is on my plate?" a list instead of a
 *     sentence.
 *
 * `audio` is filled in by core/scripts/demo-audio-build.mjs and committed as
 * data. Do not hand-edit it: the timings are measurements.
 */

import type { DemoPack } from "./pack.ts";
import { AUDIO_EN } from "./audio.en.ts";

/*
 * Soniox voices — the SAME three the Persian pack names, because a Soniox
 * voice keeps its timbre across languages and the two packs are one demo.
 * The choice and its reasons are recorded in core/scripts/demo-audio-build.mjs.
 */
/** the presenter, Sarah */
const EMMA = { voice: "Emma" };
/** NAI, the director */
const ADRIAN = { voice: "Adrian" };
/** Ms. Reynolds — a second female voice chosen to sit far from Emma's */
const NINA = { voice: "Nina" };

export const PACK_EN: DemoPack = {
  language: "en",
  orgName: "Northstar Data Demo",
  glossary: ["Simorgh", "Lakeside", "Harbor Bank"],

  people: [
    {
      key: "owner",
      username: "sara",
      displayName: "Sarah Mitchell",
      displayNameEn: null,
      jobTitle: "Product Manager",
      personTitle: "manager",
      team: "Product",
    },
    {
      key: "reza",
      username: "reza",
      displayName: "Ryan Cooper",
      displayNameEn: null,
      jobTitle: "CTO",
      personTitle: "cto",
      team: "Engineering",
    },
    {
      key: "mina",
      username: "mina",
      displayName: "Megan Brooks",
      displayNameEn: null,
      jobTitle: "Sales",
      personTitle: "employee",
      team: "Sales",
    },
    {
      key: "ali",
      username: "ali",
      displayName: "Alex Turner",
      displayNameEn: null,
      jobTitle: "Engineering Lead",
      personTitle: "lead",
      team: "Engineering",
    },
    {
      key: "hamid",
      username: "hamid",
      displayName: "Henry Walsh",
      displayNameEn: null,
      jobTitle: "Support",
      personTitle: "employee",
      team: "Support",
    },
  ],

  outsiders: [
    { key: "nai", displayName: "NAI", personTitle: "director" },
    { key: "pasargad", displayName: "Harbor Bank — Ms. Reynolds", personTitle: "manager" },
  ],

  columns: [
    { key: "backlog", name: "Backlog", tone: "grey" },
    { key: "todo", name: "To do", tone: "blue" },
    { key: "doing", name: "In progress", tone: "amber" },
    { key: "done", name: "Done", tone: "green" },
  ],

  topics: [
    { key: "customers", name: "Customers" },
    { key: "oneOnOne", name: "1 on 1" },
  ],

  tasks: [
    /* ── the eight open cards; exactly one of them is the presenter's ── */
    {
      key: "open-renewal",
      columnKey: "doing",
      title: "Draft Q3 renewal terms",
      description: null,
      priority: "critical",
      assignee: "reza",
      done: false,
      dueDays: 2,
    },
    {
      key: "open-staging",
      columnKey: "todo",
      title: "Migrate Lakeside staging data",
      description: null,
      priority: "high",
      assignee: "ali",
      done: false,
      dueDays: 3,
    },
    {
      key: "open-onboarding",
      columnKey: "doing",
      title: "Rewrite the Lakeside onboarding checklist",
      description: null,
      priority: "medium",
      assignee: "mina",
      done: false,
      dueDays: null,
    },
    {
      key: "open-room",
      columnKey: "backlog",
      title: "Book the Q4 planning room",
      description: null,
      priority: "low",
      assignee: "hamid",
      done: false,
      dueDays: null,
    },
    {
      key: "open-macros",
      columnKey: "backlog",
      title: "Review the new support macros",
      description: null,
      priority: "low",
      assignee: "hamid",
      done: false,
      dueDays: null,
    },
    {
      key: "open-demoenv",
      columnKey: "todo",
      title: "Prepare the Harbor Bank demo environment",
      description: null,
      priority: "high",
      assignee: "ali",
      done: false,
      dueDays: null,
    },
    {
      key: "open-acceptance",
      columnKey: "todo",
      title: "Collect the phase-one acceptance criteria",
      description: null,
      priority: "medium",
      assignee: "reza",
      done: false,
      dueDays: null,
    },
    {
      key: "open-quote",
      columnKey: "backlog",
      title: "Send Harbor Bank the price quote",
      description:
        "Quote for 40 users plus the custom-reports module. Include the support SLA wording (response times per severity). The demo environment goes live first.",
      priority: "medium",
      assignee: "owner",
      done: false,
      dueDays: null,
      dueFirstTuesday: true,
      linkedRecord: "pricing",
    },

    /* ── fifteen finished cards, spread across the team ── */
    { key: "done-invoices-sep", columnKey: "done", title: "Close September invoices", description: null, priority: "medium", assignee: "mina", done: true, dueDays: null },
    { key: "done-export", columnKey: "done", title: "Ship the reporting export endpoint", description: null, priority: "medium", assignee: "ali", done: true, dueDays: null },
    { key: "done-release-notes", columnKey: "done", title: "Publish the August release notes", description: null, priority: "medium", assignee: "mina", done: true, dueDays: null },
    { key: "done-onboard-support", columnKey: "done", title: "Onboard the two new support agents", description: null, priority: "medium", assignee: "hamid", done: true, dueDays: null },
    { key: "done-data-model", columnKey: "done", title: "Sign off the Lakeside data model", description: null, priority: "medium", assignee: "reza", done: true, dueDays: null },
    { key: "done-load-test", columnKey: "done", title: "Run the load test on the staging cluster", description: null, priority: "medium", assignee: "ali", done: true, dueDays: null },
    { key: "done-pricing-copy", columnKey: "done", title: "Update the pricing page copy", description: null, priority: "medium", assignee: "mina", done: true, dueDays: null },
    { key: "done-archive", columnKey: "done", title: "Archive the 2025 customer folders", description: null, priority: "medium", assignee: "hamid", done: true, dueDays: null },
    { key: "done-backup", columnKey: "done", title: "Move the nightly backup to the new bucket", description: null, priority: "medium", assignee: "ali", done: true, dueDays: null },
    { key: "done-procurement", columnKey: "done", title: "Answer the Harbor Bank procurement form", description: null, priority: "medium", assignee: "owner", done: true, dueDays: null },
    { key: "done-deck", columnKey: "done", title: "Refresh the sales deck for September", description: null, priority: "medium", assignee: "mina", done: true, dueDays: null },
    { key: "done-legacy-worker", columnKey: "done", title: "Retire the legacy transcript worker", description: null, priority: "medium", assignee: "reza", done: true, dueDays: null },
    { key: "done-incident", columnKey: "done", title: "Write the incident report for the August outage", description: null, priority: "medium", assignee: "ali", done: true, dueDays: null },
    { key: "done-sla", columnKey: "done", title: "Agree the support SLA wording", description: null, priority: "medium", assignee: "hamid", done: true, dueDays: null },
    { key: "done-shared-drive", columnKey: "done", title: "Set up the Lakeside shared drive", description: null, priority: "medium", assignee: "mina", done: true, dueDays: null },
  ],

  upcoming: [
    {
      key: "weekly",
      title: "Weekly meeting with NAI",
      description:
        "Weekly 1:1 with NAI. This meeting recurs every week — the previous one was a week ago.",
      location: "Meeting room A",
      topicKey: "oneOnOne",
      mode: "in_person",
      durationMinutes: 30,
      when: { kind: "offset" },
      attendees: ["owner"],
    },
    {
      key: "customerDemo",
      title: "Harbor Bank demo",
      description:
        "The demo environment promised on the pricing call — Harbor Bank tries the reporting platform and the custom-reports module. The quote goes out after this.",
      location: "Meeting room B",
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
      title: "Weekly meeting with NAI",
      description:
        "Weekly 1:1 with NAI — the Lakeside contract, the Simorgh codename, the support macros, and next week's Harbor Bank demo.",
      location: "Meeting room A",
      topicKey: "oneOnOne",
      outsider: "nai",
      daysBefore: 7,
      hour: 9,
      minute: 0,
      avoidWeekend: false,
      speakerLabels: ["S1·1", "S2·1"],
      voices: [EMMA, ADRIAN],
      lines: [
        { speaker: 0, text: "Good morning, NAI. Let’s do our weekly one-on-one. I want to cover Lakeside, the support macros, and next week’s demo." },
        { speaker: 1, text: "Good morning, Sarah. Sounds good. Let’s start with Lakeside, since that one has a deadline attached." },
        { speaker: 0, text: "The Lakeside contract is close to signing. Their legal team has the draft, and the last commercial point was closed on Thursday." },
        { speaker: 1, text: "That is good news. What is left before their signature?" },
        { speaker: 0, text: "Mostly the custom-reports module. They want to see how the rollout will be staged before they sign." },
        { speaker: 1, text: "We keep calling it the Lakeside custom-reports module rollout, which is a mouthful. Can we give it a short name?" },
        { speaker: 0, text: "Yes. Let’s just call the whole custom-reports rollout Simorgh internally. Simorgh is the codename for everything under that module for Lakeside." },
        { speaker: 1, text: "Simorgh. Noted. So the Simorgh rollout covers the report builder, the scheduled exports, and the staging environment?" },
        { speaker: 0, text: "Exactly. Three pieces, one codename. Anything Lakeside-specific under custom reports is Simorgh from now on." },
        { speaker: 1, text: "Then here is my concern. The Simorgh acceptance checklist does not exist yet, and Lakeside’s legal review will ask what delivered means." },
        { speaker: 0, text: "You are right. If the checklist is written after their legal review, we will be negotiating acceptance criteria twice." },
        { speaker: 1, text: "So the Simorgh acceptance checklist has to be written before Lakeside’s legal review starts. Who should own it?" },
        { speaker: 0, text: "Alex Turner. He built most of the report builder, and he already knows what the staging data looks like." },
        { speaker: 1, text: "Agreed. Alex Turner owns the Simorgh acceptance checklist, and it is due before Lakeside’s legal review." },
        { speaker: 0, text: "I will tell Alex today. He should keep it short: one page, measurable items, nothing that needs interpretation." },
        { speaker: 1, text: "Good. Second topic. Henry finished the new support macros last week. Have you looked at them?" },
        { speaker: 0, text: "Not yet. I will review Henry’s support macros this week and send him comments before Friday." },
        { speaker: 1, text: "Please check the tone as well as the content. Two of them read a bit abrupt in the draft I saw." },
        { speaker: 0, text: "Understood. I will review the macros for tone too. That one is mine." },
        { speaker: 1, text: "Third topic. Harbor Bank. Their demo is next week, right?" },
        { speaker: 0, text: "Yes, the Harbor Bank demo is next week. They want to see the reporting platform, and they asked about the custom-reports module as well." },
        { speaker: 1, text: "So Simorgh is relevant to Harbor Bank too, even if the codename stays internal." },
        { speaker: 0, text: "Right. Externally it is still the custom-reports module. Internally, the Simorgh checklist will help us with Harbor Bank as well." },
        { speaker: 1, text: "Do you need anything from me for the demo?" },
        { speaker: 0, text: "Megan is preparing the demo environment. If you could check the sample data with her on Wednesday, that would help." },
        { speaker: 1, text: "I will do that. To recap: Simorgh is the internal codename for the Lakeside custom-reports rollout, and Alex Turner owns the Simorgh acceptance checklist before Lakeside’s legal review." },
        { speaker: 0, text: "And I review Henry’s support macros this week, and the Harbor Bank demo is next week." },
        { speaker: 1, text: "Perfect. Same time next Monday. Thanks, Sarah." },
        { speaker: 0, text: "Thanks, NAI. Talk next week." },
      ],
      summary: [
        "Weekly 1:1 — Sarah Mitchell and NAI",
        "",
        "The Lakeside contract is close to signing: Lakeside’s legal team has the draft and the last commercial point was closed on Thursday. What remains is the custom-reports module, which Lakeside wants to see staged before they sign. The two agreed to call the whole Lakeside custom-reports rollout “Simorgh” internally; Simorgh covers the report builder, the scheduled exports and the staging environment, and stays an internal name.",
        "",
        "NAI raised that the Simorgh acceptance checklist does not exist yet and that Lakeside’s legal review will ask what “delivered” means. Writing it afterwards would mean negotiating acceptance criteria twice, so the checklist must be written before Lakeside’s legal review. Alex Turner owns it: one page, measurable items, nothing that needs interpretation.",
        "",
        "Henry finished the new support macros last week; Sarah will review them this week for content and tone and send comments before Friday. The Harbor Bank demo is next week — Megan is preparing the demo environment and NAI will check the sample data with her on Wednesday. Harbor Bank also asked about the custom-reports module, so the Simorgh checklist will help there too.",
        "",
        "Decisions:",
        "- The Lakeside custom-reports module rollout is codenamed “Simorgh” internally (report builder, scheduled exports, staging environment).",
        "- The Simorgh acceptance checklist is written BEFORE Lakeside’s legal review, and Alex Turner owns it.",
        "- Externally the module keeps its name; Simorgh stays internal.",
        "",
        "Action items:",
        "- Write the Simorgh acceptance checklist before Lakeside’s legal review — owner: Alex Turner",
        "- Review the new support macros for content and tone and send comments before Friday — owner: Sarah Mitchell",
        "- Check the Harbor Bank demo sample data with Megan on Wednesday — owner: NAI",
      ].join("\n"),
      items: [
        { kind: "decision", line: 6 },
        { kind: "decision", line: 13 },
        { kind: "decision", line: 22 },
        { kind: "action", line: 13 },
        { kind: "action", line: 16 },
        { kind: "action", line: 25 },
      ],
      audio: AUDIO_EN.prior,
    },

    {
      key: "pricing",
      title: "Harbor Bank — pricing call",
      description:
        "Pricing call with Harbor Bank — a quote for 40 users plus the custom-reports module.",
      location: "Meeting room A",
      topicKey: "customers",
      outsider: "pasargad",
      daysBefore: 4,
      hour: 14,
      minute: 0,
      avoidWeekend: true,
      speakerLabels: ["S1·1", "S2·1"],
      voices: [EMMA, NINA],
      lines: [
        { speaker: 1, text: "Hello Ms. Mitchell, this is Reynolds from Harbor Bank. Thank you for taking the call." },
        { speaker: 0, text: "Hello Ms. Reynolds, good to hear from you. How can I help today?" },
        { speaker: 1, text: "We would like a price quote for the reporting platform. We have forty users to start with, and we also want the custom-reports module." },
        { speaker: 0, text: "Forty users plus the custom-reports module. Let me confirm the tiers so we are looking at the same thing." },
        { speaker: 1, text: "Please do." },
        { speaker: 0, text: "The platform is priced in three tiers: up to twenty users, up to fifty users, and above fifty. Forty users falls in the second tier." },
        { speaker: 1, text: "And the custom-reports module is priced separately?" },
        { speaker: 0, text: "Yes. The custom-reports module is a flat annual add-on on top of the tier, and it includes the report builder and the scheduled exports." },
        { speaker: 1, text: "Understood. When can we have the quote in writing?" },
        { speaker: 0, text: "I will send the price quote by Tuesday, so you have it before your internal meeting on Wednesday." },
        { speaker: 1, text: "Tuesday works. One request: please include the support SLA wording in the quote itself, not as a separate document." },
        { speaker: 0, text: "Of course. I will include the support SLA wording in the quote, with the response times for each severity." },
        { speaker: 1, text: "Our procurement team reads only the quote, so that will save us a round." },
        { speaker: 0, text: "Noted. Also, our demo environment for Harbor Bank will be ready before the quote goes out, so your team can try it alongside the numbers." },
        { speaker: 1, text: "That would be helpful. Can we agree that the demo environment is ready before the quote is sent?" },
        { speaker: 0, text: "Yes, let’s agree on that. Demo environment first, then the quote by Tuesday." },
        { speaker: 1, text: "One more thing. Does the second tier include onboarding for all forty users?" },
        { speaker: 0, text: "It includes two onboarding sessions. Additional sessions are listed as an option in the quote, so you can decide later." },
        { speaker: 1, text: "Good. Then I will wait for the quote on Tuesday. Thank you, Ms. Mitchell." },
        { speaker: 0, text: "Thank you, Ms. Reynolds. You will have it by Tuesday. Goodbye." },
      ],
      summary: [
        "Pricing call — Harbor Bank (Ms. Reynolds) and Sarah Mitchell",
        "",
        "Ms. Reynolds asked for a price quote for the reporting platform for forty users plus the custom-reports module. Sarah confirmed the tiers: up to twenty users, up to fifty, and above fifty — forty users falls in the second tier — and the custom-reports module is a flat annual add-on that includes the report builder and the scheduled exports. The second tier includes two onboarding sessions; additional sessions go into the quote as an option.",
        "",
        "Sarah will send the price quote by Tuesday, before Harbor Bank’s internal meeting on Wednesday. Ms. Reynolds asked for the support SLA wording to be included in the quote itself, with the response times per severity, because their procurement team reads only the quote. Both agreed that the Harbor Bank demo environment will be ready before the quote goes out.",
        "",
        "Decisions:",
        "- Harbor Bank is quoted on the second tier (up to fifty users) plus the custom-reports add-on.",
        "- The support SLA wording goes inside the quote, not as a separate document.",
        "- The demo environment is ready before the quote is sent.",
        "",
        "Action items:",
        "- Send Harbor Bank the price quote for 40 users plus the custom-reports module by Tuesday — owner: Sarah Mitchell",
        "- Include the support SLA wording in the quote — owner: Sarah Mitchell",
        "- Have the Harbor Bank demo environment ready before the quote goes out — owner: Sarah Mitchell",
      ].join("\n"),
      items: [
        { kind: "decision", line: 5 },
        { kind: "decision", line: 11 },
        { kind: "decision", line: 15 },
        { kind: "action", line: 9 },
        { kind: "action", line: 11 },
        { kind: "action", line: 13 },
      ],
      audio: AUDIO_EN.pricing,
    },
  ],

  /*
   * ── THE PRESENTER'S WEEK WITH THE ASSISTANT ─────────────────────────────
   *
   * Five conversations, five SHAPES of ask, because the shelf is the point:
   * a sidebar of five variations on "what should I do next?" says the
   * assistant answers one question, and the demo's claim is that it answers
   * whatever the week actually contained.
   *
   *   simorgh    — one question, one answer. The whole thread fits on screen.
   *   board      — a question the answer came back as a TABLE for.
   *   quote      — the longest: the presenter asks the agent to WRITE
   *                something and then changes it twice.
   *   weekly     — about one specific meeting, and the follow-up is a
   *                question the meeting did NOT settle.
   *   unanswered — one message, no answer. Somebody closed the tab.
   *
   * Every fact in them is a fact this organisation contains: the cards are
   * the cards above with their real owners and their real priorities, the
   * decisions are the ones the two recordings decided, the names are the
   * directory's. An assistant that answered with something the org does not
   * contain would be the demo showing a product talking about somebody else.
   *
   * Nothing says "tomorrow", "next week" or a date. The pack is read on a day
   * the operator chooses; a conversation from four days ago that claims the
   * demo is tomorrow is wrong on every demo date but one, and the timeline
   * cannot correct prose. The same rule the dialogue lives under.
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
          text: "What does Simorgh actually cover?",
        },
        {
          role: "assistant",
          text: "Simorgh is this organisation's internal codename for the Lakeside custom-reports rollout — agreed with NAI in the weekly one-on-one. It covers three pieces: the report builder, the scheduled exports, and the staging environment. Outside the company the module keeps its own name; Simorgh stays internal.",
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
          text: "Who is carrying the open cards right now?",
        },
        {
          role: "assistant",
          text: [
            "Eight cards are open. By owner:",
            "",
            "| Owner | Open cards | With a deadline |",
            "| --- | --- | --- |",
            "| Ryan Cooper | 2 | Draft Q3 renewal terms |",
            "| Alex Turner | 2 | Migrate Lakeside staging data |",
            "| Henry Walsh | 2 | — |",
            "| Megan Brooks | 1 | — |",
            "| Sarah Mitchell | 1 | Send Harbor Bank the price quote |",
            "",
            "Only those three carry dates. The other five — the Lakeside onboarding checklist, the Q4 planning room, the new support macros, the Harbor Bank demo environment and the phase-one acceptance criteria — have none.",
          ].join("\n"),
        },
        {
          role: "user",
          text: "Which of the undated ones would you put a date on?",
        },
        {
          role: "assistant",
          text: "The Harbor Bank demo environment. It is Alex Turner's, it is the only undated card marked high, and it is the one the Harbor Bank demo cannot happen without — the others are a checklist, a room booking, a macro review and a set of acceptance criteria, and each of those can slip a week without anybody outside the team noticing.",
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
          text: "Draft the email to Harbor Bank with the quote we agreed on the call.",
        },
        {
          role: "assistant",
          text: [
            "Here is a draft. It follows what was agreed with Ms. Reynolds on the pricing call.",
            "",
            "**Subject: Reporting platform — your quote**",
            "",
            "Dear Ms. Reynolds,",
            "",
            "Thank you for your time on the call. The quote below covers forty users on the second tier — up to fifty users — together with the custom-reports module, which is an annual add-on and includes the report builder and the scheduled exports. Two onboarding sessions are included; further sessions appear as an option, so your team can decide later.",
            "",
            "The support SLA is set out in this message rather than attached, with the response time for each severity.",
            "",
            "Your demo environment will be live before this quote reaches your procurement team, so they can try the platform alongside the numbers.",
            "",
            "Kind regards,",
            "Sarah Mitchell",
            "",
            "Tell me what to change.",
          ].join("\n"),
        },
        {
          role: "user",
          text: "Spell the response times out per severity — their procurement team reads only the quote.",
        },
        {
          role: "assistant",
          text: "Done. The SLA section now lists each severity with its response time in the body of the message, and the link to the support policy page is gone — a link is precisely the second document Ms. Reynolds said her procurement team will not open.",
        },
        {
          role: "user",
          text: "Good. Leave the figures out until Ryan has signed off the renewal wording.",
        },
        {
          role: "assistant",
          text: "Done. The draft now names the tier and the add-on without any prices, and closes by saying the priced version follows once Ryan Cooper has confirmed the renewal wording. Nothing has been sent — the draft is yours.",
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
          text: "What did I agree to in the weekly with NAI?",
        },
        {
          role: "assistant",
          text: "One item from that meeting is yours: review Henry Walsh's new support macros for content and tone, and send him comments before Friday. The other two went elsewhere — Alex Turner owns the Simorgh acceptance checklist, to be written before Lakeside's legal review, and NAI is checking the Harbor Bank demo sample data with Megan Brooks.",
        },
        {
          role: "user",
          text: "Did we settle what “delivered” means for Lakeside?",
        },
        {
          role: "assistant",
          text: "No — that is the question the checklist exists to answer. The decision was that the Simorgh acceptance checklist is written BEFORE Lakeside's legal review, because writing it afterwards would mean negotiating acceptance criteria twice. One page, measurable items, nothing that needs interpretation. It has not been written yet.",
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
        /* ONE TURN. A session exists because something was said in it, and an
           assistant turn is written only when a run produced text — so a
           question somebody walked away from is a state the product really
           has, and a sidebar where every thread ends tidily is a sidebar
           that has never seen a Tuesday evening. */
        {
          role: "user",
          text: "Compare the Harbor Bank quote with what Lakeside signed last year.",
        },
      ],
    },
  ],
};
