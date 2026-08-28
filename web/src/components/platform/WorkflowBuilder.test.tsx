import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WORKFLOW_EVENTS } from "@echo/core/vocabulary";

/**
 * The builder is a PUZZLE, and every assertion here is about the property a
 * screenshot cannot show.
 *
 * Three of the four are about arrangement rather than presence: where a new
 * step LANDS (a version that always appends renders identically and passes
 * any count-based check), whether a kind swap KEEPS the step's identity, and
 * whether the `web` option is bound to the one kind the validator accepts it
 * on. The fourth is about the refusal: core's sentence names the step and
 * the rule, and a paraphrase — or a tidy "something went wrong" — would name
 * neither while looking better.
 *
 * Each was verified RED before being trusted; the failure each one produced
 * is written above it.
 */

const REFUSAL = "invalid graph at step s1: search needs a known scope";

const created = { id: "w1", name: "پیگیری", description: "", enabled: false,
  handle: "wf-1", trigger_event: null, current_version: null,
  current_version_id: null, versions: 0, created_at: "2026-08-28T10:00:00.000Z" };

const publish = vi.fn(async () => ({ version: 1, version_id: "v1" }));

vi.mock("@/api/client", () => ({
  api: {
    createAuthoredWorkflow: async () => created,
    publishWorkflow: (...args: unknown[]) => publish(...(args as [])),
    patchWorkflow: async () => created,
    workflowGraph: async () => ({ graph: { entry: "s1", steps: [] }, max_autonomy: "assist" }),
  },
}));

const { WorkflowBuilder, cleanStep } = await import("./WorkflowBuilder");

/** the ids in the order they are RENDERED — the whole point of these tests */
function stepIds(): string[] {
  return screen
    .queryAllByRole("textbox", { name: /شناسهٔ گام/ })
    .map((input) => (input as HTMLInputElement).value);
}

/** the `+` on each connector line, in document order: index === position */
function inserts(): HTMLElement[] {
  return screen.getAllByRole("button", { name: /افزودن گام در جایگاه/ });
}

function openMenu(name: string | RegExp) {
  fireEvent.click(screen.getByRole("button", { name }));
}

beforeEach(() => {
  cleanup();
  publish.mockClear();
});

describe("the workflow builder", () => {
  it("inserts a step AT the connector that was pressed, not at the end", () => {
    /* verify-red: with `insertStep` appending (`[...prev, fresh]`) this read
       `expected [ 's1', 's2', 's3' ] to deeply equal [ 's1', 's3', 's2' ]` —
       the count is identical in both versions, which is exactly why the
       assertion is on the ORDER. */
    render(<WorkflowBuilder onClose={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "افزودن گام" }));
    expect(stepIds()).toEqual(["s1"]);

    // the connector after the only card → a second step at the end
    fireEvent.click(inserts()[1]!);
    expect(stepIds()).toEqual(["s1", "s2"]);

    // now the connector BETWEEN them: the new step must land in the middle
    fireEvent.click(inserts()[1]!);
    expect(stepIds()).toEqual(["s1", "s3", "s2"]);
  });

  it("swaps a step's fields when its kind changes, and keeps its id", async () => {
    /*
     * The screen half of this cannot fail for the right reason on its own:
     * fields are rendered BY KIND, so a version that keeps every old value in
     * the draft still draws the new kind's boxes and looks perfect. The
     * leftovers only become visible where they do damage — on the wire, on a
     * key the NEW kind also owns. `decide.on` is a path; `wait.on` is a wait
     * kind; the same name, two grammars.
     *
     * verify-red: with the swap written the obvious way — `patchStep(index,
     * "kind", value)`, which is what this editor replaced — the published
     * step read
     *   `expected [ { id: 's1', kind: 'wait', …(1) } ] to deeply equal
     *    [ { id: 's1', kind: 'wait', …(1) } ]`
     * over the diff `- "on": "decision"` / `+ "on": "trigger"` — and core
     * would have refused that graph with "wait needs decision | until |
     * signal".
     */
    render(<WorkflowBuilder onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "افزودن گام" }));

    // a fresh step is a `search`: it has a scope, and no condition
    expect(screen.queryAllByRole("button", { name: "دامنه — s1" })).toHaveLength(1);
    expect(screen.queryAllByRole("button", { name: "شرط — s1" })).toHaveLength(0);

    openMenu("نوع گام — s1");
    fireEvent.click(screen.getByRole("option", { name: "تصمیم" }));
    expect(screen.queryAllByRole("button", { name: "دامنه — s1" })).toHaveLength(0);
    expect(screen.queryAllByRole("button", { name: "شرط — s1" })).toHaveLength(1);

    // give `on` a value, so the leftover would be a real one
    openMenu("روی مقدار — s1");
    fireEvent.click(screen.getByRole("option", { name: "آغازگر اجرا" }));

    openMenu("نوع گام — s1");
    fireEvent.click(screen.getByRole("option", { name: "انتظار تصمیم انسان" }));

    expect(stepIds()).toEqual(["s1"]);                       // the id survives
    expect(screen.queryAllByRole("button", { name: "شرط — s1" })).toHaveLength(0);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "ذخیرهٔ گردش‌کار" }));
    });
    const [, body] = publish.mock.calls[0] as unknown as [string, { graph: {
      entry: string; steps: Record<string, unknown>[] } }];
    expect(body.graph.steps).toEqual([{ id: "s1", kind: "wait", on: "decision" }]);
  });

  it("offers the web option on `ask` and on nothing else", () => {
    /*
     * verify-red, both directions. Rendering the toggle unconditionally made
     * the first expectation read `expected null not to be null`… inverted:
     * `expected <button /> to be null`. Rendering it on no kind at all made
     * the second read `Unable to find an accessible element with the role
     * "button" and name "جست‌وجوی اینترنت"`.
     *
     * One question that must answer NO and one that must answer YES — the
     * pair is what separates "the control exists" from "the control is bound
     * to the kind the validator accepts it on".
     */
    render(<WorkflowBuilder onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "افزودن گام" }));

    expect(screen.queryByRole("button", { name: "جست‌وجوی اینترنت" })).toBeNull();

    openMenu("نوع گام — s1");
    fireEvent.click(screen.getByRole("option", { name: "پرسش از دستیار" }));

    const toggle = screen.getByRole("button", { name: "جست‌وجوی اینترنت" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "جست‌وجوی اینترنت" })
      .getAttribute("aria-pressed")).toBe("true");
  });

  it("renders the server's refusal verbatim", async () => {
    /* verify-red: falling back to the local `saveFailed` string made this
       read `expected 'ذخیره نشد.' to be 'invalid graph at step s1: search
       needs a known scope'` — the local sentence names neither the step nor
       the rule, which is the entire reason the server's own words travel. */
    publish.mockRejectedValueOnce(Object.assign(new Error("bff 400"), { detail: REFUSAL }));

    render(<WorkflowBuilder onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "افزودن گام" }));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "ذخیرهٔ گردش‌کار" }));
    });

    expect(screen.getByRole("alert").textContent).toBe(REFUSAL);
  });
});

/**
 * **A mail-reply graph survives being opened and saved.**
 *
 * This is what "editable" has to mean. `cleanStep` whitelists the keys a
 * kind owns, so a kind whose new fields were never added to that list loses
 * them silently on save — the editor opens, the person changes a word, and
 * the reply's recipient quietly disappears from the graph. The server would
 * refuse the result, which is the good half; the bad half is that the
 * workflow can no longer be edited at all, which is exactly the thing this
 * feature exists to provide.
 */
describe("the draft_mail step round-trips", () => {
  it("keeps the fields that address the reply", () => {
    const step = {
      id: "s4", kind: "propose", proposal: "draft_mail",
      message: "{{s1.id}}", to: "{{s1.reply_to}}", subject: "{{s1.subject}}",
      from: "{{s2.body}}",
    };
    expect(cleanStep(step)).toEqual({
      id: "s4", kind: "propose", proposal: "draft_mail",
      message: "{{s1.id}}", to: "{{s1.reply_to}}", subject: "{{s1.subject}}",
      from: "{{s2.body}}",
    });
  });

  it("keeps tools:none on a model step", () => {
    /* the server REQUIRES it on any graph that drafts mail, so dropping it
       here would make every mail workflow unsaveable after one edit */
    expect(cleanStep({ id: "s2", kind: "extract", schema: "mail_reply_v1", tools: "none", from: "{{s1.body}}" }))
      .toMatchObject({ tools: "none" });
  });

  it("still drops a key the kind does not own — the control", () => {
    /* without this, "keep everything" passes both checks above and the
       whitelist stops being a whitelist */
    expect(cleanStep({ id: "s4", kind: "propose", proposal: "add_tags", from: "{{s2.topics}}", call: "{{trigger.call_id}}", nonsense: "x" }))
      .not.toHaveProperty("nonsense");
  });
});

/**
 * Every trigger event has its own sentence, in both locales.
 *
 * The picker's label key is COMPUTED (`event_${name}`), which makes it
 * invisible to keys.test (it skips computed keys, by design) — and that is
 * exactly how the picker rendered "After a meeting is summarized" twice the
 * day `mail.received` joined: the second event fell back onto the first's
 * hardcoded key and nothing went red. The coverage list derives from the
 * PRODUCER (rule 13½), so a sixth event fails this test until someone
 * writes its two sentences.
 *
 * Distinctness is asserted too: five events sharing one sentence is the
 * original bug wearing full coverage.
 */
describe("the event picker's catalogue", () => {
  const fs = require("node:fs") as typeof import("node:fs");
  const path = require("node:path") as typeof import("node:path");
  const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1"));
  for (const locale of ["fa", "en"] as const) {
    it(`names every event in ${locale}`, () => {
      const messages = JSON.parse(fs.readFileSync(
        path.join(here, "..", "..", "messages", `${locale}.json`), "utf8"));
      const labels = WORKFLOW_EVENTS.map((event) => {
        const key = `event_${event.replace(".", "_")}`;
        const label = messages.builder[key];
        expect(typeof label, `${locale}: builder.${key} is missing`).toBe("string");
        return label as string;
      });
      expect(new Set(labels).size, `${locale}: two events share one sentence`)
        .toBe(labels.length);
    });
  }
});
