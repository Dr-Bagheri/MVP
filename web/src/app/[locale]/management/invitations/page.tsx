"use client";

import { useEffect, useState } from "react";
import { Select } from "@/components/Select";
import { useLocale, useTranslations } from "next-intl";
import { api, BffError } from "@/api/client";
import { useRefreshEpoch } from "@/lib/refreshBus";
import type { Invitation, MintedInvitation, Role, User } from "@/api/types";
import { IconTrash } from "@/components/icons";
import { ManagementPane } from "@/components/platform/ManagementPane";
import { ConfirmDialog } from "@/components/rowActions";
import { PageHeader } from "@/components/scaffold";
import { DataTable } from "@/components/DataTable";
import { Card, Chip, EmptyState } from "@/components/ui";
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
  /* audit finding, 2026-09-02: `invitations` starts as [] and the "no
     invitations" sentence rendered on EVERY load until the fetch answered —
     loading and empty were one picture, and the card grew after first paint.
     The flag flips on the answer (refusal included: the list is then honestly
     empty of anything we can show); until then DataTable draws skeleton rows
     in its own frame. A refresh through the epoch keeps the rows on screen —
     the skeleton is for the first paint, never for a refetch. */
  const [loaded, setLoaded] = useState(false);
  /** the read came back REFUSED — not the same as nothing outstanding */
  const [listFailed, setListFailed] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("member");
  const [minted, setMinted] = useState<MintedInvitation | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** the invitation awaiting the platform's are-you-sure (dialog at the foot) */
  const [confirmRevoke, setConfirmRevoke] = useState<Invitation | null>(null);

  const isAdmin = me?.role === "admin" || me?.role === "owner";
  const invitationsEpoch = useRefreshEpoch("invitations");

  useEffect(() => {
    void api.me().then(setMe);
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    void api
      .invitations()
      .then((rows) => { setInvitations(rows); setListFailed(false); })
      /*
       * A REFUSED READ IS NOT "NO OUTSTANDING INVITATIONS" (2026-09-03). The
       * catch swallowed the failure and the list said there were none — and
       * here the false empty is ACTIONABLE and wrong: the admin issues a
       * duplicate, meets D23's one-live-per-email refusal, and has no way to
       * know why. The two nothings get two sentences.
       */
      .catch(() => setListFailed(true))
      .finally(() => setLoaded(true));
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

  /**
   * The revoke, lifted out of its button so the dialog owns the write.
   *
   * The refusal rides `inviteError`, the same line an issue failure uses:
   * before the dialog this call had no catch at all, so a server refusal
   * left the row on screen with nothing said about it.
   */
  async function revokeInvitationFor(inv: Invitation) {
    if (busy) return;
    setBusy(true);
    setInviteError(null);
    try {
      await api.revokeInvitation(inv.id);
      setInvitations(await api.invitations());
    } catch (cause) {
      setInviteError(
        cause instanceof BffError ? (cause.detail ?? t("inviteFailed")) : t("inviteFailed"),
      );
    } finally {
      setBusy(false);
    }
  }

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
              {/* audit finding, 2026-09-02: this was `.btn-secondary` re-sized
                  by hand to 36px/text-xs — a height matching neither .btn (38)
                  nor .btn-sm (34). It wears .btn-sm now, and a BORDER rather
                  than .btn-secondary's surface-2 fill, because the notice it
                  sits on is itself surface-2: a filled button on its own
                  ground has no edge to find. */}
              <button
                className="btn btn-sm mt-2 border border-border font-medium text-fg"
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
              {/* audit finding, 2026-09-02: same shape as the emailed notice's
                  button above — one control, one size, on the same ground */}
              <button
                className="btn btn-sm mt-3 border border-border font-medium text-fg"
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

          {/* ONE ROW, THREE WIDTHS (user, 2026-09-05: "put the three of them in
              the same row with different sizes"): the address takes what is
              left, the role a fixed 11rem, the button its own width. It was a
              wrapping flex row, and the Select's root is `w-full` — which
              beats the `w-auto` written beside it, since the two utilities
              set one property and the stylesheet's order decides — so the
              role stretched to the whole row and pushed the other two onto
              rows of their own. A grid gives each control its column and no
              class fight to lose. Below sm the three stack. */}
          <div className="mb-3 grid grid-cols-1 items-center gap-2 sm:grid-cols-[minmax(0,1fr)_11rem_auto]">
            <input
              className="input"
              dir="ltr"
              type="email"
              placeholder={t("inviteEmailPlaceholder")}
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
            />
            {/* D25: the issuer's role bounds the GRANT — only the owner may
                mint an admin, and nobody mints an owner */}
            <Select
              value={inviteRole}
              onChange={(next) => setInviteRole(next as Role)}
              options={[
                { value: "member", label: tAdmin("roleMember") },
                ...(me?.role === "owner"
                  ? [{ value: "admin", label: tAdmin("roleAdmin") }]
                  : []),
              ]}
            />
            <button
              className="btn btn-primary"
              disabled={busy || !inviteEmail.trim()}
              onClick={() => void issueInvitation()}
            >
              {t("invite")}
            </button>
          </div>

          {/* THE PLATFORM'S TABLE (audit finding, 2026-09-02): this list was
              hairline-divided <li> rows with an underlined text link to
              revoke and its own pager — a second list anatomy beside the
              members table. DataTable pages by the house rule on its own,
              puts revoke on the row's menu where every other destructive
              act lives, and wears the same card rows as every other list. */}
          <DataTable
            hideHeader
            rows={open}
            loading={!loaded}
            rowKey={(inv) => inv.id}
            empty={<EmptyState text={t(listFailed ? "invitationsLoadFailed" : "noInvitations")} />}
            menuItems={(inv) => [{
              key: "revoke",
              label: t("inviteRevoke"),
              icon: <IconTrash width={14} height={14} />,
              danger: true,
              disabled: busy,
              /* revoking is terminal by design — D23's terms are immutable,
                 so "change your mind" means issuing a NEW invitation; it
                 asks first (the platform rule; confirm.guard.test.ts) */
              onSelect: () => setConfirmRevoke(inv),
            }]}
            columns={[
              {
                key: "email", header: t("inviteEmailPlaceholder"),
                cell: (inv) => <span className="ltr block truncate text-sm text-fg">{inv.email}</span>,
              },
              {
                key: "role", header: tAdmin("role"),
                cell: (inv) => (
                  <Chip tone="neutral">{inv.role === "admin" ? tAdmin("roleAdmin") : tAdmin("roleMember")}</Chip>
                ),
              },
              { key: "state", header: t("inviteState_open"), cell: () => <Chip tone="success">{t("inviteState_open")}</Chip> },
              {
                key: "expires", header: t("inviteExpires"), className: "text-xs text-fg-muted",
                cell: (inv) => formatDate(inv.expires_at, locale),
              },
            ]}
          />
        </Card>

        {/* the platform's one destructive-action dialog; the address is what
            identifies an invitation to the person revoking it */}
        {confirmRevoke !== null ? (
          <ConfirmDialog
            title={t("inviteRevokeTitle", { email: confirmRevoke.email })}
            body={t("inviteRevokeBody")}
            confirmLabel={t("inviteRevoke")}
            cancelLabel={tCommon("cancel")}
            busy={busy}
            onCancel={() => setConfirmRevoke(null)}
            onConfirm={() => {
              const target = confirmRevoke;
              setConfirmRevoke(null);
              void revokeInvitationFor(target);
            }}
          />
        ) : null}
      </div>
    </ManagementPane>
  );
}
