"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api, BffError } from "@/api/client";
import type { ConnectorStatus } from "@/api/types";
import { ConfirmDialog } from "@/components/rowActions";
import { Icon } from "@/components/icons";
import { BrandMark } from "./brandMarks";
import { providerLabelFor, useIntegrationCopy, type IntegrationEntry, type TokenField } from "./integrationsCatalogue";

/**
 * THE CONNECT DIALOG — one door for every integration (2026-09-06), shared by
 * the shelf and the detail page so the two cannot drift.
 *
 * Two kinds of connection, one dialog:
 *
 *  · an OAUTH provider (Google, Zoom, Slack, Jira, Notion, GitHub, Dropbox,
 *    OneDrive) — the briefing the user asked for on 2026-08-28: what the
 *    integration enables, that the connection is private to this person
 *    (D29), and for Google that one sign-in covers four sources; then the
 *    hand-off to the provider's own consent screen;
 *  · a TOKEN provider (Telegram's bot token, WhatsApp Business's token and
 *    number, an MCP server's URL and bearer) — the same briefing with the
 *    fields the registry names, sent to core, which asks the provider to
 *    vouch for the credential BEFORE it is stored. A refusal stays in the
 *    dialog, named; the secret is never echoed back.
 *
 * The description sentence is a CONSTRAINT kind under R21 (what a connection
 * reads), and this dialog is the one place it is shown — the tile and the
 * detail page carry the name and the status alone.
 */
export function ConnectDialog({
  entry,
  reconnect,
  onConnected,
  onCancel,
}: {
  entry: IntegrationEntry;
  reconnect: boolean;
  /** a token connection landed (the status core returned); OAuth never reaches this — it leaves the page */
  onConnected: (status: ConnectorStatus) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("integrations");
  const tw = useTranslations("workflows");
  const locale = useLocale() as "fa" | "en";
  const copy = useIntegrationCopy();
  const name = copy[entry.key].name;
  const provider = providerLabelFor(entry, copy, tw);

  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const token = entry.kind === "token";
  const complete = !token || entry.tokenFields.filter((f) => f.required).every((f) => (fields[f.name] ?? "").trim() !== "");

  async function submit(): Promise<void> {
    setError(null);
    if (!token) {
      try {
        window.location.assign(await api.connectorAuthorization(entry.provider, locale));
      } catch {
        setError(tw("connectFailed"));
      }
      return;
    }
    setBusy(true);
    try {
      const status = await api.connectTokenConnector(entry.provider, fields);
      onConnected(status);
    } catch (cause) {
      /* WHICH nothing: the provider refused the credential (a 502 of kind
         provider), our validation refused its shape (a 400), or the wire
         failed — three sentences, never one */
      if (cause instanceof BffError && cause.kind === "provider") setError(t("tokenRefused"));
      else if (cause instanceof BffError && cause.status === 400) setError(t("tokenInvalid"));
      else setError(tw("connectFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConfirmDialog
      title={name}
      danger={false}
      confirmLabel={reconnect ? tw("reconnect", { provider }) : token ? t("connectWithToken") : t("connectJustForMe")}
      cancelLabel={t("cancel")}
      busy={busy}
      confirmDisabled={!complete}
      body={
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <BrandMark
              slug={entry.slug}
              className="h-10 w-10"
              fallback={(
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-surface-2 text-fg-muted" aria-hidden>
                  <Icon name={entry.icon} size="lg" />
                </span>
              )}
            />
            <p className="text-sm leading-6 text-fg-muted">{copy[entry.key].description}</p>
          </div>
          {entry.provider === "google" ? (
            <p className="text-sm leading-6 text-fg-muted">{t("oneGoogleGrant")}</p>
          ) : null}
          {token ? (
            <div className="space-y-3">
              {/* where the credential comes from — a CONSTRAINT (R21), one line,
                  because a token field with no provenance is a field a person
                  cannot fill */}
              <p className="text-xs leading-6 text-fg-muted">
                {entry.provider === "telegram" ? t("tokenHintTelegram")
                  : entry.provider === "whatsapp" ? t("tokenHintWhatsapp")
                    : t("tokenHintMcp")}
              </p>
              {entry.tokenFields.map((field) => (
                <label key={field.name} className="block">
                  <span className="mb-1 block text-xs font-medium text-fg-subtle">
                    {fieldLabel(t, entry.provider, field.name)}{field.required ? "" : ` (${t("optional")})`}
                  </span>
                  {/*
                    NEVER `autocomplete="off"` ON A SECRET HERE (found on
                    production, 2026-09-06, by opening the dialog).
                    Chrome IGNORES `off` on a `type="password"` field — it is
                    documented behaviour, not a bug — so the password manager
                    filled this box with the PERSON'S OWN ACCOUNT PASSWORD and
                    the box beside it with their email. A person who pressed
                    «اتصال» without looking would have sent their platform
                    password to a third party as an API token, and the two
                    dots-and-an-email looked exactly like a form that had
                    helpfully remembered something.
                    `new-password` is the token Chrome does honour: it marks
                    the group as a form where a saved credential has no
                    business, so neither the secret nor the field beside it is
                    filled. The auth screens already used this vocabulary
                    correctly; only this dialog did not.
                    The `data-*` pair is the same refusal for 1Password and
                    LastPass, which read their own attributes and not this one.
                    A NAME rather than an anonymous input for the same reason:
                    an unnamed box beside a password is what a heuristic reads
                    as a username.
                  */}
                  <input
                    className="input"
                    dir="ltr"
                    name={`${entry.provider}-${field.name}`}
                    type={field.name === "secret" ? "password" : "text"}
                    autoComplete={field.name === "secret" ? "new-password" : "off"}
                    data-1p-ignore
                    data-lpignore="true"
                    spellCheck={false}
                    value={fields[field.name] ?? ""}
                    onChange={(event) => setFields((prev) => ({ ...prev, [field.name]: event.target.value }))}
                  />
                </label>
              ))}
            </div>
          ) : null}
          <div className="well p-4">
            <p className="text-sm font-medium text-fg">{t("privacyTitle")}</p>
            <p className="mt-1 text-sm leading-6 text-fg-muted">{t("privacyNote")}</p>
          </div>
          {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
        </div>
      }
      onConfirm={() => { void submit(); }}
      onCancel={onCancel}
    />
  );
}

/** the field's own word, per provider where the same field means a different thing */
function fieldLabel(t: (key: "fieldSecretTelegram" | "fieldSecretWhatsapp" | "fieldSecretMcp" | "fieldUrl" | "fieldPhoneNumberId" | "fieldWabaId") => string, provider: string, field: TokenField): string {
  if (field === "url") return t("fieldUrl");
  if (field === "phone_number_id") return t("fieldPhoneNumberId");
  if (field === "waba_id") return t("fieldWabaId");
  return provider === "telegram" ? t("fieldSecretTelegram") : provider === "whatsapp" ? t("fieldSecretWhatsapp") : t("fieldSecretMcp");
}
