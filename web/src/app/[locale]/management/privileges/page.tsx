"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { CapabilityState, User } from "@/api/types";
import { ManagementPane } from "@/components/platform/ManagementPane";
import { PageHeader } from "@/components/scaffold";
import { Card } from "@/components/ui";
import { notify } from "@/lib/notify";

/**
 * MEMBER PRIVILEGES (user directive, 2026-08-26; db/0101).
 *
 * WHAT THIS SCREEN CAN AND CANNOT DO — said on the screen as well as here,
 * because a security surface that overstates itself is worse than none.
 * Every switch NARROWS what a role may do. The database decides which rows
 * a person can see at all, and nothing here widens that. So "members may
 * delete their own records" is a real switch — the database allows it
 * today, and turning it off makes the server refuse first — while
 * "members may read everyone's records" is not offered and never will be,
 * because it would be a promise the database overrules.
 *
 * The hierarchy belongs to the database too (0101's policy). It is
 * mirrored here only so the screen greys what it cannot change rather than
 * offering a switch that will be refused: an admin binds MEMBERS, the
 * owner binds ADMINS, nobody binds the owner. That last one is the exit
 * D27 asks for — if an admin could bind admins, two of them could lock
 * this screen away and only a hand-written UPDATE would recover the org.
 */
export default function PrivilegesPage() {
  const t = useTranslations("management");
  const tAdmin = useTranslations("admin");
  const [me, setMe] = useState<User | null>(null);
  const [state, setState] = useState<CapabilityState | null>(null);
  const [busy, setBusy] = useState(false);

  const isAdmin = me?.role === "admin" || me?.role === "owner";

  useEffect(() => {
    void api.me().then(setMe);
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    void api.capabilities().then(setState).catch(() => setState(null));
  }, [isAdmin]);

  /** absent means ALLOWED — the table records decisions, not permissions */
  const allowed = (role: string, key: string): boolean =>
    state?.decisions.find((d) => d.role === role && d.capability === key)?.allowed ?? true;

  async function toggle(role: "member" | "admin", key: string, next: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      setState(await api.setCapability(role, key, next));
    } catch {
      /* the server refuses what the hierarchy forbids; the screen says so
         rather than leaving a switch that moved and changed nothing */
      notify(t("privilegeFailed"), "warn");
      const fresh = await api.capabilities().catch(() => null);
      if (fresh) setState(fresh);
    } finally {
      setBusy(false);
    }
  }

  if (me && !isAdmin) {
    return (
      <ManagementPane activeSlug="privileges">
        <PageHeader title={t("section.privileges")} subtitle={t("desc.privileges")} />
        <Card>
          <h2 className="h-section">{tAdmin("adminOnly")}</h2>
        </Card>
      </ManagementPane>
    );
  }

  return (
    <ManagementPane activeSlug="privileges">
      <PageHeader title={t("section.privileges")} subtitle={t("desc.privileges")} />

      {/* THE SCOPE NOTE LEFT THE SCREEN (user directive, 2026-09-02: "remove
          the first box"). The sentence — every switch narrows, nothing here
          widens, the database decides visibility — is still true and still
          the rule; it lives in this file's header and in db/0101 rather than
          as a card above the switches. A screen that opens with a paragraph
          about what it cannot do buries the switches it is for. */}

      {/*
        * The ADMIN half is the owner's alone to see (user directive,
        * 2026-08-26: "it does not feel right that an admin sees their own
        * privileges"). The filtering happens on the SERVER — an admin's
        * response simply has no admin rows in it — so this map renders
        * whichever halves arrived rather than deciding the question here.
        * A component that hid data it had been sent would be a curtain,
        * not a wall.
        */}
      {(["member", "admin"] as const)
        .filter((role) => (state?.capabilities ?? []).some((cap) => cap.role === role))
        .map((role) => {
        const editable = role === "member" || (state?.may_set_admin ?? false);
        return (
          <Card key={role} className="mb-4">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 className="h-section">{t(`privilegeGroup_${role}`)}</h2>
              {editable ? null : (
                <span className="text-xs text-fg-subtle">{t("privilegeOwnerOnly")}</span>
              )}
            </div>
            <ul className="divide-y divide-border">
              {(state?.capabilities ?? [])
                .filter((cap) => cap.role === role)
                .map((cap) => (
                  <li key={cap.key} className="flex items-start justify-between gap-4 py-3">
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-fg">
                        {t(`privilege_${cap.key.replace(".", "_")}`)}
                      </span>
                      <span className="mt-0.5 block text-xs leading-5 text-fg-muted">
                        {t(`privilegeHint_${cap.key.replace(".", "_")}`)}
                      </span>
                    </span>
                    <label className="flex shrink-0 items-center gap-2 text-xs text-fg-muted">
                      <input
                        type="checkbox"
                        checked={allowed(role, cap.key)}
                        disabled={busy || !editable}
                        aria-label={t(`privilege_${cap.key.replace(".", "_")}`)}
                        onChange={(e) => void toggle(role, cap.key, e.target.checked)}
                      />
                      {allowed(role, cap.key) ? t("privilegeOn") : t("privilegeOff")}
                    </label>
                  </li>
                ))}
            </ul>
          </Card>
        );
      })}
    </ManagementPane>
  );
}
