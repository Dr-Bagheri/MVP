/**
 * THE WORKING SET — what "it" refers to.
 *
 * User report, 2026-09-19: "I continue to tell it to move it, the next
 * sentence is probably about the same thing, but this logic does not come and
 * it will get lost — and it does not even ask if I meant this."
 *
 * The rules this holds in place are the ones a plausible implementation gets
 * quietly wrong: the NEWEST thing is the likeliest referent, a failed act
 * still makes its object the subject, an id with no words beside it is not a
 * subject at all, and the block says to ASK when two candidates fit.
 */
import { describe, expect, it } from "vitest";

import {
  MAX_SUBJECTS, subjectBlock, subjectsFromSteps, workingSet, type RecordedStep,
} from "../src/agent/subjects.ts";
import { CLIENT_TOOLS } from "../src/agent/client-tools.ts";

/** transcribed from a real `agent_run.steps` on production, 2026-09-18 */
const REAL: RecordedStep[] = [
  { ms: 51, seq: 0, args: {}, tool: "list_tasks", detail: "1854b", outcome: "ok" } as RecordedStep,
  {
    ms: 6057, seq: 1, tool: "delete_task", detail: "42b", outcome: "ok",
    args: { title: "کارهای فعلی شرکت", task_id: "20228d01-8ec6-403c-8304-20b9014a84b3" },
  } as RecordedStep,
];

describe("reading the subject out of what was recorded", () => {
  it("finds the thing a real recorded step touched, id and words together", () => {
    /* the fixture is a transcribed production row rather than a hand-written
       shape: a step I invent agrees with whatever this parser expects */
    expect(subjectsFromSteps(REAL)).toEqual([
      { kind: "task", id: "20228d01-8ec6-403c-8304-20b9014a84b3", label: "کارهای فعلی شرکت" },
    ]);
  });

  it("takes the kind from the TOOL, so one label cannot be three things", () => {
    /*
     * The bug this file caught on its first run, and the reason it is pinned
     * here rather than trusted: `title` is an argument of the task tools, the
     * meeting tools AND the record tools, so a parser that let the ARGUMENTS
     * decide returned one `delete_task` step as three subjects — the same
     * words as a task, a meeting and a record.
     *
     * Two tools, two kinds, ONE shared label. A version that picks a fixed
     * kind, or picks by argument, fails on exactly one of these two lines —
     * which is what makes the pair a test rather than an example.
     */
    const steps: RecordedStep[] = [
      { tool: "update_task", args: { task_id: "t-1", title: "همین عنوان" } },
      { tool: "update_meeting", args: { meeting_id: "m-1", title: "همین عنوان" } },
    ];
    expect(subjectsFromSteps(steps)).toEqual([
      { kind: "task", id: "t-1", label: "همین عنوان" },
      { kind: "meeting", id: "m-1", label: "همین عنوان" },
    ]);
  });

  it("ignores an id with NO WORDS beside it", () => {
    // a bare uuid in front of a model is an invitation to quote one back at a
    // person — the database key where a name goes, which this product has
    // already shipped once on a transcript
    expect(subjectsFromSteps([{ tool: "get_task", args: { task_id: "t-1" } }])).toEqual([]);
  });

  it("walks past a step that is not an object at all", () => {
    /*
     * `agent_run.steps` is jsonb written by every version of this product
     * going back months, and it is read here with no schema in front of it.
     * A row holding a bare string or a null is not a shape to reject loudly —
     * it is one step of one old conversation, and the working set's job is to
     * carry on and name whatever IS readable. Throwing here would take out
     * the whole ask for a courtesy.
     */
    const steps = [null, "list_tasks", 7, { tool: "update_task", args: { task_id: "t-1", title: "کار" } }];
    expect(subjectsFromSteps(steps).map((s) => s.label)).toEqual(["کار"]);
  });

  it("keeps the subject of a FAILED act", () => {
    /* "I tried to move that task and it was refused" leaves the task more the
       subject of the conversation, not less — the next sentence is about the
       failure */
    const steps: RecordedStep[] = [
      { tool: "update_task", outcome: "error", args: { task_id: "t-9", title: "گزارش هفتگی" } },
    ];
    expect(subjectsFromSteps(steps).map((s) => s.label)).toEqual(["گزارش هفتگی"]);
  });

  it("puts the NEWEST first across runs, and says each thing once", () => {
    /* the order is the whole mechanism: a model reading a list weights its
       top, and the last thing touched is the likeliest "it" */
    const older: RecordedStep[] = [{ tool: "create_project", args: { project_id: "p-1", name: "دیتابیس صوتی" } }];
    const newer: RecordedStep[] = [
      { tool: "create_task", args: { task_id: "t-1", title: "جمع‌آوری صدا" } },
      { tool: "update_task", args: { task_id: "t-2", title: "لیبل‌زنی" } },
    ];
    /* runs arrive oldest-first, as the conversation happened */
    expect(workingSet([older, newer]).map((s) => s.label))
      .toEqual(["لیبل‌زنی", "جمع‌آوری صدا", "دیتابیس صوتی"]);

    /* and a thing touched twice is named ONCE — same kind, same id, two runs.
       (The first draft of this line used one id under two different KINDS and
       expected one subject: a task and a project that happen to share an id
       string are two things, and the key is the pair.) */
    const twice: RecordedStep[] = [{ tool: "update_task", args: { task_id: "t-1", title: "جمع‌آوری صدا" } }];
    expect(workingSet([newer, twice]).filter((s) => s.id === "t-1")).toHaveLength(1);
  });

  it("stops at the ceiling, so the block stays short", () => {
    // the point of this block is that it is SMALL against a 45k-token prompt;
    // a working set that grew with the conversation would be the problem again
    const many: RecordedStep[] = Array.from({ length: 20 }, (_, i) =>
      ({ tool: "update_task", args: { task_id: `t-${i}`, title: `کار ${i}` } }));
    expect(workingSet([many])).toHaveLength(MAX_SUBJECTS);
  });
});

describe("the block the model reads", () => {
  it("says nothing at all when nothing has been touched", () => {
    // an empty heading is worse than no heading: it tells a model there is a
    // subject and then does not name one
    expect(subjectBlock([], "fa")).toBe("");
  });

  it("names each subject in words, and tells the model to ASK when two fit", () => {
    const block = subjectBlock([
      { kind: "task", id: "t-1", label: "جمع‌آوری صدا" },
      { kind: "project", id: "p-1", label: "دیتابیس صوتی" },
    ], "fa");
    expect(block).toContain("جمع‌آوری صدا");
    expect(block).toContain("t-1");
    expect(block).toContain("تسک");
    expect(block).toContain("پروژه");
    /* the half the user asked for by name: "it does not even ask if i meant
       this". A block that only listed candidates would satisfy every line
       above and still guess. */
    expect(block).toMatch(/ASK which/);
  });

  it("reads in the language the person is reading", () => {
    const en = subjectBlock([{ kind: "meeting", id: "m-1", label: "Weekly" }], "en");
    expect(en).toContain("meeting «Weekly»");
    expect(en).not.toContain("جلسه");
  });
});

describe("the field map is not a guess", () => {
  it("every argument name it looks for is one a REAL tool takes", () => {
    /*
     * The map is hand-written — which argument names a subject is a judgement
     * about each tool's shape, not something the registry states. So the
     * thing that can rot is the NAMES, and this is what stops them rotting
     * silently: a rename in client-tools.ts leaves this parser reading
     * nothing at all, and a working set that quietly finds no subjects looks
     * exactly like a conversation that has not touched anything yet.
     */
    const declared = new Set<string>();
    for (const spec of CLIENT_TOOLS) {
      const params = spec.parameters as { properties?: Record<string, unknown> };
      for (const key of Object.keys(params.properties ?? {})) declared.add(key);
    }
    /* every name the map reads, id and label alike. This list IS the map,
       written out — and that is deliberate: a version that looped over the
       map itself would compare it with itself and pass forever. */
    for (const key of ["task_id", "meeting_id", "record_id",
                       "title", "new_title", "project", "meeting", "record", "colleague"]) {
      expect(declared.has(key), `no client tool takes ${key} any more`).toBe(true);
    }
  });
});
