// THE EIGHT READY-MADE AVATARS ARE GENERATED, NOT DRAWN (user, 2026-09-17:
// "change the avatars image, use something better designed, use skills and
// plugins to do it"). The first eight were hand-drawn inline SVG; these come
// from DiceBear's Avataaars (Pablo Stanley, https://avataaars.com/ — free for
// personal and commercial use, no attribution owed), rendered ONCE here into
// src/components/platform/avatarPresets.ts. The app never loads DiceBear: the
// two packages are devDependencies, the output is eight strings, and the
// bundle carries exactly what it carried before — pictures.
//
// Why Avataaars and not the other three attribution-free styles (Lorelei,
// Notionists, Open Peeps — all CC0, all rendered on the same sheet): at the
// product's 36px key the ink-only styles dissolve into a scribble and the
// line-art faces lose their features, while these keep a silhouette, a hair
// colour and a shirt; it is the smallest of the four (37KB for eight against
// 98KB); and it carries a hijab, which the Iranian market's five women should
// include. The sheet is in the 2026-09-17 runbook record.
//
// EVERY TRAIT IS PINNED BY NAME, so the same eight come out on every run and
// a version bump that changes a drawing shows up as a diff here rather than
// as a different face on somebody's profile. The order is the contract —
// five women, then three men — because AvatarEditor labels them by index.
//
//   node scripts/gen-avatar-presets.mjs            # (re)write the module
//   node scripts/gen-avatar-presets.mjs --check    # exit 1 when the module on
//                                                  # disk disagrees (the test)
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createAvatar } from "@dicebear/core";
// the standalone style package exports create/meta/schema; the collection's
// `avataaars` is exactly this namespace
import * as avataaars from "@dicebear/avataaars";

const OUT = new URL("../src/components/platform/avatarPresets.ts", import.meta.url);

/** the crop step's own side (AvatarEditor CROP_SIZE): a preset arrives at the canvas already that size */
const SIZE = 256;

/* soft grounds, one per face — harmonised with the product's green rather than copied from it */
const BG = { rose: "fbe1e6", sky: "dbe9fb", mint: "d9f2e3", sand: "fdf0cf", lilac: "e9e3fb", aqua: "d3f1f4", peach: "ffe6d5", pink: "fbe0f0" };
const HAIR = { black: "1f1a17", espresso: "3b2416", chestnut: "6b3d22", auburn: "9c4a2a", honey: "c8933f" };
const SKIN = { light: "ffdbb4", warm: "edb98a", tan: "d08b5b", deep: "ae5d29" };

/** what every face shares: open eyes, a smile, calm brows, nothing random left to the seed */
const BASE = { eyes: ["default"], mouth: ["smile"], eyebrows: ["defaultNatural"], accessoriesProbability: 0, facialHairProbability: 0 };

/** five women, then three men — the index IS the label («آواتار ۱» …) */
export const FACES = [
  { key: "f-long",    note: "long straight hair",   bg: BG.rose,  o: { top: ["straight01"], hairColor: [HAIR.espresso], skinColor: [SKIN.warm],  clothing: ["shirtCrewNeck"],    clothesColor: ["e0708a"] } },
  { key: "f-bob",     note: "auburn bob",           bg: BG.sky,   o: { top: ["bob"],        hairColor: [HAIR.auburn],   skinColor: [SKIN.light], clothing: ["blazerAndShirt"],   clothesColor: ["5199e4"] } },
  { key: "f-curly",   note: "black curls",          bg: BG.mint,  o: { top: ["curly"],      hairColor: [HAIR.black],    skinColor: [SKIN.tan],   clothing: ["shirtVNeck"],       clothesColor: ["2fa37a"] } },
  { key: "f-bun",     note: "honey bun",            bg: BG.sand,  o: { top: ["bun"],        hairColor: [HAIR.honey],    skinColor: [SKIN.light], clothing: ["collarAndSweater"], clothesColor: ["f0a03a"] } },
  { key: "f-hijab",   note: "a headscarf",          bg: BG.lilac, o: { top: ["hijab"],      hatColor: ["6d5bd0"],       skinColor: [SKIN.warm],  clothing: ["shirtScoopNeck"],   clothesColor: ["8f83e0"] } },
  { key: "m-short",   note: "short dark hair",      bg: BG.aqua,  o: { top: ["shortFlat"],  hairColor: [HAIR.espresso], skinColor: [SKIN.light], clothing: ["shirtCrewNeck"],    clothesColor: ["3568c4"] } },
  { key: "m-beard",   note: "short hair, a beard",  bg: BG.peach, o: { top: ["shortWaved"], hairColor: [HAIR.black],    skinColor: [SKIN.tan],   clothing: ["hoodie"],           clothesColor: ["2f8f6e"], facialHairProbability: 100, facialHair: ["beardMedium"], facialHairColor: [HAIR.black] } },
  { key: "m-glasses", note: "curls and glasses",    bg: BG.pink,  o: { top: ["shortCurly"], hairColor: [HAIR.chestnut], skinColor: [SKIN.deep],  clothing: ["blazerAndSweater"], clothesColor: ["c9702b"], accessoriesProbability: 100, accessories: ["prescription02"], accessoriesColor: ["262e33"] } },
];

export function renderPresets() {
  return FACES.map((f) => ({
    key: f.key,
    note: f.note,
    svg: createAvatar(avataaars, { seed: f.key, size: SIZE, backgroundColor: [f.bg], ...BASE, ...f.o }).toString(),
  }));
}

function version(pkg) {
  return JSON.parse(readFileSync(new URL(`../node_modules/${pkg}/package.json`, import.meta.url), "utf8")).version;
}

export function moduleText() {
  const presets = renderPresets();
  const lines = [
    "/**",
    " * GENERATED by scripts/gen-avatar-presets.mjs — never edited by hand. Change",
    " * the table in the script and run it; avatarPresets.test.ts runs the script's",
    " * --check and fails when this file disagrees with it.",
    " *",
    " * EIGHT READY-MADE AVATARS for the profile (user, 2026-09-17: \"5 girls and 3",
    " * boys, animated\"; then \"use something better designed\"). Drawn by DiceBear's",
    ` * Avataaars — ${avataaars.meta.creator}, ${avataaars.meta.source}, ${avataaars.meta.license.name} —`,
    ` * through @dicebear/core ${version("@dicebear/core")} and @dicebear/avataaars ${version("@dicebear/avataaars")},`,
    " * every trait pinned by name in the script. The app never loads DiceBear;",
    " * these are the eight pictures it produced, inlined as the first set was.",
    " *",
    " * The order is five women, then three men; AvatarEditor labels them by",
    " * index («آواتار ۱» …), so the order is part of the contract. Each SVG carries",
    " * DiceBear's own element ids (`viewboxMask`), which is why the editor draws",
    " * them as <img> data URLs and never inlines eight of them into one document.",
    " */",
    "export type AvatarPreset = { key: string; svg: string };",
    "",
    "export const AVATAR_PRESETS: readonly AvatarPreset[] = [",
  ];
  presets.forEach((p, i) => {
    lines.push(`  /* ${i + 1} — ${p.note} */`);
    lines.push(`  { key: ${JSON.stringify(p.key)}, svg: ${JSON.stringify(p.svg)} },`);
  });
  lines.push("];", "");
  return lines.join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const check = process.argv.indexOf("--check");
  if (check >= 0) {
    // `--check [path]`: the path exists so a test can prove the check fails on
    // a file that differs — a check whose only reds were its own has never
    // failed for its reason.
    const target = process.argv[check + 1] ? pathToFileURL(resolve(process.argv[check + 1])) : OUT;
    const normalize = (s) => s.replace(/\r\n/g, "\n");
    let onDisk;
    try { onDisk = normalize(readFileSync(target, "utf8")); } catch { console.error(`gen-avatar-presets --check: cannot read ${fileURLToPath(target)}`); process.exit(2); }
    if (onDisk !== normalize(moduleText())) {
      console.error("gen-avatar-presets --check: the module on disk disagrees with the generator — run `node scripts/gen-avatar-presets.mjs`");
      process.exit(1);
    }
    console.log("gen-avatar-presets --check: the module agrees with the generator");
  } else {
    const text = moduleText();
    writeFileSync(OUT, text, "utf8");
    console.log(`wrote ${fileURLToPath(OUT)} (${text.length} chars, ${renderPresets().length} presets)`);
  }
}
