"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { MeetingRecord, SummaryVersion } from "@/api/types";
import { parseSummary } from "@/components/echo/SummaryBody";
import { IconCheck, IconDownload, IconPrint } from "@/components/icons";
import { digits, formatDate } from "@/lib/format";

/**
 * صورت‌جلسه — the reference's minutes DOCUMENT, composed from facts the
 * platform already holds and a lifecycle 0146 makes real:
 *
 *   · حاضران   — the meeting's invitees (names as typed);
 *   · مصوبات   — the summary's own decisions section, sliced by heading;
 *   · اکشن‌آیتم‌ها — likewise; a section the summary lacks renders as its
 *     named absence, never as invented rows;
 *   · امضاها   — appended one per «ثبت امضای من» (0146 event patches);
 *   · وضعیت سند — draft ✓ (the AI wrote one) → تأیید نهایی → بستن، which
 *     the server refuses on an unapproved document.
 *
 * Word = an HTML document handed to the browser as .doc (opens in Word);
 * PDF = the browser's own print dialog over the same document.
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

function sectionItems(text: string, match: RegExp): string[] {
  const blocks = parseSummary(text);
  const items: string[] = [];
  let inSection = false;
  for (const block of blocks) {
    if (block.kind === "heading") { inSection = match.test(block.text); continue; }
    if (!inSection) continue;
    if (block.kind === "bullets" || block.kind === "numbered") items.push(...block.items);
    else if (block.text.trim() !== "") items.push(block.text.trim());
  }
  return items;
}

export function MinutesTab({ meeting, myName, myId, onChanged }: {
  meeting: MeetingRecord;
  /** the signer's display name — personName(me), resolved by the page */
  myName: string;
  /** the signer's ID — the dedupe key (a display name changes with locale) */
  myId: string | null;
  onChanged: (m: MeetingRecord) => void;
}) {
  const t = useTranslations("meetings");
  const locale = useLocale();
  const [versions, setVersions] = useState<SummaryVersion[] | null | "failed">(null);
  const [error, setError] = useState(false);

  const callId = meeting.call_id;
  useEffect(() => {
    if (callId === null) return;
    let alive = true;
    void api.getSummaries(callId)
      .then((v) => { if (alive) setVersions(v); })
      .catch(() => { if (alive) setVersions("failed"); });
    return () => { alive = false; };
  }, [callId]);

  const summary = Array.isArray(versions) ? versions[0] : undefined;
  const decisions = useMemo(
    () => (summary === undefined ? [] : sectionItems(summary.body, /مصوب|تصمیم/)),
    [summary],
  );
  const actions = useMemo(
    () => (summary === undefined ? [] : sectionItems(summary.body, /اکشن|اقدام/)),
    [summary],
  );

  const patch = (body: Record<string, unknown>) => {
    setError(false);
    void api.updateMeeting(meeting.id, body).then(onChanged).catch(() => setError(true));
  };

  const alreadySigned = meeting.minutes_signatures.some((sig) =>
    myId !== null ? sig.user_id === myId : sig.name === myName);
  const closed = meeting.minutes_closed_at !== null;
  const approved = meeting.minutes_approved_at !== null;

  const documentHtml = () => {
    const item = (x: string, i: number) => `<p>${i + 1}. ${esc(x)}</p>`;
    return `<!doctype html><html dir="rtl" lang="fa"><head><meta charset="utf-8"><title>${esc(meeting.title)}</title></head><body style="font-family:Vazirmatn,Tahoma,sans-serif">
<h1>${esc(t("minutesDocTitle", { title: meeting.title }))}</h1>
<p>${esc(t("minutesDate"))}: ${esc(formatDate(meeting.scheduled_at, locale))}</p>
<h2>${esc(t("minutesAttendees"))}</h2>${meeting.invitees.length === 0 ? `<p>${esc(t("minutesNoAttendees"))}</p>` : meeting.invitees.map((n) => `<p>${esc(n)}</p>`).join("")}
<h2>${esc(t("ext_decisions"))}</h2>${decisions.length === 0 ? `<p>${esc(t("minutesNoDecisions"))}</p>` : decisions.map(item).join("")}
<h2>${esc(t("ext_actions"))}</h2>${actions.length === 0 ? `<p>${esc(t("minutesNoActions"))}</p>` : actions.map(item).join("")}
<h2>${esc(t("minutesSignatures"))}</h2>${meeting.minutes_signatures.map((sig) => `<p>${esc(sig.name)} — ${esc(formatDate(sig.at, locale))}</p>`).join("") || `<p>${esc(t("minutesAwaitingSignature"))}</p>`}
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

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_290px]">
      {/* ── the document ─────────────────────────────────────────────── */}
      <article className="tile p-6" aria-label={t("tabMinutes")}>
        <header className="border-b border-border pb-3 text-center">
          <h2 className="text-lg font-bold text-fg">{t("minutesDocTitle", { title: meeting.title })}</h2>
          <p className="mt-1 text-[11px] text-fg-subtle">
            <span className="badge-num" dir="ltr">MTG-{meeting.id.slice(0, 8)}</span>
            {" · "}
            {t("minutesDate")}: {formatDate(meeting.scheduled_at, locale)}
          </p>
        </header>

        <section className="mt-4">
          <h3 className="text-sm font-bold text-accent">{digits(1, locale)}. {t("minutesAttendees")}</h3>
          {meeting.invitees.length === 0 ? (
            <p className="mt-1.5 text-sm text-fg-muted">{t("minutesNoAttendees")}</p>
          ) : (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {meeting.invitees.map((name) => (
                <span key={name} className="rounded-lg bg-surface-2 px-2 py-1 text-xs text-fg">{name}</span>
              ))}
            </div>
          )}
        </section>

        <section className="mt-4">
          <h3 className="text-sm font-bold text-accent">{digits(2, locale)}. {t("ext_decisions")}</h3>
          {versions === null && callId !== null ? <p className="mt-1.5 text-sm text-fg-muted">…</p>
            : decisions.length === 0 ? <p className="mt-1.5 text-sm text-fg-muted">{t("minutesNoDecisions")}</p>
              : (
                <ol className="mt-1.5 space-y-1.5">
                  {decisions.map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm leading-6 text-fg">
                      <span className="badge-num mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md bg-accent-soft text-[11px] text-accent">
                        {digits(i + 1, locale)}
                      </span>
                      {item}
                    </li>
                  ))}
                </ol>
              )}
        </section>

        <section className="mt-4">
          <h3 className="text-sm font-bold text-accent">{digits(3, locale)}. {t("ext_actions")}</h3>
          {versions === null && callId !== null ? <p className="mt-1.5 text-sm text-fg-muted">…</p>
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

        <section className="mt-4 border-t border-border pt-3">
          <h3 className="text-sm font-bold text-accent">{digits(4, locale)}. {t("minutesSignatures")}</h3>
          {meeting.minutes_signatures.length === 0 ? (
            <div className="mt-2 grid place-items-center">
              <span className="grid h-20 w-20 place-items-center rounded-full border-2 border-dashed border-border text-center text-[10px] leading-4 text-fg-subtle">
                {t("minutesAwaitingSignature")}
              </span>
            </div>
          ) : (
            <ul className="mt-1.5 space-y-1">
              {meeting.minutes_signatures.map((sig, i) => (
                <li key={i} className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="font-medium text-fg">{sig.name}</span>
                  <span className="text-[11px] text-fg-subtle">{formatDate(sig.at, locale)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </article>

      {/* ── the status rail ──────────────────────────────────────────── */}
      <div className="space-y-3">
        <section className="tile p-4" aria-label={t("minutesStatusTitle")}>
          <h3 className="mb-2 text-sm font-semibold text-fg">{t("minutesStatusTitle")}</h3>
          <ol className="space-y-2">
            {[
              { label: t("minutesStateDraft"), done: summary !== undefined },
              { label: t("minutesStateApproved"), done: approved },
              { label: t("minutesStateSigned"), done: meeting.minutes_signatures.length > 0 },
            ].map((step, i) => (
              <li key={i} className="flex items-center gap-2 text-sm">
                <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full ${
                  step.done ? "bg-accent text-on-accent" : "border border-border text-transparent"
                }`} aria-hidden>
                  <IconCheck width={12} height={12} />
                </span>
                <span className={step.done ? "text-fg" : "text-fg-muted"}>{step.label}</span>
              </li>
            ))}
          </ol>
        </section>

        {error ? (
          <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
            {t("writeFailed")}
          </p>
        ) : null}

        {closed ? (
          <p className="rounded-xl bg-accent-soft px-3 py-2 text-center text-xs font-medium text-accent">
            {t("minutesClosed", { at: formatDate(meeting.minutes_closed_at!, locale) })}
          </p>
        ) : (
          <>
            {!approved ? (
              <button type="button" onClick={() => patch({ minutes_approved: true })}
                className="btn w-full bg-accent font-semibold text-on-accent shadow-accent hover:opacity-90">
                <IconCheck width={14} height={14} />
                {t("minutesApprove")}
              </button>
            ) : null}
            <button type="button" disabled={alreadySigned || myName === ""}
              onClick={() => patch({ minutes_sign: myName })}
              className="btn w-full bg-accent font-semibold text-on-accent shadow-accent hover:opacity-90 disabled:opacity-50">
              {alreadySigned ? t("minutesSigned") : t("minutesSignMine")}
            </button>
            <button type="button" disabled={!approved}
              onClick={() => patch({ minutes_closed: true })}
              title={approved ? undefined : t("minutesCloseNeedsApproval")}
              className="btn w-full border border-accent font-semibold text-accent hover:bg-accent-soft disabled:opacity-50">
              {t("minutesFinalize")}
            </button>
          </>
        )}

        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={downloadWord}
            className="btn border border-border bg-surface font-medium text-fg hover:bg-border">
            <IconDownload width={12} height={12} />
            Word
          </button>
          <button type="button" onClick={printPdf}
            className="btn border border-border bg-surface font-medium text-fg hover:bg-border">
            <IconPrint width={12} height={12} />
            PDF
          </button>
        </div>
      </div>
    </div>
  );
}
