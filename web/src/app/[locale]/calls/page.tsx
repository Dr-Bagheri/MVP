"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { api } from "@/api/client";
import type { Call, User } from "@/api/types";
import { AppShell } from "@/components/AppShell";
import { Card, EmptyState, PageHeader, ScopeChip, StatusChip } from "@/components/ui";
import { formatDate, formatDuration, digits, purgeDaysLeft } from "@/lib/format";

export default function CallsPage() {
  const t = useTranslations("calls");
  const tStatus = useTranslations("status");
  const tAdmin = useTranslations("admin");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const [calls, setCalls] = useState<Call[] | null>(null);
  const [me, setMe] = useState<User | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  async function load(includeArchived: boolean) {
    setCalls(await api.listCalls({ includeArchived }));
  }

  useEffect(() => {
    void api.me().then(setMe);
    void load(showArchived);
  }, [showArchived]);

  return (
    <AppShell page={t("title")}>
      <PageHeader
        title={t("title")}
        actions={
          <>
            <button
              className="btn-secondary h-10 min-h-0 px-3 text-xs"
              onClick={() => setShowArchived((v) => !v)}
            >
              {showArchived ? t("hideArchived") : t("showArchived")}
            </button>
            <Link href="/capture" className="btn-primary h-10 min-h-0 px-4 text-sm">
              {t("newCall")}
            </Link>
          </>
        }
      />

      {calls === null ? null : calls.length === 0 ? (
        <Card>
          <EmptyState text={t("empty")} />
        </Card>
      ) : (
        <Card className="!p-0">
          <table className="w-full">
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
              {calls.map((call) => (
                <tr key={call.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">
                    <Link
                      href={`/calls/${call.id}`}
                      className="font-medium text-fg hover:text-accent"
                    >
                      {call.title}
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      {call.parts.length > 1 ? (
                        <span className="text-xs text-fg-muted">
                          {t("parts", { count: digits(call.parts.length, locale) })}
                        </span>
                      ) : null}
                      {call.archived ? (
                        <span className="text-xs text-fg-muted">({t("archive")})</span>
                      ) : null}
                      {call.deleted_at ? (
                        <span className="chip bg-danger/15 text-danger">
                          {t("deleted")} ·{" "}
                          {tAdmin("purgeIn", {
                            days: digits(purgeDaysLeft(call.deleted_at), locale),
                          })}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-fg-muted">
                    {call.owner_id === me?.id ? tCommon("you") : call.owner_name}
                  </td>
                  <td className="px-4 py-3 text-sm text-fg-muted">
                    {formatDate(call.created_at, locale)}
                  </td>
                  <td className="px-4 py-3 text-sm text-fg-muted">
                    {formatDuration(call.duration_seconds, locale)}
                  </td>
                  <td className="px-4 py-3">
                    <button
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
        </Card>
      )}
    </AppShell>
  );
}
