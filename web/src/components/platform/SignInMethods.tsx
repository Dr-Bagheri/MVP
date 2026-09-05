"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Switch } from "@/components/Switch";
/* the MODULE, not the barrel — DataTable's line, for DataTable's reason: a
   partial module stub of the scaffold barrel anywhere in the suite leaves its
   other exports undefined, and SettingsSecurity.test.tsx has exactly such a
   stub AND renders this component. Importing the file directly means a
   neighbour's stub cannot crash this row for a reason unrelated to it. */
import { Skeleton } from "@/components/scaffold/Skeleton";
import { api } from "@/api/client";
import type { Me } from "@/api/types";
import { notify } from "@/lib/notify";
import { Chip } from "@/components/ui";

/**
 * Settings · Sign-in methods.
 *
 * Since 0078 the availability of each external provider is a SETTING an
 * admin or the owner flips here — the toggle writes through core to the
 * SQL definer door (admin-walled twice; this screen only draws the state).
 * Members see the state without the switch: what the sign-in page offers
 * is a fact everyone may know and only admins may change.
 *
 * The projection updates on the server's answer, never optimistically —
 * a switch that flips back on refusal teaches exactly what happened.
 */
/*
 * What the row knows about itself, in three answers rather than a boolean
 * (2026-09-03: the frame before the data).
 *
 * `methods` starts as `[]` and each row read its state as `row?.enabled ??
 * true`, so every load painted BOTH providers «فعال» before anyone had asked
 * the server — a fallback wearing the costume of an answer. A provider that
 * was off showed as on until the fetch landed and then flipped, and a switch
 * pressed in that window sends the opposite of what the person read.
 *
 * `failed` is kept apart from `pending` for the same reason: a read that did
 * not happen is not the state «فعال», and it is not «خاموش» either.
 */
type Answer = "pending" | "ok" | "failed";

export function SignInMethods() {
  const t = useTranslations("signin");
  /* one sentence, borrowed rather than re-authored: Settings·Notifications
     says exactly this about a switch whose stored state could not be read */
  const tSettings = useTranslations("settings");
  const [methods, setMethods] = useState<{ provider: string; enabled: boolean }[]>([]);
  const [answer, setAnswer] = useState<Answer>("pending");
  const [me, setMe] = useState<Me | null>(null);
  /* NOT `me !== null`: a refused or failed identity read leaves `me` null
     forever, and a placeholder that waits on it would then never resolve —
     the skeleton-forever trap on the other side of this fix */
  const [meAnswered, setMeAnswered] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    void api.authMethods()
      .then((rows) => { setMethods(rows); setAnswer("ok"); })
      .catch(() => setAnswer("failed"));
    void api.me().then(setMe).catch(() => setMe(null)).finally(() => setMeAnswered(true));
  }, []);

  const mayToggle = me?.role === "admin" || me?.role === "owner";

  async function toggle(provider: "google" | "github", enabled: boolean): Promise<void> {
    setBusy(provider);
    try {
      const result = await api.setAuthMethod(provider, enabled);
      setMethods((prev) =>
        prev.map((m) => (m.provider === provider ? { ...m, enabled: result.enabled } : m)));
      notify(t(result.enabled ? "turnedOn" : "turnedOff", { method: t(`method_${provider}`) }));
    } catch {
      notify(t("toggleFailed"), "warn");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
        {(["google", "github"] as const).map((key) => {
          const row = methods.find((m) => m.provider === key);
          /* `?? true` is core's default for a provider it has no row for —
             read ONLY under `answer === "ok"`. Before the answer it was
             indistinguishable from the served value, which is the whole
             defect this section was fixed for. */
          const enabled = row?.enabled ?? true;
          return (
            <div key={key} className="flex items-center gap-3 px-5 py-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-fg">{t(`method_${key}`)}</p>
                <p className="mt-0.5 text-detail leading-6 text-fg-muted">{t(`method_${key}_note`)}</p>
              </div>
              {/* THE STATE, and only once there is one. The label and its
                  sentence above are structure — they come from the catalogue
                  and never wait — so what loads is the chip, in the chip's own
                  geometry (`.chip` is 20px tall and fully round). */}
              {answer === "pending" ? (
                <Skeleton className="h-5 w-14 rounded-full" />
              ) : answer === "failed" ? (
                <span className="text-detail text-fg-muted">{tSettings("notifUnreadable")}</span>
              ) : (
                <Chip tone={enabled ? "success" : "neutral"}>
                  {t(enabled ? "active" : "off")}
                </Chip>
              )}
              {/* THE SWITCH asks two questions and needs both answered: whether
                  this reader may flip it (identity) and which way it currently
                  points (the methods read). Its place is held meanwhile, in the
                  switch's own 44×24 (TRACK.md in Switch.tsx), so an admin's row
                  does not jump when the control arrives. A member's row settles
                  once when the answer says there is no control here — the
                  smaller of the two moves, and the only alternative is claiming
                  an answer to "who are you" before it has come back. */}
              {!meAnswered || answer === "pending" ? (
                <Skeleton className="h-6 w-11 rounded-full" />
              ) : mayToggle && answer === "ok" ? (
                /* the theme's switch (2026-09-03) — see components/Switch.tsx
                   for why nine of these were hand-drawn */
                <Switch
                  checked={enabled}
                  onChange={() => void toggle(key, !enabled)}
                  label={t("toggleLabel", { method: t(`method_${key}`) })}
                  disabled={busy !== null}
                  className={busy === key ? "opacity-60" : ""}
                />
              ) : null}
            </div>
          );
        })}
      </div>

      {/*
        The invitation-domain wall LEFT this screen (user directive,
        2026-08-28: "remove allowed invitation domains"). The COLUMN and its
        refusal at invitation-creation stay — db/0112's wall is untouched —
        only the editing surface is gone, so any domains already set keep
        binding until cleared at the wire.
      */}
    </div>
  );
}
