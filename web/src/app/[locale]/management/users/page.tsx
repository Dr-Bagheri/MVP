"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api, BffError } from "@/api/client";
import { notify } from "@/lib/notify";
import { useRefreshEpoch } from "@/lib/refreshBus";
import type {
  Invitation,
  MemberSort,
  MemberStats,
  MintedInvitation,
  Role,
  User,
  UserStatus,
} from "@/api/types";
import { ManagementPane } from "@/components/platform/ManagementPane";
import { PageHeader } from "@/components/scaffold";
import { MemberDetail } from "@/components/platform/MemberDetail";
import { Card, Chip, EmptyState } from "@/components/ui";
import { ConfirmDialog, IconAction } from "@/components/rowActions";
import { IconPencil, IconTrash } from "@/components/icons";
import { digits, formatDate, personName } from "@/lib/format";

/**
 * User management (M24) — the platform-level people surface.
 *
 * **Search, filters and sort are SERVER-side.** `GET /v1/admin/members` takes
 * `?search=&status=&role=&sort=`. Filtering a fetched page in the browser
 * answers a different question than the user asked: they search the
 * organisation, the browser searches whatever was downloaded, and then reports
 * a count for it. Under RLS "I counted N" and "there are N" are already
 * different statements; pagination makes the browser's answer confidently
 * wrong rather than merely partial.
 *
 * **Sort keys are a closed vocabulary, not column names** (`MemberSort`), so
 * renaming a database column never becomes a breaking API change. Two of them
 * carry behaviour worth not rediscovering:
 *   - `default` puts the pending queue first — it is what an admin opened this
 *     screen to act on, and burying it under an alphabetical list is how
 *     someone waits a week for approval.
 *   - `last_seen` sorts nulls LAST: never-seen is not "oldest", it is a
 *     different fact.
 *
 * **Last-action is three-state.** `undefined` (the wire doesn't carry it) is
 * not `null` (served, never seen) is not a timestamp. The column appears only
 * once a payload actually contains the field, and `null` renders in words
 * rather than as a dash — a dash reads as data.
 *
 * Roles are M23's three. `owner` is rendered but never offered in the role
 * picker: exactly one exists per org and transfer is an explicit action, so a
 * dropdown containing it could silently mint a second. It IS offered in the
 * filter, because reading is not assigning.
 */

/** Assignable through a general update. `owner` is deliberately absent. */
const ASSIGNABLE_ROLES: readonly Role[] = ["admin", "member"];
const STATUSES: readonly UserStatus[] = ["pending", "active", "disabled"];
const SORTS: readonly MemberSort[] = ["default", "name", "created", "last_seen", "status"];

export default function UsersPage() {
  const t = useTranslations("management");
  const tAdmin = useTranslations("admin");
  const tCommon = useTranslations("common");
  const locale = useLocale();

  const [me, setMe] = useState<User | null>(null);
  const [rows, setRows] = useState<User[]>([]);
  /**
   * Counts come from `GET /v1/admin/members/stats`, NOT from the rows.
   *
   * Tiles derived from a filtered list describe the query rather than the
   * organisation — they would drop as you type, which is the client-side
   * filtering lie one level up. This replaces an unfiltered second fetch that
   * was correct only while Phase A returned every member in one response.
   */
  const [stats, setStats] = useState<MemberStats | null>(null);

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<UserStatus | "">("");
  const [role, setRole] = useState<Role | "">("");
  const [sort, setSort] = useState<MemberSort>("default");
  const [busy, setBusy] = useState(false);
  /** 0085: rejecting a pending member is a deletion — reason required */
  const [rejecting, setRejecting] = useState<null | { id: string; reason: string }>(null);
  /** 2026-08-24: the members-table delete confirms in a POPUP; the ledger
      receives the fixed consent line instead of a typed reason */
  const [confirmDeleteMember, setConfirmDeleteMember] = useState<User | null>(null);

  // ---- bulk selection + detail (Part 4 tail) ----
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [detailId, setDetailId] = useState<string | null>(null);
  /** The last bulk run's honest tally — failures are COUNTED, never swallowed. */

  // ---- invitations (D23–D25, Part 4) ----
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("member");
  const [minted, setMinted] = useState<MintedInvitation | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const isAdmin = me?.role === "admin" || me?.role === "owner";

  const load = useCallback(async () => {
    const [filtered, counts] = await Promise.all([
      api.members({
        search: search.trim() || undefined,
        status: status || undefined,
        role: role || undefined,
        sort,
      }),
      api.memberStats(),
    ]);
    setRows(filtered);
    setStats(counts);
  }, [search, status, role, sort]);

  /* any write to members/invitations — the person's click OR the agent's
     hand — bumps these and the table refetches (refresh bus) */
  const membersEpoch = useRefreshEpoch("members");
  const invitationsEpoch = useRefreshEpoch("invitations");

  useEffect(() => {
    void api.me().then(setMe);
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    void api.invitations().then(setInvitations).catch(() => undefined);
  }, [isAdmin, invitationsEpoch]);

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

  useEffect(() => {
    if (!isAdmin) return;
    /*
     * Debounced: the server does the matching now, so every keystroke would
     * otherwise be a request. 250ms sits below the point where a list starts
     * feeling detached from the box.
     */
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [isAdmin, load, membersEpoch]);

  /**
   * `history_since: null` means the status-history log was not recording, so
   * there is no delta to show — render an em-dash. A **zero** here would be a
   * fabricated delta reached by honest arithmetic: the only number on the tile
   * anyone would act on, wearing the appearance of a measurement.
   *
   * A zero beside a non-null `history_since` is a true zero and renders as one.
   */
  const trendFor = (k: "total" | "active" | "inactive"): string | null => {
    const trend = stats?.trend;
    if (!trend || trend.history_since === null) return null;
    const n = k === "total" ? trend.joined : k === "active" ? trend.activated : trend.disabled;
    return t("trendWindow", {
      delta: `${n > 0 ? "+" : ""}${digits(n, locale)}`,
      days: digits(trend.window_days, locale),
    });
  };

  const lastSeenServed = rows.some((m) => m.last_seen_at !== undefined);
  const pending = rows.filter((m) => m.status === "pending");
  const listed = rows.filter((m) => m.status !== "pending");

  /** The rows bulk actions may touch: never the owner, never yourself. */
  const selectable = listed.filter((u) => u.role !== "owner" && u.id !== me?.id);
  const allSelected = selectable.length > 0 && selectable.every((u) => selected.has(u.id));
  /** Derived from the live rows so the panel refreshes with every load(). */
  const detailUser = detailId === null ? null : (rows.find((u) => u.id === detailId) ?? null);

  function toggleSelected(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** ONE mutation path for role — the table row and the detail panel share it. */
  async function setRoleFor(id: string, newRole: Role): Promise<void> {
    setBusy(true);
    try {
      await api.setUserRole(id, newRole);
      await load();
    } finally {
      setBusy(false);
    }
  }

  /**
   * ONE mutation path for identity edits (display name / username). The
   * refusal RETHROWS so the panel can show core's own sentence — "taken"
   * and "retired" are distinctions only the server can make.
   */
  async function renameFor(
    id: string,
    patch: { display_name?: string; username?: string | null },
  ): Promise<void> {
    setBusy(true);
    try {
      await api.renameMember(id, patch);
      await load();
    } finally {
      setBusy(false);
    }
  }

  /** ONE mutation path for status — table, panel and bulk all end here. */
  async function toggleStatusFor(u: User): Promise<void> {
    setBusy(true);
    try {
      await api.setUserStatus(u.id, u.status === "disabled" ? "active" : "disabled");
      await load();
    } finally {
      setBusy(false);
    }
  }

  /**
   * Bulk enable/disable: sequential on purpose (each write is an audited
   * admin action and a burst of parallel PATCHes hammers the same rows), and
   * the tally is HONEST — a member the server refused stays refused and is
   * counted, not silently skipped. Rows already in the target state are
   * skipped as already-there, which is idempotence, not failure.
   */
  /**
   * The owner's true delete (tombstone), ONE handler for the row button
   * and the detail panel — and it SAYS SO on the notification system
   * (user report, 2026-08-22: "I deleted a user but there is no
   * notification"): success and failure both land as a toast and in the
   * bell. The first version swallowed both outcomes in a bare finally.
   */
  async function deleteMemberFor(u: User, reason: string): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      await api.rejectMember(u.id, reason);
      setDetailId(null);
      notify(t("memberDeleted", { name: personName(u, locale) }));
      await load();
    } catch {
      notify(t("memberDeleteFailed"), "warn");
      await load().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  async function bulkSetStatus(target: "active" | "disabled"): Promise<void> {
    if (busy) return;
    setBusy(true);
    let done = 0;
    let failed = 0;
    try {
      for (const u of selectable.filter((row) => selected.has(row.id))) {
        if (u.status === target) continue;
        try {
          await api.setUserStatus(u.id, target);
          done += 1;
        } catch {
          failed += 1;
        }
      }
      await load();
    } finally {
      setBusy(false);
    }
    // the outcome rides the notification system (orb toast + top bell) —
    // the table itself stays quiet (user directive, 2026-08-21)
    notify(
      t("bulkResult", { done: digits(done, locale), failed: digits(failed, locale) }),
      failed > 0 ? "warn" : "info",
    );
    setSelected(new Set());
  }

  const statusTone = (s: UserStatus) =>
    s === "active" ? "success" : s === "pending" ? "warning" : "neutral";
  const statusLabel = (s: UserStatus) =>
    tAdmin(s === "active" ? "statusActive" : s === "pending" ? "statusPending" : "statusDisabled");

  /*
   * `me === null` renders nothing rather than the gate: "not loaded yet" and
   * "not permitted" are different states, and flashing a refusal at an admin
   * while their identity is in flight is the wrong one of the two.
   */
  if (me !== null && !isAdmin) {
    return (
      /* the refusal keeps the pane: losing the menu would strand a member on a
         dead end, when every other section beside it is one they may open */
      <ManagementPane activeSlug="users">
        <PageHeader title={t("section.users")} />
        <Card>
          <h2 className="h-section">{tAdmin("adminOnly")}</h2>
          <p className="mt-1 text-sm leading-7 text-fg-muted">{tAdmin("adminOnlyNote")}</p>
        </Card>
      </ManagementPane>
    );
  }

  return (
    <ManagementPane activeSlug="users">
      <div>
        <PageHeader title={t("section.users")} subtitle={t("desc.users")} />

        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          {(["total", "active", "inactive"] as const).map((k) => {
            const delta = trendFor(k);
            /* the producer's counts: "inactive" is the pending+disabled
               tile ("Disabled or pending"), composed here from the two
               real states rather than served as a third one */
            const value = !stats
              ? null
              : k === "total"
                ? stats.counts.total
                : k === "active"
                  ? stats.counts.active
                  : stats.counts.pending + stats.counts.disabled;
            return (
              <Card key={k}>
                <p className="text-xs text-fg-muted">{t(`tile.${k}`)}</p>
                <p className="mt-1 text-2xl font-bold text-fg">
                  {value === null ? "" : digits(value, locale)}
                </p>
                <p className="mt-0.5 text-xs text-fg-muted">
                  {delta === null ? <span title={t("trendUnavailable")}>—</span> : <span>{delta}</span>}
                </p>
              </Card>
            );
          })}
        </div>

        <Card className="mb-4">
          <div className="flex flex-wrap gap-2">
            <label className="min-w-[12rem] flex-1">
              <span className="sr-only">{t("searchMembers")}</span>
              <input
                className="input"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("searchMembers")}
              />
            </label>
            <label>
              <span className="sr-only">{t("filterStatus")}</span>
              <select
                className="input h-11 min-h-0 w-auto py-0 text-sm md:h-10"
                value={status}
                onChange={(e) => setStatus(e.target.value as UserStatus | "")}
              >
                <option value="">{t("filterStatusAll")}</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {statusLabel(s)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="sr-only">{t("filterRole")}</span>
              <select
                className="input h-11 min-h-0 w-auto py-0 text-sm md:h-10"
                value={role}
                onChange={(e) => setRole(e.target.value as Role | "")}
              >
                <option value="">{t("filterRoleAll")}</option>
                {/* the FILTER may name owner — reading is not assigning */}
                {(["owner", "admin", "member"] as const).map((r) => (
                  <option key={r} value={r}>
                    {r === "owner"
                      ? t("roleOwner")
                      : tAdmin(r === "admin" ? "roleAdmin" : "roleMember")}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="sr-only">{t("sortBy")}</span>
              <select
                className="input h-11 min-h-0 w-auto py-0 text-sm md:h-10"
                value={sort}
                onChange={(e) => setSort(e.target.value as MemberSort)}
              >
                {SORTS.map((s) => (
                  <option key={s} value={s}>
                    {t(`sort.${s}`)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </Card>

        {pending.length > 0 ? (
          <Card className="mb-4">
            <h2 className="h-section mb-3">{tAdmin("pending")}</h2>
            <ul className="divide-y divide-border">
              {pending.map((u) => (
                <li key={u.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-fg">{personName(u, locale)}</p>
                    {/* `username` is null until chosen, and a PENDING member is
                        the likeliest person never to have chosen one — so the
                        line is dropped rather than rendered as a bare "@". */}
                    {u.username ? <p className="text-xs text-fg-muted"><span className="ltr">@{u.username}</span></p> : null}
                  </div>
                  <span className="text-xs text-fg-muted">{formatDate(u.created_at, locale)}</span>
                  <button
                    className="btn-primary h-9 min-h-0 px-3 text-xs"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        /* acceptance has its OWN endpoint — core's PATCH
                           refuses pending members, so spelling this as a
                           status write would 404 against the real wire */
                        await api.acceptMember(u.id);
                        await load();
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {tAdmin("accept")}
                  </button>
                  {/* reject = the owner-only true delete: a pending member
                      cannot be PATCHed, and hiding the button beats letting
                      an admin collect a 403 they can do nothing about */}
                  {me?.role === "owner" ? (
                    rejecting?.id === u.id ? (
                      <span className="flex items-center gap-2">
                        <input
                          className="input h-9 min-h-0 w-40 py-0 text-xs"
                          autoFocus
                          placeholder={t("deleteReasonHint")}
                          value={rejecting.reason}
                          onChange={(e) => setRejecting({ id: u.id, reason: e.target.value })}
                          onKeyDown={(e) => { if (e.key === "Escape") setRejecting(null); }}
                        />
                        <button
                          className="btn-secondary h-9 min-h-0 px-3 text-xs text-danger"
                          disabled={busy || rejecting.reason.trim().length < 3}
                          onClick={async () => {
                            setBusy(true);
                            try {
                              await api.rejectMember(u.id, rejecting.reason.trim());
                              setRejecting(null);
                              await load();
                            } finally {
                              setBusy(false);
                            }
                          }}
                        >
                          {tAdmin("reject")}
                        </button>
                      </span>
                    ) : (
                      <button
                        className="btn-secondary h-9 min-h-0 px-3 text-xs"
                        disabled={busy}
                        onClick={() => setRejecting({ id: u.id, reason: "" })}
                      >
                        {tAdmin("reject")}
                      </button>
                    )
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        <Card className="mb-4">
          <h2 className="h-section mb-3">{t("invitationsTitle")}</h2>

          {minted?.emailed ? (
            /* the SIMPLE flow (user directive): the platform emailed the
               invitation — no token, nothing for the admin to carry */
            <div className="mb-3 rounded-lg border border-success/40 bg-surface-2 p-3">
              <p className="text-sm text-fg" role="status">
                {t("inviteEmailed", { email: minted.email })}
              </p>
              <button
                className="btn-secondary mt-2 h-9 min-h-0 px-3 text-xs"
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
              <button
                className="btn-secondary mt-3 h-9 min-h-0 px-3 text-xs"
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

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input
              className="input min-w-[14rem] flex-1"
              dir="ltr"
              type="email"
              placeholder={t("inviteEmailPlaceholder")}
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
            />
            <select
              className="input h-11 min-h-0 w-auto py-0 text-sm md:h-10"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as Role)}
            >
              <option value="member">{tAdmin("roleMember")}</option>
              {/* D25: the issuer's role bounds the GRANT — only the owner
                  may mint an admin, and nobody mints an owner */}
              {me?.role === "owner" ? <option value="admin">{tAdmin("roleAdmin")}</option> : null}
            </select>
            <button
              className="btn-primary h-10 min-h-0 px-4 text-sm"
              disabled={busy || !inviteEmail.trim()}
              onClick={() => void issueInvitation()}
            >
              {t("invite")}
            </button>
          </div>

          {(() => {
            /* ONLY the outstanding ones (user verdict): a revoked or
               redeemed invitation is history, and five dead rows for one
               address buried the single link that still works. The api
               keeps the full history; this list is the TO-DO view. */
            const open = invitations.filter(
              (inv) =>
                !inv.redeemed_at && !inv.revoked_at && new Date(inv.expires_at) >= new Date(),
            );
            return open.length === 0 ? (
              <p className="text-sm text-fg-muted">{t("noInvitations")}</p>
            ) : (
            <ul className="divide-y divide-border">
              {open.map((inv) => (
                <li key={inv.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <span className="ltr min-w-0 flex-1 truncate text-sm text-fg">{inv.email}</span>
                  <Chip tone="neutral">
                    {inv.role === "admin" ? tAdmin("roleAdmin") : tAdmin("roleMember")}
                  </Chip>
                  <Chip tone="success">{t("inviteState_open")}</Chip>
                  <span className="text-xs text-fg-muted">
                    {formatDate(inv.expires_at, locale)}
                  </span>
                  <button
                    className="text-xs text-fg-muted underline-offset-2 hover:underline"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await api.revokeInvitation(inv.id);
                        setInvitations(await api.invitations());
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {t("inviteRevoke")}
                  </button>
                </li>
              ))}
            </ul>
            );
          })()}
        </Card>

        <Card>
          <h2 className="h-section mb-3">{tAdmin("members")}</h2>

          {selected.size > 0 ? (
            /* the bulk bar appears WITH a selection and leaves with it —
               permanent chrome for an occasional action is noise */
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2">
              <span className="text-sm text-fg">
                {t("bulkSelected", { count: digits(selected.size, locale) })}
              </span>
              <button
                className="btn-secondary h-9 min-h-0 px-3 text-xs"
                disabled={busy}
                onClick={() => void bulkSetStatus("active")}
              >
                {t("bulkEnable")}
              </button>
              <button
                className="btn-secondary h-9 min-h-0 px-3 text-xs"
                disabled={busy}
                onClick={() => void bulkSetStatus("disabled")}
              >
                {t("bulkDisable")}
              </button>
              <button
                className="ms-auto text-xs text-fg-muted underline-offset-2 hover:underline"
                onClick={() => setSelected(new Set())}
              >
                {t("bulkClear")}
              </button>
            </div>
          ) : null}

          {listed.length === 0 ? (
            <EmptyState text={t("noMatches")} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="w-10 py-2 pe-2">
                      {/* select-all covers the SELECTABLE rows — owner and
                          self are not silently included by a header click */}
                      <input
                        type="checkbox"
                        aria-label={t("bulkSelectAll")}
                        checked={allSelected}
                        disabled={selectable.length === 0}
                        onChange={() =>
                          setSelected(allSelected ? new Set() : new Set(selectable.map((u) => u.id)))
                        }
                      />
                    </th>
                    <th className="table-head py-2 pe-3">{t("colName")}</th>
                    <th className="table-head py-2 pe-3">{t("colEmail")}</th>
                    <th className="table-head py-2 pe-3">{t("colUsername")}</th>
                    <th className="table-head py-2 pe-3">{t("colStatus")}</th>
                    <th className="table-head py-2 pe-3">{t("colRole")}</th>
                    <th className="table-head py-2 pe-3">{t("colAdded")}</th>
                    {lastSeenServed ? (
                      <th className="table-head py-2 pe-3" title={t("lastActionMeaning")}>
                        {t("colLastAction")}
                      </th>
                    ) : null}
                    {/* no visible ACTIONS title (2026-08-25, all tables) */}
                    <th className="table-head py-2">
                      <span className="sr-only">{t("colMemberActions")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {listed.map((u) => (
                    <tr key={u.id}>
                      <td className="w-10 py-3 pe-2 align-top">
                        {u.role !== "owner" && u.id !== me?.id ? (
                          <input
                            type="checkbox"
                            aria-label={t("bulkSelectRow", { name: personName(u, locale) })}
                            checked={selected.has(u.id)}
                            onChange={() => toggleSelected(u.id)}
                          />
                        ) : null}
                      </td>
                      <td className="py-3 pe-3 align-top">
                        {/* the name opens the detail panel — a magnified row,
                            not a navigation */}
                        <button
                          type="button"
                          className="font-medium text-fg underline-offset-2 hover:text-accent hover:underline"
                          onClick={() => setDetailId(u.id)}
                        >
                          {personName(u, locale)}
                        </button>
                      </td>
                      <td className="py-3 pe-3 align-top text-xs text-fg-muted">
                        <span className="ltr">{u.email}</span>
                      </td>
                      <td className="py-3 pe-3 align-top text-xs text-fg-muted">
                        {/* a column keeps its placeholder so the rows stay
                            aligned; "@" with nothing after it is not a handle */}
                        {u.username ? `@${u.username}` : "—"}
                      </td>
                      <td className="py-3 pe-3 align-top">
                        <div className="flex items-center gap-2">
                          {/* an ON/OFF switch (user directive) — on = active,
                              off = disabled; the chip stays for the WORD.
                              Not on the owner (M23), not on yourself (core
                              409s it). */}
                          {u.role !== "owner" && u.id !== me?.id ? (
                            <button
                              type="button"
                              role="switch"
                              aria-checked={u.status === "active"}
                              aria-label={tAdmin(u.status === "disabled" ? "enable" : "disable")}
                              disabled={busy}
                              className={`tap flex h-5 w-9 shrink-0 items-center rounded-full px-0.5 transition-colors ${
                                u.status === "active"
                                  ? "justify-end bg-accent"
                                  : "justify-start border border-border-strong bg-surface-2"
                              }`}
                              onClick={() => void toggleStatusFor(u)}
                            >
                              <span
                                className={`h-3.5 w-3.5 rounded-full ${
                                  u.status === "active" ? "bg-on-accent" : "bg-fg-muted"
                                }`}
                              />
                            </button>
                          ) : null}
                          <Chip tone={statusTone(u.status)}>{statusLabel(u.status)}</Chip>
                        </div>
                      </td>
                      <td className="py-3 pe-3 align-top">
                        {u.role === "owner" ? (
                          <Chip tone="accent">{t("roleOwner")}</Chip>
                        ) : (
                          <select
                            className="input h-11 min-h-0 w-32 py-0 text-xs md:h-9"
                            value={u.role}
                            disabled={busy}
                            onChange={(e) => void setRoleFor(u.id, e.target.value as Role)}
                          >
                            {ASSIGNABLE_ROLES.map((r) => (
                              <option key={r} value={r}>
                                {tAdmin(r === "admin" ? "roleAdmin" : "roleMember")}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td className="py-3 pe-3 align-top text-xs text-fg-muted">
                        {formatDate(u.created_at, locale)}
                      </td>
                      {lastSeenServed ? (
                        <td className="py-3 align-top text-xs">
                          {u.last_seen_at ? (
                            <span className="text-fg-muted">
                              {formatDate(u.last_seen_at, locale)}
                            </span>
                          ) : (
                            /*
                             * `null` is "never seen", said in words. A dash
                             * would read as data — the same mistake as an
                             * em-dash for a null response code, where "no
                             * answer ever came back" became indistinguishable
                             * from "nothing to show".
                             */
                            <span className="text-fg-muted/70">{t("neverSeen")}</span>
                          )}
                        </td>
                      ) : null}
                      <td className="py-3 align-top">
                        <span className="flex items-center gap-1.5 text-xs">
                          {/* Edit = the detail panel, where every editable
                              fact lives — a pencil now (2026-08-24) */}
                          <IconAction label={t("memberEdit")} onClick={() => setDetailId(u.id)}>
                            <IconPencil />
                          </IconAction>
                          {me?.role === "owner" && u.role !== "owner" && u.id !== me?.id ? (
                            /* delete = trash + are-you-sure popup; the typed
                               reason retired for the inline path (2026-08-24) */
                            <IconAction
                              label={t("deleteMember")}
                              danger
                              disabled={busy}
                              onClick={() => setConfirmDeleteMember(u)}
                            >
                              <IconTrash />
                            </IconAction>
                          ) : null}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {confirmDeleteMember !== null ? (
          <ConfirmDialog
            title={t("deleteMemberConfirmTitle", { name: confirmDeleteMember.display_name })}
            body={t("deleteMemberConfirmBody")}
            confirmLabel={t("deleteMember")}
            cancelLabel={tCommon("cancel")}
            busy={busy}
            onCancel={() => setConfirmDeleteMember(null)}
            onConfirm={() => {
              const target = confirmDeleteMember;
              setConfirmDeleteMember(null);
              void deleteMemberFor(target, "حذف با تأیید کاربر در پنجرهٔ تأیید");
            }}
          />
        ) : null}

        {detailUser ? (
          <MemberDetail
            user={detailUser}
            me={me}
            busy={busy}
            assignableRoles={ASSIGNABLE_ROLES}
            onSetRole={(id, r) => void setRoleFor(id, r)}
            onToggleStatus={(u) => void toggleStatusFor(u)}
            onRename={renameFor}
            /* the true delete is the OWNER's alone (tombstone: emptied
               person, retired handle — core's DELETE endpoint, M11 family);
               admins keep disable, which is reversible */
            {...(me?.role === "owner"
              ? { onDelete: (u: User, reason: string) => void deleteMemberFor(u, reason) }
              : {})}
            onClose={() => setDetailId(null)}
          />
        ) : null}
      </div>
    </ManagementPane>
  );
}
