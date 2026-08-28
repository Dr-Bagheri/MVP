import { describe, expect, it } from "vitest";
import { validateWorkflowGraph, type ValidateOptions } from "../src/api/workflow-graph.ts";
import { ValidationError } from "../src/api/errors.ts";

/**
 * **The mail flow as a graph, and the rules that make that safe.**
 *
 * The hardcoded poller keeps "the model never chooses the recipient" true
 * because one file takes `to` from the headers and a comment says so. A
 * graph moves that decision to whoever writes the graph — so the rule has to
 * become a property the validator can check, or the first person to bind
 * `to` to a model's output has published a workflow that emails whoever the
 * email told it to.
 *
 * Every refusal here is asserted BY ITS SENTENCE. A check that only knows
 * "something was refused" cannot tell the recipient rule from a typo.
 */

const ACT: ValidateOptions = { maxAutonomy: "act" };

function refusedWith(graph: unknown, fragment: string, options: ValidateOptions = ACT) {
  try {
    validateWorkflowGraph(graph, options);
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).message).toContain(fragment);
    return;
  }
  throw new Error(`expected a refusal naming "${fragment}", but the graph validated`);
}

/** the shipped shape: read the message, decide and write, draft the reply */
function mailGraph(over: Record<string, unknown> = {}) {
  return {
    entry: "s1",
    steps: [
      { id: "s1", kind: "fetch", source_kind: "mail_message", of: "{{trigger.source_ref}}" },
      {
        id: "s2", kind: "extract", schema: "mail_reply_v1", tools: "none",
        from: "{{s1.body}}",
        instruction: "تصمیم بگیر که این پیام پاسخ می‌خواهد و اگر می‌خواهد، پاسخ را بنویس.",
      },
      { id: "s3", kind: "decide", on: "s2.reply", eq: true, then: "s4", else: "__end" },
      {
        id: "s4", kind: "propose", proposal: "draft_mail",
        message: "{{s1.id}}", to: "{{s1.reply_to}}", subject: "{{s1.subject}}",
        from: "{{s2.body}}",
        ...over,
      },
      { id: "s5", kind: "apply", from: "s4" },
    ],
  };
}

describe("a graph may draft a reply", () => {
  it("validates the whole five-step flow", () => {
    expect(() => validateWorkflowGraph(mailGraph(), ACT)).not.toThrow();
  });

  it("refuses a recipient the model wrote", () => {
    /*
     * THE assertion of this file. `s2.body` is an extract output — typed,
     * validated, and still a thing a model produced. The rule is not "no
     * untyped data"; it is "the recipient comes from a header", and only
     * the trust label can tell those apart.
     */
    refusedWith(mailGraph({ to: "{{s2.body}}" }), "draft_mail.to must bind an address");
  });

  it("refuses a recipient from a search, and from a bare message", () => {
    /* the two other shapes someone would reach for: a whole envelope (which
       is content, and contains a body) and another step's prose */
    refusedWith(mailGraph({ to: "{{s1}}" }), "draft_mail.to must bind an address");
    refusedWith(mailGraph({ to: "{{s1.subject}}" }), "draft_mail.to must bind an address");
  });

  it("refuses a message reference that is not an id", () => {
    refusedWith(mailGraph({ message: "{{s1.subject}}" }), "draft_mail.message must bind");
  });

  it("refuses a subject taken from a DIFFERENT message", () => {
    /*
     * A reply carrying one message's subject and another's recipient is a
     * mix-up that reads as a working feature right up until it lands in a
     * stranger's inbox.
     */
    const graph = mailGraph();
    graph.steps.splice(1, 0, {
      id: "s9", kind: "fetch", source_kind: "mail_message", of: "{{trigger.source_ref}}",
    } as never);
    (graph.steps.find((step) => step.id === "s4") as Record<string, unknown>).subject = "{{s9.subject}}";
    refusedWith(graph, "must be the subject of the message being answered");
  });

  it("refuses a call on a draft_mail — it answers a message", () => {
    refusedWith(mailGraph({ call: "{{trigger.call_id}}" }), "answers a message, not a call");
  });

  it("requires tools:none on every model step of a graph that drafts mail", () => {
    /*
     * M43 gives the drafter no tools and M44 gives the meeting brief all of
     * them, and the difference is blast radius, not caution: a brief is read
     * by the person who asked, a reply is read by somebody else. A graph can
     * compose the two, so the asymmetry has to be a refusal rather than a
     * comment in two worker files.
     */
    const graph = mailGraph();
    delete (graph.steps[1] as Record<string, unknown>).tools;
    refusedWith(graph, "must set tools:\"none\" on every model step");
  });

  it("still allows tools on a graph that does NOT address anybody — the control", () => {
    /* without this, "always refuse tools" passes the check above and
       quietly takes retrieval away from every workflow in the product */
    expect(() => validateWorkflowGraph({
      entry: "s1",
      steps: [
        { id: "s1", kind: "search", scope: "summaries", limit: 5 },
        { id: "s2", kind: "ask", from: "{{s1}}", instruction: "خلاصه کن." },
      ],
    }, ACT)).not.toThrow();
  });

  it("refuses a wait for a decision nothing will ever record", () => {
    const graph = mailGraph();
    graph.steps.splice(4, 0, { id: "sw", kind: "wait", on: "decision" } as never);
    refusedWith(graph, "decided in the mailbox");
  });

  it("refuses a fetch whose source is not an id", () => {
    /* `of` bound to a model's output would let the run read whatever the
       model named — the recipient problem, one layer up */
    const graph = mailGraph();
    /* AFTER the extract, so the ordering rule is satisfied and the only
       thing left to refuse is the trust — a fixture that trips an earlier
       check would report this rule as working without ever reaching it */
    graph.steps.push({
      id: "s6", kind: "fetch", source_kind: "mail_message", of: "{{s2.body}}",
    } as never);
    refusedWith(graph, "fetch.of must bind an id");
  });

  it("refuses a trigger fact this trigger does not carry", () => {
    /*
     * Publish used to accept ANY `trigger.*` path as content, so a mis-bound
     * trigger published happily and died at 3am as binding_unresolved. Same
     * fact, said early.
     */
    const graph = mailGraph();
    (graph.steps[0] as Record<string, unknown>).of = "{{trigger.subject}}";
    refusedWith(graph, "does not resolve");
  });
});
