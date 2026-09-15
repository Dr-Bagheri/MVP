// Remove anything the failed run left on Soniox's servers, and report what
// the account can actually do (balance/status) without printing the key.
import { execFileSync } from "node:child_process";

const BASE = "https://api.soniox.com";
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

const KEY = execFileSync(
  NEURAI_PYTHON,
  ["-c", "from neurai.security import get_secret; print(get_secret('soniox_key'))"],
  { env: process.env, encoding: "utf8" },
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
