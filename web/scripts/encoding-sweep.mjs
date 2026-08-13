/**
 * The encoding sweep — every tracked file, at byte level.
 *
 *   node scripts/encoding-sweep.mjs
 *
 * **Why this exists.** `.gitignore` — the repo's secrets guard — was found
 * carrying a UTF-8 BOM and two double-encoded mojibake em-dashes, minutes
 * before a push. The corruption came from a PowerShell round-trip: PS 5.1
 * reads a BOM-less UTF-8 file as ANSI, and writes one back with a BOM.
 *
 * A rule already covered that. What the rule could not do is run. It had been
 * widened three times in one afternoon and still missed this file, because the
 * sweep everyone was using was a TEXT GREP — and ripgrep skips dotfiles by
 * default. The corruption sat in an unswept file the whole time and the check
 * could not return it: not a check that passed wrongly, a check that could only
 * ever have passed.
 *
 * So this walks `git ls-files` and reads BYTES. Nothing is skipped for being
 * hidden, and no pattern has to be remembered by a person.
 *
 * **Two failure signatures, both cheap and unambiguous:**
 *  - a UTF-8 BOM (`EF BB BF`) — the `Set-Content -Encoding utf8` fingerprint;
 *  - U+00E2 followed by U+20AC — cp1252 having eaten an em-dash, en-dash or
 *    curly quote. It is the highest-confidence marker because those three are
 *    the punctuation this codebase's prose is full of, and they are exactly
 *    what a reader's eye skips: the Persian gets checked, the dashes do not.
 *
 * **This file never writes that sequence literally, and that is deliberate.**
 * The first version did — in the needle, in this comment, and in the failure
 * output — so the sweep matched itself and could NEVER pass. A gate that always
 * fails gets waved through, which is worse than no gate because it still looks
 * like coverage: the exact mirror of the `.gitignore` check that could only ever
 * pass. Found by the publisher running it as a pre-push gate.
 *
 * So the needle is built from char codes, and any file that needs to DISCUSS the
 * sequence declares itself with the opt-out marker below rather than being added
 * to a list here — otherwise every future write-up of this incident breaks the
 * build, and the person it breaks for is the one documenting a fix.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

/**
 * Files allowed to contain the signatures, WITH the reason — an exclusion on
 * the record is a decision; a silent skip is an accident that looks like one.
 *
 * This list is deliberately tiny. A checker that manufactures false positives
 * gets muted within a week and is then worse than absent, so the answer to a
 * false positive is a named entry here, never a loosened pattern.
 */
const ALLOWED = {
  "CLAUDE.md":
    "documents the corruption signatures themselves — the sweep matching its own rule text. " +
    "A path entry rather than the marker because that file belongs to the steward and is not " +
    "mine to add a marker line to.",
};

/**
 * A file that legitimately discusses the sequence declares itself by containing
 * this marker. It is the mechanism a path list cannot be: **a future write-up of
 * this incident can exempt itself without editing this tool**, which is what
 * stops the gate from breaking for whoever documents the next fix.
 *
 * It exempts the MOJIBAKE check only. A BOM is never forgiven — not by the
 * marker, not by the allow-list, not anywhere — because the marker is a claim
 * about prose and a BOM is a claim about bytes.
 *
 * Built from char codes for the same reason the needle is: written literally, it
 * would sit in this file as a permanent self-exemption.
 */
const OPT_OUT_MARKER = ["sweep", "allow", "mojibake"].join("-");

/** A tracked binary is not prose; arbitrary bytes decode into anything. */
const BINARY = /\.(png|jpe?g|gif|webp|ico|svgz|ttf|otf|woff2?|eot|pdf|docx|xlsx|zip|gz|mp3|wav|m4a|onnx|wasm)$/i;

/**
 * U+00E2 U+20AC, assembled rather than typed — see the header. Writing it as a
 * literal is what made the first version unable to pass.
 */
const MOJIBAKE = String.fromCharCode(0x00e2, 0x20ac);

const files = execFileSync("git", ["ls-files", "-z"], {
  cwd: repoRoot,
  encoding: "utf8",
  maxBuffer: 32 * 1024 * 1024,
})
  .split("\0")
  .filter(Boolean);

const findings = [];
let scanned = 0;

for (const relative of files) {
  if (BINARY.test(relative)) continue;
  let bytes;
  try {
    bytes = readFileSync(join(repoRoot, relative));
  } catch {
    continue; // deleted-but-tracked; not this check's business
  }
  // a NUL byte means binary regardless of extension
  if (bytes.includes(0)) continue;
  scanned += 1;

  const text = bytes.toString("utf8");
  const bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const mojibake = text.includes(MOJIBAKE);
  if (!bom && !mojibake) continue;

  // Both exemptions cover MOJIBAKE only; a BOM always reports.
  const exempt = relative in ALLOWED || text.includes(OPT_OUT_MARKER);
  if (exempt && !bom) continue;

  findings.push(
    `${relative}${bom ? "  BOM" : ""}${mojibake ? "  mojibake(U+00E2 U+20AC)" : ""}` +
      (exempt ? "  [exempt for mojibake — but a BOM is never exempt]" : ""),
  );
}

if (findings.length > 0) {
  console.error(`\nENCODING SWEEP FAILED — ${findings.length} file(s):\n`);
  for (const finding of findings) console.error(`  ${finding}`);
  console.error(
    "\nA PowerShell round-trip is the usual cause: PS 5.1 reads BOM-less UTF-8 as ANSI\n" +
      "and writes back a BOM. Repair with the file tools, or with\n" +
      "[System.IO.File]::WriteAllText($p, $t, (New-Object System.Text.UTF8Encoding($false))).\n",
  );
  process.exit(1);
}

console.log(`ENCODING SWEEP PASSED — ${scanned} tracked text files, no BOM, no mojibake.`);
