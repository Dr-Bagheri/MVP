/**
 * Item 16 — trying a skill before anybody has to live with it.
 *
 * The authoring screen has always been able to SAVE a prompt, and a saved
 * prompt is live for the whole organisation from that second. So the honest
 * missing half is not versioning alone: it is being able to ask «what would
 * this do» while the wording is still a draft on your screen.
 *
 * ── WHAT A DRY RUN IS, AND IS NOT ─────────────────────────────────────────
 *
 * It runs the DRAFT — the text in the box, not the saved row — as the skill
 * for one question, under the author's own identity, and returns the answer.
 * It writes an `agent_run`, because a model was called and the organisation
 * paid for it, and nothing else: no skill row, no version, no conversation.
 *
 * **It gets NO TOOLS.** A draft is a thing somebody is still writing, and a
 * prompt that has not been read by anyone should not be able to send a
 * message, file a card or change a record on its first outing. What a dry run
 * answers is «does this wording produce the answer I meant», which needs no
 * reach at all — and the day it needs one, the skill is saved and run
 * properly, where the consent card is.
 *
 * That is the same reasoning M44 used for the mail draft and the meeting
 * brief, applied to the one case where the text itself is unreviewed:
 * **blast radius decides reach.**
 */
import { createAgentRunStore } from "../agent/run-store.ts";
import { createAgentRuntime } from "../agent/runtime.ts";
import { firstServable } from "./models.ts";
import { ValidationError } from "./errors.ts";
import type { Db, SqlTx } from "../db/identity.ts";
import type { Identity, Skill } from "../agent/types.ts";

export interface DryRunInput {
  /** the draft on the author's screen, not a saved row */
  prompt: string;
  question: string;
  /** the skill's pinned model, when the draft pins one */
  model?: string | undefined;
}

export interface DryRunResult {
  text: string;
  /** which model actually answered — the ladder's rung, not the request */
  model: string;
  run_id: string | null;
}

const MAX_PROMPT = 20_000;
const MAX_QUESTION = 2_000;

export function createSkillDryRun(db: Db, options: {
  /* the server's own option is optional, so this one is too — and a MISSING
     key is refused by name below rather than sent to the provider as an
     empty string, which comes back as an unexplained 401 (rule 7: a missing
     floor is loud) */
  apiKey?: string | undefined;
  fallbackModel?: string | undefined;
  /** test seam: stand in for the model call */
  runModel?: (input: { identity: Identity; prompt: string; question: string; model: string })
    => Promise<{ text: string; runId: string | null }>;
}) {
  async function dryRun(identity: Identity, input: DryRunInput): Promise<DryRunResult> {
    const prompt = (input.prompt ?? "").trim();
    const question = (input.question ?? "").trim();
    if (prompt === "") {
      throw new ValidationError("a skill needs a prompt to try", { code: "skill_prompt_missing" });
    }
    if (question === "") {
      throw new ValidationError("a question is required", { code: "skill_question_missing" });
    }
    if (prompt.length > MAX_PROMPT || question.length > MAX_QUESTION) {
      throw new ValidationError("that is longer than a skill may be", { code: "skill_too_long" });
    }

    /* M5's ladder, and `firstServable` rather than the raw preference — a
       barred model in a draft's pin is refused BY NAME (somebody typed it),
       and a barred one in a stale row is simply not a rung (2026-08-29) */
    const rows = await db.withIdentity(identity, (tx: SqlTx) =>
      tx.unsafe<{ preferred_model: string | null; allowed_models: string[] | null }>(
        `select u.preferred_model, o.allowed_models
           from echo.app_user u join echo.org o on o.id = u.org_id
          where u.id = $1 limit 1`, [identity.userId]));
    const model = firstServable(
      input.model, rows[0]?.preferred_model, rows[0]?.allowed_models?.[0], options.fallbackModel);
    if (!model) {
      throw new ValidationError("no model is available to try this with", { code: "no_model" });
    }

    if (!options.runModel && (options.apiKey ?? "") === "") {
      throw new ValidationError("this deployment has no model provider configured",
        { code: "provider_unconfigured" });
    }

    if (options.runModel) {
      const out = await options.runModel({ identity, prompt, question, model });
      return { text: out.text, model, run_id: out.runId };
    }

    const runs = createAgentRunStore({ db, identity });
    const runtime = createAgentRuntime({ runs });
    const result = await runtime.run({
      identity,
      kind: "assistant",
      callerModel: model,
      /*
       * The DRAFT as the skill, TYPED rather than cast.
       *
       * `id` is empty on purpose: nothing here is a saved row, and a run that
       * recorded a skill id would attribute this answer to a skill that may
       * never be saved with these words. `level: "user"` because a draft
       * belongs to whoever is typing it and to nobody else yet.
       *
       * Not `as never` — a cast against a shape somebody else owns is a drift
       * report decided not to file, which cost this repo a TypeError once a
       * minute on production earlier today.
       */
      skill: {
        id: "", level: "user", slug: "dry-run", name: "dry run", description: "",
        prompt, model: input.model ?? null, tools: [], enabled: true,
        maxToolCalls: null,
      } satisfies Skill,
      input: question,
      /* no tools — see the header */
      tools: [] as never,
      deps: {} as never,
      apiKey: options.apiKey ?? "",
    });
    if (result.failed === true) {
      throw new ValidationError(result.error ?? "the model call failed", { code: "dry_run_failed" });
    }
    /* AgentResult requires both text and runId, so the coalescing the first
       draft had would have read as defence against a shape that cannot occur.
       This returns what the runtime returned, including WHICH model answered
       — the ladder's rung, which is not always the one asked for. */
    return { text: result.text, model: result.model, run_id: result.runId };
  }

  return { dryRun };
}

export type SkillDryRun = ReturnType<typeof createSkillDryRun>;
