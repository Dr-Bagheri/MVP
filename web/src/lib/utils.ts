import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * The class joiner every shadcn/ui component expects.
 *
 * `twMerge` is the part that earns its place: it resolves CONFLICTS in
 * Tailwind's own terms, so a component's default `px-4` and a caller's
 * `px-2` end as `px-2` rather than as two classes whose winner depends on
 * the order Tailwind happened to emit them in. That ordering bug is exactly
 * the class of thing this codebase has hit twice at the CSS layer — the
 * unlayered `.tile`, the inert `.tap` — and it is the reason a variant API
 * beats hand-concatenated strings.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
