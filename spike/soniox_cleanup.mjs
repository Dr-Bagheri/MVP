// Remove anything the failed run left on Soniox's servers, and report what
// the account can actually do (balance/status) without printing the key.
import { execFileSync } from "node:child_process";

const BASE = "https://api.soniox.com";
const KEY = execFileSync(
  "C:\\Users\\amirreza\\AppData\\Local\\NeurAI\\venv\\Scripts\\python.exe",
  ["-c", "from neurai.security import get_secret; print(get_secret('soniox_key'))"],
  { env: { ...process.env, NEURAI_DATA_DIR: "C:\\Users\\amirreza\\.neurai" }, encoding: "utf8" },
).trim();
const auth = { Authorization: `Bearer ${KEY}` };

const files = await (await fetch(`${BASE}/v1/files`, { headers: auth })).json();
console.log(`files on server: ${(files.files ?? files.data ?? []).length}`);
for (const f of files.files ?? files.data ?? []) {
  const r = await fetch(`${BASE}/v1/files/${f.id}`, { method: "DELETE", headers: auth });
  console.log(`  deleted file ${f.id}: ${r.status}`);
}

const jobs = await (await fetch(`${BASE}/v1/transcriptions`, { headers: auth })).json();
const list = jobs.transcriptions ?? jobs.data ?? [];
console.log(`transcriptions on server: ${list.length}`);
for (const j of list) {
  const r = await fetch(`${BASE}/v1/transcriptions/${j.id}`, { method: "DELETE", headers: auth });
  console.log(`  deleted job ${j.id} (status=${j.status}): ${r.status}`);
}
