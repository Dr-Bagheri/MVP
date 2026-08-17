"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { Role, User } from "@/api/types";
import { BffError } from "@/api/client";
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
  onRename,
  onDelete,
  onClose,
}: {
  user: User;
  me: User | null;
  busy: boolean;
  assignableRoles: readonly Role[];
  onSetRole: (id: string, role: Role) => void;
  onToggleStatus: (user: User) => void;
  /** Admin rename: display name and/or username (`null` clears the handle).
   *  Throws on refusal — the server's sentence is the one the panel shows,
   *  because core alone can tell "taken" from "retired". */
  onRename?: (id: string, patch: { display_name?: string; username?: string | null }) => Promise<void>;
  /** Owner-only true delete (tombstone). Absent = the button never renders. */
  onDelete?: (user: User) => void;
  onClose: () => void;
}) {
  const t = useTranslations("management");
  const tAdmin = useTranslations("admin");
  const locale = useLocale();
  /** Two-step delete: the first press arms it, the second is the real one. */
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  /*
   * Rename drafts. Re-synced from the SERVER value (not just on person
   * change) so a successful save adopts whatever core normalized — a
   * lowercased handle must come back as the value on screen, not as a
   * phantom "unsaved change".
   */
  const [nameDraft, setNameDraft] = useState(user.display_name);
  const [usernameDraft, setUsernameDraft] = useState(user.username ?? "");
  const [renameError, setRenameError] = useState<string | null>(null);
  useEffect(() => {
    setNameDraft(user.display_name);
  }, [user.id, user.display_name]);
  useEffect(() => {
    setUsernameDraft(user.username ?? "");
  }, [user.id, user.username]);
  useEffect(() => {
    setRenameError(null);
  }, [user.id]);

  const trimmedName = nameDraft.trim();
  /* an emptied handle field means "clear it" — null is the wire's word */
  const usernameValue = usernameDraft.trim() === "" ? null : usernameDraft.trim();
  const nameChanged = trimmedName !== "" && trimmedName !== user.display_name;
  const usernameChanged = usernameValue !== (user.username ?? null);
  const renameDirty = nameChanged || usernameChanged;

  async function saveRename(): Promise<void> {
    if (!onRename || !renameDirty || busy) return;
    setRenameError(null);
    const patch: { display_name?: string; username?: string | null } = {};
    if (nameChanged) patch.display_name = trimmedName;
    if (usernameChanged) patch.username = usernameValue;
    try {
      await onRename(user.id, patch);
    } catch (error) {
      setRenameError(
        error instanceof BffError && error.detail ? error.detail : t("detailSaveFailed"),
      );
    }
  }

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
              the en name exists only when the person recorded one. For an
              editable member the admin edits the primary name and the handle
              in place; the en name stays the person's own to record. */}
          {editable && onRename ? (
            <label className="block py-2">
              <span className="text-xs text-fg-muted">{t("detailNameFa")}</span>
              <input
                className="input mt-1 h-9 min-h-0 text-sm"
                value={nameDraft}
                disabled={busy}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void saveRename();
                }}
              />
            </label>
          ) : (
            row(t("detailNameFa"), user.display_name)
          )}
          {user.display_name_en ? row(t("detailNameEn"), <span className="ltr">{user.display_name_en}</span>) : null}
          {editable && onRename ? (
            <label className="block py-2">
              <span className="text-xs text-fg-muted">{t("detailUsername")}</span>
              <input
                className="input ltr mt-1 h-9 min-h-0 text-sm"
                value={usernameDraft}
                disabled={busy}
                placeholder={t("detailNoUsername")}
                onChange={(e) => setUsernameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void saveRename();
                }}
              />
            </label>
          ) : (
            row(
              t("detailUsername"),
              user.username ? <span className="ltr">@{user.username}</span> : t("detailNoUsername"),
            )
          )}
          {editable && onRename && (renameDirty || renameError) ? (
            <div className="flex flex-wrap items-center gap-3 py-2">
              {renameDirty ? (
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busy}
                  onClick={() => void saveRename()}
                >
                  {t("detailSave")}
                </button>
              ) : null}
              {renameError ? <span className="text-xs text-danger">{renameError}</span> : null}
            </div>
          ) : null}
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
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              className={user.status === "disabled" ? "btn-primary" : "btn-secondary"}
              disabled={busy}
              onClick={() => onToggleStatus(user)}
            >
              {tAdmin(user.status === "disabled" ? "enable" : "disable")}
            </button>
            {onDelete ? (
              confirmingDelete ? (
                <span className="flex items-center gap-2">
                  <button
                    className="btn-danger"
                    disabled={busy}
                    onClick={() => onDelete(user)}
                  >
                    {t("confirmDeleteMember")}
                  </button>
                  <button
                    className="text-xs text-fg-muted underline-offset-2 hover:underline"
                    onClick={() => setConfirmingDelete(false)}
                  >
                    {t("detailClose")}
                  </button>
                </span>
              ) : (
                <button
                  className="text-sm text-danger/80 underline-offset-2 hover:text-danger hover:underline"
                  disabled={busy}
                  onClick={() => setConfirmingDelete(true)}
                >
                  {t("deleteMember")}
                </button>
              )
            ) : null}
          </div>
        ) : null}
        {onDelete && confirmingDelete ? (
          /* what the button DOES, said before it happens: the person is
             emptied and their handle retired forever — not a hide */
          <p className="mt-2 text-xs leading-6 text-fg-muted">{t("deleteMemberNote")}</p>
        ) : null}
      </div>
    </aside>
  );
}
