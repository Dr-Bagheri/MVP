/**
 * The link between a Telegram account and a colleague (db/0212).
 *
 * A bot answers anybody. So before a message from Telegram can become
 * anything on the board, the sender has to prove they are somebody here —
 * and the proof is a short code minted in the product, where they are
 * already signed in, sent to the bot from the account they are claiming.
 *
 * ── THE CODE ─────────────────────────────────────────────────────────────
 *
 * 40 bits of CSPRNG in an alphabet with no O/0 and no I/1/l, because this is
 * a string a person reads off a screen and types into a phone with a
 * different keyboard layout. It is stored as a SHA-256 hash and returned
 * exactly once, in the response that mints it — 0043's invitation shape, at
 * the size a human can retype.
 *
 * Short codes need their weakness paid for somewhere, and the payments are:
 * fifteen minutes, one live code per person (a partial unique index, not a
 * convention), single use, and — the one that actually bounds a guess — the
 * code is only ever compared inside ONE organisation, because the worker
 * looks it up with the polled connection's own org id.
 *
 * ── WHAT THE LINK IS NOT ─────────────────────────────────────────────────
 *
 * It is not an authorization. It carries no role, no scope and no capability:
 * everything the poller then does runs under that colleague's OWN identity,
 * with their own RLS, exactly as if they had typed it into the product. The
 * link answers "who is this", and nothing else.
 */
import { createHash, randomBytes } from "node:crypto";
import type { Db, SqlTx } from "../db/identity.ts";
import type { Identity } from "../agent/types.ts";
import { NotFoundError } from "./errors.ts";

/**
 * No O, 0, I, 1 or L. A code is read off a screen and typed on a phone, and
 * the two characters people actually confuse cost a support message each.
 */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;
const TTL_MINUTES = 15;

/** The code as the database stores it. The plaintext never reaches a column. */
export function hashCode(code: string): string {
  return createHash("sha256").update(normalizeCode(code)).digest("hex");
}

/**
 * What somebody typed, as the code they meant.
 *
 * Upper-cases and drops everything outside the alphabet, so «۱۲۳ ABC-DEF» and
 * "abcdef" reach the same hash. Persian keyboards produce Arabic-Indic digits
 * and phones insert spaces; refusing those would be a product that works for
 * whoever tested it.
 */
export function normalizeCode(input: string): string {
  const latinised = input.replace(/[۰-۹٠-٩]/g, (d) => {
    const code = d.codePointAt(0) ?? 0;
    const base = code >= 0x0660 && code <= 0x0669 ? 0x0660 : 0x06f0;
    return String(code - base);
  });
  return latinised.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** A fresh code. Rejection sampling, so every character is equally likely. */
export function mintCode(bytes: (n: number) => Buffer = randomBytes): string {
  let out = "";
  while (out.length < CODE_LENGTH) {
    for (const byte of bytes(CODE_LENGTH)) {
      if (out.length === CODE_LENGTH) break;
      /* 256 is not a multiple of 31, so the top of the byte range would
         favour the first characters. Discard rather than modulo. */
      if (byte >= 248) continue;
      out += ALPHABET[byte % ALPHABET.length];
    }
  }
  return out;
}

export interface TelegramLinkRecord {
  linked: boolean;
  telegram_username: string | null;
  linked_at: string | null;
  /** a live code's expiry, when one is outstanding — never the code itself */
  code_expires_at: string | null;
  /**
   * The organisation's bot, by its public @handle (db/0213).
   *
   * It has to come from a definer door: `connector_connection` is
   * owner-scoped, so without one every colleague except whoever connected the
   * bot is told to "send this code to the bot" with no way to find out which.
   * Null means no bot is connected — a different sentence, not a missing one.
   */
  bot_username: string | null;
}

interface LinkRow {
  telegram_username: string | null;
  linked_at: Date | null;
}

interface CodeRow {
  expires_at: Date;
}

export function createTelegramLinkRepo(db: Db) {
  /** What the person's own settings screen shows: linked, or waiting. */
  async function status(identity: Identity): Promise<TelegramLinkRecord> {
    const [links, codes, bots] = await db.withIdentity(identity, async (tx: SqlTx) => [
      await tx.unsafe<LinkRow>(
        "select telegram_username, linked_at from echo.telegram_identity limit 1"),
      await tx.unsafe<CodeRow>(
        "select expires_at from echo.telegram_link_code where redeemed_at is null and expires_at > now() limit 1"),
      await tx.unsafe<{ bot_username: string | null }>(
        "select bot_username from echo.org_telegram_bot()"),
    ]);
    const link = links[0];
    return {
      linked: link !== undefined,
      telegram_username: link?.telegram_username ?? null,
      linked_at: link?.linked_at?.toISOString() ?? null,
      code_expires_at: codes[0]?.expires_at.toISOString() ?? null,
      bot_username: bots[0]?.bot_username ?? null,
    };
  }

  /**
   * Mint a code, replacing any live one.
   *
   * Replacing rather than refusing: somebody who pressed the button, lost the
   * screen and pressed it again wants a code, and "you already have one you
   * cannot see" is an answer they can do nothing with. The partial unique
   * index is what makes the delete-then-insert honest — without it a race
   * would leave two live codes and this would merely usually work.
   */
  async function mint(identity: Identity): Promise<{ code: string; expires_at: string }> {
    const code = mintCode();
    const expires = new Date(Date.now() + TTL_MINUTES * 60_000);
    await db.withIdentity(identity, async (tx: SqlTx) => {
      await tx.unsafe("delete from echo.telegram_link_code where redeemed_at is null");
      await tx.unsafe(
        `insert into echo.telegram_link_code (org_id, user_id, code_hash, expires_at)
         values (echo.actor_org_id(), echo.actor_id(), $1, $2)`,
        [hashCode(code), expires],
      );
    });
    /* the ONLY time the plaintext exists outside the person's own screen */
    return { code, expires_at: expires.toISOString() };
  }

  /**
   * Unlink. Their own row, by policy — the grant reaches exactly one person's
   * link and the delete's own `returning` is what tells a caller whether
   * there was one, rather than a second read that could disagree.
   */
  async function unlink(identity: Identity): Promise<void> {
    const gone = await db.withIdentity(identity, (tx: SqlTx) => tx.unsafe<{ id: string }>(
      "delete from echo.telegram_identity returning id"));
    if (gone.length === 0) throw new NotFoundError();
  }

  /** Cancel a live code without linking. */
  async function cancel(identity: Identity): Promise<void> {
    await db.withIdentity(identity, (tx: SqlTx) => tx.unsafe(
      "delete from echo.telegram_link_code where redeemed_at is null"));
  }

  return { status, mint, unlink, cancel };
}

export type TelegramLinkRepo = ReturnType<typeof createTelegramLinkRepo>;
