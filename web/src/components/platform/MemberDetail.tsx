"use client";

import { useLocale, useTranslations } from "next-intl";
import type { Role, User } from "@/api/types";
import { Chip } from "@/components/ui";
import { formatDate, personName } from "@/lib/format";

/**
 * The member detail panel (Part 4) — one person, all their identity facts,
 * and the same two controls the table row offers (role, enable/disable)
 * consumed from the parent so there is exactly ONE mutation path.
 *
 * A side panel, not a route: the detail is a magnified row, and losing the
 * list (filters, selection, scroll position) to look at one person would
 * make comparing two people a navigation exercise.
 *
 * Names render AS AUTHORED (the user's verdict — never transliterated,
 * never translated); the English-context name appears only when the person
 * chose one. `null` states are said in words, never dashed into looking
 * like data.
 */
export function MemberDetail({
  user,
  me,
  busy,
  assignableRoles,
  onSetRole,
  onToggleStatus,
  onClose,
}: {
  user: User;
  me: User | null;
  busy: boolean;
  assignableRoles: readonly Role[];
  onSetRole: (id: string, role: Role) => void;
  onToggleStatus: (user: User) => void;
  onClose: () => void;
}) {
  const t = useTranslations("management");
  const tAdmin = useTranslations("admin");
  const locale = useLocale();

  const statusTone =
    user.status === "active" ? "success" : user.status === "pending" ? "warning" : "neutral";
  const statusLabel = tAdmin(
    user.status === "active"
      ? "statusActive"
      : user.status === "pending"
        ? "statusPending"
        : "statusDisabled",
  );
  const editable = user.role !== "owner" && user.id !== me?.id;

  const row = (label: string, value: React.ReactNode) => (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <span className="shrink-0 text-xs text-fg-muted">{label}</span>
      <span className="min-w-0 text-end text-sm text-fg">{value}</span>
    </div>
  );

  return (
    <aside
      className="fixed inset-y-0 end-0 z-40 flex w-full max-w-md flex-col border-s border-border bg-surface shadow-xl"
      role="dialog"
      aria-label={t("detailTitle")}
    >
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <h2 className="text-base font-semibold text-fg">{t("detailTitle")}</h2>
        <button
          type="button"
          className="tap grid h-9 w-9 place-items-center rounded-lg text-fg-muted hover:bg-surface-2 hover:text-fg"
          aria-label={t("detailClose")}
          onClick={onClose}
        >
          ×
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="mb-4 flex items-center gap-3">
          {/* initials ARE the avatar (avatar_url is a ruled absence, not a gap) */}
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-surface-2 text-base font-semibold text-fg">
            {personName(user, locale).slice(0, 1)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-fg">{personName(user, locale)}</p>
            {user.username ? (
              <p className="truncate text-xs text-fg-muted">
                <span className="ltr">@{user.username}</span>
              </p>
            ) : null}
          </div>
          <span className="ms-auto">
            <Chip tone={statusTone}>{statusLabel}</Chip>
          </span>
        </div>

        <div className="divide-y divide-border">
          {row(t("detailEmail"), <span className="ltr break-all">{user.email}</span>)}
          {/* both authored names, shown as facts — the fa name is the name,
              the en name exists only when the person recorded one */}
          {row(t("detailNameFa"), user.display_name)}
          {user.display_name_en ? row(t("detailNameEn"), <span className="ltr">{user.display_name_en}</span>) : null}
          {row(
            t("detailUsername"),
            user.username ? <span className="ltr">@{user.username}</span> : t("detailNoUsername"),
          )}
          {row(
            t("colRole"),
            user.role === "owner" ? (
              <Chip tone="accent">{t("roleOwner")}</Chip>
            ) : editable ? (
              <select
                className="input h-9 min-h-0 w-32 py-0 text-xs"
                value={user.role}
                disabled={busy}
                onChange={(e) => onSetRole(user.id, e.target.value as Role)}
              >
                {assignableRoles.map((r) => (
                  <option key={r} value={r}>
                    {tAdmin(r === "admin" ? "roleAdmin" : "roleMember")}
                  </option>
                ))}
              </select>
            ) : (
              tAdmin(user.role === "admin" ? "roleAdmin" : "roleMember")
            ),
          )}
          {row(t("colAdded"), formatDate(user.created_at, locale))}
          {user.last_seen_at !== undefined
            ? row(
                t("colLastAction"),
                user.last_seen_at ? (
                  formatDate(user.last_seen_at, locale)
                ) : (
                  <span className="text-fg-muted/70">{t("neverSeen")}</span>
                ),
              )
            : null}
        </div>

        {editable ? (
          <div className="mt-5">
            <button
              className={user.status === "disabled" ? "btn-primary" : "btn-secondary"}
              disabled={busy}
              onClick={() => onToggleStatus(user)}
            >
              {tAdmin(user.status === "disabled" ? "enable" : "disable")}
            </button>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
