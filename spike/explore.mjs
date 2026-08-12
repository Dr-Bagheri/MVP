// Spike step 0: what does Pi actually expose? (SDK ergonomics finding)
import * as core from "@earendil-works/pi-agent-core";
import * as ai from "@earendil-works/pi-ai";

const show = (name, mod) => {
  const keys = Object.keys(mod).sort();
  console.log(`\n=== ${name} (${keys.length} exports) ===`);
  for (const k of keys) console.log(`  ${k}: ${typeof mod[k]}`);
};

show("pi-agent-core", core);
show("pi-ai", ai);

// node entrypoint too (tool/session helpers usually live there)
try {
  const node = await import("@earendil-works/pi-agent-core/node");
  show("pi-agent-core/node", node);
} catch (e) {
  console.log("\n(no /node subpath usable:", e.message, ")");
}
