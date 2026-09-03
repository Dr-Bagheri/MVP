"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { Role, User } from "@/api/types";
import { BffError } from "@/api/client";
import { ConfirmDialog } from "@/components/rowActions";
import { IconClose } from "@/components/icons";
import { Chip } from "@/components/ui";
import { Avatar } from "@/components/Avatar";
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
  onSetPassword,
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
  onDelete?: (user: User, reason: string) => void;
  /** opens the platform's set-password dialog for this person (user
      directive, 2026-09-02: "put the password in the page it opens").
      Absent = the door never renders — the caller decides who may. */
  onSetPassword?: (user: User) => void;
  onClose: () => void;
}) {
  const t = useTranslations("management");
  const tAdmin = useTranslations("admin");
  const locale = useLocale();
  /**
   * The delete asks in the platform's ONE dialog (`ConfirmDialog`, enforced
   * by `confirm.guard.test.ts`) instead of the inline two-press expander it
   * used to grow in place.
   *
   * The reason field goes INSIDE that dialog rather than beside the button:
   * 0085 requires a reason in the ledger, and a confirmation that needs an
   * answer is exactly what `ConfirmDialog`'s `body` slot is for. Asking in
   * a row of controls meant the sentence explaining what a tombstone does
   * sat under a form the person had already started filling in.
   */
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  /** 0085: every deletion carries its reason into the ledger */
  const [deleteReason, setDeleteReason] = useState("");

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
      /* z-50: THE MODAL LAYER (user report, 2026-09-02: "the orb still on the
         page"). This panel sat at z-40, the same level as the assistant's
         orb, so which one covered the other was decided by DOM order — a
         coin toss that landed on the orb. A panel with role="dialog" belongs
         with the dialogs; stacking.guard.test.ts now counts it as one. */
      className="fixed inset-y-0 end-0 z-50 flex w-full max-w-md flex-col border-s border-border bg-surface shadow-xl"
      role="dialog"
      aria-label={t("detailTitle")}
    >
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <h2 className="text-base font-semibold text-fg">{t("detailTitle")}</h2>
        {/* audit finding, 2026-09-02: this close was a 36px, 12px-cornered
            square drawn by hand around a text glyph. `grid place-items-center`
            is the spelling of `flex items-center` the control guard does not
            look for, and a typed character shares nothing with the icon set's
            stroke or box — so beside every other dialog's 28px `.btn-icon`
            with IconClose it read as a different product's button. */}
        <button
          type="button"
          className="btn btn-icon text-fg-muted hover:bg-surface-2 hover:text-fg"
          aria-label={t("detailClose")}
          onClick={onClose}
        >
          <IconClose width={14} height={14} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="mb-4 flex items-center gap-3">
          {/* 2026-09-03: the platform's avatar, not a fifth hand-drawn one —
              `lg` because this person is the page's SUBJECT, which is the size
              the component carries for exactly this place.
              Two things change on screen and both are the point: the well was
              `bg-surface-2` where the roster this panel opens from is
              `bg-accent-soft` with a ring — the same person, two marks, one
              click apart — and the initial was the one copy that never got
              uppercased, so a Latin name read `a` here and `A` in the table.
              (initials ARE the avatar: avatar_url is a ruled absence, not a
              gap — the component takes a photo the day there is one.) */}
          <Avatar name={personName(user, locale)} size="lg" />
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
              {/* audit finding, 2026-09-02: four fields in this panel re-answered
                  `.input`'s one height and type size by hand (h-9 min-h-0
                  py-0 text-xs/text-sm) — 36px fields in a product whose every
                  other form is the 40px `.input`, and below md the override
                  also discarded the 44px hit-area ruling. `.input` owns height
                  and size; the fields keep only their placement (mt-1, ltr,
                  w-*). Same fix on the handle, the role select and the
                  delete-reason field below. */}
              <input
                className="input mt-1"
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
              {/* audit finding, 2026-09-02: `.input` owns height and size (see
                  the name field above) */}
              <input
                className="input ltr mt-1"
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
                /* audit finding, 2026-09-02: `.input` owns height and size
                   (see the name field above); only the width stays local */
                className="input w-32"
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
            {onSetPassword ? (
              /* the same door the row's kebab offers, from inside the panel
                 (user directive, 2026-09-02): a person who opened the panel
                 to look at somebody should not have to close it and hunt
                 for the ⋯ to act on them */
              <button
                className="btn-secondary"
                disabled={busy}
                onClick={() => onSetPassword(user)}
              >
                {t("setPassword")}
              </button>
            ) : null}
            {onDelete ? (
              <button
                className="text-sm text-danger/80 underline-offset-2 hover:text-danger hover:underline"
                disabled={busy}
                onClick={() => { setDeleteReason(""); setConfirmingDelete(true); }}
              >
                {t("deleteMember")}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {onDelete && confirmingDelete ? (
        <ConfirmDialog
          title={t("deleteMemberConfirmTitle", { name: personName(user, locale) })}
          body={
            <div className="space-y-3">
              {/* what the button DOES, said before it happens: the person is
                  emptied and their handle retired forever — not a hide */}
              <p className="text-sm leading-6 text-fg-muted">{t("deleteMemberNote")}</p>
              <label className="block text-xs text-fg-muted" htmlFor="member-delete-reason">
                {t("deleteReasonHint")}
              </label>
              {/* audit finding, 2026-09-02: `.input` owns height and size (see
                  the name field above) */}
              <input
                id="member-delete-reason"
                className="input w-full"
                autoFocus
                placeholder={t("deleteReasonHint")}
                value={deleteReason}
                onChange={(e) => setDeleteReason(e.target.value)}
              />
            </div>
          }
          confirmLabel={t("confirmDeleteMember")}
          cancelLabel={t("detailClose")}
          busy={busy}
          /* the reason is the ledger's, and core requires one — the button
             stays off and the empty field says why, rather than a refusal
             arriving after the press */
          confirmDisabled={deleteReason.trim().length < 3}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={() => {
            setConfirmingDelete(false);
            onDelete(user, deleteReason.trim());
          }}
        />
      ) : null}
    </aside>
  );
}
