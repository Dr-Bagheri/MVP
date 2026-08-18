"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/routing";
import { api } from "@/api/client";
import type { Call, Me, User } from "@/api/types";
import { Card, EmptyState, StatusChip } from "@/components/ui";
// `purgeDaysLeft` is deliberately NOT imported: the purge countdown belongs to
// DeletedCallsCard now that soft-deleted rows have their own card, and a second
// copy of that arithmetic beside the table is how two countdowns disagree.
import { formatDate, formatDuration, digits } from "@/lib/format";
import { DeletedCallsCard } from "./DeletedCallsCard";

/**
 * The calls list, lifted out of `/calls` for the merged Echo surface.
 *
 * It owns its own loading rather than taking rows as a prop, because the
 * row actions and the scope switch both re-read — a parent holding the data
 * would have to thread a refresh callback through for no gain.
 *
 * `view` (user directive): archived calls are a SECTION in the menu, not a
 * toggle on this table — "live" shows working calls, "archive" shows the
 * same table (same details, same actions) over the archived ones, and
 * archiving a row moves it from one place to the other on the next load.
 *
 * **`DeletedCallsCard` renders here, admin-only.** M25 puts it with Echo
 * because it is call-domain, and the restore control is ruled admin-only
 * (deletion should feel like deletion). The gate is the same one the api
 * enforces; this is not the authority, just the screen agreeing with it.
 */
export function CallsSection({ view = "live" }: { view?: "live" | "archive" }) {
  const t = useTranslations("calls");
  const tStatus = useTranslations("status");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [calls, setCalls] = useState<Call[] | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [members, setMembers] = useState<User[]>([]);
  // ---- row actions (the calls CRUD, user directive 2026-08-16) ----
  const [busy, setBusy] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  /** A row action's failure, said out loud — `act` used to swallow them,
   *  and a refused delete looked exactly like "the table did not refresh"
   *  (user report, on precisely that symptom). */
  const [actionError, setActionError] = useState<string | null>(null);

  async function load() {
    setCalls(await api.listCalls({ includeArchived: view === "archive" }));
  }

  useEffect(() => {
    void api.me().then(setMe);
    // the wire sends owner_id only — names come from the member list
    void api.members().then(setMembers).catch(() => setMembers([]));
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- view is fixed per mount
  }, [view]);

  /** id → display name, falling back to the id rather than to `undefined`. */
  function ownerName(id: string): string {
    return members.find((m) => m.id === id)?.display_name ?? id;
  }

  /** The rows this person may change: their own, or any as an admin (M11). */
  function mayEdit(call: Call): boolean {
    return call.owner_id === me?.id || me?.role === "admin" || me?.role === "owner";
  }

  async function act(fn: () => Promise<unknown>): Promise<void> {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      await load();
    } catch {
      // the refusal is visible AND the list re-syncs to what the server
      // actually holds — a stale row beats a silently wrong one
      setActionError(tCommon("actionFailed"));
      await load().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  /*
   * Soft-deleted rows are shown in their OWN card, not mixed into the table.
   * `api.listCalls` only returns them to an admin, so a member's list is
   * unchanged — and the split is what stops a deleted call reading as a normal
   * one with a badge. The archive view is the same split one axis over:
   * archived rows live THERE, so the live table never needs an "(archived)"
   * badge again.
   */
  const deleted = (calls ?? []).filter((call) => call.deleted_at !== null);
  const live = (calls ?? []).filter(
    (call) =>
      call.deleted_at === null
      && (view === "archive" ? call.archived_at !== null : call.archived_at === null),
  );

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="h-page">{t(view === "archive" ? "archiveTitle" : "title")}</h2>
      </div>

      {actionError ? (
        <p role="alert" className="text-sm text-danger">
          {actionError}
        </p>
      ) : null}

      {calls === null ? null : live.length === 0 ? (
        <Card>
          <EmptyState text={t(view === "archive" ? "emptyArchive" : "empty")} />
        </Card>
      ) : (
        <Card className="!p-0">
          {/*
            The table scrolls INSIDE the card rather than being clipped by it.
            Without this, ~198px of every row was unreachable at 375 — and it
            was invisible to the obvious test: clipping keeps
            `document.scrollWidth` equal to the viewport, so a page-level
            overflow check certifies the screen as clean while a third of each
            row cannot be read. `min-w-max` makes the table keep its width and
            scroll, instead of crushing its columns to fit.
          */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-max">
              <thead>
                <tr className="border-b border-border">
                  <th className="table-head px-4 py-3">{t("columnTitle")}</th>
                  <th className="table-head px-4 py-3">{t("columnOwner")}</th>
                  <th className="table-head px-4 py-3">{t("columnDate")}</th>
                  <th className="table-head px-4 py-3">{t("columnLength")}</th>
                  <th className="table-head px-4 py-3">{t("columnScope")}</th>
                  <th className="table-head px-4 py-3">{t("columnStatus")}</th>
                  <th className="table-head px-4 py-3">{t("columnActions")}</th>
                </tr>
              </thead>
              <tbody>
                {live.map((call) => (
                  <tr
                    key={call.id}
                    /* the whole ROW is the way in (user directive) — the
                       interactive cells stop the bubble so a toggle is never
                       also a navigation */
                    className="row-link border-b border-border last:border-0"
                    onClick={() => router.push(`/calls/${call.id}`)}
                  >
                    <td
                      className="px-4 py-3"
                      onClick={(e) => {
                        // renaming happens IN this cell; a click there must
                        // not also be a navigation
                        if (renamingId === call.id) e.stopPropagation();
                      }}
                    >
                      {renamingId === call.id ? (
                        <span className="flex items-center gap-1.5">
                          <input
                            className="input h-8 min-h-0 w-44 py-0 text-sm"
                            value={renameDraft}
                            autoFocus
                            onChange={(e) => setRenameDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                void act(() => api.setCallTitle(call.id, renameDraft.trim()));
                                setRenamingId(null);
                              }
                              if (e.key === "Escape") setRenamingId(null);
                            }}
                          />
                          <button
                            className="text-xs text-accent underline-offset-2 hover:underline"
                            disabled={busy}
                            onClick={() => {
                              void act(() => api.setCallTitle(call.id, renameDraft.trim()));
                              setRenamingId(null);
                            }}
                          >
                            {tCommon("save")}
                          </button>
                        </span>
                      ) : (
                        <Link
                          href={`/calls/${call.id}`}
                          className="font-medium text-fg hover:text-accent"
                        >
                          {/* an empty title renders as a WORD, not as a blank
                              link nobody can click on purpose */}
                          {call.title.trim() === "" ? (
                            <span className="text-fg-muted">{t("untitled")}</span>
                          ) : (
                            call.title
                          )}
                        </Link>
                      )}
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        {/* `parts` is not on the wire yet — absent means "not
                            told", which renders as nothing rather than as "1
                            part". */}
                        {(call.parts?.length ?? 0) > 1 ? (
                          <span className="text-xs text-fg-muted">
                            {t("parts", { count: digits(call.parts?.length ?? 0, locale) })}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-fg-muted">
                      {/* the wire carries owner_id only; the name is resolved
                          from the member list where we have it */}
                      {call.owner_id === me?.id
                        ? tCommon("you")
                        : (call.owner_name ?? ownerName(call.owner_id))}
                    </td>
                    <td className="px-4 py-3 text-sm text-fg-muted">
                      {formatDate(call.started_at, locale)}
                    </td>
                    <td className="px-4 py-3 text-sm text-fg-muted">
                      {/* null duration is UNKNOWN, not zero — live rows carry
                          null today. Saying «نامعلوم» is the honest render; a
                          dash would read as "nothing to show". */}
                      {call.duration_ms === null
                        ? t("durationUnknown")
                        : formatDuration(call.duration_ms / 1000, locale)}
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      {/* an ON/OFF switch (user directive): off = private,
                          on = the whole organization — the state is visible
                          from the position, not just the word */}
                      <span className="flex items-center gap-2">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={call.scope === "org"}
                          aria-label={call.scope === "org" ? t("makePrivate") : t("makeOrg")}
                          /* FLEX places the knob, not absolute offsets: the
                             first version's start-* arithmetic parked the
                             circle half outside the track in RTL (user
                             report). justify-start/end follow the document
                             direction by definition — there is no offset to
                             get wrong. */
                          className={`tap flex h-5 w-9 shrink-0 items-center rounded-full px-0.5 transition-colors ${
                            call.scope === "org"
                              ? "justify-end bg-accent"
                              : "justify-start border border-border-strong bg-surface-2"
                          }`}
                          onClick={async () => {
                            await api.setScope(call.id, call.scope === "org" ? "private" : "org");
                            void load();
                          }}
                        >
                          <span
                            className={`h-3.5 w-3.5 rounded-full ${
                              call.scope === "org" ? "bg-on-accent" : "bg-fg-muted"
                            }`}
                          />
                        </button>
                        <span className="text-xs text-fg-muted">
                          {call.scope === "org" ? t("scopeOrg") : t("scopePrivate")}
                        </span>
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusChip status={call.status} label={tStatus(call.status)} />
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      {mayEdit(call) ? (
                        <span className="flex items-center gap-3 text-xs">
                          <button
                            className="text-fg-muted underline-offset-2 hover:underline"
                            disabled={busy}
                            onClick={() => {
                              setRenamingId(call.id);
                              setRenameDraft(call.title);
                            }}
                          >
                            {t("rename")}
                          </button>
                          {/* archiving/restoring MOVES the row between the
                              two sections — the reload drops it from this
                              view, which is the move made visible */}
                          <button
                            className="text-fg-muted underline-offset-2 hover:underline"
                            disabled={busy}
                            onClick={() =>
                              void act(() => api.setArchived(call.id, call.archived_at === null))
                            }
                          >
                            {call.archived_at === null ? t("archive") : t("unarchive")}
                          </button>
                          <button
                            className="text-fg-muted underline-offset-2 hover:underline"
                            disabled={busy}
                            /* lands on the call with BOTH translations firing
                               (?translate=1) — summary and transcript */
                            onClick={() => router.push(`/calls/${call.id}?translate=1`)}
                          >
                            {t("translate")}
                          </button>
                          {/* ONE click (user verdict: the two-step read as
                              an error). The 30-day restore window is the
                              real safety net, not a second press. */}
                          <button
                            className="text-danger/80 underline-offset-2 hover:text-danger hover:underline"
                            disabled={busy}
                            onClick={() => void act(() => api.deleteCall(call.id))}
                          >
                            {t("delete")}
                          </button>
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/*
        Rendered only for an admin AND only when there is something in it.
        Not "always visible, empty when clean": a permanently empty «حذف‌شده‌ها»
        card on every visit trains people to ignore the one place a pending
        purge would announce itself.
      */}
      {view === "live" && me?.role === "admin" && deleted.length > 0 ? (
        <DeletedCallsCard deleted={deleted} onChanged={() => void load()} />
      ) : null}
    </section>
  );
}
