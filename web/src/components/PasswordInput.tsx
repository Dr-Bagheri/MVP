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
        /*
         * `pr-11`, not `pe-11`. The two are the same thing only when the
         * reference direction is the same, and here it is NOT: this input is
         * pinned `dir="ltr"` (a password is typed left to right whatever the
         * page does), so its own logical END is the RIGHT — while the button
         * below sits outside it, in the PAGE's direction. Written as logical
         * properties the field reserved space on one side and the eye sat on
         * the other, which in Persian put the eye on top of the dots.
         */
        className="input pr-11"
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
        /*
         * `right-2`, and PHYSICAL on purpose — the exception that proves the
         * logical-properties rule rather than breaking it. The eye belongs at
         * the trailing edge of THIS FIELD, and the field is pinned LTR, so
         * its trailing edge is the right in every locale. `end-2` resolves
         * against the page instead, which is how the eye ended up on the far
         * side from the space reserved for it.
         */
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-fg-muted hover:text-fg"
      >
        {shown
          ? <IconHide width={18} height={18} aria-hidden />
          : <IconEye width={18} height={18} aria-hidden />}
      </button>
    </div>
  );
}
