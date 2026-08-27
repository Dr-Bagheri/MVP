"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { Me } from "@/api/types";
import { notify } from "@/lib/notify";
import { Chip } from "@/components/ui";

/**
 * Settings · Sign-in methods.
 *
 * Since 0078 the availability of each external provider is a SETTING an
 * admin or the owner flips here — the toggle writes through core to the
 * SQL definer door (admin-walled twice; this screen only draws the state).
 * Members see the state without the switch: what the sign-in page offers
 * is a fact everyone may know and only admins may change.
 *
 * The projection updates on the server's answer, never optimistically —
 * a switch that flips back on refusal teaches exactly what happened.
 */
export function SignInMethods() {
  const t = useTranslations("signin");
  const [methods, setMethods] = useState<{ provider: string; enabled: boolean }[]>([]);
  /** db/0112 - the domain wall; absent until the org wire carries it */
  const [domains, setDomains] = useState<string[]>([]);
  const [domainsReady, setDomainsReady] = useState(false);
  const [domainDraft, setDomainDraft] = useState("");
  const [me, setMe] = useState<Me | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    void api.authMethods().then(setMethods).catch(() => setMethods([]));
    void api.org().then((org) => {
      if ("allowed_email_domains" in org) {
        setDomainsReady(true);
        setDomains((org.allowed_email_domains as string[]) ?? []);
      }
    }).catch(() => undefined);
    void api.me().then(setMe).catch(() => setMe(null));
  }, []);

  const mayToggle = me?.role === "admin" || me?.role === "owner";

  async function saveDomains(next: string[]) {
    try {
      const org = await api.updateOrg({ allowed_email_domains: next });
      setDomains((org.allowed_email_domains as string[]) ?? next);
      notify(t("domainsSaved"));
    } catch (cause) {
      // the server's named refusal (a bad domain names itself) verbatim
      const { detail } = cause as { detail?: string };
      notify(detail || t("domainsFailed"), "warn");
    }
  }
  async function addDomain() {
    const value = domainDraft.trim().toLowerCase();
    if (value === "") return;
    setDomainDraft("");
    await saveDomains([...domains, value]);
  }

  async function toggle(provider: "google" | "github", enabled: boolean): Promise<void> {
    setBusy(provider);
    try {
      const result = await api.setAuthMethod(provider, enabled);
      setMethods((prev) =>
        prev.map((m) => (m.provider === provider ? { ...m, enabled: result.enabled } : m)));
      notify(t(result.enabled ? "turnedOn" : "turnedOff", { method: t(`method_${provider}`) }));
    } catch {
      notify(t("toggleFailed"), "warn");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm leading-7 text-fg-muted">{t("intro")}</p>
      <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
        {(["google", "github"] as const).map((key) => {
          const row = methods.find((m) => m.provider === key);
          const enabled = row?.enabled ?? true;
          return (
            <div key={key} className="flex items-center gap-3 px-5 py-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-fg">{t(`method_${key}`)}</p>
                <p className="mt-0.5 text-detail leading-6 text-fg-muted">{t(`method_${key}_note`)}</p>
              </div>
              <Chip tone={enabled ? "success" : "neutral"}>
                {t(enabled ? "active" : "off")}
              </Chip>
              {mayToggle ? (
                <button
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  aria-label={t("toggleLabel", { method: t(`method_${key}`) })}
                  disabled={busy !== null}
                  className={`tap relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                    enabled ? "bg-accent" : "bg-surface-2 border border-border"
                  } ${busy === key ? "opacity-60" : ""}`}
                  onClick={() => void toggle(key, !enabled)}
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                      enabled ? "end-0.5" : "start-0.5"
                    }`}
                    aria-hidden
                  />
                </button>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* db/0112 - the invitation domain wall (Sign-in methods 73).
          Members SEE the policy (they are governed by it); admins edit.
          Whole-set write through updateOrg; [] clears the wall. */}
      {domainsReady ? (
        <div className="mt-5">
          <h2 className="h-section">{t("domainsTitle")}</h2>
          <p className="mt-1 text-sm leading-6 text-fg-muted">{t("domainsHint")}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {domains.map((domain) => (
              <span key={domain} dir="ltr"
                className="flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 font-mono text-xs text-fg">
                {domain}
                {mayToggle ? (
                  <button type="button" aria-label={t("domainRemove", { domain })}
                    className="text-fg-subtle hover:text-danger"
                    onClick={() => void saveDomains(domains.filter((d) => d !== domain))}>
                    ×
                  </button>
                ) : null}
              </span>
            ))}
            {domains.length === 0 ? (
              <span className="text-sm text-fg-muted">{t("domainsNone")}</span>
            ) : null}
          </div>
          {mayToggle ? (
            <div className="mt-3 flex items-center gap-2">
              <input
                dir="ltr"
                className="input h-9 min-h-0 w-56 py-0 font-mono text-sm"
                placeholder="example.com"
                value={domainDraft}
                onChange={(e) => setDomainDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void addDomain(); }}
              />
              <button type="button" className="btn-secondary h-9 min-h-0 px-3 text-sm"
                onClick={() => void addDomain()}>
                {t("domainAdd")}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
