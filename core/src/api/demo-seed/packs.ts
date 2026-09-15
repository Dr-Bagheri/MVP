/**
 * The pack REGISTRY (M52) — the one place that knows both packs exist.
 *
 * Its own file rather than a re-export from pack.ts, because the packs
 * import their types from there and a registry inside it would be a cycle.
 * Anything that needs "the pack for this language" asks here; nothing else
 * imports content.en.ts or content.fa.ts by name, so adding a third language
 * is one entry and a file.
 */

import type { DemoLanguage, DemoPack } from "./pack.ts";
import { DEMO_LANGUAGES } from "./pack.ts";
import { PACK_EN } from "./content.en.ts";
import { PACK_FA } from "./content.fa.ts";

const PACKS: Record<DemoLanguage, DemoPack> = { en: PACK_EN, fa: PACK_FA };

/** Every pack, in the declared language order — for tests and the generator. */
export const ALL_PACKS: readonly DemoPack[] = DEMO_LANGUAGES.map((l) => PACKS[l]);

export function packFor(language: DemoLanguage): DemoPack {
  return PACKS[language];
}

/** A caller-supplied language, or a refusal that names what is on offer. */
export function isDemoLanguage(value: unknown): value is DemoLanguage {
  return typeof value === "string" && (DEMO_LANGUAGES as readonly string[]).includes(value);
}
