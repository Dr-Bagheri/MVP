"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { Connector, GatewayConfig } from "@/api/types";
import { AppShell } from "@/components/AppShell";
import { Card, Chip, Field, PageHeader } from "@/components/ui";

export default function ConnectorsPage() {
  const t = useTranslations("connectors");
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [gateway, setGateway] = useState<GatewayConfig | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void api.connectors().then(setConnectors);
    void api.gateway().then(setGateway);
  }, []);

  const masked = gateway ? `${gateway.api_key.slice(0, 12)}${"•".repeat(18)}` : "";

  return (
    <AppShell page={t("title")}>
      <PageHeader title={t("title")} />

      {/* the gateway ships in v1 (M17) — it leads the page */}
      <Card className="mb-6">
        <div className="mb-2 flex items-center gap-2">
          <h2 className="text-sm font-semibold text-fg">{t("gateway")}</h2>
          <Chip tone="success">v1</Chip>
        </div>
        <p className="mb-4 text-sm leading-7 text-fg-muted">{t("gatewayNote")}</p>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t("apiKey")}>
            <div className="flex gap-2">
              <input
                className="input ltr font-mono text-xs"
                readOnly
                value={revealed ? (gateway?.api_key ?? "") : masked}
              />
              <button
                className="btn-secondary h-11 min-h-0 px-3 text-xs"
                onClick={() => setRevealed((v) => !v)}
              >
                {revealed ? t("hide") : t("reveal")}
              </button>
              <button
                className="btn-secondary h-11 min-h-0 px-3 text-xs"
                onClick={async () => {
                  if (gateway) await navigator.clipboard.writeText(gateway.api_key);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? t("copied") : t("copy")}
              </button>
            </div>
          </Field>

          <Field label={t("webhookUrl")}>
            <input
              className="input ltr text-xs"
              defaultValue={gateway?.webhook_url ?? ""}
              placeholder="https://…"
            />
          </Field>
        </div>

        <div className="mt-4 flex gap-2">
          <button className="btn-secondary h-10 min-h-0 px-3 text-xs">{t("regenerate")}</button>
          <button className="btn-ghost h-10 min-h-0 px-3 text-xs">{t("docs")}</button>
        </div>
      </Card>

      {/* catalogue: previews in v1 */}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {connectors.map((connector) => (
          <Card key={connector.id}>
            <div className="mb-1 flex items-start justify-between gap-2">
              <h3 className="font-medium text-fg">{connector.name}</h3>
              <Chip tone="neutral">{t("preview")}</Chip>
            </div>
            <p className="text-sm text-fg-muted">{connector.description}</p>
            <p className="mt-2 text-xs uppercase tracking-wide text-fg-muted ltr">
              {connector.category}
            </p>
          </Card>
        ))}
      </div>
    </AppShell>
  );
}
