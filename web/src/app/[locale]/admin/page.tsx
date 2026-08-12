"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { Call, ModelInfo, Org, User } from "@/api/types";
import { AppShell } from "@/components/AppShell";
import { Card, Chip, EmptyState, Field, PageHeader } from "@/components/ui";
import { digits, formatDate, purgeDaysLeft } from "@/lib/format";

export default function AdminPage() {
  const t = useTranslations("admin");
  const tCalls = useTranslations("calls");
  const locale = useLocale();

  const [members, setMembers] = useState<User[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [org, setOrg] = useState<Org | null>(null);
  const [deleted, setDeleted] = useState<Call[]>([]);

  async function refresh() {
    setMembers(await api.members());
    setModels(await api.models());
    setOrg(await api.org());
    setDeleted((await api.listCalls({ includeArchived: true })).filter((c) => c.deleted_at));
  }

  useEffect(() => {
    void refresh();
  }, []);

  const pending = members.filter((m) => m.status === "pending");
  const active = members.filter((m) => m.status !== "pending");

  return (
    <AppShell page={t("title")}>
      <PageHeader title={t("title")} />

      {/* pending-approval queue (M15) */}
      <Card className="mb-4">
        <h2 className="mb-3 text-sm font-semibold text-fg">
          {t("pending")}
          {pending.length > 0 ? (
            <span className="ms-2 chip bg-warning/15 text-warning">
              {digits(pending.length, locale)}
            </span>
          ) : null}
        </h2>
        {pending.length === 0 ? (
          <EmptyState text={t("pendingEmpty")} />
        ) : (
          <ul className="divide-y divide-border">
            {pending.map((user) => (
              <li key={user.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-fg">{user.display_name}</p>
                  <p className="text-xs text-fg-muted ltr">@{user.username}</p>
                </div>
                <span className="text-xs text-fg-muted">
                  {formatDate(user.created_at, locale)}
                </span>
                <button
                  className="btn-primary h-9 min-h-0 px-3 text-xs"
                  onClick={async () => {
                    await api.setUserStatus(user.id, "active");
                    void refresh();
                  }}
                >
                  {t("accept")}
                </button>
                <button
                  className="btn-secondary h-9 min-h-0 px-3 text-xs"
                  onClick={async () => {
                    await api.setUserStatus(user.id, "disabled");
                    void refresh();
                  }}
                >
                  {t("reject")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* members */}
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-fg">{t("members")}</h2>
          <ul className="divide-y divide-border">
            {active.map((user) => (
              <li key={user.id} className="flex flex-wrap items-center gap-2 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-fg">{user.display_name}</p>
                  <p className="text-xs text-fg-muted ltr">@{user.username}</p>
                </div>
                <Chip tone={user.status === "active" ? "success" : "neutral"}>
                  {user.status === "active" ? t("statusActive") : t("statusDisabled")}
                </Chip>
                <select
                  className="input h-9 min-h-0 w-28 py-0 text-xs"
                  value={user.role}
                  onChange={async (e) => {
                    await api.setUserRole(user.id, e.target.value as "admin" | "member");
                    void refresh();
                  }}
                >
                  <option value="admin">{t("roleAdmin")}</option>
                  <option value="member">{t("roleMember")}</option>
                </select>
              </li>
            ))}
          </ul>
        </Card>

        {/* org settings + model allow-list (M5 cost lever) */}
        <div className="space-y-4">
          <Card>
            <h2 className="mb-3 text-sm font-semibold text-fg">{t("orgSettings")}</h2>
            {org ? (
              <div className="space-y-3">
                <Field label={t("orgName")}>
                  <input
                    className="input"
                    value={org.name}
                    onChange={(e) => setOrg({ ...org, name: e.target.value })}
                    onBlur={() => void api.updateOrg({ name: org.name })}
                  />
                </Field>
                <Field label={t("defaultScope")}>
                  <select
                    className="input"
                    value={org.default_call_scope}
                    onChange={async (e) => {
                      const scope = e.target.value as "private" | "org";
                      setOrg({ ...org, default_call_scope: scope });
                      await api.updateOrg({ default_call_scope: scope });
                    }}
                  >
                    <option value="private">{tCalls("scopePrivate")}</option>
                    <option value="org">{tCalls("scopeOrg")}</option>
                  </select>
                </Field>
              </div>
            ) : null}
          </Card>

          <Card>
            <h2 className="mb-1 text-sm font-semibold text-fg">{t("modelAllowList")}</h2>
            <p className="mb-3 text-xs text-fg-muted">{t("modelAllowNote")}</p>
            <ul className="space-y-2">
              {models.map((model) => (
                <li key={model.id} className="flex items-center gap-2">
                  <input
                    id={`m-${model.id}`}
                    type="checkbox"
                    className="h-4 w-4 accent-[rgb(var(--accent))]"
                    checked={model.allowed}
                    disabled={!model.tool_capable}
                    onChange={async (e) => {
                      await api.setModelAllowed(model.id, e.target.checked);
                      setModels(await api.models());
                    }}
                  />
                  <label htmlFor={`m-${model.id}`} className="flex-1 text-sm text-fg">
                    {model.label}
                    <span className="ms-2 text-xs text-fg-muted ltr">{model.provider}</span>
                  </label>
                  {model.suggested ? <Chip tone="accent">★</Chip> : null}
                  {!model.tool_capable ? <Chip tone="neutral">no tools</Chip> : null}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      {/* soft-deleted items with the 30-day purge window (M11) */}
      <Card className="mt-4">
        <h2 className="mb-3 text-sm font-semibold text-fg">{t("deletedItems")}</h2>
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
                  className="btn-secondary h-9 min-h-0 px-3 text-xs"
                  onClick={async () => {
                    await api.restoreCall(call.id);
                    void refresh();
                  }}
                >
                  {t("restore")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </AppShell>
  );
}
