/**
 * The two demo content packs are the SAME demo (M52).
 *
 * A demo organisation is data, and the English and Persian packs are two
 * spellings of one thing. Every structural difference between them is a
 * feature that exists in one language and not the other — the exact shape
 * Persian-first exists to prevent — so this file asserts the equality
 * FIELD BY FIELD rather than counting rows and hoping.
 *
 * The second half is the one that would otherwise rot silently: the seeded
 * meeting's decisions and action items are not written by the pack, they are
 * SLICED out of the summary by `sliceSummary`, exactly as they are after a
 * real call. So a Persian heading somebody rephrases, or an owner marker
 * somebody drops, does not break a test about strings — it produces a demo
 * meeting with no action items, which nobody would notice until it was on a
 * screen in front of a customer. The extractor is run here on the real
 * summaries, with the negative control that proves the headings are what
 * make it work.
 */
import { describe, expect, it } from "vitest";

import { sliceSummary, splitOwner } from "../src/api/meetings.ts";
import { titleFrom } from "../src/api/sessions.ts";
import { ALL_PACKS, packFor } from "../src/api/demo-seed/packs.ts";
import {
  DEMO_CONVERSATION_KEYS, DEMO_LANGUAGES, type DemoPack,
} from "../src/api/demo-seed/pack.ts";

/** Persian digits to ASCII, so a count can be compared to a count. */
const foldDigits = (text: string): string =>
  text.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));

const EN = packFor("en");
const FA = packFor("fa");

/** Everything about a pack that must NOT depend on its language. */
const shapeOf = (pack: DemoPack) => ({
  people: pack.people.map((p) => ({ key: p.key, username: p.username, title: p.personTitle })),
  outsiders: pack.outsiders.map((o) => ({ key: o.key, title: o.personTitle })),
  columns: pack.columns.map((c) => ({ key: c.key, tone: c.tone })),
  topics: pack.topics.map((t) => t.key),
  tasks: pack.tasks.map((t) => ({
    key: t.key, column: t.columnKey, priority: t.priority,
    assignee: t.assignee, done: t.done, dueDays: t.dueDays,
    firstTuesday: t.dueFirstTuesday ?? false, linked: t.linkedRecord ?? null,
    described: t.description !== null,
  })),
  glossary: pack.glossary.length,
  upcoming: pack.upcoming.map((u) => ({
    key: u.key, topic: u.topicKey, mode: u.mode, minutes: u.durationMinutes,
    when: u.when, attendees: u.attendees,
  })),
  records: pack.records.map((r) => ({
    key: r.key, daysBefore: r.daysBefore, hour: r.hour, minute: r.minute,
    avoidWeekend: r.avoidWeekend, outsider: r.outsider, topic: r.topicKey,
    labels: r.speakerLabels, lines: r.lines.length,
    speakers: r.lines.map((l) => l.speaker),
    items: r.items.map((i) => ({ kind: i.kind, line: i.line })),
  })),
  conversations: pack.conversations.map((c) => ({
    key: c.key, daysBefore: c.daysBefore, hour: c.hour, minute: c.minute,
    afterRecord: c.afterRecord,
    /* the SHAPE of a thread is its turn count and who took each turn — a
       Persian answer that lost a follow-up is a conversation the English
       demo has and the Persian one does not */
    roles: c.turns.map((t) => t.role),
  })),
});

describe("the demo content packs", () => {
  it("ships one pack per declared language", () => {
    expect(ALL_PACKS.map((p) => p.language)).toEqual([...DEMO_LANGUAGES]);
  });

  it("has the same structure in both languages, field by field", () => {
    expect(shapeOf(FA)).toEqual(shapeOf(EN));
  });

  it("says everything a person reads in its own language", () => {
    /* the control for the test above: identical STRUCTURE must not mean
       identical STRINGS, or the Persian pack would be the English one */
    expect(FA.orgName).not.toBe(EN.orgName);
    expect(FA.glossary).not.toEqual(EN.glossary);
    for (let i = 0; i < EN.people.length; i++) {
      expect(FA.people[i]!.displayName).not.toBe(EN.people[i]!.displayName);
    }
    for (let i = 0; i < EN.records.length; i++) {
      expect(FA.records[i]!.summary).not.toBe(EN.records[i]!.summary);
      for (let l = 0; l < EN.records[i]!.lines.length; l++) {
        expect(FA.records[i]!.lines[l]!.text).not.toBe(EN.records[i]!.lines[l]!.text);
      }
    }
    for (let i = 0; i < EN.conversations.length; i++) {
      for (let t = 0; t < EN.conversations[i]!.turns.length; t++) {
        expect(FA.conversations[i]!.turns[t]!.text)
          .not.toBe(EN.conversations[i]!.turns[t]!.text);
      }
    }
  });

  it("writes the Persian pack in Persian, with no Latin prose", () => {
    /* NAI is a company acronym and is exempt by the same rule that exempts
       every brand name; anything ELSE in the Latin script would be an
       English sentence on a Persian screen */
    const latin = /[A-Za-z]+/g;
    const allowed = new Set(["NAI"]);
    const offenders: string[] = [];
    const check = (text: string, where: string) => {
      for (const word of text.match(latin) ?? []) {
        if (!allowed.has(word)) offenders.push(`${where}: ${word}`);
      }
    };
    check(FA.orgName, "orgName");
    for (const p of FA.people) check(`${p.displayName} ${p.jobTitle} ${p.team}`, "person");
    for (const c of FA.columns) check(c.name, "column");
    for (const t of FA.topics) check(t.name, "topic");
    for (const t of FA.tasks) check(`${t.title} ${t.description ?? ""}`, `task ${t.key}`);
    for (const r of FA.records) {
      check(`${r.title} ${r.description} ${r.location}`, `record ${r.key}`);
      for (const line of r.lines) check(line.text, `record ${r.key} line`);
      check(r.summary, `record ${r.key} summary`);
    }
    for (const u of FA.upcoming) check(`${u.title} ${u.description} ${u.location}`, `upcoming ${u.key}`);
    /* the conversations are the SIDEBAR, which is the first thing on screen
       on the product's first page — a Latin sentence there is the
       hard-coded-other-language bug at its most visible */
    for (const c of FA.conversations) {
      for (const turn of c.turns) check(turn.text, `conversation ${c.key}`);
    }
    expect(offenders).toEqual([]);
  });

  it("gives the presenter exactly ONE open card, and it is not urgent", () => {
    for (const pack of ALL_PACKS) {
      const open = pack.tasks.filter((t) => !t.done && t.assignee === "owner");
      expect(open, pack.language).toHaveLength(1);
      /* the demo line is "no major tasks" — a high or critical card on the
         presenter's own board makes that sentence false on screen */
      expect(open[0]!.priority, pack.language).not.toBe("high");
      expect(open[0]!.priority, pack.language).not.toBe("critical");
      expect(open[0]!.dueFirstTuesday, pack.language).toBe(true);
      expect(open[0]!.linkedRecord, pack.language).toBe("pricing");
    }
  });

  it("fills the board with fifteen finished cards and eight open ones", () => {
    for (const pack of ALL_PACKS) {
      expect(pack.tasks.filter((t) => t.done), pack.language).toHaveLength(15);
      expect(pack.tasks.filter((t) => !t.done), pack.language).toHaveLength(8);
      /* every card belongs to somebody: an unassigned card on a demo board
         reads as work nobody has got to yet, which is a different claim */
      for (const task of pack.tasks) {
        expect(pack.people.some((p) => p.key === task.assignee), task.key).toBe(true);
      }
    }
  });

  it("has a unique key on every card", () => {
    for (const pack of ALL_PACKS) {
      const keys = pack.tasks.map((t) => t.key);
      expect(new Set(keys).size, pack.language).toBe(keys.length);
    }
  });

  describe("the upcoming meetings", () => {
    it("are the same count in both languages, keyed alike", () => {
      expect(FA.upcoming).toHaveLength(EN.upcoming.length);
      expect(FA.upcoming.map((u) => u.key)).toEqual(EN.upcoming.map((u) => u.key));
      expect(EN.upcoming.length).toBeGreaterThanOrEqual(2);
    });

    it("has exactly one meeting that is relative to NOW — the one starting in N minutes", () => {
      for (const pack of ALL_PACKS) {
        const relative = pack.upcoming.filter((u) => u.when.kind === "offset");
        expect(relative, pack.language).toHaveLength(1);
        expect(relative[0]!.key, pack.language).toBe("weekly");
      }
    });

    it("is hosted by the presenter, who is always the first attendee", () => {
      for (const pack of ALL_PACKS) {
        for (const u of pack.upcoming) {
          expect(u.attendees[0], `${pack.language}/${u.key}`).toBe("owner");
          expect(new Set(u.attendees).size, `${pack.language}/${u.key}`).toBe(u.attendees.length);
          for (const key of u.attendees) {
            expect(pack.people.some((p) => p.key === key), `${pack.language}/${u.key}`).toBe(true);
          }
        }
      }
    });

    it("names the customer demo after the pack's OWN customer, tomorrow at ten, with the person preparing it", () => {
      const customer = { en: "Harbor Bank", fa: "پاسارگاد" } as const;
      for (const pack of ALL_PACKS) {
        const demo = pack.upcoming.find((u) => u.key === "customerDemo")!;
        expect(demo, pack.language).toBeDefined();
        /* the customer's name in the meeting title is the same string the
           outsider, the glossary and the pricing call carry — a title naming
           a customer the org has never heard of is a demo about somebody else */
        expect(demo.title, pack.language).toContain(customer[pack.language]);
        expect(pack.glossary, pack.language).toContain(customer[pack.language]);
        expect(demo.topicKey, pack.language).toBe("customers");
        expect(demo.mode, pack.language).toBe("in_person");
        expect(demo.durationMinutes, pack.language).toBe(45);
        expect(demo.when, pack.language).toEqual({ kind: "day", daysAfter: 1, hour: 10, minute: 0 });
        /* the colleague in the room is the one whose open card prepares the
           environment being shown — the two facts are one click apart */
        const prepares = pack.tasks.find((t) => t.key === "open-demoenv")!;
        expect(demo.attendees, pack.language).toEqual(["owner", prepares.assignee]);
        /* and the description ties it to the pricing call the way the
           recording does: environment first, quote after */
        const quote = { en: /quote/i, fa: /پیشنهاد قیمت/ } as const;
        expect(demo.description, pack.language).toMatch(quote[pack.language]);
      }
    });
  });

  describe("the conversations the sidebar opens on", () => {
    /*
     * The hub IS the product's first page, and a seeded demo used to open it
     * on "No conversations yet". These assertions are about the two things
     * that make the fix worth having rather than merely present: the
     * conversations are OF this organisation, and they are DIFFERENT from
     * each other. Both can rot silently — five plausible threads that all
     * ask the same kind of question, or five that could have been written
     * about any company, still render perfectly.
     */

    it("ships every declared conversation, keyed alike, oldest first", () => {
      for (const pack of ALL_PACKS) {
        expect(pack.conversations.map((c) => c.key), pack.language)
          .toEqual([...DEMO_CONVERSATION_KEYS]);
        /* the file reads as the week did, and the sidebar (newest first) is
           then this list reversed — one order to check rather than two */
        const days = pack.conversations.map((c) => c.daysBefore);
        expect([...days].sort((a, b) => b - a), pack.language).toEqual(days);
        expect(new Set(days).size, pack.language).toBe(days.length);
      }
    });

    it("lands every one of them in the week BEFORE the demo day", () => {
      for (const pack of ALL_PACKS) {
        for (const conversation of pack.conversations) {
          const where = `${pack.language}/${conversation.key}`;
          /* 1, never 0: a thread stamped on the demo day itself competes
             with the demo being given, and the presenter's history is
             supposed to be history */
          expect(conversation.daysBefore, where).toBeGreaterThanOrEqual(1);
          expect(conversation.daysBefore, where).toBeLessThanOrEqual(6);
          expect(conversation.hour, where).toBeGreaterThanOrEqual(7);
          expect(conversation.hour, where).toBeLessThanOrEqual(20);
        }
      }
    });

    it("opens each thread with a QUESTION short enough to be its own title", () => {
      /* the pack carries no title: the product derives one from the first
         question and never rewrites it (sessions.ts, rule 3). That makes the
         first line a title, so a first line that arrives at the sidebar with
         an ellipsis is a demo the presenter has to explain. */
      for (const pack of ALL_PACKS) {
        for (const conversation of pack.conversations) {
          const first = conversation.turns[0]!;
          const where = `${pack.language}/${conversation.key}`;
          expect(first.role, where).toBe("user");
          expect(titleFrom(first.text), where).toBe(first.text);
          expect(first.text, where).not.toContain("\n");
        }
        /* and no two conversations wear the same name in the sidebar */
        const titles = pack.conversations.map((c) => titleFrom(c.turns[0]!.text));
        expect(new Set(titles).size, pack.language).toBe(titles.length);
      }
    });

    it("alternates turns, human first", () => {
      for (const pack of ALL_PACKS) {
        for (const conversation of pack.conversations) {
          const roles = conversation.turns.map((t) => t.role);
          expect(roles, `${pack.language}/${conversation.key}`).toEqual(
            roles.map((_, i) => (i % 2 === 0 ? "user" : "assistant")),
          );
        }
      }
    });

    it("is five DIFFERENT shapes of ask, not five of one", () => {
      /* the point of a seeded history is that the assistant answered a week,
         not a question. Written as properties rather than as a count, so a
         later edit that quietly made them uniform fails here. */
      for (const pack of ALL_PACKS) {
        const lengths = pack.conversations.map((c) => c.turns.length);
        expect(new Set(lengths).size, pack.language).toBeGreaterThanOrEqual(3);
        /* one abandoned after a single message — a real state (an assistant
           turn is written only when a run produced text) and the one shape a
           tidy fixture never has */
        expect(lengths, pack.language).toContain(1);
        /* one long enough to have been worked at */
        expect(Math.max(...lengths), pack.language).toBeGreaterThanOrEqual(5);
        /* one answer that came back as a TABLE — a header row and a
           separator row, which is what remark-gfm needs to render one */
        const tables = pack.conversations.filter((c) =>
          c.turns.some((t) => t.role === "assistant" && /\n\| *-+ *\|/.test(t.text)));
        expect(tables, pack.language).toHaveLength(1);
        /* one that talks about a specific recording, and one that does not
           talk about any — the field the timeline test reads */
        expect(pack.conversations.some((c) => c.afterRecord !== null), pack.language).toBe(true);
        expect(pack.conversations.some((c) => c.afterRecord === null), pack.language).toBe(true);
      }
    });

    it("says nothing the demo DATE could make false", () => {
      /* the dialogue's own rule, applied to prose nobody re-records: the pack
         is read on a day the operator picks, so "the demo is tomorrow" is
         wrong on every demo date but one and nothing in the product can
         correct it. Weekday names survive; relative days do not. */
      const relative = {
        en: /\b(today|tomorrow|yesterday|next week|last night)\b/i,
        fa: /(امروز|فردا|دیروز|هفتهٔ آینده|هفته آینده|دیشب)/,
      } as const;
      /* the control: the pattern must be able to MATCH, or "no offenders"
         is a question that could only ever have passed */
      expect(relative.en.test("the demo is tomorrow")).toBe(true);
      expect(relative.fa.test("دمو فردا است")).toBe(true);
      for (const pack of ALL_PACKS) {
        for (const conversation of pack.conversations) {
          for (const turn of conversation.turns) {
            expect(turn.text, `${pack.language}/${conversation.key}`)
              .not.toMatch(relative[pack.language]);
          }
        }
      }
    });

    describe("being about THIS organisation", () => {
      /* the failure this catches is the one that renders perfectly: five
         well-written conversations about no company in particular. Every
         thread has to name something the seeded org actually contains. */
      const nouns = (pack: DemoPack) => [
        ...pack.glossary,
        ...pack.people.map((p) => p.displayName),
        ...pack.outsiders.map((o) => o.displayName),
      ];

      it("names one of the org's own people, customers or codenames in every thread", () => {
        for (const pack of ALL_PACKS) {
          for (const conversation of pack.conversations) {
            const said = conversation.turns.map((t) => t.text).join("\n");
            const hits = nouns(pack).filter((noun) => said.includes(noun));
            expect(hits, `${pack.language}/${conversation.key}`).not.toEqual([]);
          }
        }
      });

      it("cannot say yes to prose that names nothing — the control", () => {
        /* without this, the check above is satisfied by a noun list so
           generic that any sentence matches it, and it would report a demo
           about somebody else as a demo about this org */
        const generic = {
          en: "Sure — here is a summary of your week. Tell me if you want more detail.",
          fa: "بله — این خلاصهٔ هفتهٔ شماست. اگر جزئیات بیشتری خواستید بگویید.",
        } as const;
        for (const pack of ALL_PACKS) {
          expect(
            nouns(pack).filter((noun) => generic[pack.language].includes(noun)),
            pack.language,
          ).toEqual([]);
        }
      });

      it("keeps its facts straight: the board table counts the board's own open cards", () => {
        /* the one answer that states NUMBERS about rows this same pack
           carries. A card moved to another owner, or an open card added,
           makes the table on screen disagree with the board next to it —
           and nothing else in the suite would notice. */
        for (const pack of ALL_PACKS) {
          const table = pack.conversations
            .flatMap((c) => c.turns)
            .find((t) => /\n\| *-+ *\|/.test(t.text))!;
          expect(table, pack.language).toBeDefined();
          const rows = table.text.split("\n").filter((line) => line.startsWith("|")).slice(2);
          expect(rows, pack.language).toHaveLength(pack.people.length);
          for (const person of pack.people) {
            const row = rows.find((r) => r.includes(person.displayName));
            expect(row, `${pack.language}/${person.key}`).toBeDefined();
            const open = pack.tasks.filter((t) => !t.done && t.assignee === person.key).length;
            /* the cell is written in the pack's own digits — Persian on a
               Persian screen — so the count is compared after folding them */
            const cells = row!.split("|").map((c) => foldDigits(c.trim()));
            expect(cells, `${pack.language}/${person.key}`).toContain(String(open));
          }
        }
      });
    });
  });

  describe("the summary the meeting's items are sliced out of", () => {
    for (const pack of ALL_PACKS) {
      for (const record of pack.records) {
        const where = `${pack.language}/${record.key}`;

        it(`${where}: slices into exactly the items the pack declares`, () => {
          const sliced = sliceSummary(record.summary);
          expect(sliced).toHaveLength(record.items.length);
          expect(sliced.map((s) => s.kind)).toEqual(record.items.map((i) => i.kind));
        });

        it(`${where}: gives every action line an owner the extractor reads`, () => {
          const actions = sliceSummary(record.summary).filter((s) => s.kind === "action");
          expect(actions.length).toBeGreaterThan(0);
          for (const action of actions) {
            expect(action.owner, action.body).not.toBeNull();
            /* and the owner is somebody this organisation contains — an
               action assigned to a name nobody has is worse than one with
               no owner, because it looks assigned */
            const names = [
              ...pack.people.map((p) => p.displayName),
              ...pack.outsiders.map((o) => o.displayName),
            ];
            expect(names, action.body).toContain(action.owner);
          }
        });

        it(`${where}: gives a DECISION no owner`, () => {
          /* db/0160's rule: only an action carries a person. A decision that
             arrived with an owner would file somebody a task they never
             agreed to. */
          const decisions = sliceSummary(record.summary).filter((s) => s.kind === "decision");
          expect(decisions.length).toBeGreaterThan(0);
          for (const decision of decisions) expect(decision.owner).toBeNull();
        });

        it(`${where}: every item points at a line the record actually has`, () => {
          for (const item of record.items) {
            expect(item.line).toBeGreaterThanOrEqual(0);
            expect(item.line).toBeLessThan(record.lines.length);
          }
        });
      }
    }

    it("stops finding anything when the headings go — the control", () => {
      /* Without this, every assertion above is satisfied by an extractor that
         found the lines for some other reason. Strip the two headings and the
         same body must yield NOTHING. */
      for (const pack of ALL_PACKS) {
        for (const record of pack.records) {
          const headless = record.summary
            .split("\n")
            .filter((line) => !line.trim().endsWith(":"))
            .join("\n");
          expect(sliceSummary(headless), `${pack.language}/${record.key}`).toHaveLength(0);
        }
      }
    });

    it("reads an owner off the marker and not off the sentence", () => {
      /* the marker is a CONTRACT with splitOwner; pinned in both scripts so a
         rephrasing that drops the dash is caught here rather than on a screen */
      expect(splitOwner("Write the checklist — owner: Alex Turner")).toEqual({
        body: "Write the checklist", owner: "Alex Turner",
      });
      expect(splitOwner("نوشتن چک‌لیست — مسئول: علی نجفی")).toEqual({
        body: "نوشتن چک‌لیست", owner: "علی نجفی",
      });
    });
  });

  describe("the measured audio", () => {
    for (const pack of ALL_PACKS) {
      for (const record of pack.records) {
        const where = `${pack.language}/${record.key}`;

        it(`${where}: has one measured timing per written line`, () => {
          expect(record.audio.lines).toHaveLength(record.lines.length);
        });

        it(`${where}: runs forwards, inside its parts`, () => {
          expect(record.audio.parts.length).toBeGreaterThan(0);
          let previousEnd = -1;
          for (const line of record.audio.lines) {
            expect(line.endMs).toBeGreaterThan(line.startMs);
            expect(line.startMs).toBeGreaterThan(previousEnd);
            previousEnd = line.endMs;
            const part = record.audio.parts.find((p) => p.idx === line.partIdx);
            expect(part, `line in part ${line.partIdx}`).toBeDefined();
            expect(line.endMs).toBeLessThanOrEqual(part!.offsetMs + part!.durationMs);
          }
        });

        it(`${where}: names bytes that were actually measured`, () => {
          for (const part of record.audio.parts) {
            expect(part.byteSize).toBeGreaterThan(1000);
            expect(part.sha256).toMatch(/^[0-9a-f]{64}$/);
            /* 16 kHz mono 16-bit PCM plus a 44-byte header: the byte count
               and the duration are two measurements of one clip, and a
               disagreement means the splice drifted */
            const fromBytes = Math.round(((part.byteSize - 44) / 2 / 16000) * 1000);
            expect(Math.abs(fromBytes - part.durationMs)).toBeLessThanOrEqual(5);
          }
          expect(record.audio.totalMs).toBeGreaterThan(30_000);
        });
      }
    }
  });
});
