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

/** A single field in a metadata edit form. */
interface EditField {
  name: string;
  label: string;
  kind: "text" | "select";
  value: string;
  options?: { value: string; label: string }[];
  placeholder?: string;
  hint?: string;
  required?: boolean;
  dir?: "ltr" | "rtl" | "auto";
}

/** A pending metadata edit awaiting field values + a reason. */
interface EditState {
  key: string;
  title: string;
  target: string;
  note?: string;
  fields: EditField[];
  submit: (values: Record<string, string>, reason: string) => Promise<unknown>;
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

import { CreateOrg } from "@/components/platform/CreateOrg";
import { ConfirmDialog } from "@/components/rowActions";

export default function PlatformControlPage() {
  const t = useTranslations("platformRoot");
  /* the role words are the ADMIN surface's — one vocabulary for one thing,
     wherever it is read */
  const tAdmin = useTranslations("admin");
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
  const [orgTrash, setOrgTrash] = useState(false);
  const [userTrash, setUserTrash] = useState(false);

  const [pending, setPending] = useState<PendingAction | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<"load" | "claim" | null>(null);
  const [claiming, setClaiming] = useState(false);

  const load = useCallback(
    async (
      opts: { organizations?: string; users?: string; orgDeleted?: boolean; userDeleted?: boolean } = {},
    ) => {
      const [ov, o, u, a] = await Promise.all([
        api.platformOverview(),
        api.platformOrganizations({ search: opts.organizations ?? "", limit: PAGE, deleted: opts.orgDeleted ?? false }),
        api.platformUsers({ search: opts.users ?? "", limit: PAGE, deleted: opts.userDeleted ?? false }),
        api.platformAudit({ limit: PAGE }),
      ]);
      setOverview(ov);
      setOrgs(o.items);
      setNextOrgs(o.next_offset);
      setUsers(u.items);
      setNextUsers(u.next_offset);
      setAudit(a.items);
      setNextAudit(a.next_offset);
    },
    [],
  );

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
      await load({
        organizations: orgSearch,
        users: userSearch,
        orgDeleted: orgTrash,
        userDeleted: userTrash,
      });
    } catch {
      setError("load");
    }
  }, [load, orgSearch, userSearch, orgTrash, userTrash]);

  async function loadMore(kind: Tab) {
    const offset = kind === "organizations" ? nextOrgs : kind === "users" ? nextUsers : nextAudit;
    if (offset === null) return;
    setWorking(`more-${kind}`);
    try {
      if (kind === "organizations") {
        const p = await api.platformOrganizations({ search: orgSearch, offset, limit: PAGE, deleted: orgTrash });
        setOrgs((prev) => [...prev, ...p.items]);
        setNextOrgs(p.next_offset);
      } else if (kind === "users") {
        const p = await api.platformUsers({ search: userSearch, offset, limit: PAGE, deleted: userTrash });
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

  /**
   * Switch a tab between the live list and the "recently deleted" list. The
   * new value is passed to the query explicitly — reading it from state here
   * would be one render behind the click.
   */
  async function toggleTrash(kind: "organizations" | "users", on: boolean) {
    setError(null);
    if (kind === "organizations") setOrgTrash(on);
    else setUserTrash(on);
    setWorking(`view-${kind}`);
    try {
      if (kind === "organizations") {
        const p = await api.platformOrganizations({ search: orgSearch, limit: PAGE, deleted: on });
        setOrgs(p.items);
        setNextOrgs(p.next_offset);
      } else {
        const p = await api.platformUsers({ search: userSearch, limit: PAGE, deleted: on });
        setUsers(p.items);
        setNextUsers(p.next_offset);
      }
    } catch {
      setError("load");
    } finally {
      setWorking(null);
    }
  }

  async function confirmEdit(values: Record<string, string>, reason: string) {
    if (!edit) return;
    setWorking(edit.key);
    try {
      await edit.submit(values, reason);
      setEdit(null);
      await refresh();
    } catch (cause) {
      throw cause; // surface inside the edit dialog
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
    () => (orgTrash ? orgs : orgs.filter((o) => orgFilter === "all" || o.status === orgFilter)),
    [orgs, orgFilter, orgTrash],
  );
  /* the arrivals waiting to be placed — always shown, whatever the filter
     chips say, because a queue that hides behind a filter is a queue nobody
     empties */
  const pendingArrivals = useMemo(
    () => users.filter((u) => u.status === "pending" && u.deleted_at === null),
    [users],
  );
  /** the organisation and role chosen for each arrival, before confirming */
  const [placement, setPlacement] = useState<Record<string, { org: string; role: string }>>({});

  const shownUsers = useMemo(
    () =>
      userTrash
        ? users
        : users.filter(
            (u) =>
              (userFilter === "all" || u.status === userFilter) &&
              (!rootsOnly || u.is_platform_root),
          ),
    [users, userFilter, rootsOnly, userTrash],
  );

  /* Build the metadata-edit form for an org / a user. Email is never a field:
     it is the auth-owned sign-in identity and core rejects any attempt. */
  function orgEditForm(o: PlatformOrganization): EditState {
    return {
      key: `edit-org-${o.id}`,
      title: t("editOrganization"),
      target: o.name,
      fields: [
        { name: "name", label: t("orgName"), kind: "text", value: o.name, required: true, dir: "auto" },
        { name: "locale", label: t("interfaceLocale"), kind: "text", value: o.locale, dir: "ltr", hint: t("localeHint"), placeholder: "fa" },
      ],
      submit: (v, r) => api.updatePlatformOrganization(o.id, { name: v.name, locale: v.locale }, r),
    };
  }
  function userEditForm(u: PlatformUser): EditState {
    return {
      key: `edit-user-${u.id}`,
      title: t("editUser"),
      target: u.display_name || u.email,
      note: t("emailImmutable"),
      fields: [
        { name: "display_name", label: t("displayName"), kind: "text", value: u.display_name, required: true, dir: "auto" },
        { name: "display_name_en", label: t("displayNameEn"), kind: "text", value: u.display_name_en ?? "", dir: "ltr", hint: t("displayNameEnHint") },
        { name: "username", label: t("usernameLabel"), kind: "text", value: u.username ?? "", dir: "ltr", hint: t("usernameHint"), placeholder: "handle" },
        { name: "locale", label: t("interfaceLocale"), kind: "text", value: u.locale, dir: "ltr", hint: t("localeHint"), placeholder: "fa" },
        {
          name: "role",
          label: t("role"),
          kind: "select",
          value: u.role,
          options: [
            { value: "member", label: t("roleOption_member") },
            { value: "admin", label: t("roleOption_admin") },
            { value: "owner", label: t("roleOption_owner") },
          ],
        },
      ],
      submit: (v, r) =>
        api.updatePlatformUser(
          u.id,
          {
            display_name: v.display_name,
            display_name_en: v.display_name_en === "" ? null : v.display_name_en,
            username: v.username === "" ? null : v.username,
            locale: v.locale,
            role: v.role,
          },
          r,
        ),
    };
  }

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
        <div className="mx-auto flex max-w-content flex-wrap items-center gap-3 px-5 py-3">
          <span className="rounded-md bg-accent-soft px-2 py-1 text-xs font-bold uppercase tracking-wide text-accent">
            {t("menu")}
          </span>
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

      <main className="mx-auto max-w-content px-page-inline pb-page-bottom pt-page-sm md:px-page-inline-md md:pt-page">
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
            {/* org BIRTH (db/0082): signup joins by name; new orgs start here */}
            <div className="mb-3">
              <CreateOrg onCreated={() => void refresh()} />
            </div>
            <Toolbar
              search={orgSearch}
              onSearch={setOrgSearch}
              onApply={() => void refresh()}
              placeholder={t("searchOrganizations")}
              apply={t("apply")}
              filters={
                <div className="flex flex-wrap items-center gap-2">
                  <ViewToggle
                    trash={orgTrash}
                    onChange={(on) => void toggleTrash("organizations", on)}
                    labels={{ current: t("showCurrent"), deleted: t("showDeleted") }}
                  />
                  {!orgTrash ? (
                    <Chips
                      value={orgFilter}
                      onChange={(v) => setOrgFilter(v as OrgFilter)}
                      options={[
                        { value: "all", label: t("filterAll") },
                        { value: "active", label: t("active") },
                        { value: "suspended", label: t("suspended") },
                      ]}
                    />
                  ) : null}
                </div>
              }
            />
            <div className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
              {shownOrgs.length === 0 ? (
                <Empty>{orgTrash ? t("deletedEmptyOrgs") : t("nothingFound")}</Empty>
              ) : (
                shownOrgs.map((o) => (
                  <div key={o.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-fg">{o.name}</p>
                      <p className="mt-0.5 text-xs text-fg-muted">
                        {o.locale} · {t("memberCount")}: {o.member_count} · {t("created")}: {fmtDate(o.created_at)}
                      </p>
                    </div>
                    {orgTrash ? (
                      <>
                        <PurgeBadge purgeAfter={o.purge_after} fmt={(d) => t("purgeIn", { days: d })} />
                        <ActionButton
                          disabled={busy}
                          onClick={() =>
                            setPending({
                              key: `org-${o.id}`,
                              title: t("restoreOrganization"),
                              effect: t("effectRestoreOrg"),
                              target: o.name,
                              run: (r) => api.restorePlatformOrganization(o.id, r),
                            })
                          }
                        >
                          {t("restoreOrganization")}
                        </ActionButton>
                        <ActionButton
                          danger
                          disabled={busy}
                          onClick={() =>
                            setPending({
                              key: `org-purge-${o.id}`,
                              title: t("purgeOrgNow"),
                              effect: t("effectPurgeOrg"),
                              target: o.name,
                              danger: true,
                              run: (r) => api.purgePlatformOrganization(o.id, r),
                            })
                          }
                        >
                          {t("purgeNow")}
                        </ActionButton>
                      </>
                    ) : (
                      <>
                        <Pill ok={o.status === "active"}>
                          {o.status === "active" ? t("active") : t("suspended")}
                        </Pill>
                        <ActionButton disabled={busy} onClick={() => setEdit(orgEditForm(o))}>
                          {t("edit")}
                        </ActionButton>
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
                        {/* THE ARRIVALS DOOR (0149). Exactly one organisation
                            carries it — turning one on clears the other in
                            the same database statement, so this is a single
                            press and never a two-step move with a shut door
                            in the middle. */}
                        {o.status === "active" ? (
                          <ActionButton
                            disabled={busy}
                            onClick={() =>
                              setPending({
                                key: `org-signups-${o.id}`,
                                title: o.accepts_signups ? t("closeSignups") : t("openSignups"),
                                effect: o.accepts_signups ? t("effectCloseSignups") : t("effectOpenSignups"),
                                target: o.name,
                                run: (r) =>
                                  api.setPlatformOrganizationSignups(o.id, !o.accepts_signups, r),
                              })
                            }
                          >
                            {o.accepts_signups ? t("closeSignups") : t("openSignups")}
                          </ActionButton>
                        ) : null}
                        <ActionButton
                          danger
                          disabled={busy}
                          onClick={() =>
                            setPending({
                              key: `org-del-${o.id}`,
                              title: t("deleteOrganization"),
                              effect: t("effectDeleteOrg"),
                              target: o.name,
                              danger: true,
                              run: (r) => api.softDeletePlatformOrganization(o.id, r),
                            })
                          }
                        >
                          {t("deleteOrganization")}
                        </ActionButton>
                      </>
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
            {/*
              PENDING ARRIVALS (user directive, 2026-09-02: "the pending must
              land in the platform control, then there it will assign the org
              and get accepted or rejected").
              This queue used to live in Management·Users, where an org admin
              approved their own arrivals. That is right for someone an admin
              INVITED and already expects; it is wrong for the case that
              actually produces these rows — a stranger signs up, lands in an
              organisation of their own naming, and the only person who can
              decide where they truly belong is the vendor.
              Placement is ONE act: organisation, role and activation
              together (0156). Two steps would leave a member ACTIVE in the
              org they invented if the second never happened.
            */}
            {!userTrash && pendingArrivals.length > 0 ? (
              <div className="mb-3 overflow-hidden rounded-2xl border border-warning/30 bg-surface">
                <p className="border-b border-border px-4 py-2.5 text-xs font-semibold text-warning">
                  {t("pendingArrivals")}
                </p>
                <div className="divide-y divide-border">
                  {pendingArrivals.map((u) => (
                    <div key={u.id} className="flex flex-wrap items-center gap-2 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-fg">{u.display_name}</p>
                        <p className="truncate text-xs text-fg-subtle"><span className="ltr">{u.email}</span></p>
                      </div>
                      <select
                        aria-label={t("placeOrg")}
                        className="input h-[34px] min-h-[34px] w-48"
                        value={placement[u.id]?.org ?? ""}
                        onChange={(e) => setPlacement((prev) => ({
                          ...prev,
                          [u.id]: { org: e.target.value, role: prev[u.id]?.role ?? "member" },
                        }))}
                      >
                        <option value="">{t("placeOrgChoose")}</option>
                        {orgs.filter((o) => o.deleted_at === null).map((o) => (
                          <option key={o.id} value={o.id}>{o.name}</option>
                        ))}
                      </select>
                      <select
                        aria-label={t("placeRole")}
                        className="input h-[34px] min-h-[34px] w-32"
                        value={placement[u.id]?.role ?? "member"}
                        onChange={(e) => setPlacement((prev) => ({
                          ...prev,
                          [u.id]: { org: prev[u.id]?.org ?? "", role: e.target.value },
                        }))}
                      >
                        <option value="member">{tAdmin("roleMember")}</option>
                        <option value="admin">{tAdmin("roleAdmin")}</option>
                        <option value="owner">{tAdmin("roleOwner")}</option>
                      </select>
                      <button
                        type="button"
                        className="btn btn-sm bg-accent text-on-accent"
                        /* the button is off until an organisation is chosen —
                           the whole point of the queue is that nobody is
                           placed without that decision being made */
                        disabled={!placement[u.id]?.org || working === `place-${u.id}`}
                        onClick={() => setPending({
                          key: `place-${u.id}`,
                          title: t("placeConfirm", { name: u.display_name }),
                          effect: t("placeEffect"),
                          target: u.email,
                          run: async (reason) => {
                            const chosen = placement[u.id]!;
                            await api.placePlatformUser(u.id, chosen.org, chosen.role, reason);
                            await refresh();
                          },
                        })}
                      >
                        {t("place")}
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm border border-border text-fg-muted hover:text-danger"
                        disabled={working === `reject-${u.id}`}
                        onClick={() => setPending({
                          key: `reject-${u.id}`,
                          title: t("rejectConfirm", { name: u.display_name }),
                          effect: t("rejectEffect"),
                          target: u.email,
                          danger: true,
                          run: async (reason) => {
                            await api.softDeletePlatformUser(u.id, reason);
                            await refresh();
                          },
                        })}
                      >
                        {t("reject")}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            <Toolbar
              search={userSearch}
              onSearch={setUserSearch}
              onApply={() => void refresh()}
              placeholder={t("searchUsers")}
              apply={t("apply")}
              filters={
                <div className="flex flex-wrap items-center gap-2">
                  <ViewToggle
                    trash={userTrash}
                    onChange={(on) => void toggleTrash("users", on)}
                    labels={{ current: t("showCurrent"), deleted: t("showDeleted") }}
                  />
                  {!userTrash ? (
                    <>
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
                    </>
                  ) : null}
                </div>
              }
            />
            <div className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
              {shownUsers.length === 0 ? (
                <Empty>{userTrash ? t("deletedEmptyUsers") : t("nothingFound")}</Empty>
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
                      {userTrash ? (
                        <>
                          <PurgeBadge purgeAfter={u.purge_after} fmt={(d) => t("purgeIn", { days: d })} />
                          <ActionButton
                            disabled={busy}
                            onClick={() =>
                              setPending({
                                key: `user-${u.id}`,
                                title: t("restoreUser"),
                                effect: t("effectRestoreUser"),
                                target: u.display_name || u.email,
                                run: (r) => api.restorePlatformUser(u.id, r),
                              })
                            }
                          >
                            {t("restoreUser")}
                          </ActionButton>
                          <ActionButton
                            danger
                            disabled={busy}
                            onClick={() =>
                              setPending({
                                key: `user-purge-${u.id}`,
                                title: t("purgeUserNow"),
                                effect: t("effectPurgeUser"),
                                target: u.display_name || u.email,
                                danger: true,
                                run: (r) => api.purgePlatformUser(u.id, r),
                              })
                            }
                          >
                            {t("purgeNow")}
                          </ActionButton>
                        </>
                      ) : (
                        <>
                          <Pill ok={u.status === "active"} warn={u.status === "pending"}>
                            {t(u.status)}
                          </Pill>

                          <ActionButton disabled={busy || tombstoned} onClick={() => setEdit(userEditForm(u))}>
                            {t("edit")}
                          </ActionButton>

                          {/* ACCEPT — the pending queue's only exit, and the
                              reason the queue exists (user directive: an
                              arrival waits until an admin accepts). It is the
                              same status write as reactivation and a
                              different sentence, because "accept this person"
                              and "undo a disabling" are different decisions
                              wearing one verb. */}
                          {u.status === "pending" ? (
                            <ActionButton
                              disabled={busy}
                              onClick={() =>
                                setPending({
                                  key: `user-${u.id}`,
                                  title: t("acceptUser"),
                                  effect: t("effectAcceptUser"),
                                  target: u.display_name || u.email,
                                  run: (r) => api.setPlatformUserStatus(u.id, "active", r),
                                })
                              }
                            >
                              {t("acceptUser")}
                            </ActionButton>
                          ) : null}

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

                          {/* soft delete — never a root, never yourself, never a tombstone */}
                          <ActionButton
                            danger
                            disabled={busy || u.is_platform_root || isSelf || tombstoned}
                            onClick={() =>
                              setPending({
                                key: `user-del-${u.id}`,
                                title: t("deleteUser"),
                                effect: t("effectDeleteUser"),
                                target: u.display_name || u.email,
                                danger: true,
                                run: (r) => api.softDeletePlatformUser(u.id, r),
                              })
                            }
                          >
                            {t("deleteUser")}
                          </ActionButton>
                        </>
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

      {edit ? (
        <EditDialog
          edit={edit}
          onClose={() => setEdit(null)}
          onConfirm={confirmEdit}
          labels={{
            reason: t("dialogReason"),
            hint: t("reasonHint"),
            target: t("dialogTarget"),
            save: t("save"),
            cancel: t("cancel"),
            working: t("saving"),
            failed: t("editFailed"),
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
    "org_updated",
    "user_updated",
    "org_deleted",
    "org_restored",
    "user_deleted",
    "user_restored",
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

/** Segmented "Current | Recently deleted" switch for a tab. */
function ViewToggle({
  trash,
  onChange,
  labels,
}: {
  trash: boolean;
  onChange: (deleted: boolean) => void;
  labels: { current: string; deleted: string };
}) {
  return (
    <div className="inline-flex rounded-full border border-border p-0.5">
      {([false, true] as const).map((v) => (
        <button
          key={String(v)}
          type="button"
          aria-pressed={trash === v}
          onClick={() => onChange(v)}
          className={`tap rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
            trash === v ? "bg-accent text-on-accent" : "text-fg-muted hover:text-fg"
          }`}
        >
          {v ? labels.deleted : labels.current}
        </button>
      ))}
    </div>
  );
}

/**
 * Days-until-purge chip. Colour deepens as the 7-day window closes; the days
 * are computed from purge_after, so the label localises via ICU plural.
 */
function PurgeBadge({ purgeAfter, fmt }: { purgeAfter: string | null; fmt: (days: number) => string }) {
  if (!purgeAfter) return null;
  const ms = new Date(purgeAfter).getTime() - Date.now();
  const days = Math.max(0, Math.ceil(ms / 86_400_000));
  const cls = days <= 1 ? "bg-danger/15 text-danger" : "bg-warning/15 text-warning";
  return <span className={`rounded-full px-2 py-1 text-xs font-semibold ${cls}`}>{fmt(days)}</span>;
}

/**
 * Metadata edit dialog: a small form (fields defined by the caller) plus the
 * mandatory audit reason. No field here can reach customer content; the caller
 * only ever supplies identity/locale/role fields, never an email.
 */
function EditDialog({
  edit,
  onClose,
  onConfirm,
  labels,
}: {
  edit: EditState;
  onClose: () => void;
  onConfirm: (values: Record<string, string>, reason: string) => Promise<void>;
  labels: {
    reason: string;
    hint: string;
    target: string;
    save: string;
    cancel: string;
    working: string;
    failed: string;
  };
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(edit.fields.map((f) => [f.name, f.value])),
  );
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const requiredOk = edit.fields.every((f) => !f.required || values[f.name]?.trim());
  const reasonOk = reason.trim().length >= 3 && reason.trim().length <= 500;
  const valid = requiredOk && reasonOk;

  async function go() {
    if (!valid || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const trimmed = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim()]));
      await onConfirm(trimmed, reason.trim());
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
      aria-label={edit.title}
      onClick={() => !busy && onClose()}
    >
      <div
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-2xl border border-border bg-surface p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-fg">{edit.title}</h2>
        <p className="mt-1 text-xs text-fg-muted">
          {labels.target}: <span className="font-medium text-fg">{edit.target}</span>
        </p>
        {edit.note ? <p className="mt-2 text-xs text-fg-subtle">{edit.note}</p> : null}

        <div className="mt-4 space-y-3">
          {edit.fields.map((f) => {
            const id = `ef-${f.name}`;
            return (
              <div key={f.name}>
                <label htmlFor={id} className="block text-sm font-semibold text-fg">
                  {f.label}
                </label>
                {f.kind === "select" ? (
                  <select
                    id={id}
                    value={values[f.name] ?? ""}
                    onChange={(e) => setValues((prev) => ({ ...prev, [f.name]: e.target.value }))}
                    className="input mt-1 h-9 min-h-0 w-full text-sm"
                  >
                    {(f.options ?? []).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={id}
                    dir={f.dir ?? "auto"}
                    value={values[f.name] ?? ""}
                    placeholder={f.placeholder}
                    onChange={(e) => setValues((prev) => ({ ...prev, [f.name]: e.target.value }))}
                    className="input mt-1 h-9 min-h-0 w-full text-sm"
                  />
                )}
                {f.hint ? <p className="mt-1 text-xs text-fg-subtle">{f.hint}</p> : null}
              </div>
            );
          })}

          <div>
            <label htmlFor="ef-reason" className="block text-sm font-semibold text-fg">
              {labels.reason}
            </label>
            <textarea
              id="ef-reason"
              rows={2}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="input mt-1 min-h-0 w-full resize-y text-sm"
              aria-describedby="ef-reason-hint"
            />
            <div className="mt-1 flex items-center justify-between text-xs text-fg-muted">
              <span id="ef-reason-hint">{labels.hint}</span>
              <span className="ltr tabular-nums">{reason.trim().length}/500</span>
            </div>
          </div>
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
            className="tap rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-on-accent disabled:opacity-50"
            onClick={() => void go()}
            disabled={!valid || busy}
          >
            {busy ? labels.working : labels.save}
          </button>
        </div>
      </div>
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

  /* focus the reason box on open. Escape is NOT bound here any more —
     ConfirmDialog owns it, and two listeners for one key is how a dialog
     ends up closing on a keystroke somebody thought they had guarded. */
  useEffect(() => {
    ref.current?.focus();
  }, []);

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

  /*
   * The platform's ONE destructive-action dialog (`ConfirmDialog`, the rule
   * `confirm.guard.test.ts` enforces), wearing the console's extra
   * requirement: a REASON, which core forwards to the named DB function.
   *
   * This used to be a second dialog written out by hand here. Folding it in
   * cost nothing the console needs — `body` takes a whole form for exactly
   * this case, `confirmDisabled` is how "type a reason first" is spelled, and
   * `busy` keeps the press from repeating — and it stops the vendor's room
   * from drifting into its own dialect of the same question.
   *
   * Dismissal-while-busy stays refused: a write is in flight and closing the
   * box would leave the operator unsure whether it landed.
   */
  return (
    <ConfirmDialog
      title={action.title}
      danger={action.danger ?? false}
      busy={busy}
      confirmDisabled={!valid}
      body={
        <>
          <p className="text-xs text-fg-muted">
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
        </>
      }
      confirmLabel={busy ? labels.working : labels.confirm}
      cancelLabel={labels.cancel}
      onCancel={() => { if (!busy) onClose(); }}
      onConfirm={() => void go()}
    />
  );
}
