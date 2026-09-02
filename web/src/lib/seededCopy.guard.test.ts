import { describe, expect, it } from "vitest";
import en from "../messages/en.json";
import fa from "../messages/fa.json";
import { SEEDED_STARTERS, SEEDED_TEMPLATES } from "./workflowName";

/**
 * SHIPPED CONTENT ARRIVES FROM THE DATABASE IN ENGLISH, AND THAT IS FINE
 * ONLY WHILE A CATALOGUE ENTRY EXISTS FOR IT.
 *
 * Every seeded workflow is written into Postgres by a migration, in English,
 * because SQL is where it lives. The screen is supposed to replace that with
 * the reader's language — and when the catalogue entry is missing, the
 * resolver falls back to the stored string ON PURPOSE (visible and
 * untranslated beats invisible and broken). So the failure is silent by
 * design: a Persian screen quietly shows an English sentence, and nothing
 * anywhere goes red.
 *
 * That is exactly what happened to the two workflow_template cards — the
 * product's two flagship workflows introduced themselves in English on their
 * own page for as long as the feature has existed, and a user found it.
 *
 * Persian is the DEFAULT locale here, which makes it the one a reviewer is
 * structurally least likely to check: whoever adds a seeded row is usually
 * writing the English. So both locales are asserted, and the seeded maps —
 * which are the transcription of the migration — are the source of the list.
 */
const CATALOGUES = [
  { what: "workflow starters", seeded: SEEDED_STARTERS, namespace: "starter" as const },
  { what: "workflow templates", seeded: SEEDED_TEMPLATES, namespace: "card" as const },
];

type Copy = { name?: unknown; description?: unknown };

function catalogue(messages: typeof fa, namespace: "starter" | "card"): Record<string, Copy> {
  return (messages.workflows as Record<string, unknown>)[namespace] as Record<string, Copy>;
}

describe("seeded copy has somewhere to be translated", () => {
  for (const { what, seeded, namespace } of CATALOGUES) {
    it(`has something to check — ${what} are actually seeded`, () => {
      /* a day when the map is emptied or renamed turns every assertion below
         into a pass about nothing */
      expect(Object.keys(seeded).length).toBeGreaterThan(0);
    });

    for (const [locale, messages] of [["fa", fa], ["en", en]] as const) {
      it(`${locale}: every seeded ${what} row has a name AND a description`, () => {
        const entries = catalogue(messages, namespace);
        const broken: string[] = [];
        for (const id of Object.keys(seeded)) {
          const entry = entries?.[id];
          if (entry === undefined) { broken.push(`${id} — no entry at all`); continue; }
          /* a half-entry is the worse bug: the title localizes, the sentence
             under it stays English, and the screen looks translated */
          if (typeof entry.name !== "string" || entry.name.trim() === "") broken.push(`${id}.name`);
          if (typeof entry.description !== "string" || entry.description.trim() === "") {
            broken.push(`${id}.description`);
          }
        }
        expect(
          broken,
          `these fall back to the seeded English on a ${locale} screen:\n` + broken.join("\n"),
        ).toEqual([]);
      });
    }
  }
});
