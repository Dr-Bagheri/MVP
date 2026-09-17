import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AVATAR_PRESETS } from "./avatarPresets";

/* vitest runs from web/ (its config's root); `import.meta.url` is not a file
   URL under its transform, so the two paths are taken from the cwd */
const SCRIPT = resolve(process.cwd(), "scripts/gen-avatar-presets.mjs");
const MODULE = resolve(process.cwd(), "src/components/platform/avatarPresets.ts");

function check(path?: string) {
  return spawnSync(process.execPath, [SCRIPT, "--check", ...(path ? [path] : [])], { encoding: "utf8", timeout: 60_000 });
}

/**
 * THE EIGHT AVATARS ARE GENERATED, NOT DRAWN (2026-09-17): the module is the
 * script's output and nothing else. Its shape is the contract AvatarEditor
 * reads (eight, five women then three men, labelled by index), and the
 * module on disk must be what the script produces TODAY — a hand edit, or a
 * DiceBear bump that changed a drawing without the module being regenerated,
 * is a red here rather than a different face on somebody's profile.
 */
describe("the generated avatar presets", () => {
  it("are eight DiceBear pictures, five women then three men, at the crop's own size", () => {
    expect(AVATAR_PRESETS).toHaveLength(8);
    const keys = AVATAR_PRESETS.map((p) => p.key);
    expect(new Set(keys).size, "two presets share a key").toBe(8);
    expect(keys.slice(0, 5).every((k) => k.startsWith("f-")), "the first five are not the women").toBe(true);
    expect(keys.slice(5).every((k) => k.startsWith("m-")), "the last three are not the men").toBe(true);
    for (const p of AVATAR_PRESETS) {
      expect(p.svg.startsWith("<svg"), `${p.key} is not an SVG`).toBe(true);
      expect(p.svg, `${p.key} has no viewBox`).toContain("viewBox=");
      /* the crop step's side, so the rasteriser draws it 1:1 */
      expect(p.svg, `${p.key} is not rendered at 256`).toMatch(/width="256"/);
    }
  });

  it("the module on disk is exactly what the generator produces — and the check can fail", () => {
    const ok = check();
    expect(ok.status, `--check refused the module on disk:\n${ok.stderr}${ok.stdout}`).toBe(0);

    /* THE CONTROL: the same check against a copy with one character changed
       inside a picture must say no — otherwise the line above proves nothing
       about the module, only that the script exits. */
    const dir = mkdtempSync(join(tmpdir(), "avatar-presets-"));
    const tampered = join(dir, "avatarPresets.ts");
    const text = readFileSync(MODULE, "utf8");
    const at = text.indexOf("<svg");
    expect(at, "no SVG in the module to tamper with").toBeGreaterThan(0);
    writeFileSync(tampered, text.slice(0, at) + "<svg tampered" + text.slice(at + 4), "utf8");
    const bad = check(tampered);
    expect(bad.status, "the check accepted a tampered module").toBe(1);
    expect(bad.stderr).toContain("disagrees with the generator");
  });
});
