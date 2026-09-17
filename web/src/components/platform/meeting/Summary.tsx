"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api, BffError } from "@/api/client";
import type { MeetingItem, MeetingRecord } from "@/api/types";
import { parseSummary, SummaryBody } from "@/components/echo/SummaryBody";
import { IconAsk, IconDownload, IconPencil, IconPrint, IconRetry } from "@/components/icons";
import { SkeletonLines } from "@/components/scaffold";
import { openAssistant } from "@/lib/assistantBus";
import { digits, formatDate } from "@/lib/format";
import { meetingPeople } from "@/lib/meetingPeople";
import { notifyError } from "@/lib/notify";

/**
 * خلاصهٔ جلسه — the meeting's SUMMARY, composed from facts the platform
 * already holds:
 *
 *   · حاضران      — the meeting's roster (host, members, anybody without
 *                   an account);
 *   · خلاصه       — the recording's current summary version, editable by
 *                   hand or through the assistant;
 *   · مصوبات      — `meeting_item` rows of kind `decision`;
 *   · اکشن‌آیتم‌ها — likewise, kind `action`; a section with no rows renders
 *     as its named absence, never as invented ones.
 *
 * Word = an HTML document handed to the browser as .doc (opens in Word);
 * PDF = the browser's own print dialog over the same document.
 *
 * THE APPROVAL LADDER IS GONE. What stood here was a صورت‌جلسه — a document
 * with a
 * lifecycle (draft → تأیید نهایی → امضا → بستن, migration 0146) and a status
 * rail to display it. This is a summary now: a thing you read, correct, and
 * export. The server still carries the 0146 columns and the PATCH doors that
 * write them; no surface reaches for them any more, and removing the schema
 * is a migration, not a component edit.
 */

/** HTML-escape for the exported document — every interpolated string is
    USER OR MODEL text, and document.write of a raw title is stored XSS */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/*
 * The heading-slicer that used to live here is GONE. It parsed the summary's
 * prose into decisions and action items, which was a SECOND implementation of
 * the one in the review panel — and that is exactly how this document came to
 * report "no decisions extracted" while the panel beside it displayed three.
 * The parser is on the server now (`sliceSummary` in core), it writes ROWS,
 * and every reader reads the same rows.
 */

export function SummaryTab({ meeting, callId }: {
  meeting: MeetingRecord;
  /** the meeting's recording, when it has one — where the summary lives */
  callId: string | null;
}) {
  const t = useTranslations("meetings");
  const locale = useLocale();
  /* bumped by «تولید دوباره» and by a saved edit — the document re-reads its
     own rows rather than the page being reloaded, so a person who has
     scrolled stays where they were */
  const [reloads, setReloads] = useState(0);
  const [rerunning, setRerunning] = useState(false);
  const [rerunNote, setRerunNote] = useState<string | null>(null);

  /*
   * THE DOCUMENT READS THE ROWS (user report, 2026-09-02: "i already added
   * action items and questions and all other but it not coming in the end
   * page").
   *
   * They were sliced out of the SUMMARY'S PROSE — the design 0160 replaced
   * everywhere else and did not replace here, so a person could add three
   * decisions on the review tab, watch them save, open this tab and read
   * "no decisions extracted". Two sources for one fact.
   *
   * `meeting_item` is the single source now. Anything the summarizer finds
   * arrives as rows badged `ai` in the same list, and this page cannot
   * disagree with the panel it was built from. A re-run APPENDS and refuses an
   * exact-body repeat, so pressing it over an unchanged transcript adds
   * nothing; a differently-worded claim is a second claim, for a person to
   * judge rather than for the write to discard.
   */
  const [items, setItems] = useState<MeetingItem[] | null | "failed">(null);
  useEffect(() => {
    let alive = true;
    void api.meetingItems(meeting.id)
      .then((r) => { if (alive) setItems(r); })
      .catch(() => { if (alive) setItems("failed"); });
    return () => { alive = false; };
  }, [meeting.id, reloads]);

  /*
   * THE ROSTER IS READ, NOT RE-DERIVED (2026-09-16).
   *
   * This list was composed here — host, then `attendees`, then `invitees`,
   * deduped by name — and it had to be corrected twice for the same reason
   * each time: the host is not in either column, because nobody invites
   * themselves (user report, 2026-09-02, "the attendees still does not count
   * me"), and then db/0202 moved colleagues out of `invitees` into accounts
   * while this kept reading the old field (2026-09-07).
   *
   * `meetingPeople` is that rule, and the live stage's people rail reads it
   * too. A third hand-rolled copy is how the document and the rail would come
   * to disagree about who was in a meeting — which is precisely the class of
   * defect the two corrections above already were.
   */
  const attendees = meetingPeople(meeting, locale).map((person) => person.name);

  /**
   * The CURRENT summary version, read here rather than passed down: this tab
   * already re-reads its own rows on «تولید دوباره» (see `reloads`), and a
   * summary handed in as a prop would go stale against them at exactly the
   * moment somebody regenerates. Same counter, same refetch, one truth.
   */
  const [summary, setSummary] = useState<string | null | "failed">(null);
  useEffect(() => {
    if (callId === null) { setSummary(""); return; }
    let alive = true;
    void api.getSummaries(callId)
      .then((versions) => {
        if (!alive) return;
        /* the LAST version is the current one — the ladder appends and moves
           the pointer, it never rewrites (invariant 4) */
        const current = versions[versions.length - 1];
        setSummary(current === undefined ? "" : current.body);
      })
      .catch(() => { if (alive) setSummary("failed"); });
    return () => { alive = false; };
  }, [callId, reloads]);

  /**
   * EDITING BY HAND.
   *
   * `editSummary` (0092) APPENDS a version authored `human` — it does not
   * overwrite the model's, which is why the draft is seeded from the current
   * body and saved whole rather than diffed. `draft === null` is "not
   * editing"; the empty string is a legitimate draft, so the two cannot share
   * a falsy check.
   */
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const rows = Array.isArray(items) ? items : [];
  const decisions = useMemo(
    () => rows.filter((r) => r.kind === "decision").map((r) => r.body),
    [rows],
  );
  const actions = useMemo(
    () => rows.filter((r) => r.kind === "action")
      .map((r) => (r.owner === null ? r.body : `${r.body} — ${r.owner}`)),
    [rows],
  );

  /**
   * ONE derivation, two consumers: the section on screen and the section in
   * the saved file. Two splits of the same prose is how a document comes to
   * disagree with the page it was exported from.
   *
   * `esc()` is applied at the point of USE and not here, because the screen
   * renders text nodes (React escapes) while the document is a string being
   * concatenated into HTML — escaping twice would put `&amp;` in front of a
   * reader.
   */
  /* The PARSED summary, shared by the screen and the exported document so a
     Word file cannot render as prose what the page renders as a heading.
     It replaced a split-on-blank-lines feeding one <p> per line, which put
     «**Next steps**» and «* Refresh the demo data» on screen, and into the
     download, as literal text. */
  const summaryBlocks = useMemo(
    () => parseSummary(typeof summary === "string" ? summary : ""),
    [summary],
  );

  const documentHtml = () => {
    const item = (x: string, i: number) => `<p>${i + 1}. ${esc(x)}</p>`;
    /* The exported document reads the SAME parse the screen does. It used to
       write one <p> per line, so a Word file downloaded from this page carried
       «**Next steps**» and «* Refresh the demo data» as literal text — the
       screen's defect, printed. Headings become <h3>, bullets a <ul>, numbered
       lines an <ol>; anything the dialect does not recognise is a paragraph,
       which is the parser's own rule and is why nothing can be dropped.
       Still escaped here and not in the parser: this is a string being
       concatenated into HTML, while the screen renders text nodes React escapes
       for it — escaping twice would put `&amp;` in front of a reader. */
    const summaryHtml = summaryBlocks
      .map((b) =>
        b.kind === "heading" ? `<h3>${esc(b.text)}</h3>`
          : b.kind === "bullets" ? `<ul>${b.items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`
            : b.kind === "numbered" ? `<ol>${b.items.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>`
              : `<p>${esc(b.text)}</p>`)
      .join("");
    return `<!doctype html><html dir="rtl" lang="fa"><head><meta charset="utf-8"><title>${esc(meeting.title)}</title></head><body style="font-family:Vazirmatn,Tahoma,sans-serif">
<h1>${esc(t("summaryDocTitle", { title: meeting.title }))}</h1>
<p>${esc(t("minutesDate"))}: ${esc(formatDate(meeting.scheduled_at, locale))}</p>
<h2>${esc(t("minutesAttendees"))}</h2>${attendees.length === 0 ? `<p>${esc(t("minutesNoAttendees"))}</p>` : attendees.map((n) => `<p>${esc(n)}</p>`).join("")}
<h2>${esc(t("minutesSummary"))}</h2>${summaryHtml === "" ? `<p>${esc(t("minutesNoSummary"))}</p>` : summaryHtml}
<h2>${esc(t("ext_decisions"))}</h2>${decisions.length === 0 ? `<p>${esc(t("minutesNoDecisions"))}</p>` : decisions.map(item).join("")}
<h2>${esc(t("ext_actions"))}</h2>${actions.length === 0 ? `<p>${esc(t("minutesNoActions"))}</p>` : actions.map(item).join("")}
</body></html>`;
  };

  const downloadWord = () => {
    const blob = new Blob(["﻿", documentHtml()], { type: "application/msword" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${meeting.title.slice(0, 60)}.doc`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const printPdf = () => {
    const win = window.open("", "_blank");
    if (win === null) return;
    win.document.write(documentHtml());
    win.document.close();
    win.print();
  };

  const saveDraft = () => {
    if (callId === null || draft === null) return;
    setSaving(true);
    void api.editSummary(callId, draft)
      .then(() => {
        setDraft(null);
        setReloads((n) => n + 1);
      })
      /*
       * A REFUSAL IS NOT A GLITCH. `echo.edit_summary` (db/0092) answers the
       * 0077 hierarchy — your own record, or one whose owner your role
       * strictly outranks — and it refuses as a NOT-FOUND on purpose, so the
       * door is not probeable. That reaches here as 403/404, and reporting it
       * as "try again" sends somebody to press a button that will refuse them
       * every time. The rule cannot be mirrored on this side: it needs the
       * OWNER's role, and the wire carries only their id.
       */
      .catch((error: unknown) => notifyError(
        error instanceof BffError && (error.status === 403 || error.status === 404)
          ? t("summaryEditRefused")
          : t("summarySaveFailed"),
      ))
      .finally(() => setSaving(false));
  };

  /**
   * «ویرایش با دستیار» — the assistant's own window, seeded with this
   * meeting named in the composer.
   *
   * A DRAFT, never a submission: `openAssistant` fills the box and stops, so
   * the person says what they actually want changed. This is the same door
   * the record page's «دربارهٔ این رکورد» uses — one bus, not a second
   * assistant rendered inside a tab.
   */
  const editWithAgent = () => {
    openAssistant({ draft: t("summaryAgentDraft", { title: meeting.title }) });
  };

  return (
    <div className="space-y-3">
      {/* ── the toolbar, ABOVE the document ──
          Word and PDF used to sit at the foot of a status rail beside the
          card, which put the two controls a reader reaches for most below
          the fold of a document as long as its meeting. */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {rerunNote !== null ? (
          <span className="me-auto text-caption text-fg-muted">{rerunNote}</span>
        ) : null}
        {/*
          «تولید دوباره» — THE SAME BUTTON, A DIFFERENT EXTRACTOR.

          It used to run the PROSE slicer over the finished summary, while the
          pipeline's own model pass was already reading the transcript. Two
          extractors writing one table, each de-duping only against its own
          wording: the same decision landed twice, once per press, in two
          phrasings that nothing could recognise as one fact.

          So this runs the SUMMARIZER's third pass — the extraction (0209) —
          and ONLY that pass: one model read of the transcript, through
          `POST /api/calls/:id/decisions`. One extractor, one vocabulary, and
          `recordExtracted` REPLACES the meeting's extracted rows rather than
          adding to them — pressing this twice cannot accumulate. Nothing a
          person typed is touched: the replace is scoped to `source = 'ai'`, and
          a row the new pass restates keeps its id and its tick.

          THE COUNT IS BACK, and it counts the RESULT. A regenerate that
          restates a perfectly good ledger added nothing and would have reported
          «۰», which reads as "that did not work"; `items` is what the meeting
          now carries from the recording, which is the answer the press asked
          for. `claims: null` is the other nothing — nobody read the meeting,
          because the pass could not run or answered unreadably — and it is the
          one failure this button has ever had a word for.

          It does NOT regenerate the summary. That is a second full model pass
          the press never used to cost, and the summary on screen is not what
          anybody is asking to have rewritten by pressing this.
        */}
        {meeting.call_id !== null ? (
          <button
            type="button"
            className="btn btn-sm gap-1.5 border border-border font-medium text-fg-muted hover:text-fg"
            disabled={rerunning}
            onClick={() => {
              const recording = meeting.call_id;
              if (recording === null) return;
              setRerunning(true);
              setRerunNote(null);
              void api.extractCallDecisions(recording)
                .then((r) => {
                  if (r.claims === null) {
                    /* nobody read the meeting: the pass could not run or
                       answered unreadably. Reporting that as «۰ مورد» would
                       tell somebody their meeting decided nothing. */
                    setRerunNote(t("rerunFailed"));
                    return;
                  }
                  setRerunNote(t("rerunAdded", { n: digits(r.items, locale) }));
                  setReloads((n) => n + 1);
                })
                .catch(() => setRerunNote(t("rerunFailed")))
                .finally(() => setRerunning(false));
            }}
          >
            <IconRetry width={12} height={12} />
            {rerunning ? t("rerunning") : t("rerun")}
          </button>
        ) : null}
        <button type="button" onClick={downloadWord}
          className="btn btn-sm gap-1.5 border border-border bg-surface font-medium text-fg hover:bg-border">
          <IconDownload width={12} height={12} />
          Word
        </button>
        <button type="button" onClick={printPdf}
          className="btn btn-sm gap-1.5 border border-border bg-surface font-medium text-fg hover:bg-border">
          <IconPrint width={12} height={12} />
          PDF
        </button>
      </div>

      <article className="tile p-6" aria-label={t("tabSummary")}>
        <header className="border-b border-border pb-3 text-center">
          <h2 className="text-lg font-bold text-fg">{t("summaryDocTitle", { title: meeting.title })}</h2>
          <p className="mt-1 text-caption text-fg-subtle">
            <span className="badge-num" dir="ltr">MTG-{meeting.id.slice(0, 8)}</span>
            {" · "}
            {t("minutesDate")}: {formatDate(meeting.scheduled_at, locale)}
          </p>
        </header>

        <section className="mt-4">
          <h3 className="text-sm font-bold text-accent">{digits(1, locale)}. {t("minutesAttendees")}</h3>
          {attendees.length === 0 ? (
            <p className="mt-1.5 text-sm text-fg-muted">{t("minutesNoAttendees")}</p>
          ) : (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {attendees.map((name) => (
                <span key={name} className="rounded-lg bg-surface-2 px-2 py-1 text-xs text-fg">{name}</span>
              ))}
            </div>
          )}
        </section>

        {/* THE SUMMARY (user report, 2026-09-03). It sits above the outcomes
            on purpose: a reader who was not in the room needs the account of
            what was said before the list of what was decided. Its own loading
            state, because it is its own read — the rows arriving does not mean
            the summary has. */}
        <section className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-accent">{digits(2, locale)}. {t("minutesSummary")}</h3>
            {/* the two edits, side by side and only while there is a record to
                write against: by hand, and by asking */}
            {callId !== null && draft === null ? (
              <div className="flex items-center gap-1.5">
                <button type="button"
                  onClick={() => setDraft(typeof summary === "string" ? summary : "")}
                  disabled={typeof summary !== "string"}
                  className="btn btn-sm gap-1.5 border border-border font-medium text-fg-muted hover:text-fg disabled:opacity-50">
                  <IconPencil width={12} height={12} />
                  {t("summaryEdit")}
                </button>
                <button type="button" onClick={editWithAgent}
                  className="btn btn-sm gap-1.5 border border-accent font-medium text-accent hover:bg-accent-soft">
                  <IconAsk width={12} height={12} />
                  {t("summaryEditWithAgent")}
                </button>
              </div>
            ) : null}
          </div>

          {draft !== null ? (
            <div className="mt-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={12}
                aria-label={t("minutesSummary")}
                className="w-full rounded-xl border border-border bg-surface p-3 text-sm leading-7 text-fg outline-none focus:border-accent"
              />
              <div className="mt-2 flex items-center justify-end gap-2">
                <button type="button" onClick={() => setDraft(null)} disabled={saving}
                  className="btn btn-sm border border-border font-medium text-fg-muted hover:text-fg disabled:opacity-50">
                  {t("summaryCancel")}
                </button>
                <button type="button" onClick={saveDraft} disabled={saving}
                  className="btn btn-sm bg-accent font-semibold text-on-accent shadow-accent hover:opacity-90 disabled:opacity-50">
                  {saving ? t("summarySaving") : t("summarySave")}
                </button>
              </div>
            </div>
          ) : summary === null ? <SkeletonLines lines={3} className="mt-1.5" />
            : summary === "failed" ? <p className="mt-1.5 text-sm text-fg-muted">{t("minutesSummaryFailed")}</p>
              : summaryBlocks.length === 0
                ? <p className="mt-1.5 text-sm text-fg-muted">{t("minutesNoSummary")}</p>
                : (
                  /* SummaryBody, not a paragraph per line.
                     The models write a small markdown dialect — «**Next steps**»,
                     «* Refresh the demo data» — and splitting on blank lines and
                     wrapping each in a <p> put the asterisks on screen: the
                     product's most-read document rendering its own headings as
                     literal punctuation. `SummaryBody` is the parser for exactly
                     that dialect and the call page has rendered summaries with it
                     since 2026-08-24; this surface was simply never moved onto
                     it. Consuming the answer beats writing a second one — and a
                     second markdown parser in the same product is two dialects
                     that drift the first time a model changes its habits. */
                  <SummaryBody text={typeof summary === "string" ? summary : ""} />
                )}
        </section>

        <section className="mt-4">
          <h3 className="text-sm font-bold text-accent">{digits(3, locale)}. {t("ext_decisions")}</h3>
          {items === null ? <SkeletonLines lines={2} className="mt-1.5" />
            : decisions.length === 0 ? <p className="mt-1.5 text-sm text-fg-muted">{t("minutesNoDecisions")}</p>
              : (
                <ol className="mt-1.5 space-y-1.5">
                  {decisions.map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm leading-6 text-fg">
                      <span className="badge-num mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md bg-accent-soft text-caption text-accent">
                        {digits(i + 1, locale)}
                      </span>
                      {item}
                    </li>
                  ))}
                </ol>
              )}
        </section>

        <section className="mt-4">
          <h3 className="text-sm font-bold text-accent">{digits(4, locale)}. {t("ext_actions")}</h3>
          {items === null ? <SkeletonLines lines={2} className="mt-1.5" />
            : actions.length === 0 ? <p className="mt-1.5 text-sm text-fg-muted">{t("minutesNoActions")}</p>
              : (
                <ul className="mt-1.5 space-y-1.5">
                  {actions.map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm leading-6 text-fg">
                      <span className="mt-2 h-1 w-3 shrink-0 rounded-full bg-fg-subtle" aria-hidden />
                      {item}
                    </li>
                  ))}
                </ul>
              )}
        </section>
      </article>
    </div>
  );
}
