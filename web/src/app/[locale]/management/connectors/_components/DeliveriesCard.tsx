"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { GatewayDelivery, GatewayWebhook } from "@/api/types";
import { Card, Chip, EmptyState } from "@/components/ui";
import { digits, formatDate, formatTime } from "@/lib/format";
import { EVENT_LABEL_KEY } from "./events";

/**
 * The delivery log (BFF.md §5) — the answer to "did my endpoint actually
 * receive it?".
 *
 * core/ selects `id, webhook_id, event, attempts, response_code, delivered_at,
 * failed_at, next_attempt_at, created_at` and pointedly NOT `payload`: the body
 * holds only identifiers by construction, but an endpoint that returned it
 * would invite someone to start putting more in it. So this screen shows status
 * and timing, and there is nothing here to redact.
 */

/**
 * Four outcomes, and the whole value of the log is telling them apart.
 *
 * `delivered` and `failed` are stamps core/ writes. The other two are both
 * "no stamp yet", which is exactly the kind of nothing that gets collapsed:
 * a delivery waiting for its first attempt and one that has already failed
 * three times and is queued for a fourth look identical if you only check
 * `delivered_at`. `next_attempt_at` is what separates them, and the difference
 * matters — one is the system working, the other is the endpoint refusing.
 */
type Outcome = "delivered" | "failed" | "retrying" | "queued";

function outcomeOf(delivery: GatewayDelivery): Outcome {
  if (delivery.delivered_at) return "delivered";
  if (delivery.next_attempt_at) return "retrying";
  if (delivery.failed_at) return "failed";
  return "queued";
}

const OUTCOME_TONE = {
  delivered: "success",
  failed: "danger",
  retrying: "warning",
  queued: "neutral",
} as const satisfies Record<Outcome, string>;

/** Flat keys — see `events.ts` on why a dotted key would nest. */
const OUTCOME_LABEL_KEY = {
  delivered: "outcomeDelivered",
  failed: "outcomeFailed",
  retrying: "outcomeRetrying",
  queued: "outcomeQueued",
} as const satisfies Record<Outcome, string>;

export function DeliveriesCard({ webhooks }: { webhooks: GatewayWebhook[] }) {
  const t = useTranslations("gateway");
  const locale = useLocale();
  const [deliveries, setDeliveries] = useState<GatewayDelivery[]>([]);
  /** "" = every webhook. A server filter, not a client one — see client.ts. */
  const [filter, setFilter] = useState("");

  useEffect(() => {
    void api.gatewayDeliveries(filter === "" ? undefined : filter).then(setDeliveries);
  }, [filter]);

  const urlById = new Map(webhooks.map((webhook) => [webhook.id, webhook.url]));

  return (
    <Card className="mb-4">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="h-section">{t("deliveries")}</h2>
        <select
          /*
           * `.tap` cannot help a <select>: it is a replaced element, so
           * `::after` never renders on it (verified — computed content is
           * `none`, and the hit area stayed the visual 36px). The utility
           * silently does nothing here, which is worse than not applying it.
           * So this control grows for real below `md` and keeps the dense
           * height from `md` up, which is the same bargain `.tap` strikes
           * everywhere else — just paid in layout rather than a pseudo-element.
           */
          className="input h-11 min-h-0 w-auto max-w-[16rem] py-0 text-xs md:h-9"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          aria-label={t("filterByWebhook")}
        >
          <option value="">{t("allWebhooks")}</option>
          {webhooks.map((webhook) => (
            <option key={webhook.id} value={webhook.id}>
              {webhook.url}
            </option>
          ))}
        </select>
      </div>
      <p className="mb-3 text-xs leading-6 text-fg-muted">{t("deliveriesNote")}</p>

      {deliveries.length === 0 ? (
        <EmptyState text={t("deliveriesEmpty")} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="table-head py-2 pe-3">{t("colEvent")}</th>
                <th className="table-head py-2 pe-3">{t("colWebhook")}</th>
                <th className="table-head py-2 pe-3">{t("colOutcome")}</th>
                <th className="table-head py-2 pe-3">{t("colCode")}</th>
                <th className="table-head py-2 pe-3">{t("colAttempts")}</th>
                <th className="table-head py-2">{t("colWhen")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {deliveries.map((delivery) => {
                const outcome = outcomeOf(delivery);
                return (
                  <tr key={delivery.id}>
                    <td className="py-3 pe-3 align-top">
                      <p className="text-sm text-fg">{t(EVENT_LABEL_KEY[delivery.event])}</p>
                      <p className="ltr mt-0.5 font-mono text-xs text-fg-muted">{delivery.event}</p>
                    </td>
                    <td className="ltr max-w-[16rem] break-all py-3 pe-3 align-top font-mono text-xs text-fg-muted">
                      {urlById.get(delivery.webhook_id) ?? delivery.webhook_id}
                    </td>
                    <td className="py-3 pe-3 align-top">
                      <Chip tone={OUTCOME_TONE[outcome]}>{t(OUTCOME_LABEL_KEY[outcome])}</Chip>
                      {outcome === "retrying" && delivery.next_attempt_at ? (
                        <p className="mt-1 text-xs text-fg-muted">
                          {t("nextAttempt", {
                            time: formatTime(delivery.next_attempt_at, locale),
                          })}
                        </p>
                      ) : null}
                    </td>
                    <td className="py-3 pe-3 align-top text-xs">
                      {/*
                        `null` is not "0" and not "unknown": it means the
                        request never got an HTTP answer at all — DNS, a refused
                        connection, a timeout, or the address guard refusing to
                        dial. Rendering an em-dash there would put it in the same
                        cell shape as a 200, and "no response" is the single most
                        useful thing this column can say.
                      */}
                      {delivery.response_code === null ? (
                        <span className="text-fg-muted">{t("noResponse")}</span>
                      ) : (
                        <span
                          className={`ltr font-mono ${
                            delivery.response_code < 400 ? "text-fg" : "text-danger"
                          }`}
                        >
                          {digits(delivery.response_code, locale)}
                        </span>
                      )}
                    </td>
                    <td className="py-3 pe-3 align-top text-xs text-fg-muted">
                      {digits(delivery.attempts, locale)}
                    </td>
                    <td className="py-3 align-top text-xs text-fg-muted">
                      {/* Two lines, not one: a 4px inline margin between a
                          Jalali date and a clock reads as «۲۱ مرداد ۱۴۰۵۲۰:۰۸»
                          — the year runs straight into the hour, and Persian
                          digits give the eye no seam to break on. */}
                      <p>{formatDate(delivery.created_at, locale)}</p>
                      <p className="mt-0.5">{formatTime(delivery.created_at, locale)}</p>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
