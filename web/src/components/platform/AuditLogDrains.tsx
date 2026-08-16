"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api, BffError } from "@/api/client";
import type { GatewayDelivery, GatewayEvent, GatewayWebhook } from "@/api/types";
import { FormPanel, FormRow, PanelFooter } from "@/components/scaffold";
import { Card, Chip } from "@/components/ui";
import { digits, formatDate } from "@/lib/format";

/**
 * Audit log drains (Part 3) — LIVE, on the M17 dispatcher.
 *
 * A drain is a webhook: signed (`v1 {t}.{body}` HMAC, 5-minute replay
 * tolerance), retried, delivery-logged, SSRF-guarded at connect time, and
 * carrying IDENTIFIERS AND STATUS ONLY — the outbound twin of
 * no-content-in-logs, which is exactly what a compliance destination should
 * receive. This page manages the org's drains and shows their delivery log.
 *
 * The predecessor of this file was the honest-absence card ("drains cannot
 * be configured — a claim about the PRODUCT"). That copy retired WITH the
 * absence: the same mechanism it pointed at as the workaround is now wired
 * here as the feature. The event vocabulary is core's and travels verbatim —
 * an unknown event is refused BY NAME, never swallowed.
 *
 * The SECRET shows once, at creation, and never again (core stores a hash).
 * A toast would destroy the only copy; it renders inline until dismissed.
 */
const EVENTS: readonly GatewayEvent[] = [
  "call.created", "call.transcribed", "call.summarized", "call.failed",
];

export function AuditLogDrains() {
  const t = useTranslations("drains");
  const locale = useLocale();
  const [webhooks, setWebhooks] = useState<GatewayWebhook[] | null>(null);
  const [deliveries, setDeliveries] = useState<GatewayDelivery[]>([]);
  const [creating, setCreating] = useState(false);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<GatewayEvent[]>([...EVENTS]);
  const [minted, setMinted] = useState<{ url: string; secret: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  async function load() {
    try {
      const rows = await api.gatewayWebhooks();
      setWebhooks(rows);
      setDeliveries(await api.gatewayDeliveries());
    } catch (cause) {
      if (cause instanceof BffError && cause.status === 403) setForbidden(true);
      else setError(t("loadFailed"));
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once on mount
  }, []);

  async function create() {
    if (!url.trim() || events.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.createGatewayWebhook(url.trim(), events);
      setMinted({ url: created.url, secret: created.secret });
      setCreating(false);
      setUrl("");
      setEvents([...EVENTS]);
      await load();
    } catch (cause) {
      setError(cause instanceof BffError ? (cause.detail ?? t("saveFailed")) : t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  if (forbidden) {
    return (
      <Card>
        <p className="text-sm leading-7 text-fg-muted">{t("adminOnly")}</p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm leading-7 text-fg-muted">{t("intro")}</p>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      {minted ? (
        /* the one-way door: the secret's ONLY appearance. Dismissal is the
           user's act, never a timer's. */
        <Card className="border-accent">
          <p className="text-sm font-semibold text-fg">{t("secretTitle")}</p>
          <p className="mt-1 text-sm leading-6 text-fg-muted">{t("secretNote")}</p>
          <p className="ltr mt-2 break-all rounded-md bg-surface-2 p-2 font-mono text-xs text-fg">
            {minted.secret}
          </p>
          <button
            className="btn-secondary mt-3 h-9 min-h-0 px-3 text-xs"
            onClick={() => setMinted(null)}
          >
            {t("secretStored")}
          </button>
        </Card>
      ) : null}

      {webhooks !== null && webhooks.length === 0 && !creating ? (
        <Card>
          <p className="text-sm text-fg-muted">{t("empty")}</p>
        </Card>
      ) : null}

      {webhooks?.map((w) => (
        <Card key={w.id}>
          <div className="flex flex-wrap items-center gap-2">
            <p className="ltr min-w-0 flex-1 truncate text-sm font-medium text-fg">{w.url}</p>
            <Chip tone={w.enabled ? "success" : "neutral"}>
              {w.enabled ? t("enabled") : t("disabled")}
            </Chip>
            <button
              className="text-xs text-fg-muted underline-offset-2 hover:underline"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  setWebhooks(await api.setWebhookEnabled(w.id, !w.enabled));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {w.enabled ? t("disable") : t("enable")}
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {w.events.map((e) => (
              <span key={e} className="chip bg-surface-2 text-[11px] text-fg-muted ltr">
                {e}
              </span>
            ))}
          </div>
        </Card>
      ))}

      {creating ? (
        <FormPanel>
          <FormRow label={t("urlLabel")} description={t("urlHint")} htmlFor="drain-url">
            <input
              id="drain-url"
              className="input"
              dir="ltr"
              placeholder="https://example.com/hooks/audit"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </FormRow>
          <FormRow label={t("eventsLabel")} description={t("eventsHint")}>
            <div className="flex flex-wrap gap-2">
              {EVENTS.map((e) => {
                const on = events.includes(e);
                return (
                  <button
                    key={e}
                    type="button"
                    aria-pressed={on}
                    className={`chip ltr ${on ? "bg-accent-soft text-accent" : "bg-surface-2 text-fg-muted"}`}
                    onClick={() =>
                      setEvents(on ? events.filter((x) => x !== e) : [...events, e])
                    }
                  >
                    {e}
                  </button>
                );
              })}
            </div>
          </FormRow>
          <PanelFooter>
            <button
              className="btn-secondary h-10 min-h-0 px-4 text-sm"
              disabled={busy}
              onClick={() => setCreating(false)}
            >
              {t("cancel")}
            </button>
            <button
              className="btn-primary"
              disabled={busy || !url.trim() || events.length === 0}
              onClick={() => void create()}
            >
              {busy ? t("saving") : t("create")}
            </button>
          </PanelFooter>
        </FormPanel>
      ) : (
        <button className="btn-primary h-10 min-h-0 px-4 text-sm" onClick={() => setCreating(true)}>
          {t("newDrain")}
        </button>
      )}

      {deliveries.length > 0 ? (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-fg">{t("deliveriesTitle")}</h3>
          <Card>
            <ul className="divide-y divide-border">
              {deliveries.slice(0, 10).map((d) => {
                /* status is DERIVED from the wire's timestamps — the states
                   are which stamp exists, not a field of their own */
                const state = d.delivered_at
                  ? "delivered"
                  : d.next_attempt_at
                    ? "retrying"
                    : d.failed_at
                      ? "failed"
                      : "pending";
                return (
                  <li key={d.id} className="flex flex-wrap items-center gap-2 py-2 text-xs">
                    <span className="ltr text-fg">{d.event}</span>
                    <Chip tone={state === "delivered" ? "success" : state === "retrying" ? "warning" : "neutral"}>
                      {t(`state_${state}`)}
                    </Chip>
                    {/* null response code = no answer ever came back — words,
                        never a dash that reads as data */}
                    <span className="text-fg-muted">
                      {d.response_code === null ? t("noResponse") : digits(d.response_code, locale)}
                    </span>
                    <span className="ms-auto text-fg-muted">
                      {formatDate(d.delivered_at ?? d.failed_at ?? d.created_at, locale)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
