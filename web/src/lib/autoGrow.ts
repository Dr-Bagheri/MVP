"use client";

import { useLayoutEffect, type RefObject } from "react";

/**
 * A PROMPT BOX THAT GROWS WITH WHAT IS IN IT.
 *
 * User directive, 2026-09-04: "the command bar or prompt box must be
 * multi-line and it should get as much as I gave it, and in it it should show
 * at least three lines then go to scroll mode inside it with a thin scroll
 * inside the box."
 *
 * The hub's composer was an `<input>` — one line by construction, no wrapping
 * at all, so a dictated paragraph scrolled away sideways and the person could
 * see the last few words of their own sentence. The panel's was a `<textarea
 * rows={1}>`, which is the same picture with a scrollbar.
 *
 * ── WHY A HOOK AND NOT A CSS TRICK ────────────────────────────────────────
 *
 * `field-sizing: content` does this in one line of CSS and is not in enough
 * browsers to be the only mechanism. The two-element grid trick (a mirror
 * `<span>` sized by the same text) works everywhere and costs a duplicated
 * subtree the screen reader can see. Measuring `scrollHeight` is the one that
 * is exact, portable and invisible.
 *
 * ── THE PART THAT IS EASY TO GET WRONG ────────────────────────────────────
 *
 * The height must be reset to `auto` before `scrollHeight` is read. Left at
 * its previous value the box can grow and never shrink, because a taller
 * element reports the taller scroll height that is keeping it tall — the
 * measurement returns the thing being measured. Deleting a paragraph would
 * leave a five-line box with one word in it.
 */
export function useAutoGrow(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
  rows: { min: number; max: number },
): void {
  useLayoutEffect(() => {
    const node = ref.current;
    if (node === null) return;
    const style = getComputedStyle(node);
    /* a line-height of `normal` computes to a px value in every browser this
       runs in, but not to a NUMBER — fall back to a ratio of the font size
       rather than to NaN, which would make every height calculation vanish */
    const line = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.5;
    const padding = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
    const min = line * rows.min + padding;
    const max = line * rows.max + padding;

    node.style.height = "auto";
    const wanted = node.scrollHeight;
    node.style.height = `${Math.min(Math.max(wanted, min), max)}px`;
    /*
     * The scrollbar appears only at the ceiling. `overflow-y: auto` at all
     * times gives some platforms a permanent gutter and, on the frame where
     * the box is one line shorter than its content, a bar that flickers in and
     * out as somebody types.
     */
    const scrolls = wanted > max;
    node.style.overflowY = scrolls ? "auto" : "hidden";
    /*
     * THE FADE BELONGS TO THE SCROLLING STATE, not to the element.
     *
     * A mask on a box that fits its content just dims its first and last
     * lines for no reason — the fade means "there is more past this edge",
     * and on a full box there is not. Toggled here because this is the one
     * place that knows, and a class the component sets statically would be
     * a second answer to the same question.
     */
    node.classList.toggle("fade-scroll", scrolls);
  }, [ref, value, rows.min, rows.max]);
}
