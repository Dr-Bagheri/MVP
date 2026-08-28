"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { AuthSessionRow } from "@/api/types";
import { Pagination, usePaged } from "@/components/Pagination";
import { ConfirmDialog } from "@/components/rowActions";
import { notify } from "@/lib/notify";
import { DataTable } from "@/components/DataTable";
import { Chip } from "@/components/ui";
import { formatDate, formatTime } from "@/lib/format";
import { useLocale } from "next-intl";

/**
 * Settings · Security (db/0112 batch).
 *
 * What is REAL here and where it comes from:
 *  - ACTIVE SESSIONS: the caller's own rows from auth.sessions through a
 *    definer door whose select list is the wall — device, ip, times, a
 *    display handle. Sign-in HISTORY is deliberately absent: the auth
 *    audit table is empty on this deployment, and an empty list rendered
 *    as "no history" would be absent-because-unrecorded wearing
 *    absent-because-quiet.
 *  - VOICE PRINT: consent's other half. Enrollment recorded who and when;
 *    withdrawal is self-service here — one click, no admin, gone.
 *  - Password and provider management keep their single homes (Profile,
 *    Sign-in methods) and are LINKED, never duplicated.
 */
export function SecuritySettings() {
  const t = useTranslations("security");
  const locale = useLocale();
  const [sessions, setSessions] = useState<AuthSessionRow[] | null>(null);
  /** the handle of the session THIS request rode — the "this device" chip */
  const [current, setCurrent] = useState<string | null>(null);
  const [confirmVoice, setConfirmVoice] = useState(false);
  const [voiceState, setVoiceState] = useState<"unknown" | "gone">("unknown");

  useEffect(() => {
    void api.mySessions()
      .then((answer) => { setSessions(answer.sessions); setCurrent(answer.current); })
      .catch(() => setSessions([]));
  }, []);

  /* `null` is not-fetched, so the pager is handed the empty list until the
     rows arrive — it draws nothing for one page either way */
  const { page, setPage, pageCount, visible } = usePaged(sessions ?? []);

  async function withdrawVoice() {
    setConfirmVoice(false);
    try {
      await api.deleteMyVoiceprint();
      setVoiceState("gone");
      notify(t("voiceDeleted"));
    } catch (cause) {
      const { status } = cause as { status?: number };
      if (status === 404) {
        // an honest nothing: there was no print of yours to withdraw
        setVoiceState("gone");
        notify(t("voiceNone"));
      } else {
        notify(t("voiceDeleteFailed"), "warn");
      }
    }
  }

  /*
   * Browser + platform, read from the user agent — two words, because
   * "Edge" alone cannot tell a person which of their machines a row is.
   * Order matters twice: Edge's UA contains "Chrome", Chrome's contains
   * "Safari"; the specific brand is asked first each time.
   */
  const agentLabel = (agent: string | null): string => {
    if (!agent) return t("deviceUnknown");
    const browser = /edg/i.test(agent) ? "Edge"
      : /firefox/i.test(agent) ? "Firefox"
      : /chrome|crios/i.test(agent) ? "Chrome"
      : /safari/i.test(agent) ? "Safari"
      : t("deviceBrowser");
    const platform = /windows/i.test(agent) ? "Windows"
      : /iphone|ipad|ios/i.test(agent) ? "iOS"
      : /android/i.test(agent) ? "Android"
      : /mac os|macintosh/i.test(agent) ? "macOS"
      : /linux/i.test(agent) ? "Linux"
      : null;
    return platform ? `${browser} · ${platform}` : browser;
  };

  return (
    <div className="space-y-5">
      {/*
        The password/sign-in/export rows LEFT this page (user directive,
        2026-08-28: "remove this first section of security") — all three
        were doors to pages the menu already reaches, and a security page
        that opens with three link-buttons buries the two things only it
        has: the live devices and the voice print.
      */}

      {/* ── the caller's own devices ─────────────────────────────────── */}
      <div>
        <h2 className="h-section">{t("sessionsTitle")}</h2>
        <p className="mt-1 text-sm leading-6 text-fg-muted">{t("sessionsHint")}</p>
        {sessions === null ? null : sessions.length === 0 ? (
          <p className="mt-3 text-sm text-fg-muted">{t("sessionsEmpty")}</p>
        ) : (
          <div className="mt-3">
            <DataTable
              rows={visible}
              rowKey={(session) => session.handle}
              columns={[
                {
                  key: "device",
                  header: t("colDevice"),
                  cell: (session) => (
                    <span className="flex items-center gap-2">
                      <span className="font-medium text-fg">{agentLabel(session.user_agent)}</span>
                      {session.handle === current ? (
                        <Chip tone="success">{t("thisDevice")}</Chip>
                      ) : null}
                    </span>
                  ),
                },
                {
                  key: "ip",
                  header: t("colIp"),
                  cell: (session) => (
                    <span dir="ltr" className="text-fg-muted">{session.ip ?? "—"}</span>
                  ),
                },
                {
                  /* only the CURRENT session carries one — the BFF reads it
                     off the request in hand; an old row's IP is often the
                     hosting provider's egress, and a city derived from it
                     would be a guess wearing a fact's costume */
                  key: "location",
                  header: t("colLocation"),
                  cell: (session) => (
                    <span className="text-fg-muted">{session.location ?? "—"}</span>
                  ),
                },
                {
                  key: "signedIn",
                  header: t("colSignedIn"),
                  cell: (session) => (
                    <span className="text-fg-muted">
                      {`${formatDate(session.created_at, locale)} ${formatTime(session.created_at, locale)}`}
                    </span>
                  ),
                },
                {
                  key: "lastAction",
                  header: t("colLastAction"),
                  cell: (session) => session.refreshed_at ? (
                    <span className="text-fg-muted">
                      {`${formatDate(session.refreshed_at, locale)} ${formatTime(session.refreshed_at, locale)}`}
                    </span>
                  ) : (
                    /* never refreshed is a fact, not a gap */
                    <span className="text-fg-subtle">—</span>
                  ),
                },
              ]}
            />
            <Pagination page={page} pageCount={pageCount} onPage={setPage} />
          </div>
        )}
      </div>

      {/* ── the voice print: withdrawal is self-service ──────────────── */}
      <div>
        <h2 className="h-section">{t("voiceTitle")}</h2>
        <p className="mt-1 text-sm leading-6 text-fg-muted">{t("voiceConsent")}</p>
        {voiceState === "gone" ? (
          <p className="mt-2 text-sm text-fg-muted">{t("voiceGone")}</p>
        ) : (
          <button
            type="button"
            className="btn-secondary mt-3 h-9 min-h-0 px-4 text-sm text-danger"
            onClick={() => setConfirmVoice(true)}
          >
            {t("voiceDelete")}
          </button>
        )}
      </div>

      {confirmVoice ? (
        <ConfirmDialog
          title={t("voiceConfirmTitle")}
          body={t("voiceConfirmBody")}
          confirmLabel={t("voiceDelete")}
          cancelLabel={t("cancel")}
          onCancel={() => setConfirmVoice(false)}
          onConfirm={() => void withdrawVoice()}
        />
      ) : null}
    </div>
  );
}
