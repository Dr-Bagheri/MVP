"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api, BffError } from "@/api/client";
import type { MeetingItem, MeetingRecord, MeetingSignaturesRecord, Me, Org } from "@/api/types";
import { parseSummary, SummaryBody } from "@/components/echo/SummaryBody";
import { IconAsk, IconDownload, IconPencil, IconPrint, IconRetry, IconUpload } from "@/components/icons";
import { KebabMenu } from "@/components/rowActions";
import { SkeletonLines } from "@/components/scaffold";
import { openAssistant } from "@/lib/assistantBus";
import { digits, formatDate, personName } from "@/lib/format";
import { meetingPeople } from "@/lib/meetingPeople";
import { notifyError } from "@/lib/notify";
import { LetterheadDialog } from "./LetterheadDialog";
import { minutesDocument, minutesWordFile } from "./minutesDocument";
import { forgetLetterhead, letterheadForDocument, signaturesForDocument } from "@/lib/minutesFile";
import { deriveSignature, SIGNATURE_ACCEPT, SignatureError } from "@/lib/signatureImage";

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

/*
 * The document itself moved to `minutesDocument.ts` (2026-09-17). It is no
 * longer a string this component happens to build: it is a صورت‌جلسه that has
 * to come out the same through two readers — Word and the browser's print —
 * and, when the organisation has uploaded a letterhead, land inside the clear
 * area of their own paper. That is a thing with rules, so it has a file and
 * its own tests.
 */

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
  const people = meetingPeople(meeting, locale);
  const attendees = people.map((person) => person.name);

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

  /*
   * THE ORGANISATION, for its LETTERHEAD (db/0228) — and who is reading, so
   * the ⋯ offers uploading one only to somebody the server would let upload
   * it. An admin-only row drawn for a member is a promise the product will
   * not keep; a missing read is not a refusal, so both start as null and the
   * entry simply is not there until the answer arrives.
   */
  const [org, setOrg] = useState<Org | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [orgReads, setOrgReads] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    void api.org().then((o) => { if (alive) setOrg(o); }).catch(() => { if (alive) setOrg(null); });
    return () => { alive = false; };
  }, [orgReads]);
  useEffect(() => {
    let alive = true;
    void api.me().then((u) => { if (alive) setMe(u); }).catch(() => { if (alive) setMe(null); });
    return () => { alive = false; };
  }, []);
  const isAdmin = me !== null && (me.role === "admin" || me.role === "owner");

  /*
   * THE SIGNATURES (db/0229) — who has signed, and the three facts about the
   * reader that decide the one control at the foot of the document: may they
   * sign (host or roster), is there a signature on file, have they signed.
   * Read from the server rather than derived here: the roster is on screen,
   * but "on file" is a fact only their own row answers, and drawing a sign
   * button for somebody the policy would refuse is a promise the product
   * will not keep.
   */
  const [sigs, setSigs] = useState<MeetingSignaturesRecord | null | "failed">(null);
  const [signing, setSigning] = useState(false);
  const [signNote, setSignNote] = useState<string | null>(null);
  const signatureInput = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    let alive = true;
    void api.meetingSignatures(meeting.id)
      .then((r) => { if (alive) setSigs(r); })
      .catch(() => { if (alive) setSigs("failed"); });
    return () => { alive = false; };
  }, [meeting.id]);

  /* a refusal names WHICH nothing: no signature on file is fixable in the
     profile, already signed is the primary key, and anything else is the
     generic line — the sentences are the catalogue's, keyed by the code */
  const signFailure = (error: unknown): string => {
    if (error instanceof SignatureError) return t(error.code);
    const code = error instanceof BffError ? error.code : undefined;
    if (code === "no_signature_on_file" || code === "already_signed") return t(`sign_${code}`);
    if (code === "signature_too_large" || code === "signature_not_an_image") return t(code);
    return t("signFailed");
  };

  /** SIGN with the signature on file, or with a picture chosen right here
      (`file`) — one request either way, the server files and signs together */
  const sign = (file?: File) => {
    setSigning(true);
    setSignNote(null);
    void (file === undefined ? Promise.resolve(undefined) : deriveSignature(file).then((d) => d.base64))
      .then((base64) => api.signMeeting(meeting.id, base64))
      .then((record) => {
        setSigs(record);
        setSignNote(t("signedByYou"));
      })
      .catch((error: unknown) => setSignNote(signFailure(error)))
      .finally(() => setSigning(false));
  };

  const withdrawSignature = () => {
    setSigning(true);
    setSignNote(null);
    void api.withdrawMeetingSignature(meeting.id)
      .then((record) => setSigs(record))
      .catch(() => setSignNote(t("signFailed")))
      .finally(() => setSigning(false));
  };

  /* «آماده‌سازی متن با دستیار» — the composed prose lands in the EDITOR, not
     in the file: a model's paragraph goes into a document people sign only
     after somebody has read it and pressed save. */
  const [composing, setComposing] = useState(false);
  const composeText = () => {
    setComposing(true);
    setRerunNote(null);
    void api.composeMinutesText(meeting.id)
      .then((answer) => {
        if (answer.body === null) {
          /* WHICH nothing: a provider that refused is not a meeting with
             nothing to say, and neither is a meeting with nothing recorded
             yet — the route names both and so does this */
          setRerunNote(answer.reason === "nothing_to_compose"
            ? t("minutesComposeEmpty") : t("minutesComposeFailed"));
          return;
        }
        setDraft(answer.body);
        setRerunNote(t("minutesComposed"));
      })
      .catch(() => setRerunNote(t("minutesComposeFailed")))
      .finally(() => setComposing(false));
  };

  const rows = Array.isArray(items) ? items : [];
  const decisions = useMemo(
    () => rows.filter((r) => r.kind === "decision").map((r) => r.body),
    [rows],
  );
  /*
   * THE ROWS, not a rendering of them. The screen writes «کار — مسئول» on one
   * line and the document gives مسئول and مهلت columns of their own, so a
   * flattened string here would mean the file could never carry a deadline
   * the panel beside it displays — two renderings of one fact is fine, two
   * DERIVATIONS is how they come to disagree.
   */
  const actionRows = useMemo(() => rows.filter((r) => r.kind === "action"), [rows]);

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

  /**
   * THE FILE THIS PAGE HANDS OVER.
   *
   * Built by `minutesDocument` — see that file for the صورت‌جلسه's shape and
   * for why the organisation's letterhead has to be expressed twice, once for
   * Word and once for the browser's print.
   *
   * ASYNC, because the letterhead is bytes: the page image lives behind the
   * api and has to become a data URI before it can travel inside a document
   * that Word will open from disk and a print window will render with no
   * session of its own.
   */
  const buildDocument = async (target: "browser" | "word"): Promise<string> => {
    /* the signatures are read FRESH for every export — a colleague may have
       signed since this tab loaded, and the one report this feature must
       never produce is "the host printed it and mine was not on it" */
    const placed = await api.meetingSignatures(meeting.id).catch(() => null);
    const args = {
      t, locale, meeting,
      people: people.map((p) => ({ key: p.key, name: p.name })),
      signatures: placed === null ? [] : await signaturesForDocument(meeting.id, placed),
      summaryBlocks, decisions,
      actions: actionRows,
      sheet: await sheetForDocument(),
    };
    /* the WORD file is an MHTML archive when there is a letterhead, because
       that is the only form Word repeats an image from (minutesDocument.ts
       has the three measurements); the print window gets the HTML. */
    return target === "word" ? minutesWordFile(args) : minutesDocument(args);
  };

  /* the letterhead comes from `lib/minutesFile`, which the assistant's own
     `export_meeting_minutes` reads too: one loader, one cache, and the two
     doors cannot produce different-looking documents for one meeting */
  const sheetForDocument = () => letterheadForDocument(org);

  const downloadWord = () => {
    void buildDocument("word").then((html) => {
      const blob = new Blob(["\ufeff", html], { type: "application/msword" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${meeting.title.slice(0, 60)}.doc`;
      a.click();
      URL.revokeObjectURL(url);
    });
  };

  const printPdf = () => {
    /* the window is opened INSIDE the press, before any await: a popup that
       is not the direct result of a gesture is one the browser blocks, and
       fetching the letterhead first is exactly such an await */
    const win = window.open("", "_blank");
    if (win === null) return;
    void buildDocument("browser").then((html) => {
      win.document.open();
      win.document.write(html);
      win.document.close();
      win.print();
    });
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
      <article className="tile p-6" aria-label={t("tabSummary")}>
      {/*
        ── THE DOCUMENT'S OWN HEADER, INSIDE THE DOCUMENT ──
        (user directive, 2026-09-17, second pass: "add the items of name of the
        meeting with date and buttons to the place of the summarization, not
        separate like this — they have to be in the same box; and change their
        place with each other: the kebab menu left, then the generate button,
        and the name and date on the right in the fa version".)

        TWO REVERSALS OF THE SAME MORNING, both recorded rather than quietly
        made:

        · it was a row ABOVE the card, and a header floating over the thing it
          names is a second box for one document. It is the card's own header
          now, with the sections under a hairline.
        · it was pinned PHYSICALLY (`rtl:flex-row-reverse`) on the reading that
          «left» meant the same side in both languages. It does not: what was
          asked for is the ORDINARY one — the name where a Persian reader
          starts, the controls at the far end — so the row is plain logical
          order, and English mirrors it into exactly the header an English
          reader expects.

        Inside the controls, «تولید دوباره» comes first and the ⋯ second, which
        puts the ⋯ on the row's outer corner in either direction.
      */}
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-bold text-fg">
            {t("summaryDocTitle", { title: meeting.title })}
          </h2>
          <p className="mt-0.5 text-caption text-fg-subtle">
            <span className="badge-num" dir="ltr">MTG-{meeting.id.slice(0, 8)}</span>
            {" · "}
            {t("minutesDate")}: {formatDate(meeting.scheduled_at, locale)}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        {rerunNote !== null ? (
          <span className="text-caption text-fg-muted">{rerunNote}</span>
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
        {/*
          THE TWO EXPORTS MOVED INTO THE ⋯ and «تولید دوباره» stayed out, which
          is the directive's own division and a sound one: the regenerate is
          the row's frequent act, while Word and PDF are the two ways of taking
          the SAME document away — a menu is where a reader looks for a format,
          and two more buttons beside the title is a toolbar again.
        */}
        <KebabMenu
          label={t("summaryExport")}
          items={[
            {
              key: "word", label: "Word",
              icon: <IconDownload width={14} height={14} />,
              onSelect: downloadWord,
            },
            {
              key: "pdf", label: "PDF",
              icon: <IconPrint width={14} height={14} />,
              onSelect: printPdf,
            },
            /* the ASSISTANT's own entry, beside the two formats because it is
               about the same document: it writes the account of the meeting to
               the length the letterhead leaves, and leaves it in the editor */
            ...(callId === null ? [] : [{
              key: "compose",
              label: composing ? t("minutesComposing") : t("minutesCompose"),
              icon: <IconAsk width={14} height={14} />,
              disabled: composing,
              onSelect: composeText,
            }]),
            /* and the paper itself — an ADMIN's, because it is the whole
               organisation's stationery rather than this meeting's */
            ...(isAdmin ? [{
              key: "sheet",
              label: org?.sheet?.mime == null ? t("sheetUpload") : t("sheetChange"),
              icon: <IconUpload width={14} height={14} />,
              onSelect: () => setSheetOpen(true),
            }] : []),
          ]}
        />
        </div>
      </header>

        <section>
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
            : actionRows.length === 0 ? <p className="mt-1.5 text-sm text-fg-muted">{t("minutesNoActions")}</p>
              : (
                <ul className="mt-1.5 space-y-1.5">
                  {actionRows.map((row) => (
                    <li key={row.id} className="flex items-start gap-2 text-sm leading-6 text-fg">
                      <span className="mt-2 h-1 w-3 shrink-0 rounded-full bg-fg-subtle" aria-hidden />
                      {row.owner === null ? row.body : `${row.body} — ${row.owner}`}
                    </li>
                  ))}
                </ul>
              )}
        </section>

        {/*
          THE SIGNATURES, at the foot of the document (user directive,
          2026-09-17: "add place at the end of the summary that each attendant
          can add their own signature there … and when the host is printing
          it, all of their real signatures … are already added there").

          Who has signed is a list everybody sees; the CONTROL is drawn for the
          reader alone and only in the state the server says they are in —
          signed (withdraw), on file (one press), or nothing on file (a picker,
          which files and signs in one request). A colleague who was not in
          the room gets the list and no control: db/0229's policy would refuse
          them, and a button that meets a refusal explains nothing.
        */}
        <section className="mt-4" aria-label={t("minutesSignatures")}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-accent">{digits(5, locale)}. {t("minutesSignatures")}</h3>
            {sigs !== null && sigs !== "failed" && sigs.can_sign ? (
              <div className="flex flex-wrap items-center gap-1.5">
                {signNote !== null ? (
                  <span className="text-caption text-fg-muted">{signNote}</span>
                ) : null}
                {sigs.signed ? (
                  <button type="button" onClick={withdrawSignature} disabled={signing}
                    className="btn btn-sm border border-border font-medium text-fg-muted hover:text-fg disabled:opacity-50">
                    {t("signatureWithdraw")}
                  </button>
                ) : sigs.has_signature_on_file ? (
                  <button type="button" onClick={() => sign()} disabled={signing}
                    className="btn btn-sm gap-1.5 bg-accent font-semibold text-on-accent shadow-accent hover:opacity-90 disabled:opacity-50">
                    <IconPencil width={12} height={12} />
                    {signing ? t("signing") : t("signMinutes")}
                  </button>
                ) : (
                  <>
                    <input
                      ref={signatureInput}
                      type="file"
                      accept={SIGNATURE_ACCEPT}
                      className="sr-only"
                      aria-label={t("signMinutesUpload")}
                      disabled={signing}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        /* reset FIRST, so choosing the same file twice still fires */
                        event.target.value = "";
                        if (file) sign(file);
                      }}
                    />
                    <button type="button" onClick={() => signatureInput.current?.click()} disabled={signing}
                      className="btn btn-sm gap-1.5 bg-accent font-semibold text-on-accent shadow-accent hover:opacity-90 disabled:opacity-50">
                      <IconUpload width={12} height={12} />
                      {signing ? t("signing") : t("signMinutesUpload")}
                    </button>
                  </>
                )}
              </div>
            ) : null}
          </div>
          {sigs === null ? <SkeletonLines lines={1} className="mt-1.5" />
            : sigs === "failed" ? <p className="mt-1.5 text-sm text-fg-muted">{t("signaturesFailed")}</p>
              : sigs.signatures.length === 0
                ? <p className="mt-1.5 text-sm text-fg-muted">{t("signaturesNone")}</p>
                : (
                  <ul className="mt-1.5 flex flex-wrap gap-2">
                    {sigs.signatures.map((row) => (
                      <li key={row.user_id} className="well flex items-center gap-2.5 px-2.5 py-1.5">
                        {/* on WHITE, whatever the theme: a signature is dark ink
                            on paper, and a transparent PNG over the dark surface
                            is invisible — the letterhead preview's own reason */}
                        {/* eslint-disable-next-line @next/next/no-img-element -- a session-scoped bytes route, not a static asset */}
                        <img
                          src={api.meetingSignatureImageUrl(meeting.id, row.user_id)}
                          alt=""
                          className="h-8 max-w-[7rem] rounded bg-white object-contain p-0.5"
                        />
                        <span className="text-xs">
                          <span className="block text-fg">{personName(row, locale)}</span>
                          <span className="block text-caption text-fg-subtle">{formatDate(row.signed_at, locale)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
        </section>
      </article>

      {/* the organisation's paper. Re-read on save rather than assumed: the
          ⋯ entry's own words («بارگذاری» vs «تعویض») come from the record, so
          a screen that kept the old one would offer to upload a sheet that is
          already there. */}
      {sheetOpen ? (
        <LetterheadDialog
          current={org?.sheet ?? null}
          onClose={() => setSheetOpen(false)}
          onSaved={() => {
            forgetLetterhead();
            setOrgReads((n) => n + 1);
          }}
        />
      ) : null}
    </div>
  );
}
