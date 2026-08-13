"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { AdminModelRow, Call, Org, User } from "@/api/types";
import { AppShell } from "@/components/AppShell";
import { Card, Chip, EmptyState, Field, PageHeader } from "@/components/ui";
import { digits, formatDate, purgeDaysLeft } from "@/lib/format";

export default function AdminPage() {
  const t = useTranslations("admin");
  const tCalls = useTranslations("calls");
  const locale = useLocale();

  const [members, setMembers] = useState<User[]>([]);
  /*
   * Allow-list rows are a Phase-A view-model, NOT core/'s `/v1/models` shape:
   * core/ publishes no admin model-management endpoint yet, so this section is
   * mock-fed and known-stale (recorded in BFF.md). Kept on its own type so the
   * wire type never inherits fields core/ doesn't send.
   */
  const [models, setModels] = useState<AdminModelRow[]>([]);
  const [org, setOrg] = useState<Org | null>(null);
  const [deleted, setDeleted] = useState<Call[]>([]);
  const [me, setMe] = useState<User | null>(null);

  /*
   * An AFFORDANCE gate, never the wall — same posture as `Skill.editable` and
   * the connectors panel. RLS and core/'s requireAdmin remain the authority;
   * this only decides what to ASK FOR.
   *
   * It matters at the swap: this screen had no role check at all, and the nav
   * links to it unconditionally. That was invisible in Phase A only because
   * the fixture `me` is an admin — so "admin-only" was a property of the
   * FIXTURES, not of the app. Against the real engine a member clicking
   * «مدیریت» would have got a screen whose every request 403s.
   */
  const isAdmin = me?.role === "admin";

  async function refresh() {
    setMembers(await api.members());
    setModels(await api.adminModels());
    setOrg(await api.org());
    setDeleted((await api.listCalls({ includeArchived: true })).filter((c) => c.deleted_at));
  }

  useEffect(() => {
    void api.me().then(setMe);
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    void refresh();
  }, [isAdmin]);

  const pending = members.filter((m) => m.status === "pending");
  const active = members.filter((m) => m.status !== "pending");

  /*
   * Not an empty admin screen. A member who saw empty member/model/deleted
   * lists would read it as "this org has nothing" — a claim about the ORG
   * built out of a fact about their own PERMISSIONS. Saying so plainly is
   * also why nothing is requested above: four requests that will all be
   * refused teach the user nothing and fill core/'s logs with noise.
   */
  if (me !== null && !isAdmin) {
    return (
      <AppShell page={t("title")}>
        <PageHeader title={t("title")} />
        <Card>
          <h2 className="h-section">{t("adminOnly")}</h2>
          <p className="mt-1 text-sm leading-7 text-fg-muted">{t("adminOnlyNote")}</p>
        </Card>
      </AppShell>
    );
  }

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
                      setModels(await api.adminModels());
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
