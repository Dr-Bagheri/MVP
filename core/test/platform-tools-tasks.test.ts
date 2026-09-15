import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * WHO A TASK BELONGS TO, IN AN ANSWER.
 *
 * The board's own record names its people by id, because the SCREEN resolves
 * them against a roster it fetched once. `list_tasks` published that record
 * unchanged, so a model asked who is carrying what answered with UUIDs — a
 * production answer on 2026-09-09 put `fa54eda9-…` in an "Assigned To"
 * column, one row of it being the id of the person reading the table.
 *
 * The repos are faked at the module seam (rule 11: what is under test is the
 * tool's own resolution, not `people()`'s SQL or RLS — those have their own
 * tests). The fixture is the shape the repos publish: ids everywhere, and a
 * roster whose order deliberately disagrees with the cards, so a name that
 * arrives is evidence of a lookup rather than of a coincidence.
 */
const board = vi.fn();
const detail = vi.fn();
const people = vi.fn();
const projects = vi.fn();

vi.mock("../src/api/tasks.ts", () => ({ createTasksRepo: () => ({ board, detail, people }) }));
vi.mock("../src/api/projects.ts", () => ({ createProjectsRepo: () => ({ list: projects }) }));

const { createPlatformTools, personNames, UNKNOWN_PERSON } = await import(
  "../src/agent/platform-tools.ts"
);

/* real uuids, in the shape the reported answer printed */
const SARAH = "8cb818e8-6bbb-40aa-955a-50b5f35bf5a5";
const RYAN = "fa54eda9-ab86-442f-a3da-95d2c9aed86b";
/* somebody the roster no longer carries — suspended, or tombstoned since the
   card was written */
const GONE = "c4ab8a56-31fc-4689-9fa0-f9b9209d82ff";

/* NOT in the cards' order: a mapper that walked two lists in parallel would
   name the wrong colleague and pass every "a name appeared" assertion */
const ROSTER = [
  { id: RYAN, display_name: "Ryan Cooper", display_name_en: null },
  { id: SARAH, display_name: "Sarah Mitchell", display_name_en: "Sarah Mitchell" },
];

const CARD = {
  id: "t-1",
  column_id: "col-1",
  topic_id: null,
  title: "Draft Q3 renewal terms",
  priority: "critical",
  due_at: "2026-09-11T12:00:00.000Z",
  done: false,
  created_by: SARAH,
  assignee_ids: [RYAN, GONE],
  labels: [],
  label_ids: [],
};

const BOARD = { columns: [{ id: "col-1", name: "Backlog" }], topics: [], tasks: [CARD] };

const identity = { userId: SARAH, orgId: "o-1", role: "member", isActive: true };
const call = (name: string, args: Record<string, unknown> = {}) =>
  createPlatformTools()
    .find((t) => t.name === name)!
    .run({ identity, deps: { db: {} } } as never, args as never) as Promise<Record<string, unknown>>;

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

beforeEach(() => {
  board.mockReset().mockResolvedValue(BOARD);
  detail.mockReset();
  people.mockReset().mockResolvedValue(ROSTER);
  projects.mockReset().mockResolvedValue([]);
});

describe("personNames", () => {
  it("answers with the name the product displays", () => {
    expect(personNames(ROSTER)(RYAN)).toBe("Ryan Cooper");
  });

  it("does NOT pass an unknown id through — the control", () => {
    /* the tempting fallback is the id itself, which keeps the exact defect
       for precisely the people whose names are hardest to check */
    const nameOf = personNames(ROSTER);
    expect(nameOf(GONE)).toBe(UNKNOWN_PERSON);
    expect(nameOf(null)).toBe(UNKNOWN_PERSON);
    expect(nameOf(GONE)).not.toContain("c4ab8a56");
  });
});

describe("list_tasks", () => {
  it("names the people on a card and publishes no id for any of them", async () => {
    const result = await call("list_tasks");
    const tasks = result.tasks as { items: Record<string, unknown>[] };
    expect(tasks.items[0]!.assignees).toEqual(["Ryan Cooper", UNKNOWN_PERSON]);
    expect(tasks.items[0]!.created_by).toBe("Sarah Mitchell");
    /* the discriminating assertion, and the one that fails against the
       smaller fix: publishing `assignees` BESIDE `assignee_ids` satisfies
       every line above and leaves a uuid in front of the model */
    expect(tasks.items[0]).not.toHaveProperty("assignee_ids");
    expect(JSON.stringify(tasks.items)).not.toMatch(UUID);
  });

  it("still carries what the card IS — the naming is not a redaction", async () => {
    const { items } = (await call("list_tasks")).tasks as { items: Record<string, unknown>[] };
    expect(items[0]!.id).toBe("t-1");
    expect(items[0]!.title).toBe("Draft Q3 renewal terms");
    expect(items[0]!.priority).toBe("critical");
    expect(items[0]!.due_at).toBe("2026-09-11T12:00:00.000Z");
  });

  it("reads the roster under the CALLER's identity", async () => {
    /* a roster read at any other altitude would name colleagues this member
       cannot see — the answer must be as narrow as the person asking */
    await call("list_tasks");
    expect(people).toHaveBeenCalledWith(identity);
  });
});

describe("get_task", () => {
  it("names the assignees, the author of every comment and every event's actor", async () => {
    detail.mockResolvedValue({
      ...CARD,
      description: "",
      checklist: [],
      comments: [{ id: "c-1", body: "on it", created_by: RYAN, created_at: "2026-09-08T09:00:00.000Z" }],
      events: [{ id: "e-1", kind: "assigned", actor_id: SARAH, detail: {}, created_at: "2026-09-08T09:00:00.000Z" }],
      recurrence: null,
    });
    const result = await call("get_task", { task_id: "t-1" });
    expect(result.assignees).toEqual(["Ryan Cooper", UNKNOWN_PERSON]);
    expect((result.comments as { created_by: string }[])[0]!.created_by).toBe("Ryan Cooper");
    /* `actor`, not `actor_id`: a field whose name says id and whose value is
       a name is the two-spellings defect waiting for its first reader */
    expect((result.events as { actor: string }[])[0]!.actor).toBe("Sarah Mitchell");
    expect((result.events as Record<string, unknown>[])[0]).not.toHaveProperty("actor_id");
    expect(JSON.stringify(result)).not.toMatch(UUID);
  });
});

describe("list_projects", () => {
  it("names a project's people — the same defect, one list over", async () => {
    projects.mockResolvedValue([
      {
        id: "p-1", name: "Harbor Bank", summary: "", tone: "blue", icon: null,
        archived_at: null, created_by: SARAH, created_at: "2026-09-01T00:00:00.000Z",
        topic_id: null, member_ids: [SARAH, RYAN], task_total: 2, task_done: 1,
      },
    ]);
    const { items } = (await call("list_projects")) as { items: Record<string, unknown>[] };
    expect(items[0]!.members).toEqual(["Sarah Mitchell", "Ryan Cooper"]);
    expect(items[0]).not.toHaveProperty("member_ids");
    expect(JSON.stringify(items)).not.toMatch(UUID);
  });
});
