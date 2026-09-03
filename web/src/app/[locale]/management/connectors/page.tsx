"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { GatewayKey, User } from "@/api/types";
import { notify } from "@/lib/notify";
import { SettingsPane } from "@/components/platform/SettingsPane";
// audit finding, 2026-09-02: the keys slot rendered NOTHING until identity
// arrived — the loading rule wants the frame first and the content waiting in it
import { SkeletonLines } from "@/components/scaffold";
import { Card, Chip, PageHeader } from "@/components/ui";
import { KeysCard } from "./_components/KeysCard";

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
 * The sentence that carries this screen is the one the steward blessed: a key
 * **can do what you can do** — never "full API access", which is both false
 * and dangerous. (A second sentence about webhooks stood beside it until the
 * feature was removed on 2026-08-29.)
 */
export default function ConnectorsPage() {
  const t = useTranslations("connectors");
  const g = useTranslations("gateway");
  const tCommon = useTranslations("common");

  const [me, setMe] = useState<User | null>(null);
  const [keys, setKeys] = useState<GatewayKey[]>([]);
  const [members, setMembers] = useState<User[]>([]);
  /*
   * 2026-09-03: the frame before the data — loading and empty were one
   * picture. `keys` starts as [] and KeysCard reads that as «هنوز کلیدی
   * ساخته نشده است», so an admin opening this page was told their
   * organization has no integrations BEFORE the gateway had answered, and
   * the table then dropped in underneath the sentence it had just
   * contradicted.
   *
   * Three answers rather than a boolean, because the empty array has a
   * THIRD source: a read that FAILED also leaves [] behind, and "no keys
   * yet" is not what happened (rule 12 — name which nothing). `ok` is the
   * only state in which this page may make a claim about the org.
   */
  const [gateway, setGateway] = useState<"pending" | "ok" | "failed">("pending");

  /*
   * Managing keys is admin-only, enforced by RLS (db/0013's api_key_admin)
   * with core/'s requireAdmin in front of it so a member gets one legible 403
   * instead of a confusing empty result.
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

  /**
   * Re-read after a mint or a revoke. NOT the first read (that one is the
   * effect below): the card is already up by then, and collapsing it back to
   * a skeleton after a successful act would take the rows away at exactly the
   * moment somebody is checking that their act landed.
   *
   * 2026-09-03: it also has a catch now. `void refreshGateway()` on a
   * rejecting promise was an unhandled rejection, and swallowing it silently
   * would leave the last-known rows on screen with nothing saying they are
   * stale — the act itself succeeded, so the toast is about the re-read.
   */
  async function refreshGateway(): Promise<void> {
    try {
      setKeys(await api.gatewayKeys());
    } catch {
      notify(tCommon("actionFailed"), "warn");
    }
  }

  useEffect(() => {
    void api.me().then(setMe);
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    let live = true;
    /*
     * ONE answer for the two reads the card needs (2026-09-03). Acts-as is a
     * member id on the wire and the NAME comes from the member list, so a
     * keys-first render would print «این شناسه در فهرست اعضا نیست» beside a
     * perfectly ordinary colleague — a claim about the org built out of a
     * list nobody had finished reading. The card waits for both, and then
     * everything in it is true at once.
     */
    void Promise.all([api.gatewayKeys(), api.members()])
      .then(([keyRows, memberRows]) => {
        if (!live) return;
        setKeys(keyRows);
        setMembers(memberRows);
        setGateway("ok");
      })
      .catch(() => {
        if (live) setGateway("failed");
      });
    return () => {
      live = false;
    };
  }, [isAdmin]);

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

      {me === null || (isAdmin && gateway === "pending") ? (
        /*
         * audit finding, 2026-09-02: this slot was `null` until api.me()
         * resolved, so the page was the intro card and then a gap, and the
         * keys card (or the refusal card) dropped in afterwards. Which of the
         * two it will be is unknown until identity lands — that is exactly why
         * it cannot be either of them yet — but the CARD is known, so the card
         * renders now and only its contents wait. Three lines is the promise:
         * the refusal card is a heading and a sentence; the keys card is a
         * heading, a button row and a table, so the space is a floor, not a
         * guess at the table.
         *
         * 2026-09-03: the same frame now covers the GATEWAY read as well, so
         * there is one skeleton from the first paint until the card can be
         * true, rather than a skeleton, then a card claiming the org has no
         * keys, then a table. Two waits, one picture.
         */
        <Card className="mb-4">
          <SkeletonLines lines={3} />
        </Card>
      ) : !isAdmin ? (
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
      ) : gateway === "failed" ? (
        /*
         * The third nothing, said as itself. The card keeps its NAME — the
         * reader still knows which section could not be read — and the
         * platform's generic sentence carries the rest. It is deliberately
         * the generic one: a dedicated «کلیدها خوانده نشد» would be better
         * copy, and it would mean editing the locale catalogues, which are
         * not this file's to change; a borrowed sentence about the wrong
         * subject would be worse than either.
         */
        <Card className="mb-4">
          <h2 className="h-section">{g("keys")}</h2>
          <p className="mt-1 text-sm leading-7 text-fg-muted">{tCommon("actionFailed")}</p>
        </Card>
      ) : (
        <KeysCard
          keys={keys}
          members={members}
          meId={me.id}
          onChanged={() => void refreshGateway()}
        />
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
