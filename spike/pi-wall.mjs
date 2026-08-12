// Spike item 1: Pi harness + OUR permission wall (M4).
//
// Questions: does Pi embed cleanly, can our wrapper intercept EVERY tool
// call, can we swap models mid-session? Two fake domain tools, one wrapper
// carrying caller identity, real OpenRouter loop, non-Claude model.
import { execFileSync } from "node:child_process";
import { runAgentLoop } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { builtinModels, getBuiltinModel } from "@earendil-works/pi-ai/providers/all";

// ---------------------------------------------------------------- key + models

function openrouterKey() {
  const out = execFileSync(
    "C:\\Users\\amirreza\\AppData\\Local\\NeurAI\\venv\\Scripts\\python.exe",
    ["-c", "from neurai.security import get_secret; print(get_secret('openrouter_key'))"],
    { env: { ...process.env, NEURAI_DATA_DIR: "C:\\Users\\amirreza\\.neurai" }, encoding: "utf8" },
  );
  return out.trim();
}

const MODEL_A = "google/gemini-3.6-flash";
const MODEL_B = "openai/gpt-5-mini";   // mid-session swap target (non-Claude)

// Pi ships a generated catalogue: 39 providers, 335 OpenRouter models —
// exactly the M5 "admin-curated catalogue" primitive, for free.
const model = (id) => getBuiltinModel("openrouter", id);

// ---------------------------------------------------------- the domain + wall

// Fake domain data: two orgs' calls. The agent must never see org-b rows.
const CALLS = [
  { id: "call-1", org: "org-a", title: "جلسه بودجه سه‌ماهه", text: "بودجه بازاریابی بیست درصد افزایش یافت." },
  { id: "call-2", org: "org-a", title: "جلسه محصول", text: "انتشار نسخه جدید اول مهر تعیین شد." },
  { id: "call-secret", org: "org-b", title: "جلسه رقیب", text: "اطلاعات محرمانه سازمان دیگر." },
];

const audit = [];   // every attempted call — the M4 agent_runs analogue

/**
 * THE WALL: one wrapper every domain tool goes through. Carries the caller
 * identity, refuses out-of-scope ids, records the attempt. Pi never sees an
 * unwrapped tool.
 */
function scoped(caller, { name, label, description, parameters, run }) {
  return {
    name,
    label,
    description,
    parameters,
    execute: async (toolCallId, params) => {
      const entry = { tool: name, caller: caller.userId, org: caller.orgId, params, allowed: true };
      try {
        const result = run(caller, params);
        entry.rows = Array.isArray(result) ? result.length : 1;
        audit.push(entry);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (e) {
        entry.allowed = false;
        entry.denied = e.message;
        audit.push(entry);
        // deny is a normal tool result, not a crash — the model reads it and adapts
        return { content: [{ type: "text", text: `DENIED: ${e.message}` }], isError: true };
      }
    },
  };
}

function makeTools(caller) {
  return [
    scoped(caller, {
      name: "search_calls",
      label: "Search calls",
      description: "Search the caller's calls by keyword. Returns id + title only.",
      parameters: Type.Object({ query: Type.String() }),
      run: (c, { query }) =>
        CALLS.filter((r) => r.org === c.orgId)          // <- scope, in code
             .filter((r) => (r.title + r.text).includes(query))
             .map(({ id, title }) => ({ id, title })),
    }),
    scoped(caller, {
      name: "read_window",
      label: "Read call window",
      description: "Read the transcript text of one call by id.",
      parameters: Type.Object({ call_id: Type.String() }),
      run: (c, { call_id }) => {
        const row = CALLS.find((r) => r.id === call_id);
        // identical refusal whether it doesn't exist or isn't theirs
        if (!row || row.org !== c.orgId) throw new Error("call not found");
        return { id: row.id, title: row.title, text: row.text };
      },
    }),
  ];
}

// ------------------------------------------------------------------- the run

async function main() {
  process.env.OPENROUTER_API_KEY = openrouterKey();

  const models = builtinModels();   // every built-in provider registered

  const caller = { userId: "user-1", orgId: "org-a" };
  const tools = makeTools(caller);

  const events = [];
  const blocked = [];
  const modelsUsed = [];
  let turn = 0;

  const context = {
    systemPrompt:
      "You are a call-analysis assistant. Use the tools to answer. " +
      "Answer in Persian, briefly. If a tool denies access, say so honestly.",
    messages: [{
      role: "user",
      content: [{ type: "text", text:
        "سه کار انجام بده: (۱) با search_calls دنبال «بودجه» بگرد و متن آن جلسه را با read_window بخوان. " +
        "(۲) سپس تلاش کن جلسه‌ای با شناسه call-secret را با read_window بخوانی و بگو چه شد. " +
        "(۳) سپس تلاش کن جلسه‌ای با شناسه admin-7 را با read_window بخوانی و بگو چه شد." }],
      timestamp: new Date().toISOString(),
    }],
    tools,
  };

  const config = {
    model: model(MODEL_A),
    // FINDING: gemini-3.x on OpenRouter rejects reasoning-disabled requests
    // ("Reasoning is mandatory for this endpoint"); pi defaults to none, so
    // the catalogue's reasoning:true models need an explicit level.
    reasoning: "low",
    convertToLlm: (messages) => messages,

    // WALL LAYER 2: Pi's own interception point. Every tool call passes here
    // BEFORE execution; returning {block:true} stops it dead.
    beforeToolCall: async ({ toolCall, args }) => {
      events.push({ hook: "beforeToolCall", tool: toolCall.name, args });
      // demo policy: this wall can veto centrally, without touching tools
      if (toolCall.name === "read_window" && String(args?.call_id ?? "").startsWith("admin-")) {
        blocked.push(toolCall.name);
        return { block: true, reason: "blocked by policy: admin-* windows require elevation" };
      }
      return undefined;
    },
    afterToolCall: async ({ toolCall, isError }) => {
      events.push({ hook: "afterToolCall", tool: toolCall.name, isError });
      return undefined;
    },

    // MODEL SWAP: switch models between turns, mid-session.
    prepareNextTurn: () => {
      turn += 1;
      if (turn === 1) {
        modelsUsed.push(MODEL_B);
        console.log(`\n[spike] swapping model mid-session: ${MODEL_A} -> ${MODEL_B}`);
        return { model: model(MODEL_B) };
      }
      return undefined;
    },
    toolExecutionMode: "sequential",
  };

  modelsUsed.push(MODEL_A);
  const started = Date.now();
  const emitted = [];
  const messages = await runAgentLoop(
    context.messages, context, config,
    (event) => {
      emitted.push(event.type);
      if (event.type === "tool_execution_start") console.log(`[spike] tool -> ${event.toolName ?? "?"}`);
      if (event.type === "text_delta" && event.delta) process.stdout.write(event.delta);
      if (event.type === "message_end" && event.message?.stopReason === "error") {
        console.log(`[spike] LLM ERROR: ${event.message.errorMessage}`);
      }
    },
    undefined,
    (m, ctx, opts) => models.streamSimple(m, ctx, opts),
  );

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log("\n\n================ SPIKE 1 RESULTS ================");
  console.log(`wall clock: ${elapsed}s   turns: ${turn + 1}   models used: ${[...new Set(modelsUsed)].join(" -> ")}`);
  console.log(`event types: ${[...new Set(emitted)].join(", ")}`);
  console.log(`\nhook interceptions (${events.length}):`);
  for (const e of events) console.log("  ", JSON.stringify(e));
  console.log(`\nwall audit trail (${audit.length} attempted tool calls):`);
  for (const a of audit) console.log("  ", JSON.stringify(a));
  const leaked = JSON.stringify(messages).includes("اطلاعات محرمانه سازمان دیگر");
  console.log(`\nout-of-scope data leaked into transcript: ${leaked ? "YES ***" : "NO"}`);
  console.log(`policy-blocked calls: ${blocked.length}`);

  const final = messages.filter((m) => m.role === "assistant").pop();
  const text = (final?.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("");
  console.log(`\nfinal answer:\n${text}`);
}

main().catch((e) => { console.error("SPIKE FAILED:", e); process.exit(1); });
