import { Icon, type IconName } from "@/components/icons";

/**
 * A workflow's identity mark — the round tile its detail page wears in the
 * header, and its card wears in the list.
 *
 * Extracted rather than drawn twice (2026-08-28, when the list became two big
 * cards). The tile encodes two answers that are easy to get subtly different:
 * which glyph a card's `icon` field means, and that `coral` is the danger
 * family rather than a colour name someone maps by eye. A second copy is where
 * those answers start disagreeing — the list would go on showing a paper plane
 * for a template whose own page had moved to an envelope, and nothing would
 * look broken on either screen.
 */

/**
 * The glyph, keyed by the card's own `icon` field. It maps into the platform's
 * icon SET rather than to a text character: the set is the product's one
 * visual language (user directive, 2026-08-26), and a text glyph blown up to
 * fill a tile wears neither its stroke nor its grid.
 */
const TILE_ICON: Readonly<Record<string, IconName>> = {
  calendar: "calendar",
  /* a PAPER PLANE (user directive, 2026-08-27: "with the right logos or
     icons", against a reference whose mail workflow carries one). db/0065
     names this icon `send` and the workflow's output is an outgoing reply,
     so the plane says what it does; the envelope would say what it reads. */
  send: "send",
  sparkles: "zap",
};

export function WorkflowTile({
  icon,
  color,
  size = "card",
}: {
  /** the card's own `icon` field — `calendar`, `send`, `sparkles` */
  icon: string;
  /** the card's own `color` field; `coral` is the danger family */
  color: string;
  /** `hero` is the detail page's 96px header mark; `card` the list's 64px */
  size?: "card" | "hero";
}) {
  const hero = size === "hero";
  return (
    <span
      className={`grid ${hero ? "h-24 w-24" : "h-16 w-16"} shrink-0 place-items-center rounded-full ${
        color === "coral"
          ? "bg-danger text-on-danger shadow-[0_18px_44px_-14px_rgb(var(--danger)/0.75)]"
          : "bg-accent text-on-accent shadow-[0_18px_44px_-14px_rgb(var(--accent)/0.75)]"
      }`}
      aria-hidden
    >
      <Icon name={TILE_ICON[icon] ?? "zap"} size={hero ? "hero" : "xl"} />
    </span>
  );
}
