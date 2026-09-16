"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { Me } from "@/api/types";
import { IconInfoCircle } from "@/components/icons";

/**
 * «YOUR WORKSPACE AWAITS VERIFICATION» — the one sentence, drawn where the
 * agents live (db/0224, M54).
 *
 * User ruling, 2026-09-16: a stranger walks in through the gate and is IN;
 * what waits for the platform's word is the agents, because they spend
 * tokens. So the notice says exactly that — what works now (everything but
 * the agents) and what switches on after — and it says it BEFORE the person
 * presses a composer, on Home and in the room, rather than as a refusal
 * after they have typed a question.
 *
 * Rendered only on an explicit `false`: ABSENT means the deployment has no
 * such wall (types.ts's three-state rule), and drawing a "waiting" line for
 * everybody on a schema without the column would be the notice lying about
 * a wall that does not exist.
 *
 * A STATE, not an explanation under a title (R21's allowed kind): the
 * product is refusing something specific and says why.
 */
export function verificationDue(me: Me | null | undefined): boolean {
  return me !== null && me !== undefined && me.org_verified === false;
}

/**
 * The notice that reads its own identity — for surfaces that hold no `me`
 * (Home, the room). One cached read through the client's burst tier, the
 * FirstRunDoor's shape; nothing while it is unanswered, since "still asking"
 * must never draw as "waiting for verification".
 */
export function VerificationBanner({ className = "" }: { className?: string }) {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    /* inside a promise, so a read that cannot even be asked — a surface
       whose test fakes an `api` with no `me` — is the same silence as one
       that failed: no identity, no claim (the 2026-09-04 mock lesson, met
       from the component's side) */
    void Promise.resolve()
      .then(() => api.me())
      .then((identity) => { if (live) setMe(identity); })
      .catch(() => undefined);
    return () => { live = false; };
  }, []);
  return <VerificationNotice me={me} className={className} />;
}

export function VerificationNotice({ me, className = "" }: { me: Me | null | undefined; className?: string }) {
  const t = useTranslations("verification");
  if (!verificationDue(me)) return null;
  return (
    <div
      role="status"
      className={`well flex items-start gap-3 border border-warning/30 bg-warning/10 px-4 py-3 text-sm ${className}`}
    >
      <span className="mt-0.5 shrink-0 text-warning" aria-hidden><IconInfoCircle width={16} height={16} /></span>
      <span className="min-w-0">
        <span className="block font-semibold text-fg">{t("title")}</span>
        <span className="mt-0.5 block leading-6 text-fg-muted">{t("body")}</span>
      </span>
    </div>
  );
}
