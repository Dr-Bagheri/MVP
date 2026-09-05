"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { GatewayKey, User } from "@/api/types";
import { Pagination, usePaged } from "@/components/Pagination";
import { ConfirmDialog } from "@/components/rowActions";
import { Card, Chip, EmptyState } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { MintKeyDialog } from "./MintKeyDialog";

/**
 * Why a key can be dead, in the order the reasons override each other.
 *
 * All three are DERIVED FROM FACTS core/ already sent — a revocation stamp, an
 * expiry timestamp, and the member's own status — and every one of them is an
 * explanation, never a gate. `echo.resolve_api_key` (db/0015) is what actually
 * refuses these keys; if this and that ever disagree, the resolver is right and
 * the user gets a refusal rather than a silent success.
 *
 * `actor_inactive` is the one the screen exists for. M17/db-D6: a key names a
 * MEMBER, so disabling an employee stops their integrations that instant, with
 * no rotation. An admin about to remove someone needs to see which integrations
 * die with them BEFORE they click, and a list that showed only `revoked_at`
 * would show all of these as perfectly healthy.
 */
type KeyState = "revoked" | "expired" | "actor_inactive" | "live";

function keyState(key: GatewayKey, actor: User | undefined): KeyState {
  if (key.revoked_at) return "revoked";
  if (key.expires_at && Date.parse(key.expires_at) <= Date.now()) return "expired";
  /*
   * `undefined` is NOT inactive. A missing member row means this list could not
   * see them — a different kind of nothing from "they are switched off", and
   * asserting the second on evidence of the first would put a red flag on a
   * working key. The acts-as cell says what is true instead: here is the id,
   * and it is not in the member list.
   */
  if (actor && actor.status !== "active") return "actor_inactive";
  return "live";
}

export function KeysCard({
  keys,
  members,
  meId,
  onChanged,
}: {
  keys: GatewayKey[];
  /** Doubles as the acts-as picker's options and the id→name map for the list. */
  members: User[];
  meId: string;
  onChanged: () => void;
}) {
  const t = useTranslations("gateway");
  const locale = useLocale();
  const [minting, setMinting] = useState(false);
  const [revoking, setRevoking] = useState<GatewayKey | null>(null);
  const [busy, setBusy] = useState(false);

  const memberById = new Map(members.map((member) => [member.id, member]));
  /* server order is the page order too — revoked keys sink to the bottom, so
     the live ones a person came here for are on page one */
  const { page, setPage, pageCount, visible } = usePaged(keys);

  return (
    <Card className="mb-4">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="h-section">{t("keys")}</h2>
        <button
          type="button"
          className="btn-primary btn-sm"
          onClick={() => setMinting(true)}
        >
          {t("mint")}
        </button>
      </div>
      <p className="mb-3 text-xs leading-6 text-fg-muted">{t("keysNote")}</p>

      {keys.length === 0 ? (
        <EmptyState text={t("keysEmpty")} />
      ) : (
        // Tables are the one thing that legitimately outgrows a phone; scroll
        // the table, never the page.
        <>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="table-head py-2 pe-3">{t("colName")}</th>
                <th className="table-head py-2 pe-3">{t("colActsAs")}</th>
                <th className="table-head py-2 pe-3">{t("colAssistant")}</th>
                <th className="table-head py-2 pe-3">{t("colLastUsed")}</th>
                <th className="table-head py-2 pe-3">{t("colExpires")}</th>
                <th className="table-head py-2">{/* actions */}</th>
              </tr>
            </thead>
            {/*
              Server order is kept exactly: core/ returns `revoked_at nulls
              first, created_at desc`, which already puts withdrawn keys at the
              bottom. Re-sorting here would be a second copy of an ordering rule
              that only one side can own.
            */}
            <tbody className="divide-y divide-border">
              {visible.map((key) => {
                const actor = memberById.get(key.actor_id);
                const state = keyState(key, actor);
                const dead = state !== "live";
                return (
                  <tr key={key.id} className={dead ? "opacity-70" : undefined}>
                    <td className="py-3 pe-3 align-top">
                      <p className="font-medium text-fg">{key.name}</p>
                      <p className="ltr mt-0.5 font-mono text-xs text-fg-muted">
                        {key.token_prefix}…
                      </p>
                      <p className="mt-0.5 text-xs text-fg-muted">
                        {t("createdAt", { date: formatDate(key.created_at, locale) })}
                      </p>
                    </td>

                    <td className="py-3 pe-3 align-top">
                      {actor ? (
                        <span className="text-sm text-fg">{actor.display_name}</span>
                      ) : (
                        <span className="text-sm text-fg-muted">
                          {t("actorNotListed")}
                          <span className="ltr ms-1 font-mono text-xs">{key.actor_id}</span>
                        </span>
                      )}
                      {state === "actor_inactive" ? (
                        <p className="mt-1 text-xs text-danger">{t("actorInactive")}</p>
                      ) : null}
                    </td>

                    <td className="py-3 pe-3 align-top">
                      {/*
                        Both states are stated. An absent chip would be a third
                        meaning — "we don't know" — sitting in the same place as
                        "off", and this is the field that separates a key which
                        reads from a key which bills.
                      */}
                      {key.allow_assistant ? (
                        <Chip tone="accent">{t("assistantOn")}</Chip>
                      ) : (
                        <Chip tone="neutral">{t("assistantOff")}</Chip>
                      )}
                    </td>

                    <td className="py-3 pe-3 align-top text-xs text-fg-muted">
                      {key.last_used_at ? formatDate(key.last_used_at, locale) : t("neverUsed")}
                    </td>

                    <td className="py-3 pe-3 align-top text-xs text-fg-muted">
                      {key.expires_at ? formatDate(key.expires_at, locale) : t("noExpiry")}
                    </td>

                    <td className="py-3 align-top">
                      {key.revoked_at ? (
                        <div className="flex flex-col items-start gap-1">
                          <Chip tone="danger">{t("revoked")}</Chip>
                          <span className="text-xs text-fg-muted">
                            {formatDate(key.revoked_at, locale)}
                          </span>
                        </div>
                      ) : state === "expired" ? (
                        <Chip tone="warning">{t("expired")}</Chip>
                      ) : (
                        <button
                          type="button"
                          className="btn-secondary btn-sm"
                          onClick={() => setRevoking(key)}
                        >
                          {t("revoke")}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pagination page={page} pageCount={pageCount} onPage={setPage} />
        </>
      )}

      <MintKeyDialog
        open={minting}
        onClose={() => setMinting(false)}
        onMinted={onChanged}
        members={members}
        meId={meId}
      />

      {/*
        The platform's ONE destructive-action dialog (`ConfirmDialog`, the
        rule enforced by `confirm.guard.test.ts`).

        This screen used to hand-roll the same box out of the local `Dialog`
        primitive. Two dialogs asking one question is how they drift: one
        gains a busy state, the other keeps its own spacing, and eventually
        a delete somewhere looks like a different product. `Dialog` stays
        for what it was built for — the FORMS beside this (minting a key,
        adding a webhook), including the show-once secret that must not close
        on a reflex.
      */}
      {revoking !== null ? (
        <ConfirmDialog
          title={t("revokeTitle", { name: revoking.name })}
          body={t("revokeBody")}
          confirmLabel={t("revokeConfirm")}
          cancelLabel={t("cancel")}
          busy={busy}
          onCancel={() => setRevoking(null)}
          onConfirm={() => {
            const key = revoking;
            setBusy(true);
            void api.revokeGatewayKey(key.id)
              .then(() => {
                setRevoking(null);
                onChanged();
              })
              .finally(() => setBusy(false));
          }}
        />
      ) : null}
    </Card>
  );
}
