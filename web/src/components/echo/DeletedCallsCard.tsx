"use client";

import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { Call } from "@/api/types";
import { Card, Chip, EmptyState } from "@/components/ui";
import { digits, purgeDaysLeft } from "@/lib/format";

/**
 * Soft-deleted calls with their 30-day purge window (M11).
 *
 * **Extracted from `/admin` on its retirement, not rewritten** — M25 puts this
 * with Echo because it is call-domain, and it belongs on the merged
 * Record+Calls surface (Front-end 1's build). Lifting it out intact was the
 * point of the retirement: the code is preserved so the move is a re-home
 * rather than a re-implementation.
 *
 * **Two live constraints that must travel with it — neither is visible in the
 * markup, and both cost someone real time to establish:**
 *
 * 1. **Restore is admin-only and ruled that way** (deletion should feel like
 *    deletion). An owner must never be shown a restore path, even here.
 *    Whether owners may undo their own deletions sits with the steward; if it
 *    flips it is one line on the server, so do not design around either answer.
 * 2. **Delete and restore are both BROKEN for members today** — an RLS policy
 *    hides a call from its own owner the moment it is marked deleted, so
 *    `DELETE` answers 404 and `restore` matches zero rows and **raises nothing
 *    at any layer**. `api.deleteCall` / `api.restoreCall` are deliberately
 *    still fixture-backed for that reason.
 *
 * And the trap that makes this card look fine while being untested: it renders
 * only rows with `deleted_at`, so against a live engine — where no soft-deleted
 * row can exist until the policy is fixed — the section renders empty, the
 * restore button never draws, and nothing appears wrong. **An untested control
 * that cannot be reached passes every smoke test by never appearing.** The
 * database fix needs to land with a seeded soft-deleted row, or this stays
 * unexercised while looking healthy.
 */
export function DeletedCallsCard({
  deleted,
  onChanged,
}: {
  deleted: Call[];
  onChanged: () => void;
}) {
  const t = useTranslations("admin");
  const locale = useLocale();

  return (
    <Card>
      <h2 className="h-section mb-3">{t("deletedItems")}</h2>
      {deleted.length === 0 ? (
        <EmptyState text="—" />
      ) : (
        <ul className="divide-y divide-border">
          {deleted.map((call) => (
            <li key={call.id} className="flex flex-wrap items-center gap-3 py-3">
              <span className="min-w-0 flex-1 text-sm text-fg">{call.title}</span>
              <Chip tone="danger">
                {t("purgeIn", { days: digits(purgeDaysLeft(call.deleted_at!), locale) })}
              </Chip>
              <button
                className="btn-secondary btn-sm"
                onClick={async () => {
                  await api.restoreCall(call.id);
                  onChanged();
                }}
              >
                {t("restore")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
