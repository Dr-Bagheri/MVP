/**
 * ECHO CALLS ROYA AND AVA INTO THE THREAD.
 *
 * USER DIRECTIVE, 2026-09-03: "echo should have the option to communicate with
 * roya and ava and call them to the screen ... they need to brainstorm and do
 * tasks together ... echo should be the brain that controls them but they need
 * to know themselves, come to the same thread, get commands and even talk and
 * suggest different things to the user and echo itself, until the job that
 * users asked is done."
 *
 * ── THE SHAPE, AND WHY THIS ONE ────────────────────────────────────────────
 *
 * A delegate is a TOOL CALL. `ask_roya` and `ask_ava` are ordinary
 * `DomainTool`s in Echo's set; running one starts a nested agent turn with
 * that agent's persona and specialist tools, streams its answer into the
 * thread as a message of its own, and hands the same text back to Echo as the
 * tool's result.
 *
 * Everything the directive asks for falls out of that:
 *
 *   · "call them to the screen" — the nested run's answer is emitted as a
 *     thread message with `author`, so it appears beside Echo's turns with its
 *     own avatar rather than being folded into Echo's paragraph.
 *   · "echo is the brain" — Echo decides who to call, when, and how many
 *     times; the delegates never decide to speak.
 *   · "until the job is done" — the result comes back INTO Echo's loop, so
 *     Echo can read it, call the other one, disagree, and keep going. That is
 *     the brainstorm: it is a loop, not a relay.
 *   · "they know themselves" — each nested run is given that agent's own
 *     stored instructions, resolved from the database under the caller's
 *     identity (never from anything the browser sent).
 *
 * The alternative — one model told to role-play three names — was rejected
 * for a reason that is not aesthetic: role-play cannot be given DIFFERENT
 * TOOLS. Ava genuinely cannot reach the meeting board and Roya genuinely
 * cannot read the audit trail, and that difference is what makes asking the
 * right one worth doing.
 *
 * ── THE THREE GUARDS ───────────────────────────────────────────────────────
 *
 * 1. NO ONWARD DELEGATION. A delegate's tool set simply does not contain
 *    these tools. Structural, not a depth counter: a counter is a number
 *    somebody can raise, and there is no version of "Ava asks Roya to ask Ava"
 *    that is worth the tokens it costs.
 *
 * 2. BLAST RADIUS. A delegate gets READS and nothing else — no client tools
 *    (which act on the person's own session) and no write tools (which emit
 *    proposals). M43's rule, applied: what an output can REACH decides what
 *    its author may hold. Echo keeps both, because Echo is the one the person
 *    is talking to and the one whose proposals they will see and confirm.
 *
 * 3. A CEILING PER TURN. `MAX_DELEGATIONS` bounds how many nested runs one
 *    question can spend. Without it a model that finds delegation useful will
 *    delegate about delegating, and the person pays for the whole tree.
 */
import { Type } from "./pi.ts";
import { ToolDenied, type DomainTool } from "./tools.ts";
import { resolveAssistantAgent } from "./agent-store.ts";
import { createDomainTools, type ToolDeps } from "./domain-tools.ts";
import { toolsFor, type Specialism } from "./platform-tools.ts";
import type { AgentResult, Identity } from "./types.ts";
import type { Db } from "../db/identity.ts";

/**
 * How many colleagues one question may call in, counting repeats.
 *
 * Four is two of each, which is the most a single question has ever plausibly
 * needed: ask both, read both answers, go back to one of them once. It is not
 * a safety limit — the policy's own `maxToolCalls` is that — it is the number
 * past which a delegating model is talking to itself.
 */
export const MAX_DELEGATIONS = 4;

/** What the stream needs in order to draw the delegate's turn. */
export interface DelegateTurn {
  /** the agent's handle — `roya`, `ava`, or whatever else is registered */
  author: string;
  /** the name to show, already resolved (the catalogue owns the translation) */
  name: string;
  text: string;
  /** true when the nested run failed; the thread says so rather than staying quiet */
  failed: boolean;
}

export interface DelegationOptions {
  db: Db;
  /** the caller — every nested run borrows exactly this identity, never more */
  identity: Identity;
  /** may the delegates search the open web (db/0169, the person's own switch) */
  web: boolean;
  /** the interface language, so a delegate answers in the language being read */
  locale?: string | undefined;
  /** run one nested turn; injected so this module never imports the runtime */
  runNested(input: {
    agentHandle: string;
    instructions: string;
    model: string | null;
    web: boolean;
    question: string;
    tools: DomainTool<ToolDeps, never>[];
  }): Promise<AgentResult>;
  /** called when a delegate has spoken, so the surface can draw it */
  onTurn(turn: DelegateTurn): void | Promise<void>;
}

/**
 * The two colleagues, as tools.
 *
 * Built from the AGENTS THE CALLER CAN SEE rather than from a hard-coded pair:
 * db/0163 seeds Roya and Ava, an organization may add its own, and a tool list
 * that named two handles would go stale the first time somebody did. The
 * handles come from the store; only the SPECIALISM mapping is ours.
 */
/**
 * THE OTHER DIRECTION (user directive, 2026-09-04: "they also must have the
 * ability to talk to echo and ask things from echo as well").
 *
 * An agent's turn gets ONE tool, `ask_echo`, and it is deliberately not the
 * mirror of `ask_roya`. Echo, asked by a person, holds client tools, write
 * tools and its colleagues. Echo asked by an AGENT holds none of those:
 *
 *   · no client tools — the browser performs those, and nothing a delegate
 *     produces should be able to navigate the person's screen;
 *   · no write tools — a proposal exists so a HUMAN can approve it, and a
 *     proposal raised inside a nested run has no conversation to be approved
 *     in (the ruling that killed the pending-proposals inbox);
 *   · no delegation of its own — otherwise Roya asks Echo, who asks Ava, who
 *     asks Echo, and the ceiling is the only thing standing between that and
 *     a bill. Guard 1 in the other direction.
 *
 * What is left is the thing worth having: Echo's READ tools and its view of
 * the platform, which is what an agent actually needs when it says "I do not
 * have that". The blast radius is identical to a colleague's answer, which is
 * the rule this file already runs on — what an output can REACH decides what
 * its author may hold.
 *
 * It shares `MAX_DELEGATIONS` with the colleague tools by construction: one
 * `spent` counter per turn, whichever direction the asking goes.
 */
export async function createEchoTool(
  options: Omit<DelegationOptions, "web"> & { web: boolean; askedBy: string },
): Promise<DomainTool<ToolDeps, never>[]> {
  let spent = 0;
  const tool: DomainTool<ToolDeps, { question: string }> = {
    name: "ask_echo",
    label: "پرسیدن از اکو",
    description:
      "Ask Echo, the platform assistant, something you cannot answer yourself. "
      + "Echo sees the whole platform and can look things up for you. Use it when "
      + "you are missing a fact, not to hand over the question you were asked — "
      + "the person asked YOU.",
    parameters: Type.Object({
      question: Type.String({
        description: "The specific thing you need to know, in one question.",
      }),
    }),
    async run(_ctx, args) {
      /*
       * VALIDATE, THEN SPEND. The two were the other way round, which made a
       * malformed call cost a real one: a model that sends an empty `question`
       * — which is exactly the mistake it recovers from by trying again — got
       * charged for the attempt and hit the ceiling one ask early. The budget
       * exists to bound WORK, and a refusal did none.
       */
      const question = (args.question ?? "").trim();
      if (question === "") throw new ToolDenied("say what you are asking Echo for");
      if (spent >= MAX_DELEGATIONS) {
        throw new ToolDenied(
          `you have already asked Echo ${MAX_DELEGATIONS} times for this question `
          + "— answer with what you have",
        );
      }
      spent += 1;

      const result = await options.runNested({
        agentHandle: "echo",
        instructions: echoBriefing(options.askedBy, options.locale),
        model: null,
        web: options.web,
        question,
        tools: [...createDomainTools(), ...toolsFor("both")] as DomainTool<ToolDeps, never>[],
      });

      /*
       * NOT announced as a turn. A colleague's answer is shown because the
       * person asked Echo and somebody else replied — that is a fact about
       * the conversation. Echo answering its own agent is working out, not
       * speaking, and putting it in the thread would show the reader two
       * voices for one answer they only asked one person for.
       */
      if (result.failed) {
        throw new ToolDenied(`Echo could not answer: ${result.error ?? "the run failed"}`);
      }
      return { from: "Echo", answer: result.text };
    },
  };
  return [tool as DomainTool<ToolDeps, never>];
}

function echoBriefing(askedBy: string, locale: string | undefined): string {
  const language = locale === "en" ? "Answer in English." : "پاسخ را به فارسی بنویس.";
  return [
    `تو «اکو» هستی، دستیار این پلتفرم. ${askedBy} — یکی از دستیارهای همین سازمان —`,
    "از تو چیزی پرسیده است تا بتواند به کاربر جواب بدهد.",
    "پاسخ تو به کاربر نشان داده نمی‌شود؛ به همکارت داده می‌شود، پس کوتاه و دقیق",
    "بنویس: همان چیزی که پرسیده، با شاهدش. اگر نمی‌دانی، همین را بگو؛ حدس نزن.",
    language,
  ].join(" ");
}

export async function createDelegationTools(
  options: DelegationOptions,
): Promise<DomainTool<ToolDeps, never>[]> {
  const roster = await Promise.all(
    (["roya", "ava"] as const).map(async (handle) => ({
      handle,
      agent: await resolveAssistantAgent(options.db, options.identity, handle),
    })),
  );

  let spent = 0;

  return roster.flatMap(({ handle, agent }) => {
    /* an agent that is not visible to this caller simply has no tool — the
       model is never offered a colleague it cannot reach, which is a better
       answer than a tool that always refuses */
    if (!agent) return [];
    const specialism: Specialism = SPECIALISM_BY_HANDLE[handle] ?? "both";

    const delegate: DomainTool<ToolDeps, { question: string; context?: string }> = {
      name: `ask_${handle}`,
      label: `پرسیدن از ${agent.name}`,
      /* the record is keyed by the handles this file knows; an org-made agent
         with another handle would land here with no entry, so the fallback is
         the agent's OWN description rather than an empty string — a tool the
         model cannot tell apart is a tool it will not choose */
      description: (DESCRIPTION[handle] ?? ((own: string) => own))(agent.description),
      parameters: Type.Object({
        question: Type.String({
          description:
            "What you want from them, in their own terms — a colleague's brief, "
            + "not a forwarded user message. Say what you already know so they "
            + "do not repeat your work.",
        }),
        context: Type.Optional(Type.String({
          description:
            "Anything from this conversation they need and cannot look up — "
            + "ids you have already resolved, the user's stated constraint.",
        })),
      }),
      async run(_ctx, args) {
        /* validate before spending — see `createEchoTool` for why: a refused
           call did no work, and charging for it costs a real ask */
        const question = (args.question ?? "").trim();
        if (question === "") throw new ToolDenied("say what you are asking them for");
        if (spent >= MAX_DELEGATIONS) {
          throw new ToolDenied(
            `you have already called your colleagues ${MAX_DELEGATIONS} times for this `
            + "question — answer with what they gave you",
          );
        }
        spent += 1;

        /*
         * The delegate's tool set: its specialism's platform reads plus the
         * four transcript tools every agent has. NOT the delegation tools —
         * that is guard 1, and it is an absence rather than a check.
         */
        const tools = [
          ...createDomainTools(),
          ...toolsFor(specialism),
        ] as DomainTool<ToolDeps, never>[];

        const result = await options.runNested({
          agentHandle: handle,
          instructions: [
            agent.instructions,
            colleagueBriefing(agent.name, options.locale),
          ].join("\n\n"),
          model: agent.model,
          /* the AGENT's own flag AND the person's switch — either off is off.
             db/0169 put the second one on the person deliberately: the open web
             is the one capability here that spends outside the building. */
          web: options.web && agent.web,
          question: args.context
            ? `${question}\n\n[Context from the conversation, provided by Echo]\n${args.context}`
            : question,
          tools,
        });

        await options.onTurn({
          author: handle,
          name: agent.name,
          text: result.text,
          failed: result.failed,
        });

        if (result.failed) {
          /* a failed colleague is a REFUSAL to the caller, not an error that
             kills the whole turn — Echo can say "Ava could not answer" and
             carry on with what it has, which is what a person would do */
          throw new ToolDenied(
            `${agent.name} could not answer: ${result.error ?? "the run failed"}`,
          );
        }
        return { from: agent.name, handle, answer: result.text };
      },
    };
    return [delegate as DomainTool<ToolDeps, never>];
  });
}

const SPECIALISM_BY_HANDLE: Readonly<Record<string, Specialism>> = {
  /* Roya ACTS — she is asked about work in flight: meetings, tasks, agendas,
     what is due. Ava READS — the record, the history, what changed. The split
     is by VERB, which is the ruling M-decision behind 0163's two agents, and
     it is the whole reason asking the right one is worth doing. */
  roya: "operator",
  ava: "analyst",
};

const DESCRIPTION: Readonly<Record<string, (own: string) => string>> = {
  roya: (own) =>
    `Ask رؤیا, the operations colleague. ${own} `
    + "She sees meetings, the task board, agendas and what is due — the work in "
    + "flight. Ask her to plan, to draft the shape of something, or to tell you "
    + "the state of what people are actually doing. She CANNOT read the audit "
    + "trail or summary history; ask Ava for those.",
  ava: (own) =>
    `Ask آوا, the analyst colleague. ${own} `
    + "She reads the record: transcripts, summaries and their versions, the "
    + "audit trail, member history, who said what and what changed. Ask her to "
    + "find evidence and to report on it. She CANNOT see the task board or "
    + "meeting agendas; ask Roya for those.",
};

/**
 * What a delegate is told about the situation it has been called into.
 *
 * Short on purpose. It is appended to the agent's OWN stored instructions,
 * which are the trusted, server-resolved text (M30), and a long framing here
 * would quietly outweigh the persona somebody configured.
 *
 * The last clause is the directive's "even talk and suggest different things
 * to the user and echo itself" — a colleague who only answers the question
 * asked is a search box with a name.
 */
function colleagueBriefing(name: string, locale: string | undefined): string {
  const language = locale === "en"
    ? "Answer in English."
    : "پاسخ را به فارسی بنویس.";
  return [
    `تو ${name} هستی و یک همکار — «اکو» تو را به این گفت‌وگو آورده است.`,
    "پاسخ تو مستقیماً به کاربر نشان داده می‌شود، پس مثل یک همکار بنویس: کوتاه،",
    "با شاهد، و بدون تکرار چیزی که پرسیده شده.",
    "اگر چیزی می‌بینی که پرسیده نشده اما به کار می‌آید، بگو — و اگر با",
    "برداشتِ پرسش موافق نیستی، همان را بگو؛ همکاری که فقط تأیید می‌کند به کار نمی‌آید.",
    "اگر شاهدی نیافتی، همین را بنویس؛ حدس نزن.",
    language,
  ].join(" ");
}
