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
 *
 * NOT A CONTROL, which is why control.guard carries this file with a reason
 * rather than a conversion (2026-09-03). It shares a button's shape — a fixed
 * box, a corner, centred contents — and shares nothing else: it is an
 * `aria-hidden` span, it has no handler, and the thing that IS pressable is
 * the card or the header it sits inside. Dressing an identity mark as `.btn`
 * would put a button's face on 96px of decoration and offer a press that
 * goes nowhere.
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
  /**
   * `hero` is the detail page's 96px header mark, `card` the list's 64px,
   * and `sm` the 40px one an authored workflow's half-height card carries —
   * same mark, same colours, one size down, because those cards say
   * "smaller", not "lesser".
   */
  size?: "card" | "hero" | "sm";
}) {
  const hero = size === "hero";
  const small = size === "sm";
  return (
    <span
      className={`grid ${hero ? "h-24 w-24" : small ? "h-10 w-10" : "h-16 w-16"} shrink-0 place-items-center rounded-full ${
        color === "coral"
          ? "bg-danger text-on-danger shadow-[0_18px_44px_-14px_rgb(var(--danger)/0.75)]"
          : "bg-accent text-on-accent shadow-[0_18px_44px_-14px_rgb(var(--accent)/0.75)]"
      }`}
      aria-hidden
    >
      <Icon name={TILE_ICON[icon] ?? "zap"} size={hero ? "hero" : small ? "md" : "xl"} />
    </span>
  );
}
