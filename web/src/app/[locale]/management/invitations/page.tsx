"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api, BffError } from "@/api/client";
import { useRefreshEpoch } from "@/lib/refreshBus";
import type { Invitation, MintedInvitation, Role, User } from "@/api/types";
import { Pagination, usePaged } from "@/components/Pagination";
import { ManagementPane } from "@/components/platform/ManagementPane";
import { PageHeader } from "@/components/scaffold";
import { Card, Chip } from "@/components/ui";
import { formatDate } from "@/lib/format";

/**
 * INVITATIONS — its own surface (user directive, 2026-08-26: "replace the
 * invitation to the side sub menu under user, with its own icon").
 *
 * It used to sit stacked under the members roster, which put two different
 * acts on one screen: reading who is already here, and asking somebody new
 * to come. The rules it carries are core's and are unchanged — D23's
 * show-once token (the string exists in this response and never again),
 * D25's role ceiling (only an owner mints an admin, nobody mints an
 * owner), and one live invitation per address.
 *
 * Admin-walled like the roster: the page renders the same refusal card for
 * a member, because an invitation is a claim about who joins the org.
 */
export default function InvitationsPage() {
  const t = useTranslations("management");
  const tAdmin = useTranslations("admin");
  const tCommon = useTranslations("common");
  const locale = useLocale();

  const [me, setMe] = useState<User | null>(null);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("member");
  const [minted, setMinted] = useState<MintedInvitation | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isAdmin = me?.role === "admin" || me?.role === "owner";
  const invitationsEpoch = useRefreshEpoch("invitations");

  useEffect(() => {
    void api.me().then(setMe);
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    void api.invitations().then(setInvitations).catch(() => undefined);
  }, [isAdmin, invitationsEpoch]);

  /* ONLY the outstanding ones (user verdict): a revoked or redeemed
     invitation is history, and five dead rows for one address buried the
     single link that still works. The api keeps the full history; this list
     is the TO-DO view.

     It is derived HERE rather than where it renders because the pager is a
     hook and the refusal card below is an early return — a hook after it
     would run conditionally. */
  const open = invitations.filter(
    (inv) => !inv.redeemed_at && !inv.revoked_at && new Date(inv.expires_at) >= new Date(),
  );
  const { page, setPage, pageCount, visible } = usePaged(open);

  async function issueInvitation() {
    const email = inviteEmail.trim();
    if (!email || busy) return;
    setBusy(true);
    setInviteError(null);
    try {
      // the token exists HERE and never again (D23's show-once contract)
      setMinted(await api.createInvitation(email, inviteRole));
      setInviteEmail("");
      setInvitations(await api.invitations());
    } catch (cause) {
      // core's sentence: it owns one-live-per-email, the role ceiling, and
      // the address rules — re-deriving any of them here would drift
      setInviteError(
        cause instanceof BffError ? (cause.detail ?? t("inviteFailed")) : t("inviteFailed"),
      );
    } finally {
      setBusy(false);
    }
  }



  if (me && !isAdmin) {
    return (
      <ManagementPane activeSlug="invitations">
        <PageHeader title={t("section.invitations")} subtitle={t("desc.invitations")} />
        <Card>
          <h2 className="h-section">{tAdmin("adminOnly")}</h2>
        </Card>
      </ManagementPane>
    );
  }

  return (
    <ManagementPane activeSlug="invitations">
      <div>
        <PageHeader title={t("section.invitations")} subtitle={t("desc.invitations")} />

        <Card className="mb-4">
          <h2 className="h-section mb-3">{t("invitationsTitle")}</h2>

          {minted?.emailed ? (
            /* the SIMPLE flow (user directive): the platform emailed the
               invitation — no token, nothing for the admin to carry */
            <div className="mb-3 rounded-lg border border-success/40 bg-surface-2 p-3">
              <p className="text-sm text-fg" role="status">
                {t("inviteEmailed", { email: minted.email })}
              </p>
              <button
                className="btn-secondary mt-2 h-9 min-h-0 px-3 text-xs"
                onClick={() => setMinted(null)}
              >
                {tCommon("done")}
              </button>
            </div>
          ) : minted ? (
            /* the RESCUE: the email did not go (already registered / sender
               down / not configured) — the show-once token link is the manual
               fallback, with the reason said out loud. Dismissed by the
               person, never a timer (SecretOnce's rule). */
            <div className="mb-3 rounded-lg border border-accent bg-surface-2 p-3">
              <p className="text-sm font-semibold text-fg">{t("inviteMintedTitle")}</p>
              <p className="mt-1 text-sm leading-6 text-fg-muted">
                {t(`inviteEmail_${minted.email_status}`, { email: minted.email })}{" "}
                {t("inviteMintedNote", { email: minted.email })}
              </p>
              <p className="ltr mt-2 break-all rounded-md bg-surface p-2 font-mono text-xs text-fg">
                {minted.token}
              </p>
              <button
                className="btn-secondary mt-3 h-9 min-h-0 px-3 text-xs"
                onClick={() => setMinted(null)}
              >
                {t("inviteStored")}
              </button>
            </div>
          ) : null}

          {inviteError ? (
            <p role="alert" className="mb-2 text-sm text-danger">
              {inviteError}
            </p>
          ) : null}

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input
              className="input min-w-[14rem] flex-1"
              dir="ltr"
              type="email"
              placeholder={t("inviteEmailPlaceholder")}
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
            />
            <select
              className="input h-11 min-h-0 w-auto py-0 text-sm md:h-10"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as Role)}
            >
              <option value="member">{tAdmin("roleMember")}</option>
              {/* D25: the issuer's role bounds the GRANT — only the owner
                  may mint an admin, and nobody mints an owner */}
              {me?.role === "owner" ? <option value="admin">{tAdmin("roleAdmin")}</option> : null}
            </select>
            <button
              className="btn-primary h-10 min-h-0 px-4 text-sm"
              disabled={busy || !inviteEmail.trim()}
              onClick={() => void issueInvitation()}
            >
              {t("invite")}
            </button>
          </div>

          {open.length === 0 ? (
            <p className="text-sm text-fg-muted">{t("noInvitations")}</p>
          ) : (
            <>
            <ul className="divide-y divide-border">
              {visible.map((inv) => (
                <li key={inv.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <span className="ltr min-w-0 flex-1 truncate text-sm text-fg">{inv.email}</span>
                  <Chip tone="neutral">
                    {inv.role === "admin" ? tAdmin("roleAdmin") : tAdmin("roleMember")}
                  </Chip>
                  <Chip tone="success">{t("inviteState_open")}</Chip>
                  <span className="text-xs text-fg-muted">
                    {formatDate(inv.expires_at, locale)}
                  </span>
                  <button
                    className="text-xs text-fg-muted underline-offset-2 hover:underline"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await api.revokeInvitation(inv.id);
                        setInvitations(await api.invitations());
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {t("inviteRevoke")}
                  </button>
                </li>
              ))}
            </ul>
            <Pagination page={page} pageCount={pageCount} onPage={setPage} />
            </>
          )}
        </Card>

      </div>
    </ManagementPane>
  );
}
