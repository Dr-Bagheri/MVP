"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { Org, User } from "@/api/types";
import { notify } from "@/lib/notify";
import { FormPanel, FormRow, Section } from "@/components/scaffold";

/**
 * Settings · General — the WORKSPACE (user directive, 2026-08-27: "for
 * general add the ones related to the workspace; the general you must be in
 * the profile settings").
 *
 * What left, and why the screen is better for it: **language and theme were
 * personal**, and they already had a home on Profile. Two homes for one
 * preference is two states that eventually disagree, and the way that
 * surfaces is somebody switching to light in one place and finding dark in
 * the other. They now live only on Profile.
 *
 * What arrived is the thing this screen was always the right place for: the
 * settings that apply to EVERYONE in the workspace and are therefore an
 * admin's to set, not a person's to prefer.
 *
 * ── The autonomy ceiling, and the defect it closes ──────────────────────────
 *
 * db/0075 added `echo.org.autonomy_ceiling` and `actorAutonomy` has clamped
 * every member to `least(their choice, this)` ever since. What never existed
 * was a way to MOVE it — the column was written by its own default and by
 * nothing else. A cap that cannot be set is a producer with no consumer
 * pointed the other way: the enforcement was real, the control was missing,
 * and no test could see the gap because the default is the permissive value.
 *
 * ── What is NOT here ────────────────────────────────────────────────────────
 *
 * The organisation's identity — name, logo, glossary, public face — is
 * Management · General's, and this screen no longer even links there (user
 * directive, 2026-08-27): admins reach it from the Management menu, and a
 * door here was one more thing to read on a screen that answers a
 * different question.
 */

/** The dial's rungs, lowest first. Mirrors core's AUTONOMY_LEVELS. */
const CEILINGS = ["watch", "assist", "act"] as const;

export function GeneralSettings() {
  const t = useTranslations("settings");

  const [me, setMe] = useState<User | null>(null);
  const [org, setOrg] = useState<Org | null>(null);
  const [busy, setBusy] = useState(false);

  const isAdmin = me?.role === "admin" || me?.role === "owner";
  /* ABSENT means un-migrated, which is not the same as "no cap": a select
     rendered for a column that does not exist would save nothing and look
     like it saved. */
  const ceilingReady = org !== null && org.autonomy_ceiling !== undefined;

  useEffect(() => {
    void api.me().then(setMe);
    void api.org().then(setOrg).catch(() => undefined);
  }, []);

  async function setCeiling(value: string) {
    if (busy || !org) return;
    setBusy(true);
    try {
      /* adopt the SERVER's answer rather than the value we sent — if core
         normalised it, that is the value the workspace actually has */
      setOrg(await api.updateOrg({ autonomy_ceiling: value }));
      notify(t("workspaceSaved"));
    } catch {
      notify(t("workspaceSaveFailed"), "warn");
    } finally {
      setBusy(false);
    }
  }

  if (!org) return null;

  return (
    <>
      <Section title={t("workspaceTitle")}>
        <FormPanel>
          {ceilingReady ? (
            <FormRow
              label={t("autonomyCeiling")}
              description={t("autonomyCeilingHint")}
              htmlFor="ws-ceiling"
            >
              {isAdmin ? (
                <select
                  id="ws-ceiling"
                  className="input min-h-0 h-11 md:h-control"
                  value={org.autonomy_ceiling}
                  disabled={busy}
                  onChange={(event) => void setCeiling(event.target.value)}
                >
                  {CEILINGS.map((level) => (
                    <option key={level} value={level}>
                      {t(`autonomy_${level}` as "autonomy_watch")}
                    </option>
                  ))}
                </select>
              ) : (
                /* a member SEES the cap that governs their own dial — hiding
                   it would withhold the explanation for a setting of theirs
                   that will not go any higher */
                <span className="text-sm text-fg">
                  {t(`autonomy_${org.autonomy_ceiling}` as "autonomy_watch")}
                </span>
              )}
            </FormRow>
          ) : null}
        </FormPanel>
        {!isAdmin ? (
          <p className="mt-2 text-detail leading-6 text-fg-muted">{t("orgAdminOnly")}</p>
        ) : null}
      </Section>
    </>
  );
}
