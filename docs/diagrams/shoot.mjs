/**
 * Renders each figure in diagrams.html to its own PNG at 2× for print.
 *
 * Served over http rather than opened as file:// — the page pulls a font
 * from a stylesheet, and a document that resolves past itself needs an
 * origin. Run the server first:
 *   python -m http.server 8899 --bind 127.0.0.1   (from this directory)
 */
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "png");

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1700, height: 1200 },
  deviceScaleFactor: 2,
});
await page.goto("http://127.0.0.1:8899/diagrams.html", { waitUntil: "networkidle" });
/* the labels are typeset — a shot taken before the face loads is a shot of
   the fallback, and it looks almost right, which is the dangerous kind */
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(400);

await mkdir(OUT, { recursive: true });
const ids = await page.$$eval(".fig", (nodes) => nodes.map((n) => n.id));
for (const id of ids) {
  const el = await page.$(`#${id}`);
  if (!el) continue;
  await el.screenshot({ path: path.join(OUT, `${id}.png`) });
  console.log("rendered", id);
}
await browser.close();
console.log(`${ids.length} figures → ${OUT}`);
