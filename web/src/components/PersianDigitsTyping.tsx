"use client";

import { useEffect } from "react";
import { faDigits } from "@/lib/format";

/**
 * TYPED DIGITS FOLLOW THE LANGUAGE (user, 2026-09-05: "when I write in the fa
 * version, all the numbers must be written in Persian as well").
 *
 * The DISPLAY side has been Persian since M9 (`digits()`); the INPUT side was
 * not — a person typing 1000 into a Persian description got "1000" inside a
 * sentence whose every other number read «۱۰۰۰». One listener on the
 * document, in the CAPTURE phase — before React's own handler sees the event
 * — rewrites the field's value through the element's NATIVE setter (React's
 * instrumented setter would tell its value tracker about the write, and React
 * would then see "no change" and drop the event), keeps the caret where it
 * was (a one-for-one replacement moves nothing), and lets the event continue
 * to React, which reads the converted value and stores it. No form needs to
 * know; a form written next month gets it for free.
 *
 * WHICH FIELDS: text-shaped ones — `<textarea>`, `<input>` of type text or
 * search — whose effective direction is RTL: the nearest `dir` decides, and
 * the document is `rtl` in fa. Fields pinned `dir="ltr"` are the Latin-shaped
 * ones by this repo's own convention (an email, a handle, a key, a code, an
 * IP) and keep ASCII; so do number/email/url/password inputs, which either
 * refuse Persian digits or carry data that must stay ASCII. Arabic-Indic
 * digits (٠-٩, what some keyboards type) become Persian too, so one text never
 * mixes two shapes of the same digit. Nothing runs while an IME is composing.
 *
 * Stored text carries Persian digits from then on; search folds digits at the
 * server (rule 4: normalization at ingest and at query), so «۱۰۰۰» and "1000"
 * still find each other.
 */

const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";

export function persianDigits(text: string): string {
  return faDigits(text.replace(/[٠-٩]/g, (d) => String(ARABIC_INDIC.indexOf(d))));
}

const TEXT_TYPES = new Set(["text", "search"]);

/** a field whose typed digits should read Persian — see the note above */
export function eligible(el: Element): el is HTMLInputElement | HTMLTextAreaElement {
  const isText =
    el instanceof HTMLTextAreaElement
    || (el instanceof HTMLInputElement && TEXT_TYPES.has(el.type));
  if (!isText) return false;
  if (el.readOnly || el.disabled) return false;
  const scope = el.closest<HTMLElement>("[dir]");
  const dir = scope !== null ? scope.getAttribute("dir") : document.documentElement.getAttribute("dir");
  return dir === "rtl";
}

/** rewrite the field's digits in place; true when anything changed */
export function convertTyped(el: HTMLInputElement | HTMLTextAreaElement): boolean {
  const before = el.value;
  const after = persianDigits(before);
  if (after === before) return false;
  const start = el.selectionStart;
  const end = el.selectionEnd;
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter === undefined) return false;
  setter.call(el, after);
  if (start !== null && end !== null) {
    try { el.setSelectionRange(start, end); } catch { /* a field without a caret */ }
  }
  return true;
}

export function PersianDigitsTyping({ locale }: { locale: string }) {
  useEffect(() => {
    if (locale !== "fa") return;
    const onInput = (e: Event) => {
      if ((e as InputEvent).isComposing) return;
      const target = e.target;
      if (!(target instanceof Element) || !eligible(target)) return;
      convertTyped(target);
    };
    document.addEventListener("input", onInput, true);
    return () => document.removeEventListener("input", onInput, true);
  }, [locale]);
  return null;
}
