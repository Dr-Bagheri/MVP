import { execFileSync } from "node:child_process";
import { createModels, createProvider, envApiKeyAuth } from "@earendil-works/pi-ai";

// Where the NeurAI interpreter is, and where its data lives, are properties of
// the MACHINE — so there is no default (review F4). NEURAI_DATA_DIR rides the
// ambient environment; it is not overridden here. The full argument for having
// no default at all is at db/scripts/lib/neurai-python.mjs.
const NEURAI_PYTHON = process.env.NEURAI_PYTHON;
if (!NEURAI_PYTHON) {
  throw new Error(
    'NEURAI_PYTHON is not set. Point it at the python.exe of the NeurAI server venv on THIS machine, e.g.\n' +
    '  $env:NEURAI_PYTHON = "C:\\path\\to\\neurai-mvp\\server\\.venv\\Scripts\\python.exe"',
  );
}

const key = execFileSync(
  NEURAI_PYTHON,
  ["-c", "from neurai.security import get_secret; print(get_secret('openrouter_key'))"],
  { env: process.env, encoding: "utf8" },
).trim();
process.env.OPENROUTER_API_KEY = key;

const m = {
  id: "google/gemini-3.6-flash", provider: "openrouter", api: "openai-completions",
  name: "g", reasoning: false, input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200000, maxTokens: 1024,
};
const provider = createProvider({
  id: "openrouter", baseUrl: "https://openrouter.ai/api/v1",
  auth: envApiKeyAuth("OPENROUTER_API_KEY"), models: [m], api: "openai-completions",
});
const models = createModels({ providers: [provider] });

const stream = await models.streamSimple(m, {
  systemPrompt: "be terse",
  messages: [{ role: "user", content: [{ type: "text", text: "say OK" }], timestamp: new Date().toISOString() }],
});
for await (const ev of stream) {
  if (ev.type === "error") {
    console.log("ERROR EVENT full:", JSON.stringify(ev.error, null, 2).slice(0, 2000));
  } else {
    console.log("EV", ev.type, JSON.stringify(ev).slice(0, 200));
  }
}
