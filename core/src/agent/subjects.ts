/**
 * WHAT THIS CONVERSATION IS ABOUT RIGHT NOW.
 *
 * User report, 2026-09-19: "when I am talking with it and I continue to tell
 * it to move it, the next sentence is probably about the same thing, but this
 * logic does not come and it will get lost — and it does not even ask if I
 * meant this."
 *
 * ── the diagnosis, measured rather than guessed ───────────────────────────
 *
 * The conversation IS in the prompt — the whole recent thread, verbatim, up
 * to 12k characters. The problem is not that the history is missing, it is
 * that it is 1% of the input. A turn from the assistant page was measured on
 * production at 44,939 input tokens, of which ~15,000 is the JSON schemas of
 * 101 client tools. The two sentences that decide what "it" refers to are a
 * rounding error in that, and a model asked to resolve a pronoun against a
 * 45k-token wall of tool definitions will sometimes pick nothing.
 *
 * Adding MORE context is the obvious move and the wrong one. What is needed
 * is a small, sharp, explicit statement of the SUBJECT, placed where a model
 * reads last.
 *
 * ── it is DERIVED, so there is nothing to keep in sync ────────────────────
 *
 * `agent_run.steps` already records every tool call's arguments, and the
 * task, project and meeting tools carry the subject's TITLE beside its id —
 * they have since the consent card was made to name its object rather than
 * its verb. So the working set is rebuilt from what is already written down,
 * on every turn. No table, no migration, and nothing that can go stale
 * against the thing it describes (rule 6: the derived artifact is rebuilt,
 * never stored beside its source).
 *
 * A renamed task therefore shows its OLD title here until it is touched
 * again, and that is correct: this block is a record of what was discussed,
 * not a live read of the object.
 */

export type SubjectKind = "task" | "project" | "meeting" | "record" | "person";

export interface Subject {
  kind: SubjectKind;
  /** present when the tool addressed it by id; a project is addressed by NAME */
  id?: string;
  /** the words the person saw — a title, a name — never an id on its own */
  label: string;
}

/**
 * One recorded tool call, the shape `agent_run.steps` holds.
 *
 * Every field is `unknown` and the reader guards each one, because this
 * arrives out of a jsonb column: the rows were written by versions of the
 * worker and the api going back months, and the only honest claim about a
 * step is that it is some object. So the ENTRY POINTS take `unknown` and the
 * narrowing happens here, rather than a caller writing `as` at the boundary —
 * a cast against someone else's shape is a drift report somebody decided not
 * to file, and this file is the one place that knows what a step looks like.
 */
export interface RecordedStep {
  tool?: unknown;
  args?: unknown;
  outcome?: unknown;
}

/**
 * How each kind is SPELLED in a tool's arguments.
 *
 * ── this map was a guess and its own test caught it ───────────────────────
 *
 * The first draft read `project_id`, `meeting_title`, `call_title` — plausible
 * names, none of which any tool takes. The registry says: a project is
 * addressed by `project` (its NAME), a record by `record` or `record_id`, a
 * colleague by `colleague` (a name, no id at all). So the LABEL is the
 * required half and the id is the optional one, which is the right way round
 * anyway: what a model needs to resolve "it" is the words the person saw.
 *
 * Hand-written rather than derived, because the registry does not carry this
 * fact — which argument names the subject is a judgement about each tool's
 * shape, and a derived version would be a guess wearing a mechanism's
 * clothes. What IS mechanised is that every name here exists: the test
 * asserts each against the live registry, because a rename there would leave
 * this reading nothing, and a working set that finds no subjects looks
 * exactly like a conversation that has not touched anything yet.
 */
const FIELDS: readonly {
  kind: SubjectKind; when: RegExp; id?: string; label: readonly string[];
}[] = [
  { kind: "task", when: /task/, id: "task_id", label: ["title", "new_title"] },
  { kind: "meeting", when: /meeting/, id: "meeting_id", label: ["title", "meeting"] },
  { kind: "record", when: /record|call|transcript|summar|speaker/, id: "record_id", label: ["record", "title"] },
  { kind: "project", when: /project/, label: ["project", "name"] },
  { kind: "person", when: /colleague|member|message|telegram/, label: ["colleague"] },
];

/** How many subjects the block may name. */
export const MAX_SUBJECTS = 5;

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null;

/**
 * The subjects a run's steps touched, most recent FIRST.
 *
 * Failed calls count. "I tried to move that task and it was refused" leaves
 * the task exactly as much the subject of the conversation as a success does
 * — more so, because the next sentence is likely to be about the failure.
 */
export function subjectsFromSteps(steps: readonly unknown[]): Subject[] {
  const out: Subject[] = [];
  for (const raw of steps) {
    if (raw === null || typeof raw !== "object") continue;
    const step = raw as RecordedStep;
    const args = step.args;
    if (args === null || typeof args !== "object") continue;
    const tool = text(step.tool);
    if (tool === null) continue;
    const bag = args as Record<string, unknown>;

    /*
     * THE TOOL DECIDES THE KIND, and the first draft let the ARGUMENTS decide
     * — which its own test caught against a transcribed production row. One
     * `delete_task` step came back as three subjects: `title` is an argument
     * of the task tools, the meeting tools AND the record tools, so every
     * generic label matched every kind and the same words appeared as a task,
     * a meeting and a record. A label cannot say what something IS.
     *
     * One subject per step, therefore, chosen by the tool's own name. A step
     * that also mentions something else — `create_task` with a `project` —
     * yields the thing being acted on, which is the one the next sentence is
     * about; the other appears when a tool of its own kind touches it.
     */
    const field = FIELDS.find((f) => f.when.test(tool));
    if (field === undefined) continue;

    /*
     * THE LABEL IS THE REQUIRED HALF. An id with no words beside it is not a
     * subject: putting a bare uuid in front of a model invites it to quote
     * one back at a person, which is the database key where a name goes — a
     * bug this product has already shipped once, on a transcript. The id
     * rides along when the tool took one, so an act can address the thing
     * exactly rather than by a name that may match two rows.
     */
    const label = field.label.map((key) => text(bag[key])).find((v) => v !== null) ?? null;
    if (label === null) continue;
    const id = field.id === undefined ? null : text(bag[field.id]);
    out.push({ kind: field.kind, ...(id === null ? {} : { id }), label });
  }
  return out;
}

/**
 * The working set across several runs, newest run first, deduplicated by id.
 *
 * The caller passes runs in the order the conversation happened; this reverses
 * them, because the LAST thing touched is the likeliest referent and a model
 * reading a list weights the top of it.
 */
export function workingSet(runs: readonly (readonly unknown[])[]): Subject[] {
  const seen = new Set<string>();
  const out: Subject[] = [];
  for (const steps of [...runs].reverse()) {
    for (const subject of subjectsFromSteps(steps).reverse()) {
      const key = `${subject.kind}:${subject.id ?? subject.label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(subject);
      if (out.length >= MAX_SUBJECTS) return out;
    }
  }
  return out;
}

const NOUN: Record<SubjectKind, { fa: string; en: string }> = {
  task: { fa: "تسک", en: "task" },
  project: { fa: "پروژه", en: "project" },
  meeting: { fa: "جلسه", en: "meeting" },
  record: { fa: "رکورد", en: "record" },
  person: { fa: "همکار", en: "colleague" },
};

/**
 * The block, or "" when there is nothing to say.
 *
 * ── two rules, and the second is the one the user actually asked for ──────
 *
 * The first is that "it" has candidates and they are named. The second is
 * that when more than one fits, the answer is a QUESTION — "did you mean the
 * task or the project?" — rather than a guess. A wrong guess here is not a
 * wrong answer, it is an ACT on the wrong object, and this product has
 * already paid for one of those.
 *
 * Said POSITIVELY throughout, because this string is read by the same model
 * that the 2026-09-06 guard exists for: a prompt that teaches a model what it
 * cannot do teaches it to plead.
 */
export function subjectBlock(subjects: readonly Subject[], locale: string): string {
  if (subjects.length === 0) return "";
  const fa = locale !== "en";
  const lines = subjects.map((s) => `- ${fa ? NOUN[s.kind].fa : NOUN[s.kind].en} «${s.label}»`
    + (s.id === undefined ? "" : ` (${s.kind}_id: ${s.id})`));
  return [
    "WHAT THIS CONVERSATION IS ABOUT. These are the things you and this person",
    "have touched in this conversation, most recent first:",
    "",
    ...lines,
    "",
    "When they say «آن», «اون», «همین», \"it\", \"that one\", \"this task\" and do",
    "not name which, the top of this list is almost always what they mean, and",
    "you may act on it. When TWO of them could fit the sentence, ASK which —",
    "one short question naming both — and wait. Acting on the wrong object is",
    "not a wrong answer, it is a wrong act, and it is the one mistake here that",
    "cannot be taken back by saying sorry.",
  ].join("\n");
}
