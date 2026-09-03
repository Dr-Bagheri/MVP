"use client";

/**
 * THE PLATFORM'S SWITCH — the token the theme was missing.
 *
 * Found 2026-09-03 while emptying the control guard's worklist: NINE
 * `role="switch"` toggles across the product, hand-drawn every time, and four
 * of the guard's remaining entries were this one absence rather than four
 * separate defects. They disagreed on three axes at once, which is the user's
 * complaint in miniature ("one is small, one is big, one has one shape for
 * button, the other has the other one"):
 *
 *   · SIZE — a 24×44 track on the settings rows, a 20×36 track in the
 *     assistant panels. Two answers to one question.
 *   · THE KNOB — `bg-white shadow` in one place, `bg-bg` in another. In dark
 *     theme those are opposite colours: a white knob and a near-black one, on
 *     the same control, one screen apart.
 *   · WHAT "ON" MEANS — `bg-accent` on six of them and `bg-success` on the
 *     seventh. Success is a semantic colour meaning "this is healthy"; a
 *     switch being on is not a health report.
 *
 * Nobody was careless, and this is the same shape as the finding that started
 * the whole pass: `.btn` offered exactly one size, so any screen that wanted a
 * compact control invented one. The theme shipped `.btn`, `.btn-sm`,
 * `.btn-icon` and `.input` — and no switch — so every screen that needed one
 * drew it. The fix is the same too: name the sizes, so choosing a third is a
 * decision rather than a necessity.
 *
 * DIRECTION. The knob slides between `start-0.5` and `end-0.5`, never
 * `translate-x`, because `translate-x` is physical: on a Persian screen a
 * knob told to move right moves the wrong way, and it does it silently. The
 * existing switches already had this right and it is kept deliberately.
 */

const TRACK = {
  /** the settings-row switch: 44×24 with a 20px knob */
  md: { track: "h-6 w-11", knob: "h-5 w-5" },
  /** the compact one, for a switch that sits inline in a sentence */
  sm: { track: "h-5 w-9", knob: "h-4 w-4" },
} as const;

export function Switch({
  checked,
  onChange,
  label,
  size = "md",
  disabled = false,
  className = "",
  id,
}: {
  checked: boolean;
  onChange: () => void;
  /** the accessible name — a switch with no label is a control nobody can
      describe, and every one of the nine already carried one */
  label: string;
  size?: keyof typeof TRACK;
  disabled?: boolean;
  className?: string;
  /** when a FormRow's `htmlFor` points here — a label pointing at an id that
      does not exist is worse than no label, because it reads as associated */
  id?: string;
}) {
  const { track, knob } = TRACK[size];
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      /* `.tap` and not `.btn`: a switch is a track with a knob inside it, and
         `.btn` would give it a button's height, corner and padding and leave
         the knob positioned against a box that no longer exists. What it DOES
         need from the theme is the 44px hit target below md, which `.tap`
         carries — three of the nine had no hit area at all. */
      className={`tap relative shrink-0 rounded-full transition-colors disabled:opacity-50 ${track} ${
        checked ? "bg-accent" : "border border-border bg-surface-2"
      } ${className}`}
    >
      <span
        aria-hidden
        className={`absolute top-0.5 rounded-full bg-white shadow transition-all ${knob} ${
          checked ? "end-0.5" : "start-0.5"
        }`}
      />
    </button>
  );
}
