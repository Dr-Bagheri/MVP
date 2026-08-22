"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import { formatDate } from "@/lib/format";

/**
 * The OAuth allow-list (db/0082) — the platform console's fourth tab: who
 * may ENTER via Google/GitHub. Root-walled twice below this screen (core's
 * requirePlatformRoot + the SQL definer functions); every change takes a
 * reason and lands in the platform audit, like every other console action.
 * The seeded root address renders like any row — deleting it is possible
 * and the confirm text says what that means.
 */
export function OauthAllowlist() {
  const t = useTranslations("platformRoot");
  const locale = useLocale();
  const [entries, setEntries] = useState<{ email: string; note: string; added_at: string }[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [removing, setRemoving] = useState<null | { email: string; reason: string }>(null);

  const refresh = () =>
    api.platformOauthAllowlist()
      .then((res) => { setEntries(res.entries); setLoaded(true); })
      .catch(() => setLoaded(true));

  useEffect(() => { void refresh(); }, []);

  async function add(): Promise<void> {
    if (busy || !email.includes("@") || !reason.trim()) return;
    setBusy(true);
    setFailed(false);
    try {
      await api.platformOauthAllow(email.trim(), note.trim(), reason.trim());
      setEmail("");
      setNote("");
      setReason("");
      await refresh();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    if (!removing || busy || !removing.reason.trim()) return;
    setBusy(true);
    setFailed(false);
    try {
      await api.platformOauthDisallow(removing.email, removing.reason.trim());
      setRemoving(null);
      await refresh();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-4 space-y-4">
      <p className="text-sm leading-6 text-fg-muted">{t("oauthIntro")}</p>

      <div className="rounded-xl border border-border bg-surface p-4">
        <p className="mb-3 text-sm font-semibold text-fg">{t("oauthAdd")}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            className="input"
            dir="ltr"
            placeholder="email@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            className="input"
            placeholder={t("oauthNote")}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <input
          className="input mt-2 w-full"
          placeholder={t("reasonHint")}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <button
          className="btn-primary mt-3 h-10 px-4"
          disabled={busy || !email.includes("@") || !reason.trim()}
          onClick={() => void add()}
        >
          {t("oauthAllow")}
        </button>
        {failed ? (
          <p role="alert" className="mt-2 text-sm text-danger">{t("actionFailed")}</p>
        ) : null}
      </div>

      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
        {!loaded ? null : entries.length === 0 ? (
          <p className="px-4 py-6 text-sm text-fg-muted">{t("oauthEmpty")}</p>
        ) : (
          entries.map((entry) => (
            <div key={entry.email} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="ltr text-sm font-medium text-fg">{entry.email}</span>
              {entry.note ? (
                <span className="text-xs text-fg-muted">{entry.note}</span>
              ) : null}
              <span className="ms-auto text-xs text-fg-subtle">
                {formatDate(entry.added_at, locale)}
              </span>
              {removing?.email === entry.email ? (
                <span className="flex w-full items-center gap-2 sm:w-auto">
                  <input
                    className="input h-9 min-h-0 flex-1 text-sm"
                    autoFocus
                    placeholder={t("reasonHint")}
                    value={removing.reason}
                    onChange={(e) => setRemoving({ email: entry.email, reason: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void remove();
                      if (e.key === "Escape") setRemoving(null);
                    }}
                  />
                  <button
                    className="tap h-9 rounded-lg px-3 text-sm text-danger hover:bg-danger/10"
                    disabled={busy || !removing.reason.trim()}
                    onClick={() => void remove()}
                  >
                    {t("oauthRemoveConfirm")}
                  </button>
                </span>
              ) : (
                <button
                  className="tap rounded-lg px-2 py-1 text-xs text-fg-muted hover:text-danger"
                  onClick={() => setRemoving({ email: entry.email, reason: "" })}
                >
                  {t("oauthRemove")}
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
