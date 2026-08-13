"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { api } from "@/api/client";
import type { Call, Me, User } from "@/api/types";
import { Card, EmptyState, ScopeChip, StatusChip } from "@/components/ui";
// `purgeDaysLeft` is deliberately NOT imported: the purge countdown belongs to
// DeletedCallsCard now that soft-deleted rows have their own card, and a second
// copy of that arithmetic beside the table is how two countdowns disagree.
import { formatDate, formatDuration, digits } from "@/lib/format";
import { DeletedCallsCard } from "./DeletedCallsCard";

/**
 * The calls list, lifted out of `/calls` for the merged Echo surface.
 *
 * It owns its own loading rather than taking rows as a prop, because the
 * archive toggle and the scope switch both re-read — a parent holding the data
 * would have to thread a refresh callback through for no gain.
 *
 * **`DeletedCallsCard` renders here, admin-only.** M25 puts it with Echo
 * because it is call-domain, and the restore control is ruled admin-only
 * (deletion should feel like deletion). The gate is the same one the api
 * enforces; this is not the authority, just the screen agreeing with it.
 */
export function CallsSection() {
  const t = useTranslations("calls");
  const tStatus = useTranslations("status");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const [calls, setCalls] = useState<Call[] | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [members, setMembers] = useState<User[]>([]);
  const [showArchived, setShowArchived] = useState(false);

  async function load(includeArchived: boolean) {
    setCalls(await api.listCalls({ includeArchived }));
  }

  useEffect(() => {
    void api.me().then(setMe);
    // the wire sends owner_id only — names come from the member list
    void api.members().then(setMembers).catch(() => setMembers([]));
    void load(showArchived);
  }, [showArchived]);

  /** id → display name, falling back to the id rather than to `undefined`. */
  function ownerName(id: string): string {
    return members.find((m) => m.id === id)?.display_name ?? id;
  }

  /*
   * Soft-deleted rows are shown in their OWN card, not mixed into the table.
   * `api.listCalls` only returns them to an admin, so a member's list is
   * unchanged — and the split is what stops a deleted call reading as a normal
   * one with a badge.
   */
  const deleted = (calls ?? []).filter((call) => call.deleted_at !== null);
  const live = (calls ?? []).filter((call) => call.deleted_at === null);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="h-page">{t("title")}</h2>
        <button
          className="btn-secondary h-10 min-h-0 px-3 text-xs"
          onClick={() => setShowArchived((v) => !v)}
        >
          {showArchived ? t("hideArchived") : t("showArchived")}
        </button>
      </div>

      {calls === null ? null : live.length === 0 ? (
        <Card>
          <EmptyState text={t("empty")} />
        </Card>
      ) : (
        <Card className="!p-0">
          {/*
            The table scrolls INSIDE the card rather than being clipped by it.
            Without this, ~198px of every row was unreachable at 375 — and it
            was invisible to the obvious test: clipping keeps
            `document.scrollWidth` equal to the viewport, so a page-level
            overflow check certifies the screen as clean while a third of each
            row cannot be read. `min-w-max` makes the table keep its width and
            scroll, instead of crushing its columns to fit.
          */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-max">
              <thead>
                <tr className="border-b border-border">
                  <th className="table-head px-4 py-3">{t("columnTitle")}</th>
                  <th className="table-head px-4 py-3">{t("columnOwner")}</th>
                  <th className="table-head px-4 py-3">{t("columnDate")}</th>
                  <th className="table-head px-4 py-3">{t("columnLength")}</th>
                  <th className="table-head px-4 py-3">{t("columnScope")}</th>
                  <th className="table-head px-4 py-3">{t("columnStatus")}</th>
                </tr>
              </thead>
              <tbody>
                {live.map((call) => (
                  <tr key={call.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">
                      <Link
                        href={`/calls/${call.id}`}
                        className="font-medium text-fg hover:text-accent"
                      >
                        {call.title}
                      </Link>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        {/* `parts` is not on the wire yet — absent means "not
                            told", which renders as nothing rather than as "1
                            part". */}
                        {(call.parts?.length ?? 0) > 1 ? (
                          <span className="text-xs text-fg-muted">
                            {t("parts", { count: digits(call.parts?.length ?? 0, locale) })}
                          </span>
                        ) : null}
                        {call.archived_at !== null ? (
                          <span className="text-xs text-fg-muted">({t("archive")})</span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-fg-muted">
                      {/* the wire carries owner_id only; the name is resolved
                          from the member list where we have it */}
                      {call.owner_id === me?.id
                        ? tCommon("you")
                        : (call.owner_name ?? ownerName(call.owner_id))}
                    </td>
                    <td className="px-4 py-3 text-sm text-fg-muted">
                      {formatDate(call.started_at, locale)}
                    </td>
                    <td className="px-4 py-3 text-sm text-fg-muted">
                      {/* null duration is UNKNOWN, not zero — live rows carry
                          null today. Saying «نامعلوم» is the honest render; a
                          dash would read as "nothing to show". */}
                      {call.duration_ms === null
                        ? t("durationUnknown")
                        : formatDuration(call.duration_ms / 1000, locale)}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        /* `tap` — this control changes who can see a call, and
                           it was a 24px target on a phone. The chip keeps its
                           size; only the hit area grows. */
                        className="tap"
                        onClick={async () => {
                          await api.setScope(call.id, call.scope === "org" ? "private" : "org");
                          void load(showArchived);
                        }}
                        title={call.scope === "org" ? t("makePrivate") : t("makeOrg")}
                      >
                        <ScopeChip
                          scope={call.scope}
                          label={call.scope === "org" ? t("scopeOrg") : t("scopePrivate")}
                        />
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <StatusChip status={call.status} label={tStatus(call.status)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/*
        Rendered only for an admin AND only when there is something in it.
        Not "always visible, empty when clean": a permanently empty «حذف‌شده‌ها»
        card on every visit trains people to ignore the one place a pending
        purge would announce itself.
      */}
      {me?.role === "admin" && deleted.length > 0 ? (
        <DeletedCallsCard deleted={deleted} onChanged={() => void load(showArchived)} />
      ) : null}
    </section>
  );
}
