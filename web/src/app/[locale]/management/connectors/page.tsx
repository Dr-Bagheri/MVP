"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { Connector, GatewayKey, GatewayWebhook, User } from "@/api/types";
import { ManagementPane } from "@/components/platform/ManagementPane";
import { Card, Chip, PageHeader } from "@/components/ui";
import { DeliveriesCard } from "./_components/DeliveriesCard";
import { KeysCard } from "./_components/KeysCard";
import { WebhooksCard } from "./_components/WebhooksCard";

/**
 * Connectors & the API gateway (M17).
 *
 * A full replacement for the screen that stood here, not a migration. The
 * original was built against an earlier single-key gateway and offered to
 * **reveal** a stored key — something the real API structurally cannot do,
 * because core/ keeps a sha256 and a six-character display prefix and nothing
 * else. There is no reveal endpoint and there never will be, so the affordance
 * could not be repaired; it had to go, and with it the `GatewayConfig`
 * view-model it read.
 *
 * The gateway ships in v1 and leads the page; the connector catalogue below it
 * is previews (named connectors get built ON the gateway later).
 *
 * Two sentences carry this screen, and they are the ones the steward blessed:
 * a key **can do what you can do** — never "full API access", which is both
 * false and dangerous — and a webhook is **a doorbell, not a delivery**.
 */
export default function ConnectorsPage() {
  const t = useTranslations("connectors");
  const g = useTranslations("gateway");

  const [me, setMe] = useState<User | null>(null);
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [keys, setKeys] = useState<GatewayKey[]>([]);
  const [webhooks, setWebhooks] = useState<GatewayWebhook[]>([]);
  const [members, setMembers] = useState<User[]>([]);

  /*
   * Managing keys and webhooks is admin-only, enforced by RLS (db/0013's
   * api_key_admin / webhook_admin) with core/'s requireAdmin in front of it so
   * a member gets one legible 403 instead of a confusing empty result.
   *
   * This flag is an AFFORDANCE and never the wall — the same posture as
   * `Skill.editable`. It decides what to ASK FOR, so that a member does not
   * fire four requests that will all be refused, and what to explain instead.
   * If it ever disagreed with the server, the server wins and the user gets a
   * refusal, not a silent success.
   */
  const isAdmin = me?.role === "admin";

  const refreshGateway = useCallback(async () => {
    const [nextKeys, nextWebhooks] = await Promise.all([
      api.gatewayKeys(),
      api.gatewayWebhooks(),
    ]);
    setKeys(nextKeys);
    setWebhooks(nextWebhooks);
  }, []);

  useEffect(() => {
    void api.me().then(setMe);
    void api.connectors().then(setConnectors);
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    void refreshGateway();
    // Acts-as is a member id on the wire; the name comes from the member list.
    void api.members().then(setMembers);
  }, [isAdmin, refreshGateway]);

  return (
    <ManagementPane activeSlug="connectors">
      <div>
      <PageHeader title={t("title")} />

      <Card className="mb-4">
        <div className="mb-2 flex items-center gap-2">
          <h2 className="h-section">{g("title")}</h2>
          <Chip tone="success">v1</Chip>
        </div>
        <p className="text-sm leading-7 text-fg-muted">{g("intro")}</p>
      </Card>

      {me === null ? null : isAdmin ? (
        <>
          <KeysCard
            keys={keys}
            members={members}
            meId={me.id}
            onChanged={() => void refreshGateway()}
          />
          <WebhooksCard webhooks={webhooks} onChanged={() => void refreshGateway()} />
          <DeliveriesCard webhooks={webhooks} />
        </>
      ) : (
        /*
         * Not an empty list. A member who saw "no keys" would read it as "this
         * org has no integrations" — a claim about the org built out of a fact
         * about their own permissions, which is exactly the confusion that not
         * sending the request at all avoids.
         */
        <Card className="mb-4">
          <h2 className="h-section">{g("adminOnly")}</h2>
          <p className="mt-1 text-sm leading-7 text-fg-muted">{g("adminOnlyNote")}</p>
        </Card>
      )}

      {/* catalogue: previews in v1 — these get built ON the gateway above.
          No heading of its own: `connectors.*` is Front-end 1's namespace and
          has no key for one, and inventing a string in someone else's
          namespace to justify a divider is not worth a divider. */}
      <div className="mt-6 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {connectors.map((connector) => (
          <Card key={connector.id}>
            <div className="mb-1 flex items-start justify-between gap-2">
              <h3 className="font-medium text-fg">{connector.name}</h3>
              <Chip tone="neutral">{t("preview")}</Chip>
            </div>
            <p className="text-sm text-fg-muted">{connector.description}</p>
            <p className="ltr mt-2 text-xs uppercase tracking-wide text-fg-muted">
              {connector.category}
            </p>
          </Card>
        ))}
      </div>
    </div>
    </ManagementPane>
  );
}
