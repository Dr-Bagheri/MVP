import { execFileSync } from "node:child_process";
import { createModels, createProvider, envApiKeyAuth } from "@earendil-works/pi-ai";

const key = execFileSync(
  "C:\\Users\\amirreza\\AppData\\Local\\NeurAI\\venv\\Scripts\\python.exe",
  ["-c", "from neurai.security import get_secret; print(get_secret('openrouter_key'))"],
  { env: { ...process.env, NEURAI_DATA_DIR: "C:\\Users\\amirreza\\.neurai" }, encoding: "utf8" },
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
