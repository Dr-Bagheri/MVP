"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import { notify } from "@/lib/notify";
import { useRefreshEpoch } from "@/lib/refreshBus";
import type { Role, User, UserStatus } from "@/api/types";

/* the admin namespace spells these camelCase; a template literal that built
   `role_${role}` shipped a raw key to the users list on 2026-09-02 — every
   role read "admin.role_owner" on production while typecheck and the locale
   parity test stayed green, because neither can see a computed key. A map
   is a key the checks CAN see. */
const ROLE_KEY: Record<Role, "roleOwner" | "roleAdmin" | "roleMember"> = {
  owner: "roleOwner", admin: "roleAdmin", member: "roleMember",
};
const STATUS_KEY: Record<UserStatus, "statusActive" | "statusPending" | "statusDisabled"> = {
  active: "statusActive", pending: "statusPending", disabled: "statusDisabled",
};
import { ManagementPane } from "@/components/platform/ManagementPane";
import { PageHeader } from "@/components/scaffold";
import { MemberDetail } from "@/components/platform/MemberDetail";
import { Card, EmptyState } from "@/components/ui";
import { ConfirmDialog } from "@/components/rowActions";
import { DataTable } from "@/components/DataTable";
import { Avatar } from "@/components/Avatar";
import { IconKey, IconPencil, IconToggleOff, IconToggleOn, IconTrash } from "@/components/icons";
import { personName } from "@/lib/format";
import { SetMemberPassword } from "@/components/platform/SetMemberPassword";

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
  /* audit finding, 2026-09-02: `rows` starts as [] and the table was gated on
     `listed.length === 0`, so from first paint until the members request
     answered the page said «عضوی با این نام پیدا نشد» — and while identity
     was still in flight too, since `me === null` falls through to the same
     return. Loading and empty were one picture, and a table then dropped in
     under a sentence claiming there was nobody. `loaded` is "the list has
     answered" (refusal included: the list is then honestly empty of anything
     we can show — the invitations page's spelling); until then DataTable
     draws skeleton rows in its own frame and says nothing about the org. It
     never flips back: a refetch through the epoch keeps the rows on screen,
     the skeleton is for the first paint only. */
  const [loaded, setLoaded] = useState(false);
  /**
   * Counts come from `GET /v1/admin/members/stats`, NOT from the rows.
   *
   * Tiles derived from a filtered list describe the query rather than the
   * organisation — they would drop as you type, which is the client-side
   * filtering lie one level up. This replaces an unfiltered second fetch that
   * was correct only while Phase A returned every member in one response.
   */

  const [busy, setBusy] = useState(false);
  /** 2026-08-24: the members-table delete confirms in a POPUP; the ledger
      receives the fixed consent line instead of a typed reason */
  const [confirmDeleteMember, setConfirmDeleteMember] = useState<User | null>(null);

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
    try {
      setRows(await api.members({ sort: "default" }));
    } finally {
      /* audit finding, 2026-09-02: both branches end the loading state — a
         failure is an answer too, and a skeleton left standing after the
         request has ended claims a fetch is in flight that is not */
      setLoaded(true);
    }
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



  /*
   * The `lastSeenServed` / `presenceServed` flags went with the columns they
   * gated (2026-09-02). They were the honest answer to "did the server answer
   * this question at all" for a member versus an admin — the distinction is
   * still real, and it now lives in the detail panel, which is the only place
   * those facts are shown.
   */

  /** the member whose password is being set, if any */
  const [passwordFor, setPasswordFor] = useState<User | null>(null);

  /*
   * STRICTLY outranked, and never yourself — the same rule db/0137 enforces,
   * spelled here only to decide what to OFFER.
   *
   * Self is excluded deliberately rather than by omission: your own password
   * changes in Settings, where it asks for the CURRENT one, and that check is
   * what stops a hijacked session locking you out. An admin door does not ask
   * for it, so offering this at yourself would route around the only thing
   * protecting the self path. The database refuses it either way; this keeps
   * the menu from promising otherwise.
   */
  const canSetPasswordFor = (u: User): boolean => {
    if (!me || u.id === me.id) return false;
    const rank = (r: User["role"]): number => (r === "owner" ? 3 : r === "admin" ? 2 : 1);
    return rank(me.role) > rank(u.role);
  };
  const listed = rows.filter((m) => m.status !== "pending");
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

        {/*
          THE PENDING QUEUE MOVED TO THE PLATFORM CONSOLE (user directive,
          2026-09-02). It sat here, where an org admin approved their own
          arrivals — right for someone they invited and already expect, wrong
          for the case that actually produces these rows: a stranger signs up,
          lands in an organisation of their own naming, and the only person
          who can decide where they belong is the vendor. The console can
          place them; an admin never could, because org_id is immutable to
          the application role by design.
          The rows are still VISIBLE here — a pending member appears in the
          table below with their status — so an admin can see who is waiting.
          What left is the decision, not the information.
        */}

        {/* INVITATIONS moved to their own menu item (user directive,
            2026-08-26): /management/invitations, under People. Sending an
            invitation is its own act with its own audience — it does not
            belong stacked under the roster of people who already accepted
            one. */}

        {/* NO OUTER BOX (user directive, 2026-09-02: "remove the outside
            table, make it like the meeting table"). The rows are cards of
            their own — a card of cards is the box-in-a-box the meetings list
            never had, and the reference draws its members straight on the
            page. */}
        <div>

          {/* NO SELECTION, NO BULK BAR (user directive, 2026-09-02: "remove the
              check boxes of the users table"). The reference has none: every
              action on a person is on their row's kebab, and a bulk toolbar
              that appeared with a selection was a second surface for the
              same two verbs. Enable/disable stay per row. */}

          {/* audit finding, 2026-09-02: the table renders UNCONDITIONALLY —
              the frame is structure and structure is known before the
              network. `loading` keeps skeleton rows in it until the list has
              answered, and `empty` is DataTable's own empty state, which it
              shows only once it is not loading: the sentence "nobody matches"
              is a claim about the org and appears only after the answer.
              The ternary this replaced made loading and empty one picture. */}
          {/* the theme's ONE table (2026-08-26): the members list wears
              exactly the records table — hover-revealed selection, no
              action icons in the row, every action in the right-click
              menu, the quiet dot for the ordinary good state */}
          <DataTable
            hideHeader
            rows={listed}
            loading={!loaded}
            empty={<EmptyState text={t("noMatches")} />}
            rowKey={(u) => u.id}
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
              ...(canSetPasswordFor(u)
                ? [{
                    key: "password",
                    label: t("setPassword"),
                    icon: <IconKey />,
                    onSelect: () => setPasswordFor(u),
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
                /*
                 * ONE COLUMN (user directive, 2026-09-02: "a simple name
                 * and its role small under it … remove Email, Status,
                 * Online, Role, Added, Last action title and data from the
                 * table … with kebab menu at the end and if clicked the
                 * side window with details in it").
                 *
                 * Six columns became a mark, a name and one line under it.
                 * The facts did not go anywhere — every one of them is in
                 * the detail panel a row opens, which is where a person
                 * goes when they want them. What the table is FOR is
                 * finding somebody, and six columns of metadata is six
                 * things to read past while doing that.
                 *
                 * The role sits under the name rather than beside it for
                 * the same reason the handle already did: under the name it
                 * costs no horizontal room, which is the scarce thing in a
                 * table and the reason this one used to scroll sideways.
                 */
                key: "member",
                header: t("colName"),
                headClassName: "sr-only",
                cell: (u) => (
                  <span className="flex items-center gap-2.5">
                    {/* 2026-09-03: the platform's avatar, not a fifth
                        hand-drawn one. This roster IS the look the component
                        took — accent-soft with a ring, never a solid accent
                        disc, because a list of eight bright green circles is
                        eight accents on one screen and the accent stops
                        meaning anything — so the picture is unchanged and the
                        decision (which letter, uppercased once, a photo when
                        there is one) stops being re-made here. The NAME stays
                        the caller's: which of a person's two names to show is
                        a locale question. */}
                    <Avatar name={personName(u, locale)} size="md" />
                    <span className="block min-w-0 leading-tight">
                      <span className="block truncate font-medium text-fg">
                        {personName(u, locale)}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-fg-muted">
                        {/* the namespace's own spelling — `role_owner` was an
                            invented key that rendered raw on production,
                            because a computed key skips the parity check */}
                        {tAdmin(ROLE_KEY[u.role])}
                        {/* status only when it is NOT the ordinary one: a
                            row that says "active" about everybody is a
                            column of one repeated word, which is what the
                            status column was */}
                        {u.status !== "active" ? (
                          <>
                            <span aria-hidden>·</span>
                            <span className={u.status === "pending" ? "text-warning" : "text-danger"}>
                              {tAdmin(STATUS_KEY[u.status])}
                            </span>
                          </>
                        ) : null}
                      </span>
                    </span>
                  </span>
                ),
              },
              {
                key: "actions",
                header: t("colMemberActions"),
                srOnly: true,
                cell: () => null,
              },
            ]}
          />
        </div>

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

        {passwordFor ? (
          <SetMemberPassword
            member={passwordFor}
            onClose={() => {
              setPasswordFor(null);
              /* re-read: the reset ended their sessions, so this person's
                 signed-in cell is now stale on the row behind the dialog */
              void load();
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
            {...(canSetPasswordFor(detailUser) ? { onSetPassword: setPasswordFor } : {})}
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
