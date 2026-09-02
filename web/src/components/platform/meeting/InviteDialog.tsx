"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { OrgPersonRecord } from "@/api/types";
import { Overlay } from "@/components/platform/Overlay";
import { IconCheck, IconClose, IconCopy, IconSearch } from "@/components/icons";
import { personName } from "@/lib/format";
import { Skeleton } from "@/components/scaffold";

/**
 * WHO IS COMING — the meeting's invitees, chosen from the organisation or
 * typed as an address (user directive, 2026-09-02: "when you press on invite
 * this window must pop up, and you can add people from all org to it — it
 * should work both for members and admins — or you can send emails to them").
 *
 * Two ways in, because there are two kinds of person:
 *
 *   COLLEAGUES are picked from a list. `orgPeople` is the directory every
 *   picker on the platform uses, and it returns names and roles and NEVER
 *   emails — a member browsing their colleagues is not a reason to hand out
 *   an address book.
 *
 *   EVERYONE ELSE is typed. An invitee outside the platform has no row to
 *   pick, which is exactly why `meeting.invitees` is a text array rather than
 *   a set of user ids (0145 wrote that reasoning down; this is the surface
 *   that needed it), and why the guest link sits in this window too — the
 *   answer to "how does this person actually get in" is only useful beside
 *   the place you add them.
 *
 * MEMBERS AND ADMINS ALIKE, and there is no role check here on purpose: the
 * directory is org-scoped and the meeting's own policies decide who may edit
 * it. A check in a dialog is a check the server does not have.
 */
export function InviteDialog({
  invitees,
  onChange,
  onClose,
  guestLinkCopied,
  onCopyGuestLink,
}: {
  invitees: string[];
  onChange: (next: string[]) => void;
  onClose: () => void;
  /** true once a link has been minted and put on the clipboard this session */
  guestLinkCopied: boolean;
  onCopyGuestLink: () => void;
}) {
  const t = useTranslations("meetings");
  const locale = useLocale();
  const [people, setPeople] = useState<OrgPersonRecord[] | null>(null);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");

  useEffect(() => {
    void api.orgPeople().then(setPeople).catch(() => setPeople([]));
  }, []);

  const shown = useMemo(() => {
    const rows = people ?? [];
    const q = query.trim().toLowerCase();
    if (q === "") return rows;
    /* through `personName`, the way every other search on this platform
       matches a person — a colleague findable by one of their two names and
       not the other is a colleague the search says does not exist */
    return rows.filter((p) => personName(p, locale).toLowerCase().includes(q));
  }, [people, query, locale]);

  const toggle = (name: string) => {
    onChange(invitees.includes(name) ? invitees.filter((v) => v !== name) : [...invitees, name]);
  };

  const addTyped = () => {
    const name = draft.trim();
    if (name === "" || invitees.includes(name)) { setDraft(""); return; }
    onChange([...invitees, name]);
    setDraft("");
  };

  return (
    <Overlay onClose={onClose} label={t("inviteTitle")} size="md">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-fg">{t("inviteTitle")}</h2>
          <p className="mt-0.5 text-xs text-fg-muted">{t("inviteHint")}</p>
        </div>
        <button
          type="button"
          aria-label={t("close")}
          onClick={onClose}
          className="btn btn-icon shrink-0 border border-border text-fg-subtle hover:text-fg"
        >
          <IconClose width={14} height={14} />
        </button>
      </div>

      <label className="relative block">
        <span className="sr-only">{t("inviteSearch")}</span>
        <input
          className="input ps-9"
          placeholder={t("inviteSearch")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="pointer-events-none absolute top-1/2 -translate-y-1/2 text-fg-subtle" style={{ insetInlineStart: "0.75rem" }}>
          <IconSearch width={14} height={14} />
        </span>
      </label>

      <div className="mt-2 max-h-64 overflow-y-auto">
        {people === null ? (
          /* the list's own frame with placeholder rows — the platform's
             loading rule, so the dialog does not change height when the
             directory lands under the pointer */
          <div className="space-y-1.5 py-1">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="flex items-center gap-2 px-1 py-1.5">
                <Skeleton className="h-7 w-7 rounded-full" />
                <Skeleton className="h-4 w-40" />
              </div>
            ))}
          </div>
        ) : shown.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-fg-subtle">{t("inviteNoPeople")}</p>
        ) : (
          <ul className="space-y-1">
            {shown.map((person) => {
              const name = personName(person, locale);
              const chosen = invitees.includes(name);
              return (
                <li key={person.id}>
                  <button
                    type="button"
                    aria-pressed={chosen}
                    onClick={() => toggle(name)}
                    className={`flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-start transition-colors ${
                      chosen
                        ? "border-accent bg-accent-soft"
                        : "border-transparent hover:border-border hover:bg-surface-2"
                    }`}
                  >
                    <span
                      className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-bold ${
                        chosen ? "bg-accent text-on-accent" : "bg-surface-2 text-fg-muted"
                      }`}
                      aria-hidden
                    >
                      {chosen ? <IconCheck width={12} height={12} /> : name.slice(0, 1)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-fg">{name}</span>
                      <span className="block text-[10px] text-fg-subtle">{person.role}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="mt-3 border-t border-border pt-3">
        <p className="mb-1.5 text-xs font-semibold text-fg">{t("inviteOutside")}</p>
        <div className="flex gap-1.5">
          <input
            className="input"
            placeholder={t("inviteePlaceholder")}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTyped(); } }}
          />
          <button
            type="button"
            className="btn shrink-0 bg-accent text-on-accent"
            disabled={draft.trim() === ""}
            onClick={addTyped}
          >
            {t("addInvitee")}
          </button>
        </div>
        <button
          type="button"
          onClick={onCopyGuestLink}
          className="btn btn-sm mt-2 w-full border border-border font-medium text-fg-muted hover:text-fg"
        >
          <IconCopy width={12} height={12} />
          {guestLinkCopied ? t("guestLinkCopied") : t("copyGuestLink")}
        </button>
      </div>

      {invitees.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border pt-3">
          {invitees.map((name) => (
            <span key={name} className="flex items-center gap-1 rounded-lg bg-surface-2 px-2 py-0.5 text-xs text-fg">
              {name}
              <button
                type="button"
                aria-label={t("removeInvitee", { name })}
                onClick={() => onChange(invitees.filter((v) => v !== name))}
                className="text-fg-subtle hover:text-danger"
              >
                <IconClose width={12} height={12} />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </Overlay>
  );
}
