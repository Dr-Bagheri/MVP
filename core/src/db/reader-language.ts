/**
 * WHAT LANGUAGE DOES THE PERSON WE ARE WRITING TO READ?
 *
 * Found on 2026-09-09, in the same demo rehearsal that produced db/0219: an
 * ENGLISH organisation (`acme`, `echo.org.locale = 'en'`), an English screen
 * at /en, English content throughout — and the assistant's own conversation
 * list reading «خلاصهٔ آمادهٔ «Weekly meeting with NAI»». The person's own
 * conversations were titled correctly, because their titles are the person's
 * own first question. The titles the PRODUCT writes were hard-coded Persian.
 *
 * 0219 fixed the summariser, whose text is written by a model and can follow
 * the meeting it read. This module is for the other half: text the SERVER
 * composes itself — a brief's title, a digest's body, the line that stands in
 * for a note the model did not write. No model reads it and no model writes
 * it, so nothing about it can "follow the conversation": somebody has to
 * decide, at the moment of writing, which language the person opening it
 * reads.
 *
 * ── THE LADDER, AND WHY THE PERSON IS THE FIRST RUNG ──────────────────────
 *
 *   1. `echo.app_user.locale` — the person's own.
 *   2. `echo.org.locale`      — the organisation's.
 *   3. `fa`                   — Persian-first, the product's default locale.
 *
 * Rung 1 is not merely "their preference": it is the SAME VALUE the interface
 * itself runs on. `PATCH /v1/me` writes it, the shell renders /fa or /en from
 * it, and every other string on the screen a card lands on comes from that
 * locale's catalogue. Composing in it is therefore the only rule under which
 * a delivered card can never disagree with the screen it is delivered to —
 * which is the 2026-09-06 ruling (one language per screen) stated as a
 * mechanism instead of as a habit. It also degrades in the right direction: a
 * person whose language is wrong has ONE value to correct, and correcting it
 * fixes the interface and the deliveries together.
 *
 * REFUSED — the organisation alone. It reads as the tidier rule (an English
 * org gets English, done) and it is wrong for a real row on this deployment:
 * `demo@pishrodata.demo` is an ENGLISH reader inside a Persian organisation.
 * Org-only would hand that person Persian cards on an English screen, which
 * is the reported bug with the languages swapped — and this product is
 * Persian-first, so the swapped version is the one nobody would notice.
 *
 * REFUSED — a key in the row, localised by web/ at read time. That is the
 * right mechanism where the row IS a label with a stable identity, and this
 * repo already uses it there (`lib/seededNames.ts` for the four seeded task
 * columns, `lib/workflowName.ts` for shipped workflows, `lib/skillName.ts`
 * for system skills). It does not reach here: the brief's body is an
 * `agent_message` — a persisted assistant turn, the record of what was
 * delivered — and a key sitting in `content` is a raw key on every surface
 * that renders a message as prose (the thread, the export, search) plus a
 * migration to carry the parameters. The catalogue mechanism localises a
 * NAME; this is a paragraph.
 *
 * ── WHAT THIS COSTS, SAID OUT LOUD ────────────────────────────────────────
 *
 * A card written before somebody switched their language stays in the
 * language it was written in. That is deliberate and it is the same posture
 * the rest of the platform takes toward a persisted turn: a message is a
 * record of something that was said, and re-translating it later would edit
 * the record. The alternative buys retro-active translation at the price of
 * putting keys where prose is promised.
 */
import type { Identity } from "../agent/types.ts";
import type { Db, SqlTx } from "./identity.ts";

/** The two languages this product ships an interface in. */
export type ReaderLanguage = "fa" | "en";

/**
 * A stored locale → a language we can actually write, or null.
 *
 * `PATCH /v1/me` validates locale by SHAPE and not against a closed list
 * (`members.ts`: "the rule moves, the catalogue does not"), so the column can
 * legitimately hold `en-GB` or `fa-IR`, and could hold `de`. The base subtag
 * is the language; anything that is not one of ours returns null so the
 * caller falls to the NEXT RUNG rather than to the floor — an organisation's
 * language is a better guess for a German reader than Persian is, and both
 * are better than inventing a third catalogue we do not have.
 */
export function readerLanguageOf(value: unknown): ReaderLanguage | null {
  if (typeof value !== "string") return null;
  const base = value.trim().toLowerCase().split(/[-_]/)[0];
  return base === "fa" || base === "en" ? base : null;
}

/**
 * The language to compose in for one person, read under their own identity.
 *
 * ONE round trip, and the same join `mail-poll.ts` and `meeting-prep.ts`
 * already make for the model ladder — so this reaches nothing they do not
 * already reach, and needs no grant and no migration.
 *
 * A read that finds nothing (an owner who has gone, an org that has) is not
 * an error here: the caller is mid-delivery and the language is a rendering
 * decision, not an authorisation. It falls to Persian, the product's default
 * locale, exactly as an unreadable value does.
 */
export async function readerLanguage(db: Db, identity: Identity): Promise<ReaderLanguage> {
  const rows = await db.withIdentity(identity, (tx: SqlTx) =>
    tx.unsafe<{ person: string | null; org: string | null }>(
      `select u.locale as person, o.locale as org
         from echo.app_user u join echo.org o on o.id = u.org_id
        where u.id = $1 limit 1`,
      [identity.userId],
    ));
  const row = rows[0];
  return readerLanguageOf(row?.person) ?? readerLanguageOf(row?.org) ?? "fa";
}
