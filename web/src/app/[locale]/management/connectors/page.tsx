"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { GatewayKey, GatewayWebhook, User } from "@/api/types";
import { SettingsPane } from "@/components/platform/SettingsPane";
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
 * The gateway ships in v1 and IS the page — the named-connector preview
 * catalogue that used to sit under it was removed (user directive: no
 * coming-soons; a fabricated catalogue is a roadmap we would have to keep).
 *
 * Two sentences carry this screen, and they are the ones the steward blessed:
 * a key **can do what you can do** — never "full API access", which is both
 * false and dangerous — and a webhook is **a doorbell, not a delivery**.
 */
export default function ConnectorsPage() {
  const t = useTranslations("connectors");
  const g = useTranslations("gateway");

  const [me, setMe] = useState<User | null>(null);
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
  // M23: the owner is an admin and more — `=== "admin"` alone locked the
  // OWNER out of their own gateway (caught while removing the catalogue)
  const isAdmin = me?.role === "admin" || me?.role === "owner";

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
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    void refreshGateway();
    // Acts-as is a member id on the wire; the name comes from the member list.
    void api.members().then(setMembers);
  }, [isAdmin, refreshGateway]);

  return (
    <SettingsPane activeSlug="connectors">
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

      {/*
        The named-connector preview cards (Slack, Teams, HubSpot, …) are GONE
        (user directive: no coming-soons anywhere). They were the hub's
        no-invented-app-tiles rule broken one surface over: a fabricated
        catalogue is a roadmap we would then have to keep. The gateway above
        is the real integration surface — any system can already push audio
        in and pull answers out — and a named connector returns here the day
        it EXISTS, not the day it is imagined.
      */}
    </div>
    </SettingsPane>
  );
}
