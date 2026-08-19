"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type {
  PlatformAuditEntry,
  PlatformOrganization,
  PlatformOverview,
  PlatformUser,
} from "@/api/types";

type AccessState = "checking" | "claim" | "root" | "denied";

interface ConsoleData {
  overview: PlatformOverview;
  organizations: PlatformOrganization[];
  users: PlatformUser[];
  audit: PlatformAuditEntry[];
  nextOrganizations: number | null;
  nextUsers: number | null;
  nextAudit: number | null;
}

const EMPTY_DATA: ConsoleData = {
  overview: {
    current_user_id: "",
    organizations: { total: 0, active: 0, suspended: 0 },
    users: { total: 0, active: 0, pending: 0, disabled: 0 },
    platform_roots: 0,
  },
  organizations: [],
  users: [],
  audit: [],
  nextOrganizations: null,
  nextUsers: null,
  nextAudit: null,
};

/**
 * M32's deliberately narrow control plane.
 *
 * This screen has no routes, components, or fields for customer content. Its
 * data is limited to platform lifecycle metadata, and every state change
 * requires an audit reason that core forwards to the named DB function.
 */
export default function PlatformControlPage() {
  const t = useTranslations("platformRoot");
  const locale = useLocale();
  const [access, setAccess] = useState<AccessState>("checking");
  const [data, setData] = useState<ConsoleData>(EMPTY_DATA);
  const [reason, setReason] = useState("");
  const [orgSearch, setOrgSearch] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [error, setError] = useState<"load" | "action" | "claim" | null>(null);
  const [working, setWorking] = useState<string | null>(null);

  const load = useCallback(async (search = { organizations: "", users: "" }) => {
    const [overview, organizations, users, audit] = await Promise.all([
      api.platformOverview(),
      api.platformOrganizations({ search: search.organizations, limit: 50 }),
      api.platformUsers({ search: search.users, limit: 50 }),
      api.platformAudit({ limit: 50 }),
    ]);
    setData({
      overview,
      organizations: organizations.items,
      users: users.items,
      audit: audit.items,
      nextOrganizations: organizations.next_offset,
      nextUsers: users.next_offset,
      nextAudit: audit.next_offset,
    });
  }, []);

  useEffect(() => {
    let active = true;
    void api.platformAccess()
      .then(async ({ platform_root }) => {
        if (!active) return;
        if (!platform_root) {
          setAccess("claim");
          return;
        }
        setAccess("root");
        try {
          await load();
        } catch {
          if (active) setError("load");
        }
      })
      .catch(() => {
        if (active) setAccess("denied");
      });
    return () => {
      active = false;
    };
  }, [load]);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      await load({ organizations: orgSearch, users: userSearch });
    } catch {
      setError("load");
    }
  }, [load, orgSearch, userSearch]);

  const validReason = reason.trim().length >= 3 && reason.trim().length <= 500;

  const runAction = useCallback(async (key: string, action: () => Promise<unknown>) => {
    if (!validReason) return;
    setWorking(key);
    setError(null);
    try {
      await action();
      await refresh();
    } catch {
      setError("action");
    } finally {
      setWorking(null);
    }
  }, [refresh, validReason]);

  async function claim() {
    setWorking("claim");
    setError(null);
    try {
      const result = await api.bootstrapPlatformRoot();
      if (!result.claimed) throw new Error("not claimed");
      setAccess("root");
      window.dispatchEvent(new Event("neurai:platform-root-changed"));
      await refresh();
    } catch {
      setError("claim");
    } finally {
      setWorking(null);
    }
  }

  async function loadMore(kind: "organizations" | "users" | "audit") {
    const offset = kind === "organizations"
      ? data.nextOrganizations
      : kind === "users"
        ? data.nextUsers
        : data.nextAudit;
    if (offset === null) return;
    setWorking(`more-${kind}`);
    setError(null);
    try {
      if (kind === "organizations") {
        const page = await api.platformOrganizations({ search: orgSearch, offset, limit: 50 });
        setData((previous) => ({
          ...previous,
          organizations: [...previous.organizations, ...page.items],
          nextOrganizations: page.next_offset,
        }));
      } else if (kind === "users") {
        const page = await api.platformUsers({ search: userSearch, offset, limit: 50 });
        setData((previous) => ({
          ...previous,
          users: [...previous.users, ...page.items],
          nextUsers: page.next_offset,
        }));
      } else {
        const page = await api.platformAudit({ offset, limit: 50 });
        setData((previous) => ({
          ...previous,
          audit: [...previous.audit, ...page.items],
          nextAudit: page.next_offset,
        }));
      }
    } catch {
      setError("load");
    } finally {
      setWorking(null);
    }
  }

  function applySearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void refresh();
  }

  if (access === "checking") {
    return <main className="mx-auto max-w-3xl px-5 py-10 text-sm text-fg-muted">{t("checking")}</main>;
  }

  if (access === "denied") {
    return <main className="mx-auto max-w-3xl px-5 py-10 text-sm text-danger">{t("noAccess")}</main>;
  }

  if (access === "claim") {
    return (
      <main className="mx-auto max-w-3xl px-5 py-10">
        <section className="rounded-2xl border border-border bg-surface p-6 shadow-sm">
          <h1 className="text-2xl font-semibold text-fg">{t("claimTitle")}</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-fg-muted">{t("claimBody")}</p>
          {error === "claim" ? <p role="alert" className="mt-3 text-sm text-danger">{t("claimFailed")}</p> : null}
          <button
            type="button"
            className="tap mt-5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-on-accent disabled:opacity-50"
            onClick={() => void claim()}
            disabled={working === "claim"}
          >
            {t("claim")}
          </button>
        </section>
      </main>
    );
  }

  const busy = working !== null;
  const format = (value: string | null) => value
    ? new Intl.DateTimeFormat(locale === "fa" ? "fa-IR" : "en-GB", { dateStyle: "medium" }).format(new Date(value))
    : "—";

  return (
    <main className="mx-auto max-w-7xl px-5 py-8">
      <header className="border-b border-border pb-6">
        <h1 className="text-3xl font-semibold tracking-tight text-fg">{t("title")}</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-fg-muted">{t("subtitle")}</p>
        <p className="mt-4 rounded-lg border border-accent/25 bg-accent-soft px-4 py-3 text-sm leading-6 text-fg">
          {t("privacy")}
        </p>
      </header>

      {error ? (
        <p role="alert" className="mt-4 text-sm text-danger">
          {error === "claim" ? t("claimFailed") : error === "action" ? t("actionFailed") : t("loadFailed")}
        </p>
      ) : null}

      <section aria-label={t("title")} className="mt-6 grid gap-3 sm:grid-cols-3">
        <CountCard label={t("organizations")} value={data.overview.organizations.total} detail={`${t("active")}: ${data.overview.organizations.active} · ${t("suspended")}: ${data.overview.organizations.suspended}`} />
        <CountCard label={t("users")} value={data.overview.users.total} detail={`${t("active")}: ${data.overview.users.active} · ${t("pending")}: ${data.overview.users.pending} · ${t("disabled")}: ${data.overview.users.disabled}`} />
        <CountCard label={t("roots")} value={data.overview.platform_roots} detail={t("currentRoot")} />
      </section>

      <section className="mt-6 rounded-xl border border-border bg-surface p-4">
        <label htmlFor="platform-action-reason" className="text-sm font-semibold text-fg">{t("reason")}</label>
        <textarea
          id="platform-action-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={500}
          rows={3}
          className="input mt-2 min-h-0 resize-y text-sm"
          aria-describedby="platform-action-reason-hint"
        />
        <p id="platform-action-reason-hint" className="mt-1 text-xs text-fg-muted">{t("reasonHint")}</p>
      </section>

      <section className="mt-6 rounded-xl border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-fg">{t("organizations")}</h2>
          <form className="flex gap-2" onSubmit={applySearch}>
            <label className="sr-only" htmlFor="platform-organization-search">{t("searchOrganizations")}</label>
            <input id="platform-organization-search" className="input h-9 min-h-0 w-56 text-sm" value={orgSearch} onChange={(event) => setOrgSearch(event.target.value)} placeholder={t("searchOrganizations")} />
            <button type="submit" className="tap rounded-lg border border-border px-3 py-1 text-xs font-semibold text-fg">{t("apply")}</button>
          </form>
        </div>
        <div className="mt-4 divide-y divide-border overflow-x-auto rounded-lg border border-border">
          {data.organizations.map((organization) => {
            const nextStatus = organization.status === "active" ? "suspended" : "active";
            const key = `org-${organization.id}`;
            return (
              <div key={organization.id} className="flex min-w-[580px] items-center gap-4 px-3 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-fg">{organization.name}</p>
                  <p className="mt-1 text-xs text-fg-muted">{organization.locale} · {t("memberCount")}: {organization.member_count} · {format(organization.created_at)}</p>
                </div>
                <StatusPill status={organization.status} label={organization.status === "active" ? t("active") : t("suspended")} />
                <button
                  type="button"
                  className="tap rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-fg disabled:opacity-50"
                  disabled={!validReason || busy}
                  onClick={() => void runAction(key, () => api.setPlatformOrganizationStatus(organization.id, nextStatus, reason))}
                >
                  {organization.status === "active" ? t("suspendOrganization") : t("reactivateOrganization")}
                </button>
              </div>
            );
          })}
        </div>
        {data.nextOrganizations !== null ? <MoreButton busy={working === "more-organizations"} onClick={() => void loadMore("organizations")} label={t("loadMore")} /> : null}
      </section>

      <section className="mt-6 rounded-xl border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-fg">{t("users")}</h2>
          <form className="flex gap-2" onSubmit={applySearch}>
            <label className="sr-only" htmlFor="platform-user-search">{t("searchUsers")}</label>
            <input id="platform-user-search" className="input h-9 min-h-0 w-56 text-sm" value={userSearch} onChange={(event) => setUserSearch(event.target.value)} placeholder={t("searchUsers")} />
            <button type="submit" className="tap rounded-lg border border-border px-3 py-1 text-xs font-semibold text-fg">{t("apply")}</button>
          </form>
        </div>
        <div className="mt-4 divide-y divide-border overflow-x-auto rounded-lg border border-border">
          {data.users.map((user) => {
            const nextStatus = user.status === "active" ? "disabled" : "active";
            const key = `user-${user.id}`;
            const isCurrentRoot = user.id === data.overview.current_user_id;
            return (
              <div key={user.id} className="flex min-w-[760px] items-center gap-4 px-3 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-fg">{user.display_name}</p>
                  <p className="mt-1 truncate text-xs text-fg-muted"><span className="ltr">{user.email}</span> · {user.org_name} · {t("role")}: {user.role}</p>
                </div>
                <StatusPill status={user.status} label={t(user.status)} />
                {user.is_platform_root ? <span className="rounded-full bg-accent-soft px-2 py-1 text-xs font-semibold text-accent">{t("currentRoot")}</span> : null}
                <button
                  type="button"
                  className="tap rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-fg disabled:opacity-50"
                  disabled={!validReason || busy || user.is_platform_root}
                  onClick={() => void runAction(key, () => api.setPlatformUserStatus(user.id, nextStatus, reason))}
                >
                  {user.status === "active" ? t("disableUser") : t("reactivateUser")}
                </button>
                <button
                  type="button"
                  className="tap rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-fg disabled:opacity-50"
                  disabled={!validReason || busy || user.is_platform_root}
                  onClick={() => void runAction(`root-${user.id}`, () => api.grantPlatformRoot(user.id, reason))}
                >
                  {t("makeRoot")}
                </button>
                {user.is_platform_root && !isCurrentRoot ? (
                  <button
                    type="button"
                    className="tap rounded-lg border border-danger/40 px-3 py-1.5 text-xs font-semibold text-danger disabled:opacity-50"
                    disabled={!validReason || busy}
                    onClick={() => void runAction(`unroot-${user.id}`, () => api.revokePlatformRoot(user.id, reason))}
                  >
                    {t("removeRoot")}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
        {data.nextUsers !== null ? <MoreButton busy={working === "more-users"} onClick={() => void loadMore("users")} label={t("loadMore")} /> : null}
      </section>

      <section className="mt-6 rounded-xl border border-border bg-surface p-4">
        <h2 className="text-lg font-semibold text-fg">{t("audit")}</h2>
        {data.audit.length === 0 ? <p className="mt-3 text-sm text-fg-muted">{t("noAudit")}</p> : (
          <div className="mt-4 divide-y divide-border overflow-x-auto rounded-lg border border-border">
            {data.audit.map((entry) => (
              <div key={entry.id} className="min-w-[620px] px-3 py-3 text-sm">
                <p className="font-medium text-fg">{entry.action}</p>
                <p className="mt-1 text-xs text-fg-muted"><span className="ltr">{entry.actor_email}</span> · {format(entry.created_at)}</p>
                <p className="mt-2 text-sm text-fg-muted">{entry.reason}</p>
              </div>
            ))}
          </div>
        )}
        {data.nextAudit !== null ? <MoreButton busy={working === "more-audit"} onClick={() => void loadMore("audit")} label={t("loadMore")} /> : null}
      </section>
    </main>
  );
}

function CountCard({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-sm text-fg-muted">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-fg">{value}</p>
      <p className="mt-2 text-xs text-fg-muted">{detail}</p>
    </div>
  );
}

function StatusPill({ status, label }: { status: string; label: string }) {
  const active = status === "active";
  return <span className={`rounded-full px-2 py-1 text-xs font-semibold ${active ? "bg-success/15 text-success" : "bg-danger/10 text-danger"}`}>{label}</span>;
}

function MoreButton({ busy, onClick, label }: { busy: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" className="tap mt-3 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-fg disabled:opacity-50" disabled={busy} onClick={onClick}>
      {label}
    </button>
  );
}
