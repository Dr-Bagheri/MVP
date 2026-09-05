"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

/**
 * The one-way door (M17, BFF.md §1).
 *
 * core/ mints a token, returns it in the create response, and stores only a
 * sha256 plus a six-character display prefix. There is no reveal endpoint and
 * there never will be — so this component is the ONLY moment the value
 * exists in the product, for keys and for webhook secrets alike.
 *
 * Three things make it a door rather than a notice:
 *
 * 1. The dialog around it is not dismissible. Escape and backdrop clicks are
 *    reflexes; here they would destroy the only copy.
 * 2. `beforeunload` is registered for exactly as long as this is mounted, so
 *    a reload or a closed tab costs a browser prompt. This is the "navigating
 *    away is unmistakably lossy" requirement, and it is the one case where
 *    that prompt is honest rather than obnoxious.
 * 3. The exit is gated on an explicit acknowledgement, not on a click that
 *    the eye can land on by accident.
 *
 * And what it does NOT do: no logging, no analytics, no localStorage, no
 * writing the value anywhere it could outlive this component. The value lives
 * in one prop and dies with the unmount.
 */
export function SecretOnce({
  body,
  value,
  ackLabel,
  onDone,
}: {
  /** The warning itself. The headline is the enclosing `Dialog`'s title — the
   *  same sentence twice inside one small panel reads as a rendering fault. */
  body: string;
  value: string;
  ackLabel: string;
  onDone: () => void;
}) {
  const t = useTranslations("gateway");
  const [copied, setCopied] = useState<"idle" | "ok" | "failed">("idle");
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Legacy assignment is still what several browsers key off.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  async function copy() {
    /*
     * A clipboard write can genuinely fail — an insecure context, a permission
     * policy, a browser that has none. Reporting "copied" anyway would be the
     * worst possible lie in this particular component: the user closes the
     * door believing they have the value, and the only recovery is
     * revoke-and-mint. So a failure says so and points at selecting by hand,
     * which is why the value sits in a `select-all` block rather than behind
     * a button.
     */
    try {
      await navigator.clipboard.writeText(value);
      setCopied("ok");
      setTimeout(() => setCopied("idle"), 2000);
    } catch {
      setCopied("failed");
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3">
        <svg
          viewBox="0 0 24 24"
          className="mt-0.5 h-4 w-4 shrink-0 text-warning"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
        </svg>
        <p className="text-sm leading-6 text-fg">{body}</p>
      </div>

      <div className="flex items-stretch gap-2">
        <code className="ltr min-w-0 flex-1 select-all break-all rounded-md border border-border bg-surface-2 p-3 font-mono text-xs text-fg">
          {value}
        </code>
        <button type="button" className="btn-secondary btn-sm" onClick={() => void copy()}>
          {copied === "ok" ? t("copied") : t("copy")}
        </button>
      </div>
      {copied === "failed" ? (
        <p className="mt-1.5 text-xs text-danger">{t("copyFailed")}</p>
      ) : null}

      {/* `.tap` here matters more than anywhere else on the screen: this is the
          checkbox that gates the only exit from an unrecoverable secret. */}
      <label className="tap mt-4 flex items-start gap-2">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 accent-[rgb(var(--accent))]"
          checked={acknowledged}
          onChange={(event) => setAcknowledged(event.target.checked)}
        />
        <span className="text-sm text-fg">{ackLabel}</span>
      </label>

      <div className="mt-4 flex justify-end">
        <button type="button" className="btn-primary" disabled={!acknowledged} onClick={onDone}>
          {t("done")}
        </button>
      </div>
    </div>
  );
}
