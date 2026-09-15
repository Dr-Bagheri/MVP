/**
 * THE ZONE A BROWSER SENT, or nothing.
 *
 * `client.ts` resolves `Intl.DateTimeFormat().resolvedOptions().timeZone`
 * and sends it with every ask so core can turn "nine in the morning" into
 * an instant (M24: a stored preference wins, "auto" follows the client).
 * Core read it from the day the field existed; the BFF in the middle never
 * declared or forwarded it, so every ask reached core zone-less and the
 * assistant reasoned in UTC while the screens beside it rendered Tehran.
 * The askForward guard now holds the pair for `ask`; this helper is the
 * shape check both stream routes share.
 *
 * A SHAPE check, deliberately not a validity one: the runtime that formats
 * dates is the authority on which zones exist (core's own reasoning in
 * members.ts, `assertRenderableZone`), and a curated list here would be a
 * second list that must agree with two others. What is refused is what an
 * IANA name can never be — control characters, spaces, a kilobyte of
 * anything — so a hostile body cannot ride the field into a prompt line.
 * An implausible value is DROPPED rather than refused: the field is a
 * courtesy from the client, and a person must not lose their question to
 * a zone string their runtime mis-spelt. Core then says "UTC" out loud.
 */
const ZONE_SHAPE = /^[A-Za-z_]+(\/[A-Za-z_+\-0-9]+)*$/;
const ZONE_MAX = 64;

export function plausibleZone(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const zone = value.trim();
  if (zone === "" || zone.length > ZONE_MAX) return undefined;
  return ZONE_SHAPE.test(zone) ? zone : undefined;
}
