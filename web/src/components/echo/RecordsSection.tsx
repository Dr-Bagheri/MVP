"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/routing";
import { api } from "@/api/client";
import { notify } from "@/lib/notify";
import { useRefreshEpoch } from "@/lib/refreshBus";
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
export function RecordsSection({ view = "live" }: { view?: "live" | "archive" }) {
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
  /** 0085 (user ruling): deleting a RECORD asks to confirm again and takes
      a reason, which lands in the deletion ledger the admins read. */
  const [deleting, setDeleting] = useState<null | { id: string; reason: string }>(null);
  const [renameDraft, setRenameDraft] = useState("");
  /** Bulk actions (user directive, 2026-08-23): select several rows, then
      archive them together or delete them under ONE typed reason. Only
      rows this person may edit are selectable — a checkbox on a row the
      server would refuse is a promise the click can't keep. */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState<null | { reason: string }>(null);
  /** Tags (0086): filter chip + inline whole-set editor. The column exists
      only after the migration; until the wire carries `tags`, no tag UI
      renders — a control for a column that does not exist would read as
      wired and do nothing. */
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [taggingId, setTaggingId] = useState<string | null>(null);
  const [tagsDraft, setTagsDraft] = useState("");
  /* A row action's failure is still said OUT LOUD — `act` used to swallow
     them — but through the notification system now (orb toast + top bell),
     not an inline line in the table (user directive, 2026-08-21). */

  /* refresh bus: a record mutation anywhere — button or agent — bumps this */
  const callsEpoch = useRefreshEpoch("calls");

  async function load() {
    setCalls(await api.listCalls({ includeArchived: view === "archive" }));
  }

  useEffect(() => {
    void api.me().then(setMe);
    // the wire sends owner_id only — names come from the member list
    void api.members().then(setMembers).catch(() => setMembers([]));
    void load();
    // a view change or an external mutation invalidates the selection —
    // acting on rows that may no longer be in front of the person
    setSelected(new Set());
    setBulkDeleting(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- view is fixed per mount
  }, [view, callsEpoch]);

  /**
   * The PIPELINE moves statuses server-side (user report, 2026-08-23:
   * "processing → ready needs a full page refresh"). The refresh bus only
   * hears CLIENT writes, so while any row sits in a WORKER-moved status
   * the table re-reads itself every few seconds — and stops the moment
   * everything is terminal. `recording` is deliberately not in the set:
   * only client actions move it, and those announce; polling on it would
   * spin forever on an abandoned take.
   */
  useEffect(() => {
    const WORKER_MOVED = new Set(["processing", "linking", "summarizing"]);
    if (!calls?.some((c) => WORKER_MOVED.has(c.status))) return;
    const timer = setInterval(() => { void load(); }, 5000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load is stable per mount
  }, [calls]);

  /** id → display name, falling back to the id rather than to `undefined`. */
  function ownerName(id: string): string {
    return members.find((m) => m.id === id)?.display_name ?? id;
  }

  /**
   * The rows this person may change (0077 hierarchy, user ruling
   * 2026-08-22): their own, or one whose owner their role strictly
   * outranks — owner > admin > member. Peers are walled both ways. The
   * WALL is the database's guard trigger; this only decides which action
   * buttons to show, and when the owner's rank is unknown it shows
   * nothing rather than promising a click the server will refuse.
   */
  function mayEdit(call: Call): boolean {
    if (!me) return false;
    if (call.owner_id === me.id) return true;
    const rank: Record<string, number> = { owner: 3, admin: 2, member: 1 };
    const ownerRole = members.find((m) => m.id === call.owner_id)?.role;
    if (!ownerRole) return false;
    return (rank[me.role] ?? 0) > (rank[ownerRole] ?? 0);
  }

  async function act(fn: () => Promise<unknown>): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      await load();
    } catch {
      // the refusal is visible AND the list re-syncs to what the server
      // actually holds — a stale row beats a silently wrong one
      notify(tCommon("actionFailed"), "warn");
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

  const tagsReady =
    calls !== null && calls.length > 0 && calls[0] !== undefined && "tags" in calls[0];
  const allTags = tagsReady
    ? [...new Set(live.flatMap((call) => call.tags ?? []))].sort()
    : [];
  const shown =
    tagFilter === null ? live : live.filter((call) => call.tags?.includes(tagFilter));

  const selectable = shown.filter((call) => mayEdit(call));
  const allSelected =
    selectable.length > 0 && selectable.every((call) => selected.has(call.id));

  async function saveTags(call: Call): Promise<void> {
    const tags = [...new Set(
      tagsDraft.split(/[,،]/).map((t) => t.trim()).filter((t) => t !== ""),
    )].slice(0, 10);
    setTaggingId(null);
    await act(async () => {
      try {
        await api.setCallTags(call.id, tags);
      } catch (cause) {
        const { status, detail } = cause as { status?: number; detail?: string };
        if (status === 409 || detail === "not_migrated") {
          notify(t("tagsNotReady"), "warn");
          return;
        }
        throw cause;
      }
    });
  }

  function toggleSelect(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** One action over every selected row; failures are counted, not hidden,
      and the reload shows what the server actually holds. */
  async function bulk(perRow: (id: string) => Promise<unknown>): Promise<void> {
    if (busy || selected.size === 0) return;
    setBusy(true);
    const ids = [...selected];
    const results = await Promise.allSettled(ids.map((id) => perRow(id)));
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed > 0) {
      notify(
        t("bulkFailed", { n: digits(failed, locale), total: digits(ids.length, locale) }),
        "warn",
      );
    }
    setSelected(new Set());
    setBulkDeleting(null);
    await load().catch(() => undefined);
    setBusy(false);
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="h-page">{t(view === "archive" ? "archiveTitle" : "title")}</h2>
      </div>

      {/* tag filter chips — only when tags exist to filter by */}
      {allTags.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-pressed={tagFilter === null}
            onClick={() => setTagFilter(null)}
            className={`h-7 rounded-full px-2.5 text-xs transition-colors ${
              tagFilter === null
                ? "bg-accent-soft font-semibold text-accent"
                : "bg-surface-2 text-fg-muted hover:text-fg"
            }`}
          >
            {t("allTags")}
          </button>
          {allTags.map((tag) => (
            <button
              key={tag}
              type="button"
              aria-pressed={tagFilter === tag}
              onClick={() => setTagFilter((prev) => (prev === tag ? null : tag))}
              className={`h-7 rounded-full px-2.5 text-xs transition-colors ${
                tagFilter === tag
                  ? "bg-accent-soft font-semibold text-accent"
                  : "bg-surface-2 text-fg-muted hover:text-fg"
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      ) : null}

      {/* the bulk bar — appears only while a selection exists */}
      {selected.size > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-4 py-2 text-sm">
          <span className="text-fg">
            {t("selectedCount", { n: digits(selected.size, locale) })}
          </span>
          <button
            className="btn-secondary h-8 min-h-0 px-3 text-xs"
            disabled={busy}
            onClick={() => void bulk((id) => api.setArchived(id, view === "live"))}
          >
            {view === "live" ? t("archive") : t("unarchive")}
          </button>
          {bulkDeleting !== null ? (
            <span className="flex items-center gap-2">
              <input
                className="input h-8 min-h-0 w-44 py-0 text-xs"
                autoFocus
                placeholder={t("deleteReasonHint")}
                value={bulkDeleting.reason}
                onChange={(e) => setBulkDeleting({ reason: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Escape") setBulkDeleting(null); }}
              />
              <button
                className="btn-danger h-8 min-h-0 px-3 text-xs"
                disabled={busy || bulkDeleting.reason.trim().length < 3}
                onClick={() => {
                  const reason = bulkDeleting.reason.trim();
                  void bulk((id) => api.deleteCall(id, reason));
                }}
              >
                {t("confirmDelete")}
              </button>
              <button
                className="text-xs text-fg-muted underline-offset-2 hover:underline"
                onClick={() => setBulkDeleting(null)}
              >
                {tCommon("cancel")}
              </button>
            </span>
          ) : (
            <button
              className="btn-danger h-8 min-h-0 px-3 text-xs"
              disabled={busy}
              onClick={() => setBulkDeleting({ reason: "" })}
            >
              {t("delete")}
            </button>
          )}
          <button
            className="text-xs text-fg-muted underline-offset-2 hover:underline"
            onClick={() => {
              setSelected(new Set());
              setBulkDeleting(null);
            }}
          >
            {t("clearSelection")}
          </button>
        </div>
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
                  <th className="w-10 px-3 py-3">
                    {selectable.length > 0 ? (
                      <input
                        type="checkbox"
                        aria-label={t("selectAll")}
                        checked={allSelected}
                        onChange={() =>
                          setSelected(
                            allSelected
                              ? new Set()
                              : new Set(selectable.map((call) => call.id)),
                          )
                        }
                      />
                    ) : null}
                  </th>
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
                {shown.map((call) => (
                  <tr
                    key={call.id}
                    /* the whole ROW is the way in (user directive) — the
                       interactive cells stop the bubble so a toggle is never
                       also a navigation */
                    className="row-link border-b border-border last:border-0"
                    onClick={() => router.push(`/calls/${call.id}`)}
                  >
                    <td className="w-10 px-3 py-3" onClick={(e) => e.stopPropagation()}>
                      {mayEdit(call) ? (
                        <input
                          type="checkbox"
                          aria-label={t("selectRow", { title: call.title || t("untitled") })}
                          checked={selected.has(call.id)}
                          onChange={() => toggleSelect(call.id)}
                        />
                      ) : null}
                    </td>
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
                        {(call.tags ?? []).map((tag) => (
                          <span key={tag} className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-fg-muted">
                            {tag}
                          </span>
                        ))}
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
                          {/* An unfinished take continues where its audio
                              ends (user directive, 2026-08-20). OWNER-only,
                              stricter than mayEdit: resuming records through
                              the resumer's OWN microphone into the take —
                              an admin "resuming" a colleague's call would
                              splice their voice into someone else's
                              recording. */}
                          {call.status === "recording" && call.owner_id === me?.id ? (
                            <Link
                              href={`/echo/record?resume=${call.id}`}
                              className="font-semibold text-accent underline-offset-2 hover:underline"
                            >
                              {t("resumeCall")}
                            </Link>
                          ) : null}
                          {/* the RETRY door (user directive, 2026-08-22:
                              "we got the voice — add an option to retry"):
                              a failed call re-enters the pipeline where its
                              artifacts say it stopped — parts without
                              transcripts re-transcribe, otherwise straight
                              to speakers+summary. Failed rows only. */}
                          {call.status === "failed" ? (
                            <button
                              className="font-semibold text-accent underline-offset-2 hover:underline"
                              disabled={busy}
                              onClick={() =>
                                void act(async () => {
                                  await api.retryCall(call.id);
                                  notify(t("retryStarted"));
                                })
                              }
                            >
                              {t("retry")}
                            </button>
                          ) : null}
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
                          {/* tags (0086): whole-set inline editor, only when
                              the wire carries the column */}
                          {tagsReady ? (
                            taggingId === call.id ? (
                              <span className="flex items-center gap-2">
                                <input
                                  className="input h-8 min-h-0 w-44 py-0 text-xs"
                                  autoFocus
                                  placeholder={t("tagsHint")}
                                  value={tagsDraft}
                                  onChange={(e) => setTagsDraft(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") void saveTags(call);
                                    if (e.key === "Escape") setTaggingId(null);
                                  }}
                                />
                                <button
                                  className="text-accent underline-offset-2 hover:underline"
                                  disabled={busy}
                                  onClick={() => void saveTags(call)}
                                >
                                  {tCommon("save")}
                                </button>
                              </span>
                            ) : (
                              <button
                                className="text-fg-muted underline-offset-2 hover:underline"
                                disabled={busy}
                                onClick={() => {
                                  setTaggingId(call.id);
                                  setTagsDraft((call.tags ?? []).join("، "));
                                }}
                              >
                                {t("tags")}
                              </button>
                            )
                          ) : null}
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
                          {/* REVERSED 2026-08-23 (user ruling — supersedes the earlier
                              one-click verdict): a record's deletion confirms AGAIN and
                              takes a REASON, which the deletion ledger keeps (0085). */}
                          {deleting?.id === call.id ? (
                            <span className="flex items-center gap-2">
                              <input
                                className="input h-8 min-h-0 w-44 py-0 text-xs"
                                autoFocus
                                placeholder={t("deleteReasonHint")}
                                value={deleting.reason}
                                onChange={(e) => setDeleting({ id: call.id, reason: e.target.value })}
                                onKeyDown={(e) => { if (e.key === "Escape") setDeleting(null); }}
                              />
                              <button
                                className="font-semibold text-danger underline-offset-2 hover:underline"
                                disabled={busy || deleting.reason.trim().length < 3}
                                onClick={() => {
                                  const reason = deleting.reason.trim();
                                  setDeleting(null);
                                  void act(() => api.deleteCall(call.id, reason));
                                }}
                              >
                                {t("confirmDelete")}
                              </button>
                              <button
                                className="text-fg-muted underline-offset-2 hover:underline"
                                onClick={() => setDeleting(null)}
                              >
                                {tCommon("cancel")}
                              </button>
                            </span>
                          ) : (
                            <button
                              className="text-danger/80 underline-offset-2 hover:text-danger hover:underline"
                              disabled={busy}
                              onClick={() => setDeleting({ id: call.id, reason: "" })}
                            >
                              {t("delete")}
                            </button>
                          )}
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
