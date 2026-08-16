"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { MemberSort, MemberStats, Role, User, UserStatus } from "@/api/types";
import { ManagementPane } from "@/components/platform/ManagementPane";
import { Card, Chip, EmptyState } from "@/components/ui";
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

  useEffect(() => {
    void api.me().then(setMe);
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    /*
     * Debounced: the server does the matching now, so every keystroke would
     * otherwise be a request. 250ms sits below the point where a list starts
     * feeling detached from the box.
     */
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [isAdmin, load]);

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
        <h1 className="mb-1 text-xl font-bold text-fg">{t("section.users")}</h1>
        <Card className="mt-4">
          <h2 className="h-section">{tAdmin("adminOnly")}</h2>
          <p className="mt-1 text-sm leading-7 text-fg-muted">{tAdmin("adminOnlyNote")}</p>
        </Card>
      </ManagementPane>
    );
  }

  return (
    <ManagementPane activeSlug="users">
      <div>
        <h1 className="mb-1 text-xl font-bold text-fg">{t("section.users")}</h1>
        <p className="mb-5 text-sm text-fg-muted">{t("desc.users")}</p>

        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          {(["total", "active", "inactive"] as const).map((k) => {
            const delta = trendFor(k);
            return (
              <Card key={k}>
                <p className="text-xs text-fg-muted">{t(`tile.${k}`)}</p>
                <p className="mt-1 text-2xl font-bold text-fg">
                  {stats ? digits(stats[k], locale) : ""}
                </p>
                <p className="mt-0.5 text-xs text-fg-muted">
                  {delta === null ? <span title={t("trendUnavailable")}>—</span> : <span>{delta}</span>}
                </p>
              </Card>
            );
          })}
        </div>
        <p className="mb-5 text-xs leading-6 text-fg-muted">{t("noTrends")}</p>

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
                    {u.username ? <p className="ltr text-xs text-fg-muted">@{u.username}</p> : null}
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
                    <button
                      className="btn-secondary h-9 min-h-0 px-3 text-xs"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await api.rejectMember(u.id);
                          await load();
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      {tAdmin("reject")}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        <Card>
          <h2 className="h-section mb-3">{tAdmin("members")}</h2>
          {listed.length === 0 ? (
            <EmptyState text={t("noMatches")} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="table-head py-2 pe-3">{t("colName")}</th>
                    <th className="table-head py-2 pe-3">{t("colUsername")}</th>
                    <th className="table-head py-2 pe-3">{t("colStatus")}</th>
                    <th className="table-head py-2 pe-3">{t("colRole")}</th>
                    <th className="table-head py-2 pe-3">{t("colAdded")}</th>
                    {lastSeenServed ? (
                      <th className="table-head py-2" title={t("lastActionMeaning")}>
                        {t("colLastAction")}
                      </th>
                    ) : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {listed.map((u) => (
                    <tr key={u.id}>
                      <td className="py-3 pe-3 align-top">
                        <p className="font-medium text-fg">{personName(u, locale)}</p>
                      </td>
                      <td className="ltr py-3 pe-3 align-top text-xs text-fg-muted">
                        {/* a column keeps its placeholder so the rows stay
                            aligned; "@" with nothing after it is not a handle */}
                        {u.username ? `@${u.username}` : "—"}
                      </td>
                      <td className="py-3 pe-3 align-top">
                        <div className="flex items-center gap-2">
                          <Chip tone={statusTone(u.status)}>{statusLabel(u.status)}</Chip>
                          {/* the page's own description promises "disable
                              members" — a promise with no control is FE3's
                              "row that cannot be filled". Not on the owner
                              (M23) and not on yourself (core 409s it). */}
                          {u.role !== "owner" && u.id !== me?.id ? (
                            <button
                              className="text-xs text-fg-muted underline-offset-2 hover:underline"
                              disabled={busy}
                              onClick={async () => {
                                setBusy(true);
                                try {
                                  await api.setUserStatus(
                                    u.id,
                                    u.status === "disabled" ? "active" : "disabled",
                                  );
                                  await load();
                                } finally {
                                  setBusy(false);
                                }
                              }}
                            >
                              {tAdmin(u.status === "disabled" ? "enable" : "disable")}
                            </button>
                          ) : null}
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
                            onChange={async (e) => {
                              setBusy(true);
                              try {
                                await api.setUserRole(u.id, e.target.value as Role);
                                await load();
                              } finally {
                                setBusy(false);
                              }
                            }}
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </ManagementPane>
  );
}
