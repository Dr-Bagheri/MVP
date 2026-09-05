"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/api/client";

/**
 * The one org birth path (db/0082): signup joins by NAME now and founds
 * nothing, so new organizations start here — root-walled, reasoned,
 * audited. The name IS the join key members will type at signup, which is
 * why the hint says so and why the server refuses an active twin.
 */
export function CreateOrg({ onCreated }: { onCreated: () => void }) {
  const t = useTranslations("platformRoot");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function create(): Promise<void> {
    if (busy || !name.trim() || !reason.trim()) return;
    setBusy(true);
    setFailed(false);
    try {
      await api.platformCreateOrg(name.trim(), reason.trim());
      setName("");
      setReason("");
      setOpen(false);
      onCreated();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className="btn-primary"
        onClick={() => setOpen(true)}
      >
        {t("newOrg")}
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="mb-1 text-sm font-semibold text-fg">{t("newOrg")}</p>
      <p className="mb-3 text-xs leading-5 text-fg-muted">{t("newOrgHint")}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <input
          className="input"
          autoFocus
          placeholder={t("newOrgName")}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="input"
          placeholder={t("reasonHint")}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void create(); }}
        />
      </div>
      {failed ? (
        <p role="alert" className="mt-2 text-sm text-danger">{t("newOrgFailed")}</p>
      ) : null}
      <div className="mt-3 flex gap-2">
        <button
          className="btn-primary"
          disabled={busy || !name.trim() || !reason.trim()}
          onClick={() => void create()}
        >
          {t("newOrgCreate")}
        </button>
        <button
          className="btn-secondary"
          onClick={() => { setOpen(false); setFailed(false); }}
        >
          {t("cancel")}
        </button>
      </div>
    </div>
  );
}
