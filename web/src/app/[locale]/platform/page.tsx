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
import { Select } from "@/components/Select";
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
import { ConfirmDialog, type KebabItem } from "@/components/rowActions";
/* audit finding, 2026-09-02: the console's three lists were the only
   list-of-rows in the product still hand-rolled — a hairline-divided box
   instead of the theme's card rows, with no loading frame and no pager.
   DataTable brings all three, and a fourth thing worth more than any of
   them: the row actions become the same right-click menu every other table
   in the platform answers with. */
import { DataTable } from "@/components/DataTable";
import { Card, Chip, EmptyState } from "@/components/ui";
/* the platform's ONE date and ONE numeral rule. The console used to build
   its own Intl.DateTimeFormat, which ignored the reader's calendar
   preference — so the same instant could be named a different month here
   than on every other screen — and printed Latin digits in the Persian UI. */
import { digits, formatDate, formatTime } from "@/lib/format";
import {
  IconCheck,
  IconGlobe,
  IconKey,
  IconPencil,
  IconRetry,
  IconToggleOff,
  IconToggleOn,
  IconTrash,
} from "@/components/icons";

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
  /* THE ANSWER HAS ARRIVED — not "there are rows". The three lists start as
     `[]`, so before this flag existed every first paint said «چیزی با این
     فیلترها مطابقت ندارد» about organizations nobody had looked at yet:
     loading and empty were one picture, which is the kinds-of-nothing
     confusion rendered in pixels. DataTable's `loading` keeps the frame with
     skeleton rows in it until the console can honestly say "nothing". */
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(
    async (
      opts: { organizations?: string; users?: string; orgDeleted?: boolean; userDeleted?: boolean } = {},
    ) => {
      try {
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
      } finally {
        /* whatever it said. A table that keeps its skeletons after a refusal
           claims a fetch is still running, and the error banner above it is
           already saying the opposite. */
        setLoaded(true);
      }
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
    /* the rows on screen belong to the OTHER view: showing them under the
       new heading while the query runs is a list that is briefly false */
    setLoaded(false);
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
      setLoaded(true);
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

  /* audit finding, 2026-09-02: this was a second date formatter — a raw
     `Intl.DateTimeFormat` keyed off the locale alone. It could not see the
     person's CALENDAR preference or the platform timezone, so a Persian
     reader who chose Gregorian got a Jalali date here and a Gregorian one
     everywhere else: two spellings of one instant, and the console is where
     they would be compared. `formatDate` resolves both and carries its own
     bidi isolate. `fmtDateTime` went with it — the audit feed splits date and
     time onto two lines the way Audit Logs does. */
  const fmtDate = useCallback(
    (value: string | null) => (value ? formatDate(value, locale) : t("never")),
    [locale, t],
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

  /* ---- row menus ---------------------------------------------------------
     THE ACTIONS MOVED INTO THE ROW'S OWN MENU (audit finding, 2026-09-02).
     They used to be a strip of five bordered text buttons per row — the
     affordance the whole platform left behind, and the reason this console
     read as a different product from Management·Users, which offers exactly
     these decisions about exactly these people.

     What is deliberately NOT lost: an action that is REFUSED for a row stays
     in the menu, disabled, rather than disappearing. "You may not disable
     yourself" and "there is no such action" are different sentences, and the
     console is the one screen where the difference is the point. */
  function orgMenu(o: PlatformOrganization): KebabItem[] {
    if (orgTrash) {
      return [
        {
          key: "restore",
          label: t("restoreOrganization"),
          icon: <IconRetry />,
          disabled: busy,
          onSelect: () =>
            setPending({
              key: `org-${o.id}`,
              title: t("restoreOrganization"),
              effect: t("effectRestoreOrg"),
              target: o.name,
              run: (r) => api.restorePlatformOrganization(o.id, r),
            }),
        },
        {
          key: "purge",
          label: t("purgeNow"),
          icon: <IconTrash />,
          danger: true,
          disabled: busy,
          onSelect: () =>
            setPending({
              key: `org-purge-${o.id}`,
              title: t("purgeOrgNow"),
              effect: t("effectPurgeOrg"),
              target: o.name,
              danger: true,
              run: (r) => api.purgePlatformOrganization(o.id, r),
            }),
        },
      ];
    }
    return [
      {
        key: "edit",
        label: t("edit"),
        icon: <IconPencil />,
        disabled: busy,
        onSelect: () => setEdit(orgEditForm(o)),
      },
      /* THE ARRIVALS DOOR (0149). Exactly one organisation carries it —
         turning one on clears the other in the same database statement, so
         this is a single press and never a two-step move with a shut door in
         the middle. */
      ...(o.status === "active"
        ? [
            {
              key: "signups",
              label: o.accepts_signups ? t("closeSignups") : t("openSignups"),
              icon: <IconGlobe />,
              disabled: busy,
              onSelect: () =>
                setPending({
                  key: `org-signups-${o.id}`,
                  title: o.accepts_signups ? t("closeSignups") : t("openSignups"),
                  effect: o.accepts_signups ? t("effectCloseSignups") : t("effectOpenSignups"),
                  target: o.name,
                  run: (r) => api.setPlatformOrganizationSignups(o.id, !o.accepts_signups, r),
                }),
            } satisfies KebabItem,
          ]
        : []),
      o.status === "active"
        ? {
            key: "status",
            label: t("suspendOrganization"),
            icon: <IconToggleOff />,
            danger: true,
            disabled: busy,
            onSelect: () =>
              setPending({
                key: `org-${o.id}`,
                title: t("suspendOrganization"),
                effect: t("effectSuspendOrg"),
                target: o.name,
                danger: true,
                run: (r) => api.setPlatformOrganizationStatus(o.id, "suspended", r),
              }),
          }
        : {
            key: "status",
            label: t("reactivateOrganization"),
            icon: <IconToggleOn />,
            disabled: busy,
            onSelect: () =>
              setPending({
                key: `org-${o.id}`,
                title: t("reactivateOrganization"),
                effect: t("effectReactivateOrg"),
                target: o.name,
                run: (r) => api.setPlatformOrganizationStatus(o.id, "active", r),
              }),
          },
      {
        key: "delete",
        label: t("deleteOrganization"),
        icon: <IconTrash />,
        danger: true,
        disabled: busy,
        onSelect: () =>
          setPending({
            key: `org-del-${o.id}`,
            title: t("deleteOrganization"),
            effect: t("effectDeleteOrg"),
            target: o.name,
            danger: true,
            run: (r) => api.softDeletePlatformOrganization(o.id, r),
          }),
      },
    ];
  }

  function userMenu(u: PlatformUser): KebabItem[] {
    const isSelf = u.id === overview.current_user_id;
    const tombstoned = isTombstone(u);
    const named = u.display_name || u.email;
    /*
     * NOTHING LEFT TO DO TO A FINISHED ACCOUNT (user report, 2026-09-04).
     *
     * A tombstone has already been through the door: `platform_purge_user`
     * deleted its calls and erased the person, and its own comment says "the
     * row stays, the person leaves". The row survives because
     * `platform_audit.target_user_id` is ON DELETE RESTRICT — the audit's
     * subject may not be removed by the operator it records — and sixteen
     * other rows still point at it.
     *
     * So the two trash actions are both wrong here: restore would set a
     * `deleted_at` that is already null and change nothing, and purge raises
     * `only a deleted user can be purged`. An empty menu is the honest
     * answer, and it is what the row itself now says.
     */
    if (tombstoned) return [];
    if (userTrash) {
      return [
        {
          key: "restore",
          label: t("restoreUser"),
          icon: <IconRetry />,
          disabled: busy,
          onSelect: () =>
            setPending({
              key: `user-${u.id}`,
              title: t("restoreUser"),
              effect: t("effectRestoreUser"),
              target: named,
              run: (r) => api.restorePlatformUser(u.id, r),
            }),
        },
        {
          key: "purge",
          label: t("purgeNow"),
          icon: <IconTrash />,
          danger: true,
          disabled: busy,
          onSelect: () =>
            setPending({
              key: `user-purge-${u.id}`,
              title: t("purgeUserNow"),
              effect: t("effectPurgeUser"),
              target: named,
              danger: true,
              run: (r) => api.purgePlatformUser(u.id, r),
            }),
        },
      ];
    }
    return [
      {
        key: "edit",
        label: t("edit"),
        icon: <IconPencil />,
        disabled: busy || tombstoned,
        onSelect: () => setEdit(userEditForm(u)),
      },
      /* ACCEPT — the pending queue's only exit, and the reason the queue
         exists (user directive: an arrival waits until an admin accepts). It
         is the same status write as reactivation and a different sentence,
         because "accept this person" and "undo a disabling" are different
         decisions wearing one verb. */
      ...(u.status === "pending"
        ? [
            {
              key: "accept",
              label: t("acceptUser"),
              icon: <IconCheck />,
              disabled: busy,
              onSelect: () =>
                setPending({
                  key: `user-${u.id}`,
                  title: t("acceptUser"),
                  effect: t("effectAcceptUser"),
                  target: named,
                  run: (r) => api.setPlatformUserStatus(u.id, "active", r),
                }),
            } satisfies KebabItem,
          ]
        : []),
      /* enable / disable — never a root, never yourself */
      u.status === "disabled"
        ? {
            key: "enable",
            label: t("reactivateUser"),
            icon: <IconToggleOn />,
            disabled: busy,
            onSelect: () =>
              setPending({
                key: `user-${u.id}`,
                title: t("reactivateUser"),
                effect: t("effectReactivateUser"),
                target: named,
                run: (r) => api.setPlatformUserStatus(u.id, "active", r),
              }),
          }
        : {
            key: "enable",
            label: t("disableUser"),
            icon: <IconToggleOff />,
            danger: true,
            disabled: busy || u.is_platform_root || isSelf,
            onSelect: () =>
              setPending({
                key: `user-${u.id}`,
                title: t("disableUser"),
                effect: t("effectDisableUser"),
                target: named,
                danger: true,
                run: (r) => api.setPlatformUserStatus(u.id, "disabled", r),
              }),
          },
      /* grant / revoke root */
      u.is_platform_root
        ? {
            key: "root",
            label: t("removeRoot"),
            icon: <IconKey />,
            danger: true,
            disabled: busy || isSelf,
            onSelect: () =>
              setPending({
                key: `root-${u.id}`,
                title: t("removeRoot"),
                effect: t("effectRemoveRoot"),
                target: named,
                danger: true,
                run: (r) => api.revokePlatformRoot(u.id, r),
              }),
          }
        : {
            key: "root",
            label: t("makeRoot"),
            icon: <IconKey />,
            disabled: busy || u.status !== "active" || tombstoned,
            onSelect: () =>
              setPending({
                key: `root-${u.id}`,
                title: t("makeRoot"),
                effect: t("effectMakeRoot"),
                target: named,
                run: (r) => api.grantPlatformRoot(u.id, r),
              }),
          },
      /* soft delete — never a root, never yourself, never a tombstone */
      {
        key: "delete",
        label: t("deleteUser"),
        icon: <IconTrash />,
        danger: true,
        disabled: busy || u.is_platform_root || isSelf || tombstoned,
        onSelect: () =>
          setPending({
            key: `user-del-${u.id}`,
            title: t("deleteUser"),
            effect: t("effectDeleteUser"),
            target: named,
            danger: true,
            run: (r) => api.softDeletePlatformUser(u.id, r),
          }),
      },
    ];
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
      /* audit finding, 2026-09-02: a hand-rolled card with a 20px heading and
         a hand-rolled button. Every sibling centred-card screen (pending,
         suspended, forgot, reset, sign-up) is a `.card` with a `text-lg
         font-bold` title — this one screen was a different shape from the
         five it stands beside, and it is the first thing a new vendor sees. */
      <Centered>
        <Card className="w-full max-w-xl">
          <h1 className="text-lg font-bold text-fg">{t("claimTitle")}</h1>
          <p className="mt-3 text-sm leading-6 text-fg-muted">{t("claimBody")}</p>
          {error === "claim" ? (
            <p role="alert" className="mt-3 text-sm text-danger">
              {t("claimFailed")}
            </p>
          ) : null}
          <button
            type="button"
            className="btn-primary mt-5"
            onClick={() => void claim()}
            disabled={claiming}
          >
            {claiming ? t("workingLabel") : t("claim")}
          </button>
        </Card>
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
          {/* found by running persianType.guard on this file (2026-09-02, and
              red before this pass — the line predates it): `uppercase
              tracking-wide` on «کنترل پلتفرم». Letter-spacing pulls joined
              Persian script apart and the uppercase does nothing at all to
              it; `text-group-label` is the scaffold's own role for a small
              label, and it holds in both locales. */}
          <span className="rounded-md bg-accent-soft px-2 py-1 text-group-label font-bold text-accent">
            {t("menu")}
          </span>
          {/* audit finding, 2026-09-02: both were a private ~30px, 12px-corner
              button — a shape that exists nowhere else in the product. The
              theme's compact control is `.btn-sm`, which is what the section
              toolbar one row below already wears. */}
          <span className="ms-auto flex items-center gap-2">
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => void refresh()}
              disabled={busy}
            >
              {t("refresh")}
            </button>
            <a href={`/${locale}`} className="btn-secondary btn-sm">
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
        {/* THE TOOLBAR SHAPE (audit finding, 2026-09-02): the console switched
            its three sections with an underlined tab strip on a hairline — a
            control no other surface uses; every other surface switches with
            the pill toolbar */}
        <nav className="mt-6 flex flex-wrap items-center gap-1" role="tablist" aria-label={t("title")}>
          {(["organizations", "users", "audit"] as const).map((key) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              className={`btn btn-sm gap-1.5 font-medium ${
                tab === key
                  ? "bg-accent text-on-accent"
                  : "text-fg-muted hover:bg-surface-2 hover:text-fg"
              }`}
              onClick={() => setTab(key)}
            >
              {t(key)}
              {key !== "audit" ? (
                /* audit finding, 2026-09-02: the count printed Latin digits in
                   the Persian console — `badge-num` is the theme's numeral
                   box (tabular figures), `digits()` the locale's numerals */
                <span className="badge-num ms-2 rounded-md bg-surface-2 px-1.5 text-xs text-fg-muted">
                  {digits(
                    key === "organizations" ? overview.organizations.total : overview.users.total,
                    locale,
                  )}
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
            {/* THE THEME'S ONE TABLE (audit finding, 2026-09-02). This was a
                hairline-divided box of hand-rolled rows — the last list in
                the product wearing its own skin. `hideHeader` for the same
                reason the members list hides its own: the first thing under
                the toolbar should be a record, not a caption for records. */}
            <div className="mt-3">
              <DataTable
                hideHeader
                rows={shownOrgs}
                loading={!loaded}
                empty={<EmptyState text={orgTrash ? t("deletedEmptyOrgs") : t("nothingFound")} />}
                rowKey={(o) => o.id}
                menuItems={orgMenu}
                columns={[
                  {
                    key: "organization",
                    header: t("organization"),
                    cell: (o) => (
                      <span className="block min-w-0 leading-tight">
                        <span className="block truncate font-medium text-fg">{o.name}</span>
                        <span className="mt-0.5 block text-xs text-fg-muted">
                          <span className="ltr">{o.locale}</span> · {t("memberCount")}:{" "}
                          {digits(o.member_count, locale)} · {t("created")}: {fmtDate(o.created_at)}
                        </span>
                      </span>
                    ),
                  },
                  {
                    key: "status",
                    header: t("status"),
                    cell: (o) =>
                      orgTrash ? (
                        <PurgeBadge purgeAfter={o.purge_after} fmt={(d) => t("purgeIn", { days: d })} />
                      ) : (
                        <Chip tone={o.status === "active" ? "success" : "danger"}>
                          {o.status === "active" ? t("active") : t("suspended")}
                        </Chip>
                      ),
                  },
                  { key: "actions", header: t("colActions"), srOnly: true, cell: () => null },
                ]}
              />
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
                      {/* audit finding, 2026-09-02: both selects were cut to
                          34px on top of `.input`, so the arrivals queue's
                          fields sat 6px shorter than every other field on the
                          console. `.input` owns the height. */}
                      <Select
                        ariaLabel={t("placeOrg")}
                        className="w-48"
                        value={placement[u.id]?.org ?? ""}
                        placeholder={t("placeOrgChoose")}
                        onChange={(next) => setPlacement((prev) => ({
                          ...prev,
                          [u.id]: { org: next, role: prev[u.id]?.role ?? "member" },
                        }))}
                        options={[
                          { value: "", label: t("placeOrgChoose") },
                          ...orgs.filter((o) => o.deleted_at === null)
                            .map((o) => ({ value: o.id, label: o.name })),
                        ]}
                      />
                      <Select
                        ariaLabel={t("placeRole")}
                        className="w-32"
                        value={placement[u.id]?.role ?? "member"}
                        onChange={(next) => setPlacement((prev) => ({
                          ...prev,
                          [u.id]: { org: prev[u.id]?.org ?? "", role: next },
                        }))}
                        options={[
                          { value: "member", label: tAdmin("roleMember") },
                          { value: "admin", label: tAdmin("roleAdmin") },
                          { value: "owner", label: tAdmin("roleOwner") },
                        ]}
                      />
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
                      {/* NOT A SWITCH (2026-09-03): it wore `role="switch"`,
                          which tells a screen reader there is a track with a
                          knob — there is a labelled filter chip. A toggle
                          button reports itself with `aria-pressed`, and the
                          shape is the platform's filter chip (`btn btn-sm`,
                          the meetings toolbar's), not a `rounded-full` pill on
                          a button. */}
                      <button
                        type="button"
                        aria-pressed={rootsOnly}
                        onClick={() => setRootsOnly((v) => !v)}
                        className={`btn btn-sm border font-semibold ${
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
            {/* the same table as Organizations and as Management·Users — one
                shape for one job (audit finding, 2026-09-02) */}
            <div className="mt-3">
              <DataTable
                hideHeader
                rows={shownUsers}
                loading={!loaded}
                empty={<EmptyState text={userTrash ? t("deletedEmptyUsers") : t("nothingFound")} />}
                rowKey={(u) => u.id}
                menuItems={userMenu}
                columns={[
                  {
                    key: "user",
                    header: t("user"),
                    cell: (u) => (
                      <span className="block min-w-0 leading-tight">
                        <span className="flex items-center gap-2 truncate font-medium text-fg">
                          {isTombstone(u) ? t("tombstoned") : u.display_name}
                          {isTombstone(u) ? (
                            /* said on the row, because the empty menu above is
                               an absence and an absence explains nothing */
                            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-fg-muted">
                              {t("finished")}
                            </span>
                          ) : null}
                          {u.is_platform_root ? (
                            <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent">
                              {u.id === overview.current_user_id ? t("selfBadge") : t("currentRoot")}
                            </span>
                          ) : null}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-fg-muted">
                          <span className="ltr">{u.email}</span> · {u.org_name} · {t("role")}: {u.role}
                          {u.username ? <> · @{u.username}</> : null}
                        </span>
                        <span className="mt-0.5 block text-[11px] text-fg-subtle">
                          {t("lastSeen")}: {fmtDate(u.last_seen_at)} · {t("created")}: {fmtDate(u.created_at)}
                        </span>
                      </span>
                    ),
                  },
                  {
                    key: "status",
                    header: t("status"),
                    cell: (u) =>
                      userTrash ? (
                        <PurgeBadge purgeAfter={u.purge_after} fmt={(d) => t("purgeIn", { days: d })} />
                      ) : (
                        <Chip
                          tone={
                            u.status === "active"
                              ? "success"
                              : u.status === "pending"
                                ? "warning"
                                : "danger"
                          }
                        >
                          {t(u.status)}
                        </Chip>
                      ),
                  },
                  { key: "actions", header: t("colActions"), srOnly: true, cell: () => null },
                ]}
              />
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
            {/* the feed keeps its column HEADERS, unlike the two lists above:
                its sibling is Audit Logs, which is five columns of facts
                rather than a roster, and there the header is what says which
                fact is which (audit finding, 2026-09-02) */}
            <DataTable
              rows={audit}
              loading={!loaded}
              empty={<EmptyState text={t("noAudit")} />}
              rowKey={(e) => e.id}
              columns={[
                {
                  key: "when",
                  header: t("colWhen"),
                  cell: (e) => (
                    <span className="block text-xs text-fg-muted">
                      <span className="block">{formatDate(e.created_at, locale)}</span>
                      <span className="block">{formatTime(e.created_at, locale)}</span>
                    </span>
                  ),
                },
                {
                  key: "who",
                  header: t("colWho"),
                  cell: (e) => <span className="ltr block text-xs text-fg-muted">{e.actor_email}</span>,
                },
                {
                  key: "what",
                  header: t("colWhat"),
                  cell: (e) => (
                    <span className="text-xs font-medium text-fg">{auditLabel(t, e.action)}</span>
                  ),
                },
                {
                  key: "target",
                  header: t("dialogTarget"),
                  cell: (e) => <span className="text-xs">{auditTarget(e, orgNames, userNames)}</span>,
                },
                {
                  key: "reason",
                  header: t("auditReason"),
                  /* the reason is the ONE free-text field on this screen and
                     the only one worth reading in full — it wraps inside a
                     capped column rather than widening the table, which
                     `min-w-max` would otherwise let it do without limit */
                  cell: (e) => (
                    <span className="block max-w-[46ch] whitespace-normal text-xs leading-5 text-fg">
                      {e.reason}
                    </span>
                  ),
                },
              ]}
            />
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

/** A tombstoned account: the address is REPLACED at deletion (db/0044). */
/*
 * THE STAMP, not the address (0179). `@tombstone.invalid` is a shape the
 * erasure happens to write; `tombstoned_at` is the fact, and the console now
 * has it. A screen that recognises a state by parsing a string it did not
 * produce is one rename away from showing live accounts as deleted.
 */
const isTombstone = (u: PlatformUser) =>
  /*
   * `!= null`, LOOSELY, and that is the whole care in this line: it catches
   * undefined as well as null. A deployment whose server predates 0179 sends
   * no `tombstoned_at` at all, and with a strict `!== null` every account on
   * the platform would read as erased — no name, no menu, nothing to press.
   * An absent field must mean "not erased"; the dangerous direction here is
   * the one that turns a missing column into a finished person.
   */
  u.tombstoned_at != null;

/**
 * What an audit line was ABOUT, named rather than numbered where the console
 * happens to hold the row. The short id is the honest fallback — the entry
 * may point at something outside the page we loaded, and inventing a name for
 * it would be worse than showing the identifier.
 */
function auditTarget(
  entry: PlatformAuditEntry,
  orgNames: Map<string, string>,
  userNames: Map<string, string>,
): string {
  if (entry.target_org_id) return orgNames.get(entry.target_org_id) ?? shortId(entry.target_org_id);
  if (entry.target_user_id) return userNames.get(entry.target_user_id) ?? shortId(entry.target_user_id);
  return "—";
}

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

/**
 * audit finding, 2026-09-02: three 27px bold figures in Latin digits, inside
 * a hand-rolled tile. `text-3xl` is the dashboard greeting's size and nothing
 * else's; the platform's stat figure is `badge-num text-xl`, which is also
 * what the four agent numbers on Management·Server already use — two sizes
 * for one kind of number was the whole complaint.
 */
function StatCard({
  label,
  value,
  parts,
}: {
  label: string;
  value: number;
  parts: { label: string; value: number; tone: Tone }[];
}) {
  const locale = useLocale();
  return (
    <div className="tile p-4">
      <p className="text-sm text-fg-muted">{label}</p>
      <p className="badge-num mt-1 text-xl font-bold text-fg">{digits(value, locale)}</p>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {parts.map((p) => (
          <span key={p.label} className="text-fg-muted">
            {p.label}:{" "}
            <span className={`font-semibold ${TONE[p.tone]}`}>{digits(p.value, locale)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/*
 * `Pill`, `ActionButton` and `Empty` were DELETED here (audit finding,
 * 2026-09-02), not restyled: the status pill is the theme's `Chip`, the row
 * action is a menu entry, and the empty sentence is `EmptyState` inside
 * DataTable — which is also what makes it appear only after the answer.
 * Three local dialects of three things the theme already says.
 */

function More({ busy, onClick, children }: { busy: boolean; onClick: () => void; children: ReactNode }) {
  return (
    /* the cursor button sits BESIDE the table's pager, the way Audit Logs
       keeps its own: a page of fifty is ten pages to walk, and the last one
       has no door to the next fifty without this */
    <button type="button" className="btn-secondary btn-sm mt-3" disabled={busy} onClick={onClick}>
      {children}
    </button>
  );
}

/**
 * The toolbar's filter chips — the meetings toolbar's own idiom, which is the
 * shape every section-switching row in the product wears (audit finding,
 * 2026-09-02: these were `rounded-full` lozenges, and the segmented switch
 * beside them was a third shape again).
 */
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
    <div className="flex flex-wrap items-center gap-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`btn btn-sm gap-1.5 font-medium ${
            value === o.value
              ? "bg-accent text-on-accent"
              : "text-fg-muted hover:bg-surface-2 hover:text-fg"
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
      {/* audit finding, 2026-09-02: the field re-answered `.input`'s one
          question — height and type size — and the button was a third button
          shape on a screen that already had two. `.input` owns the geometry;
          `w-56` is the only thing left for a caller to say. */}
      <form className="flex gap-2" onSubmit={submit}>
        <input
          className="input w-56"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
        />
        <button type="submit" className="btn-secondary btn-sm">
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
    /* audit finding, 2026-09-02: two pill buttons inside a `rounded-full`
       ring. The reference's segmented control is the same `.btn-sm` pair the
       meetings toolbar uses — pills are for chips and badges, and a button
       that borrows their shape is why one row of this console had three
       button families in it. */
    <div className="flex items-center gap-1">
      {([false, true] as const).map((v) => (
        <button
          key={String(v)}
          type="button"
          aria-pressed={trash === v}
          onClick={() => onChange(v)}
          className={`btn btn-sm font-medium ${
            trash === v
              ? "bg-accent text-on-accent"
              : "text-fg-muted hover:bg-surface-2 hover:text-fg"
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
  /* the theme's `Chip`, which is the same two tones this drew by hand plus
     the dot — status is never carried by colour alone. The days themselves
     stay ICU's: `purgeIn` is a plural message, and `#` is already localised
     by next-intl, so putting `digits()` in front of it would be a second
     spelling of the same rule. */
  return <Chip tone={days <= 1 ? "danger" : "warning"}>{fmt(days)}</Chip>;
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
  const locale = useLocale();
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
                  <Select
                    id={id}
                    value={values[f.name] ?? ""}
                    onChange={(next) => setValues((prev) => ({ ...prev, [f.name]: next }))}
                    className="mt-1 w-full"
                    options={(f.options ?? []).map((o) => ({ value: o.value, label: o.label }))}
                  />
                ) : (
                  <input
                    id={id}
                    dir={f.dir ?? "auto"}
                    value={values[f.name] ?? ""}
                    placeholder={f.placeholder}
                    onChange={(e) => setValues((prev) => ({ ...prev, [f.name]: e.target.value }))}
                    className="input mt-1 w-full"
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
              className="input mt-1 min-h-[80px] w-full resize-y py-2"
              aria-describedby="ef-reason-hint"
            />
            <div className="mt-1 flex items-center justify-between text-xs text-fg-muted">
              <span id="ef-reason-hint">{labels.hint}</span>
              {/* audit finding, 2026-09-02: the counter printed Latin digits
                  beside a Persian hint */}
              <span className="ltr tabular-nums">
                {digits(reason.trim().length, locale)}/{digits(500, locale)}
              </span>
            </div>
          </div>
        </div>

        {failed ? (
          <p role="alert" className="mt-2 text-sm text-danger">
            {labels.failed}
          </p>
        ) : null}

        {/* audit finding, 2026-09-02: a 40px, 12px-corner pair — the primary
            action changing shape between the page and its own dialog. These
            are the theme's two buttons, the ones `ConfirmDialog` uses. */}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
            {labels.cancel}
          </button>
          <button
            type="button"
            className="btn-primary"
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
  const locale = useLocale();
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
            className="input mt-1 min-h-[80px] w-full resize-y py-2"
            aria-describedby="pa-reason-hint"
          />
          <div className="mt-1 flex items-center justify-between text-xs text-fg-muted">
            <span id="pa-reason-hint">{labels.hint}</span>
            {/* audit finding, 2026-09-02: Latin digits beside a Persian hint */}
            <span className="ltr tabular-nums">
              {digits(reason.trim().length, locale)}/{digits(500, locale)}
            </span>
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
