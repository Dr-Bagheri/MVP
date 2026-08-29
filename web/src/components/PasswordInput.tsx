"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";

/*
 * The existing pair, not a new one. `IconEye` and `IconHide` already sit in
 * this set as the transcript's view-mode toggle — the first version of this
 * component drew its own eye and its own struck-through eye, which
 * typecheck caught as a redeclaration. Two drawings of one idea is how two
 * screens come to show slightly different eyes.
 */
import { IconEye, IconHide } from "@/components/icons";

/**
 * A password box that can show what you typed.
 *
 * ONE component rather than a toggle pasted beside each field. There are
 * eight password inputs across sign-in, sign-up, recovery, the OAuth
 * enrollment step and the profile's change-password form, and the repo has
 * already paid for the other version of this twice — the `.tap` fix and the
 * dock's header buttons both had to stop being local before they were
 * actually fixed. A component means the next password field inherits the
 * affordance instead of remembering it.
 *
 * ── why it matters on the sign-in gate specifically ─────────────────────
 * User directive, 2026-08-29. A person typing a password they may be about
 * to change has no way to check what they typed, and the Persian keyboard
 * layout makes a mistyped Latin password entirely invisible — eight dots
 * look identical whichever eight characters they are.
 *
 * ── the details that are easy to get wrong ──────────────────────────────
 *  · `dir="ltr"` on the input regardless of page direction: a password is a
 *    byte string, not prose, and an RTL page would otherwise render its
 *    revealed characters in a different order than they were typed.
 *  · The button is `type="button"`. Inside a form, the default is `submit` —
 *    revealing your password would post the form.
 *  · The button is NOT a tab stop (`tabIndex={-1}`): tabbing from the
 *    password field should reach the submit button, which is what someone
 *    filling a form expects. It stays reachable by pointer and by screen
 *    reader.
 *  · `aria-pressed` rather than a label that changes meaning — the control
 *    is a toggle, and its state is the thing assistive tech should announce.
 *  · Revealed state is never persisted anywhere. It resets on every mount,
 *    because "show my password" is a decision about one moment.
 */
export function PasswordInput({
  value,
  onChange,
  autoComplete,
  id,
  "aria-describedby": describedBy,
  "aria-invalid": invalid,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  autoComplete?: string;
  id?: string;
  "aria-describedby"?: string;
  /** the confirm fields set this while the two do not match */
  "aria-invalid"?: boolean;
  disabled?: boolean;
}) {
  const t = useTranslations("auth");
  const [shown, setShown] = useState(false);
  const fallbackId = useId();
  const inputId = id ?? fallbackId;

  return (
    <div className="relative">
      <input
        id={inputId}
        className="input pe-11"
        dir="ltr"
        type={shown ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        {...(autoComplete ? { autoComplete } : {})}
        {...(describedBy ? { "aria-describedby": describedBy } : {})}
        {...(invalid ? { "aria-invalid": true } : {})}
        {...(disabled ? { disabled: true } : {})}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-pressed={shown}
        aria-controls={inputId}
        aria-label={shown ? t("hidePassword") : t("showPassword")}
        title={shown ? t("hidePassword") : t("showPassword")}
        onClick={() => setShown((v) => !v)}
        /* `end-2`, not `right-2`: the box is LTR but the page may not be,
           and the eye belongs at the trailing edge of the field either way */
        className="absolute end-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-fg-muted hover:text-fg"
      >
        {shown
          ? <IconHide width={18} height={18} aria-hidden />
          : <IconEye width={18} height={18} aria-hidden />}
      </button>
    </div>
  );
}
