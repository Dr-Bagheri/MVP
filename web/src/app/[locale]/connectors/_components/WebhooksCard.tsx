"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { GatewayEvent, GatewayWebhook } from "@/api/types";
import { Card, Chip, EmptyState, Field } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { Dialog } from "./Dialog";
import { SecretOnce } from "./SecretOnce";
import { EVENT_LABEL_KEY, GATEWAY_EVENTS } from "./events";

type Phase =
  | { step: "form" }
  /** The secret exists here and nowhere else, for as long as this state lives. */
  | { step: "created"; secret: string };

/**
 * Webhook CRUD (BFF.md §4).
 *
 * The copy is the point as much as the controls are: **a webhook is a doorbell,
 * not a delivery**. Bodies carry `{event, call_id, org_id, occurred_at, status}`
 * and nothing else — no title, no transcript, no speaker name (M17 amendment,
 * an invariant rather than a convention). The consumer is told THAT something
 * happened and comes back through the gateway to read it, under the same wall
 * and in the same audit trail. An admin who does not know that will wire up an
 * integration expecting content and conclude the product is broken.
 */
export function WebhooksCard({
  webhooks,
  onChanged,
}: {
  webhooks: GatewayWebhook[];
  onChanged: () => void;
}) {
  const t = useTranslations("gateway");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>({ step: "form" });
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<GatewayEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setPhase({ step: "form" });
    setUrl("");
    setEvents([]);
    setError(null);
  }

  async function create() {
    const trimmed = url.trim();
    /*
     * Two client-side checks, and both are AFFORDANCES — a fast legible answer
     * for the two mistakes a person actually makes. core/ is the authority on
     * both, and it also refuses things this cannot see: the address guard
     * rejects private, loopback and metadata ranges at parse time AND re-checks
     * at connect time, because DNS rebinding walks straight past any URL
     * inspection. Re-implementing that here would be a weaker second copy that
     * drifts, so the rule is: catch the obvious, forward everything else, and
     * show core/'s refusal verbatim when it comes.
     */
    if (!trimmed.toLowerCase().startsWith("https://")) {
      setError(t("urlInvalid"));
      return;
    }
    if (events.length === 0) {
      setError(t("eventsRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await api.createGatewayWebhook(trimmed, events);
      setPhase({ step: "created", secret: created.secret });
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : t("failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-4">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="h-section">{t("webhooks")}</h2>
        <button
          type="button"
          className="btn-secondary h-9 min-h-0 px-3 text-xs"
          onClick={() => setOpen(true)}
        >
          {t("addWebhook")}
        </button>
      </div>
      <p className="mb-3 text-xs leading-6 text-fg-muted">{t("webhooksNote")}</p>

      {webhooks.length === 0 ? (
        <EmptyState text={t("webhooksEmpty")} />
      ) : (
        <ul className="divide-y divide-border">
          {webhooks.map((webhook) => (
            <li key={webhook.id} className="flex flex-wrap items-start gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="ltr break-all font-mono text-xs text-fg">{webhook.url}</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {webhook.events.map((event) => (
                    <Chip key={event} tone="neutral">
                      {t(EVENT_LABEL_KEY[event])}
                    </Chip>
                  ))}
                </div>
                <p className="mt-1.5 text-xs text-fg-muted">
                  {t("createdAt", { date: formatDate(webhook.created_at, locale) })}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Chip tone={webhook.enabled ? "success" : "neutral"}>
                  {webhook.enabled ? t("enabled") : t("paused")}
                </Chip>
                <button
                  type="button"
                  className="btn-secondary h-8 min-h-0 px-3 text-xs"
                  onClick={async () => {
                    await api.setWebhookEnabled(webhook.id, !webhook.enabled);
                    onChanged();
                  }}
                >
                  {webhook.enabled ? t("pause") : t("resume")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs leading-6 text-fg-muted">{t("pauseNote")}</p>

      <Dialog
        open={open}
        // Same one-way door as a key: once the secret is on screen, the reflex
        // gestures stop being an exit.
        dismissible={phase.step === "form"}
        onClose={() => {
          reset();
          setOpen(false);
        }}
        title={phase.step === "form" ? t("addWebhook") : t("secretOnceTitle")}
      >
        {phase.step === "created" ? (
          <SecretOnce
            body={t("secretOnceBody")}
            value={phase.secret}
            ackLabel={t("secretSaved")}
            onDone={() => {
              reset();
              setOpen(false);
              onChanged();
            }}
          />
        ) : (
          <div className="space-y-4">
            <Field label={t("urlLabel")} hint={t("urlHint")}>
              <input
                className="input ltr font-mono text-xs"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://example.com/hooks/echo"
                inputMode="url"
              />
            </Field>

            <fieldset>
              <legend className="mb-1.5 block text-sm font-medium text-fg">
                {t("eventsLabel")}
              </legend>
              <p className="mb-2 text-xs leading-6 text-fg-muted">{t("eventsHint")}</p>
              <div className="space-y-2">
                {GATEWAY_EVENTS.map((event) => (
                  // `.tap` goes on the LABEL, not the checkbox: a checkbox is a
                  // replaced element and grows no pseudo-element either. The
                  // label is already the wide hit target (clicking the text
                  // toggles it); what it lacked was height — 20px.
                  <label key={event} className="tap flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[rgb(var(--accent))]"
                      checked={events.includes(event)}
                      onChange={(input) =>
                        setEvents((current) =>
                          input.target.checked
                            ? [...current, event]
                            : current.filter((value) => value !== event),
                        )
                      }
                    />
                    <span className="text-sm text-fg">{t(EVENT_LABEL_KEY[event])}</span>
                    <span className="ltr font-mono text-xs text-fg-muted">{event}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            {error ? <p className="text-sm text-danger">{error}</p> : null}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="btn-secondary h-10 min-h-0 px-4 text-sm"
                onClick={() => {
                  reset();
                  setOpen(false);
                }}
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                className="btn-primary h-10 min-h-0 px-4 text-sm"
                disabled={busy}
                onClick={() => void create()}
              >
                {busy ? t("adding") : t("add")}
              </button>
            </div>
          </div>
        )}
      </Dialog>
    </Card>
  );
}
