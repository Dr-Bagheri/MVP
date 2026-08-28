"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { api } from "@/api/client";
import type { AuthSessionRow } from "@/api/types";
import { Pagination, usePaged } from "@/components/Pagination";
import { FormPanel, FormRow } from "@/components/scaffold";
import { ConfirmDialog } from "@/components/rowActions";
import { notify } from "@/lib/notify";

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
  const [sessions, setSessions] = useState<AuthSessionRow[] | null>(null);
  const [confirmVoice, setConfirmVoice] = useState(false);
  const [voiceState, setVoiceState] = useState<"unknown" | "gone">("unknown");

  useEffect(() => {
    void api.mySessions().then(setSessions).catch(() => setSessions([]));
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

  const agentLabel = (agent: string | null): string => {
    if (!agent) return t("deviceUnknown");
    if (/mobile|android|iphone/i.test(agent)) return t("deviceMobile");
    if (/firefox/i.test(agent)) return "Firefox";
    if (/edg/i.test(agent)) return "Edge";
    if (/chrome/i.test(agent)) return "Chrome";
    if (/safari/i.test(agent)) return "Safari";
    return t("deviceBrowser");
  };

  return (
    <div className="space-y-5">
      <FormPanel>
        <FormRow label={t("passwordLabel")} description={t("passwordHint")}>
          <Link href="/profile" className="btn-secondary h-10 min-h-0 px-4 text-sm">
            {t("passwordAction")}
          </Link>
        </FormRow>
        <FormRow label={t("methodsLabel")} description={t("methodsHint")}>
          <Link href="/settings/sso" className="btn-secondary h-10 min-h-0 px-4 text-sm">
            {t("methodsAction")}
          </Link>
        </FormRow>
        <FormRow label={t("exportLabel")} description={t("exportHint")}>
          <Link href="/profile" className="btn-secondary h-10 min-h-0 px-4 text-sm">
            {t("exportAction")}
          </Link>
        </FormRow>
      </FormPanel>

      {/* ── the caller's own devices ─────────────────────────────────── */}
      <div>
        <h2 className="h-section">{t("sessionsTitle")}</h2>
        <p className="mt-1 text-sm leading-6 text-fg-muted">{t("sessionsHint")}</p>
        {sessions === null ? null : sessions.length === 0 ? (
          <p className="mt-3 text-sm text-fg-muted">{t("sessionsEmpty")}</p>
        ) : (
          <>
          <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-surface">
            {visible.map((session) => (
              <li key={session.handle} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-fg">{agentLabel(session.user_agent)}</span>
                  <span className="block truncate text-xs text-fg-muted" dir="ltr">
                    {session.ip ?? "—"} · {session.handle}
                  </span>
                </span>
                <span className="text-xs text-fg-subtle" dir="ltr">
                  {new Date(session.refreshed_at ?? session.created_at).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
          <Pagination page={page} pageCount={pageCount} onPage={setPage} />
          </>
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
