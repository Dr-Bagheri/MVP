"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type {
  PlatformAuditEntry,
  PlatformOrganization,
  PlatformOverview,
  PlatformUser,
} from "@/api/types";

type AccessState = "checking" | "claim" | "root" | "denied";
type Tab = "organizations" | "users" | "audit";
type OrgFilter = "all" | "active" | "suspended";
type UserFilter = "all" | "active" | "pending" | "disabled";

/** A pending control action awaiting a reason + confirmation. */
interface PendingAction {
  key: string;
  title: string;
  effect: string;
  target: string;
  danger?: boolean;
  run: (reason: string) => Promise<{ changed?: boolean } | unknown>;
}

const EMPTY_OVERVIEW: PlatformOverview = {
  current_user_id: "",
  organizations: { total: 0, active: 0, suspended: 0 },
  users: { total: 0, active: 0, pending: 0, disabled: 0 },
  platform_roots: 0,
};

const PAGE = 50;

/**
 * M32's control plane, made fully operable.
 *
 * The screen still has no route, component, or field for customer content —
 * its data is platform lifecycle metadata only, and every state change is
 * confirmed with an audit reason that core forwards to the named DB function.
 * What changed from the first cut: every action now carries its OWN reason +
 * confirm dialog, so an operator is never staring at disabled buttons gated by
 * a single far-away textarea (the "I can only watch" report). Nothing here can
 * reach a call, transcript, conversation, key, or connector; that wall is RLS,
 * not this UI.
 */
export default function PlatformControlPage() {
  const t = useTranslations("platformRoot");
  const locale = useLocale();

  const [access, setAccess] = useState<AccessState>("checking");
  const [overview, setOverview] = useState<PlatformOverview>(EMPTY_OVERVIEW);
  const [orgs, setOrgs] = useState<PlatformOrganization[]>([]);
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [audit, setAudit] = useState<PlatformAuditEntry[]>([]);
  const [nextOrgs, setNextOrgs] = useState<number | null>(null);
  const [nextUsers, setNextUsers] = useState<number | null>(null);
  const [nextAudit, setNextAudit] = useState<number | null>(null);

  const [tab, setTab] = useState<Tab>("organizations");
  const [orgSearch, setOrgSearch] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [orgFilter, setOrgFilter] = useState<OrgFilter>("all");
  const [userFilter, setUserFilter] = useState<UserFilter>("all");
  const [rootsOnly, setRootsOnly] = useState(false);

  const [pending, setPending] = useState<PendingAction | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<"load" | "claim" | null>(null);
  const [claiming, setClaiming] = useState(false);

  const load = useCallback(async (search = { organizations: "", users: "" }) => {
    const [ov, o, u, a] = await Promise.all([
      api.platformOverview(),
      api.platformOrganizations({ search: search.organizations, limit: PAGE }),
      api.platformUsers({ search: search.users, limit: PAGE }),
      api.platformAudit({ limit: PAGE }),
    ]);
    setOverview(ov);
    setOrgs(o.items);
    setNextOrgs(o.next_offset);
    setUsers(u.items);
    setNextUsers(u.next_offset);
    setAudit(a.items);
    setNextAudit(a.next_offset);
  }, []);

  useEffect(() => {
    let live = true;
    void api
      .platformAccess()
      .then(async ({ platform_root }) => {
        if (!live) return;
        if (!platform_root) return setAccess("claim");
        setAccess("root");
        try {
          await load();
        } catch {
          if (live) setError("load");
        }
      })
      .catch(() => live && setAccess("denied"));
    return () => {
      live = false;
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

  async function loadMore(kind: Tab) {
    const offset = kind === "organizations" ? nextOrgs : kind === "users" ? nextUsers : nextAudit;
    if (offset === null) return;
    setWorking(`more-${kind}`);
    try {
      if (kind === "organizations") {
        const p = await api.platformOrganizations({ search: orgSearch, offset, limit: PAGE });
        setOrgs((prev) => [...prev, ...p.items]);
        setNextOrgs(p.next_offset);
      } else if (kind === "users") {
        const p = await api.platformUsers({ search: userSearch, offset, limit: PAGE });
        setUsers((prev) => [...prev, ...p.items]);
        setNextUsers(p.next_offset);
      } else {
        const p = await api.platformAudit({ offset, limit: PAGE });
        setAudit((prev) => [...prev, ...p.items]);
        setNextAudit(p.next_offset);
      }
    } catch {
      setError("load");
    } finally {
      setWorking(null);
    }
  }

  async function confirmAction(reason: string) {
    if (!pending) return;
    setWorking(pending.key);
    try {
      await pending.run(reason);
      setPending(null);
      await refresh();
    } catch (cause) {
      // surface the failure inside the dialog by rethrowing to the dialog
      throw cause;
    } finally {
      setWorking(null);
    }
  }

  async function claim() {
    setClaiming(true);
    setError(null);
    try {
      const result = await api.bootstrapPlatformRoot();
      if (!result.claimed) throw new Error("not claimed");
      setAccess("root");
      window.dispatchEvent(new Event("neurai:platform-root-changed"));
      await load();
    } catch {
      setError("claim");
    } finally {
      setClaiming(false);
    }
  }

  const fmtDate = useCallback(
    (value: string | null) =>
      value
        ? `⁨${new Intl.DateTimeFormat(locale === "fa" ? "fa-IR" : "en-GB", { dateStyle: "medium" }).format(new Date(value))}⁩`
        : t("never"),
    [locale, t],
  );
  const fmtDateTime = useCallback(
    (value: string) =>
      `⁨${new Intl.DateTimeFormat(locale === "fa" ? "fa-IR" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))}⁩`,
    [locale],
  );

  const orgNames = useMemo(() => new Map(orgs.map((o) => [o.id, o.name])), [orgs]);
  const userNames = useMemo(
    () => new Map(users.map((u) => [u.id, u.display_name || u.email])),
    [users],
  );

  const shownOrgs = useMemo(
    () => orgs.filter((o) => orgFilter === "all" || o.status === orgFilter),
    [orgs, orgFilter],
  );
  const shownUsers = useMemo(
    () =>
      users.filter(
        (u) =>
          (userFilter === "all" || u.status === userFilter) &&
          (!rootsOnly || u.is_platform_root),
      ),
    [users, userFilter, rootsOnly],
  );

  /* ---- access gates ------------------------------------------------------ */
  if (access === "checking") {
    return <Centered className="text-fg-muted">{t("checking")}</Centered>;
  }
  if (access === "denied") {
    return <Centered className="text-danger">{t("noAccess")}</Centered>;
  }
  if (access === "claim") {
    return (
      <Centered>
        <div className="w-full max-w-xl rounded-2xl border border-border bg-surface p-6 shadow-sm">
          <h1 className="text-2xl font-semibold text-fg">{t("claimTitle")}</h1>
          <p className="mt-3 text-sm leading-6 text-fg-muted">{t("claimBody")}</p>
          {error === "claim" ? (
            <p role="alert" className="mt-3 text-sm text-danger">
              {t("claimFailed")}
            </p>
          ) : null}
          <button
            type="button"
            className="tap mt-5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-on-accent disabled:opacity-50"
            onClick={() => void claim()}
            disabled={claiming}
          >
            {claiming ? t("workingLabel") : t("claim")}
          </button>
        </div>
      </Centered>
    );
  }

  /* ---- the console ------------------------------------------------------- */
  const busy = working !== null;

  return (
    <div className="min-h-dvh bg-bg text-fg">
      {/* sticky operator bar */}
      <header className="sticky top-0 z-20 border-b border-border bg-bg/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-5 py-3">
          <span className="rounded-md bg-accent-soft px-2 py-1 text-xs font-bold uppercase tracking-wide text-accent">
            {t("menu")}
          </span>
          <h1 className="text-lg font-semibold text-fg">{t("title")}</h1>
          <span className="ms-auto flex items-center gap-2">
            <button
              type="button"
              className="tap rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-fg hover:bg-surface-2 disabled:opacity-50"
              onClick={() => void refresh()}
              disabled={busy}
            >
              {t("refresh")}
            </button>
            <a
              href={`/${locale}`}
              className="tap rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-fg hover:bg-surface-2"
            >
              {t("exitToApp")}
            </a>
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-6">
        <p className="rounded-lg border border-accent/25 bg-accent-soft px-4 py-3 text-sm leading-6 text-fg">
          {t("privacy")}
        </p>

        {error === "load" ? (
          <p role="alert" className="mt-4 text-sm text-danger">
            {t("loadFailed")}
          </p>
        ) : null}

        {/* overview */}
        <section aria-label={t("title")} className="mt-5 grid gap-3 sm:grid-cols-3">
          <StatCard
            label={t("organizations")}
            value={overview.organizations.total}
            parts={[
              { label: t("active"), value: overview.organizations.active, tone: "good" },
              { label: t("suspended"), value: overview.organizations.suspended, tone: "bad" },
            ]}
          />
          <StatCard
            label={t("users")}
            value={overview.users.total}
            parts={[
              { label: t("active"), value: overview.users.active, tone: "good" },
              { label: t("pending"), value: overview.users.pending, tone: "warn" },
              { label: t("disabled"), value: overview.users.disabled, tone: "bad" },
            ]}
          />
          <StatCard
            label={t("roots")}
            value={overview.platform_roots}
            parts={[{ label: t("currentRoot"), value: 1, tone: "accent" }]}
          />
        </section>

        {/* tabs */}
        <nav className="mt-6 flex gap-1 border-b border-border" role="tablist" aria-label={t("title")}>
          {(["organizations", "users", "audit"] as const).map((key) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              className={`tap -mb-px rounded-t-lg border-b-2 px-4 py-2 text-sm font-semibold transition-colors ${
                tab === key
                  ? "border-accent text-fg"
                  : "border-transparent text-fg-muted hover:text-fg"
              }`}
              onClick={() => setTab(key)}
            >
              {t(key)}
              {key !== "audit" ? (
                <span className="ms-2 rounded-full bg-surface-2 px-1.5 text-xs text-fg-muted">
                  {key === "organizations" ? overview.organizations.total : overview.users.total}
                </span>
              ) : null}
            </button>
          ))}
        </nav>

        {/* ORGANIZATIONS */}
        {tab === "organizations" ? (
          <section className="mt-4">
            <Toolbar
              search={orgSearch}
              onSearch={setOrgSearch}
              onApply={() => void refresh()}
              placeholder={t("searchOrganizations")}
              apply={t("apply")}
              filters={
                <Chips
                  value={orgFilter}
                  onChange={(v) => setOrgFilter(v as OrgFilter)}
                  options={[
                    { value: "all", label: t("filterAll") },
                    { value: "active", label: t("active") },
                    { value: "suspended", label: t("suspended") },
                  ]}
                />
              }
            />
            <div className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
              {shownOrgs.length === 0 ? (
                <Empty>{t("nothingFound")}</Empty>
              ) : (
                shownOrgs.map((o) => (
                  <div key={o.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-fg">{o.name}</p>
                      <p className="mt-0.5 text-xs text-fg-muted">
                        {o.locale} · {t("memberCount")}: {o.member_count} · {t("created")}: {fmtDate(o.created_at)}
                      </p>
                    </div>
                    <Pill ok={o.status === "active"}>
                      {o.status === "active" ? t("active") : t("suspended")}
                    </Pill>
                    {o.status === "active" ? (
                      <ActionButton
                        danger
                        disabled={busy}
                        onClick={() =>
                          setPending({
                            key: `org-${o.id}`,
                            title: t("suspendOrganization"),
                            effect: t("effectSuspendOrg"),
                            target: o.name,
                            danger: true,
                            run: (r) => api.setPlatformOrganizationStatus(o.id, "suspended", r),
                          })
                        }
                      >
                        {t("suspendOrganization")}
                      </ActionButton>
                    ) : (
                      <ActionButton
                        disabled={busy}
                        onClick={() =>
                          setPending({
                            key: `org-${o.id}`,
                            title: t("reactivateOrganization"),
                            effect: t("effectReactivateOrg"),
                            target: o.name,
                            run: (r) => api.setPlatformOrganizationStatus(o.id, "active", r),
                          })
                        }
                      >
                        {t("reactivateOrganization")}
                      </ActionButton>
                    )}
                  </div>
                ))
              )}
            </div>
            {nextOrgs !== null ? (
              <More busy={working === "more-organizations"} onClick={() => void loadMore("organizations")}>
                {t("loadMore")}
              </More>
            ) : null}
          </section>
        ) : null}

        {/* USERS */}
        {tab === "users" ? (
          <section className="mt-4">
            <Toolbar
              search={userSearch}
              onSearch={setUserSearch}
              onApply={() => void refresh()}
              placeholder={t("searchUsers")}
              apply={t("apply")}
              filters={
                <div className="flex flex-wrap items-center gap-2">
                  <Chips
                    value={userFilter}
                    onChange={(v) => setUserFilter(v as UserFilter)}
                    options={[
                      { value: "all", label: t("filterAll") },
                      { value: "active", label: t("active") },
                      { value: "pending", label: t("pending") },
                      { value: "disabled", label: t("disabled") },
                    ]}
                  />
                  <button
                    type="button"
                    role="switch"
                    aria-checked={rootsOnly}
                    onClick={() => setRootsOnly((v) => !v)}
                    className={`tap rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                      rootsOnly ? "border-accent bg-accent-soft text-accent" : "border-border text-fg-muted"
                    }`}
                  >
                    {t("rootsOnly")}
                  </button>
                </div>
              }
            />
            <div className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
              {shownUsers.length === 0 ? (
                <Empty>{t("nothingFound")}</Empty>
              ) : (
                shownUsers.map((u) => {
                  const isSelf = u.id === overview.current_user_id;
                  const tombstoned = u.email.endsWith("@tombstone.invalid");
                  return (
                    <div key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-2 truncate font-medium text-fg">
                          {tombstoned ? t("tombstoned") : u.display_name}
                          {u.is_platform_root ? (
                            <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent">
                              {isSelf ? t("selfBadge") : t("currentRoot")}
                            </span>
                          ) : null}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-fg-muted">
                          <span className="ltr">{u.email}</span> · {u.org_name} · {t("role")}: {u.role}
                          {u.username ? <> · @{u.username}</> : null}
                        </p>
                        <p className="mt-0.5 text-[11px] text-fg-subtle">
                          {t("lastSeen")}: {fmtDate(u.last_seen_at)} · {t("created")}: {fmtDate(u.created_at)}
                        </p>
                      </div>
                      <Pill ok={u.status === "active"} warn={u.status === "pending"}>
                        {t(u.status)}
                      </Pill>

                      {/* enable / disable — never a root, never yourself */}
                      {u.status === "disabled" ? (
                        <ActionButton
                          disabled={busy}
                          onClick={() =>
                            setPending({
                              key: `user-${u.id}`,
                              title: t("reactivateUser"),
                              effect: t("effectReactivateUser"),
                              target: u.display_name || u.email,
                              run: (r) => api.setPlatformUserStatus(u.id, "active", r),
                            })
                          }
                        >
                          {t("reactivateUser")}
                        </ActionButton>
                      ) : (
                        <ActionButton
                          danger
                          disabled={busy || u.is_platform_root || isSelf}
                          onClick={() =>
                            setPending({
                              key: `user-${u.id}`,
                              title: t("disableUser"),
                              effect: t("effectDisableUser"),
                              target: u.display_name || u.email,
                              danger: true,
                              run: (r) => api.setPlatformUserStatus(u.id, "disabled", r),
                            })
                          }
                        >
                          {t("disableUser")}
                        </ActionButton>
                      )}

                      {/* grant / revoke root */}
                      {u.is_platform_root ? (
                        <ActionButton
                          danger
                          disabled={busy || isSelf}
                          onClick={() =>
                            setPending({
                              key: `root-${u.id}`,
                              title: t("removeRoot"),
                              effect: t("effectRemoveRoot"),
                              target: u.display_name || u.email,
                              danger: true,
                              run: (r) => api.revokePlatformRoot(u.id, r),
                            })
                          }
                        >
                          {t("removeRoot")}
                        </ActionButton>
                      ) : (
                        <ActionButton
                          disabled={busy || u.status !== "active" || tombstoned}
                          onClick={() =>
                            setPending({
                              key: `root-${u.id}`,
                              title: t("makeRoot"),
                              effect: t("effectMakeRoot"),
                              target: u.display_name || u.email,
                              run: (r) => api.grantPlatformRoot(u.id, r),
                            })
                          }
                        >
                          {t("makeRoot")}
                        </ActionButton>
                      )}
                    </div>
                  );
                })
              )}
            </div>
            {nextUsers !== null ? (
              <More busy={working === "more-users"} onClick={() => void loadMore("users")}>
                {t("loadMore")}
              </More>
            ) : null}
          </section>
        ) : null}

        {/* AUDIT */}
        {tab === "audit" ? (
          <section className="mt-4">
            <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
              {audit.length === 0 ? (
                <Empty>{t("noAudit")}</Empty>
              ) : (
                audit.map((e) => {
                  const target = e.target_org_id
                    ? orgNames.get(e.target_org_id) ?? shortId(e.target_org_id)
                    : e.target_user_id
                      ? userNames.get(e.target_user_id) ?? shortId(e.target_user_id)
                      : "—";
                  return (
                    <div key={e.id} className="px-4 py-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-fg">{auditLabel(t, e.action)}</span>
                        <span className="text-xs text-fg-subtle">·</span>
                        <span className="text-xs text-fg-muted">
                          {t("dialogTarget")}: {target}
                        </span>
                        <span className="ms-auto text-xs text-fg-subtle">{fmtDateTime(e.created_at)}</span>
                      </div>
                      <p className="mt-1 text-xs text-fg-muted">
                        {t("auditBy")} <span className="ltr">{e.actor_email}</span>
                      </p>
                      <p className="mt-1.5 rounded-md bg-surface-2 px-3 py-2 text-sm text-fg">{e.reason}</p>
                    </div>
                  );
                })
              )}
            </div>
            {nextAudit !== null ? (
              <More busy={working === "more-audit"} onClick={() => void loadMore("audit")}>
                {t("loadMore")}
              </More>
            ) : null}
          </section>
        ) : null}
      </main>

      {pending ? (
        <ActionDialog
          action={pending}
          onClose={() => setPending(null)}
          onConfirm={confirmAction}
          labels={{
            reason: t("dialogReason"),
            hint: t("reasonHint"),
            target: t("dialogTarget"),
            confirm: t("confirm"),
            cancel: t("cancel"),
            working: t("workingLabel"),
            failed: t("actionFailed"),
          }}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------------- */

function auditLabel(t: (k: string) => string, action: string): string {
  const known = new Set([
    "root_bootstrapped",
    "root_granted",
    "root_revoked",
    "org_status_changed",
    "user_status_changed",
  ]);
  return known.has(action) ? t(`action_${action}`) : action;
}

const shortId = (id: string) => `#${id.slice(0, 8)}`;

function Centered({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <main className={`grid min-h-dvh place-items-center bg-bg px-5 text-sm ${className}`}>
      <div className="text-center">{children}</div>
    </main>
  );
}

type Tone = "good" | "bad" | "warn" | "accent";
const TONE: Record<Tone, string> = {
  good: "text-success",
  bad: "text-danger",
  warn: "text-warning",
  accent: "text-accent",
};

function StatCard({
  label,
  value,
  parts,
}: {
  label: string;
  value: number;
  parts: { label: string; value: number; tone: Tone }[];
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-sm text-fg-muted">{label}</p>
      <p className="mt-1 text-3xl font-bold text-fg">{value}</p>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {parts.map((p) => (
          <span key={p.label} className="text-fg-muted">
            {p.label}: <span className={`font-semibold ${TONE[p.tone]}`}>{p.value}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function Pill({ ok, warn, children }: { ok: boolean; warn?: boolean; children: ReactNode }) {
  const cls = ok
    ? "bg-success/15 text-success"
    : warn
      ? "bg-warning/15 text-warning"
      : "bg-danger/10 text-danger";
  return <span className={`rounded-full px-2 py-1 text-xs font-semibold ${cls}`}>{children}</span>;
}

function ActionButton({
  children,
  onClick,
  disabled,
  danger,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`tap rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-40 ${
        danger
          ? "border-danger/40 text-danger hover:bg-danger/10"
          : "border-border text-fg hover:bg-surface-2"
      }`}
    >
      {children}
    </button>
  );
}

function More({ busy, onClick, children }: { busy: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      className="tap mt-3 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-fg hover:bg-surface-2 disabled:opacity-50"
      disabled={busy}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-6 text-center text-sm text-fg-muted">{children}</p>;
}

function Chips({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`tap rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
            value === o.value ? "bg-accent text-on-accent" : "bg-surface-2 text-fg-muted hover:text-fg"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toolbar({
  search,
  onSearch,
  onApply,
  placeholder,
  apply,
  filters,
}: {
  search: string;
  onSearch: (v: string) => void;
  onApply: () => void;
  placeholder: string;
  apply: string;
  filters: ReactNode;
}) {
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    onApply();
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      {filters}
      <form className="flex gap-2" onSubmit={submit}>
        <input
          className="input h-9 min-h-0 w-56 text-sm"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
        />
        <button type="submit" className="tap rounded-lg border border-border px-3 py-1 text-xs font-semibold text-fg hover:bg-surface-2">
          {apply}
        </button>
      </form>
    </div>
  );
}

function ActionDialog({
  action,
  onClose,
  onConfirm,
  labels,
}: {
  action: PendingAction;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
  labels: {
    reason: string;
    hint: string;
    target: string;
    confirm: string;
    cancel: string;
    working: string;
    failed: string;
  };
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const valid = reason.trim().length >= 3 && reason.trim().length <= 500;

  async function go() {
    if (!valid || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await onConfirm(reason.trim());
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={action.title}
      onClick={() => !busy && onClose()}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-border bg-surface p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className={`text-lg font-semibold ${action.danger ? "text-danger" : "text-fg"}`}>
          {action.title}
        </h2>
        <p className="mt-1 text-xs text-fg-muted">
          {labels.target}: <span className="font-medium text-fg">{action.target}</span>
        </p>
        <p className="mt-2 text-sm leading-6 text-fg-muted">{action.effect}</p>

        <label htmlFor="pa-reason" className="mt-4 block text-sm font-semibold text-fg">
          {labels.reason}
        </label>
        <textarea
          id="pa-reason"
          ref={ref}
          rows={3}
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="input mt-1 min-h-0 w-full resize-y text-sm"
          aria-describedby="pa-reason-hint"
        />
        <div className="mt-1 flex items-center justify-between text-xs text-fg-muted">
          <span id="pa-reason-hint">{labels.hint}</span>
          <span className="ltr tabular-nums">{reason.trim().length}/500</span>
        </div>

        {failed ? (
          <p role="alert" className="mt-2 text-sm text-danger">
            {labels.failed}
          </p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="tap rounded-lg border border-border px-4 py-2 text-sm font-semibold text-fg hover:bg-surface-2 disabled:opacity-50"
            onClick={onClose}
            disabled={busy}
          >
            {labels.cancel}
          </button>
          <button
            type="button"
            className={`tap rounded-lg px-4 py-2 text-sm font-semibold text-on-accent disabled:opacity-50 ${
              action.danger ? "bg-danger" : "bg-accent"
            }`}
            onClick={() => void go()}
            disabled={!valid || busy}
          >
            {busy ? labels.working : labels.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
