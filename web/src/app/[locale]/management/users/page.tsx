"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import { notify } from "@/lib/notify";
import { useRefreshEpoch } from "@/lib/refreshBus";
import type {
  Role,
  User,
  UserStatus,
} from "@/api/types";
import { ManagementPane } from "@/components/platform/ManagementPane";
import { PageHeader } from "@/components/scaffold";
import { MemberDetail } from "@/components/platform/MemberDetail";
import { Card, Chip, EmptyState } from "@/components/ui";
import { ConfirmDialog, SelectMenu } from "@/components/rowActions";
import { DataTable, StatusDot } from "@/components/DataTable";
import { IconPencil, IconToggleOff, IconToggleOn, IconTrash } from "@/components/icons";
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


  const isAdmin = me?.role === "admin" || me?.role === "owner";

  /*
   * The filter row LEFT this page (user directive, 2026-08-26), and with
   * it the four controls that fed these parameters. The request keeps the
   * server's own default ordering — pending first — because that ordering
   * is the reason the sort existed, not a leftover of the control.
   *
   * `GET /v1/admin/members` still takes search/status/role/sort, and
   * `api.members()` still passes them: the capability is untouched, only
   * unoffered. If filtering comes back it comes back as a control, not as
   * a re-implementation.
   */
  const load = useCallback(async () => {
    setRows(await api.members({ sort: "default" }));
  }, []);

  /* any write to members/invitations — the person's click OR the agent's
     hand — bumps these and the table refetches (refresh bus) */
  const membersEpoch = useRefreshEpoch("members");

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
  }, [isAdmin, load, membersEpoch]);



  const lastSeenServed = rows.some((m) => m.last_seen_at !== undefined);
  const pending = rows.filter((m) => m.status === "pending");
  const listed = rows.filter((m) => m.status !== "pending");

  /** The rows bulk actions may touch: never the owner, never yourself. */
  const selectable = listed.filter((u) => u.role !== "owner" && u.id !== me?.id);
  /** Derived from the live rows so the panel refreshes with every load(). */
  const detailUser = detailId === null ? null : (rows.find((u) => u.id === detailId) ?? null);

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
                    <button
                      className="btn-secondary h-9 min-h-0 px-3 text-xs"
                      disabled={busy}
                      /* the press ASKS, in the platform's one dialog (see the
                         foot of this file, and confirm.guard.test.ts). This
                         used to grow a reason box inside the row: the same
                         question, in an affordance nothing else on the
                         platform wears, on the one control that permanently
                         empties a person. */
                      onClick={() => setRejecting({ id: u.id, reason: "" })}
                    >
                      {tAdmin("reject")}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        {/* INVITATIONS moved to their own menu item (user directive,
            2026-08-26): /management/invitations, under People. Sending an
            invitation is its own act with its own audience — it does not
            belong stacked under the roster of people who already accepted
            one. */}

        <Card>

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
            /* the theme's ONE table (2026-08-26): the members list wears
               exactly the records table — hover-revealed selection, no
               action icons in the row, every action in the right-click
               menu, the quiet dot for the ordinary good state */
            <DataTable
              rows={listed}
              rowKey={(u) => u.id}
              selected={selected}
              onSelect={setSelected}
              selectableRow={(u) => u.role !== "owner" && u.id !== me?.id}
              selectLabel={(u) => t("bulkSelectRow", { name: personName(u, locale) })}
              onRowClick={(u) => setDetailId(u.id)}
              menuItems={(u) => [
                {
                  key: "edit",
                  label: t("memberEdit"),
                  icon: <IconPencil />,
                  onSelect: () => setDetailId(u.id),
                },
                ...(u.role !== "owner" && u.id !== me?.id
                  ? [{
                      key: "status",
                      label: tAdmin(u.status === "disabled" ? "enable" : "disable"),
                      icon: u.status === "disabled" ? <IconToggleOn /> : <IconToggleOff />,
                      disabled: busy,
                      onSelect: () => void toggleStatusFor(u),
                    }]
                  : []),
                ...(me?.role === "owner" && u.role !== "owner" && u.id !== me?.id
                  ? [{
                      key: "delete",
                      label: t("deleteMember"),
                      icon: <IconTrash />,
                      danger: true,
                      disabled: busy,
                      onSelect: () => setConfirmDeleteMember(u),
                    }]
                  : []),
              ]}
              columns={[
                {
                  key: "name",
                  header: t("colName"),
                  cell: (u) => (
                    <span className="font-medium text-fg">{personName(u, locale)}</span>
                  ),
                },
                {
                  key: "email",
                  header: t("colEmail"),
                  className: "text-xs text-fg-muted",
                  cell: (u) => <span className="ltr">{u.email}</span>,
                },
                {
                  key: "username",
                  header: t("colUsername"),
                  className: "text-xs text-fg-muted",
                  /* a column keeps its placeholder so the rows stay
                     aligned; "@" with nothing after it is not a handle */
                  cell: (u) => (u.username ? `@${u.username}` : "—"),
                },
                {
                  key: "status",
                  header: t("colStatus"),
                  /* ACTIVE is the ordinary good state and now says so the
                     way READY does — a quiet dot, no chip fill. The
                     ON/OFF switch retired to the row menu with every
                     other action (user directive, 2026-08-26). */
                  cell: (u) =>
                    u.status === "active" ? (
                      <StatusDot label={statusLabel(u.status)} />
                    ) : (
                      <Chip tone={statusTone(u.status)}>{statusLabel(u.status)}</Chip>
                    ),
                },
                {
                  key: "role",
                  header: t("colRole"),
                  stopClick: true,
                  cell: (u) =>
                    u.role === "owner" ? (
                      <Chip tone="accent">{t("roleOwner")}</Chip>
                    ) : (
                      <SelectMenu
                        className="h-9 min-h-0 w-32 py-0 text-xs"
                        ariaLabel={t("colRole")}
                        value={u.role}
                        disabled={busy}
                        onChange={(next) => void setRoleFor(u.id, next as Role)}
                        options={ASSIGNABLE_ROLES.map((r) => ({
                          value: r,
                          label: tAdmin(r === "admin" ? "roleAdmin" : "roleMember"),
                        }))}
                      />
                    ),
                },
                {
                  key: "added",
                  header: t("colAdded"),
                  className: "text-xs text-fg-muted",
                  cell: (u) => formatDate(u.created_at, locale),
                },
                ...(lastSeenServed
                  ? [{
                      key: "lastSeen",
                      header: t("colLastAction"),
                      headClassName: "whitespace-nowrap",
                      className: "text-xs",
                      cell: (u: User) =>
                        u.last_seen_at ? (
                          <span className="text-fg-muted">
                            {formatDate(u.last_seen_at, locale)}
                          </span>
                        ) : (
                          /*
                           * `null` is "never seen", said in words. A dash
                           * would read as data — the same mistake as an
                           * em-dash for a null response code, where "no
                           * answer ever came back" became
                           * indistinguishable from "nothing to show".
                           */
                          <span className="text-fg-muted/70">{t("neverSeen")}</span>
                        ),
                    }]
                  : []),
                {
                  key: "actions",
                  header: t("colMemberActions"),
                  srOnly: true,
                  cell: () => null,
                },
              ]}
            />
          )}
        </Card>

        {/*
          REJECTING A PENDING MEMBER is the owner's true delete (tombstone),
          so it wears the platform's destructive-action dialog like every
          other one. The reason rides INSIDE the dialog because 0085 requires
          one in the ledger and `ConfirmDialog`'s body slot is where a
          confirmation that needs an answer puts its question.

          `personName` rather than `display_name`: the row above names them
          that way, and a dialog naming somebody differently from the line it
          was opened from is a dialog about somebody else.
        */}
        {rejecting !== null ? (() => {
          const target = pending.find((u) => u.id === rejecting.id);
          if (!target) return null;
          return (
            <ConfirmDialog
              title={t("deleteMemberConfirmTitle", { name: personName(target, locale) })}
              body={
                <div className="space-y-3">
                  <p className="text-sm leading-6 text-fg-muted">{t("deleteMemberConfirmBody")}</p>
                  <label className="block text-xs text-fg-muted" htmlFor="reject-reason">
                    {t("deleteReasonHint")}
                  </label>
                  <input
                    id="reject-reason"
                    className="input h-9 min-h-0 w-full py-0 text-sm"
                    autoFocus
                    placeholder={t("deleteReasonHint")}
                    value={rejecting.reason}
                    onChange={(e) => setRejecting({ id: rejecting.id, reason: e.target.value })}
                  />
                </div>
              }
              confirmLabel={tAdmin("reject")}
              cancelLabel={tCommon("cancel")}
              busy={busy}
              confirmDisabled={rejecting.reason.trim().length < 3}
              onCancel={() => setRejecting(null)}
              onConfirm={() => {
                const reason = rejecting.reason.trim();
                setRejecting(null);
                void deleteMemberFor(target, reason);
              }}
            />
          );
        })() : null}

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
