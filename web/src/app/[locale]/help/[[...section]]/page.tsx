"use client";

import { use } from "react";
import { useTranslations } from "next-intl";
import { GITHUB_HREF } from "@/components/platform/nav";
import { TwoPane } from "@/components/platform/TwoPane";
import { PageHeader, Section } from "@/components/scaffold";
import { Card } from "@/components/ui";
import { digits } from "@/lib/format";
import { useLocale } from "next-intl";
import { HELP_GROUPS, HELP_SECTIONS, type HelpSlug } from "../sections";

/**
 * Help — a real guide (user directive, 2026-08-16): "how to work with the
 * platform, with simple images", one side-menu section per part.
 *
 * Rewritten from the beginning (user directive, 2026-08-28) to match the
 * platform as it stands: the Assistant is the landing page; Workflows,
 * Integrations and Agents live under its menu; Echo carries the live-
 * transcript record page; Management holds the organisation; Settings and
 * Profile carry the person. The old copy taught a hub-with-app-cards home
 * and an organisation under Settings — both gone, and a guide that teaches
 * a layout the product no longer has is worse than none.
 *
 * The illustrations are inline SVG sketches drawn from the theme's own
 * tokens (currentColor + the accent), not screenshots: a screenshot of the
 * UI ages the moment a screen changes and silently teaches the OLD layout,
 * while a sketch shows the shape of the flow and survives a restyle. Each
 * is decorative (aria-hidden) beside numbered steps that carry the meaning
 * — the image guides the eye, the words carry the truth.
 *
 * Steps live in the message catalogue per section (`help.s.<slug>.stepN`).
 * Those keys are COMPUTED here, so `keys.test.ts` cannot see them — the
 * colocated `help.test.tsx` walks `HELP_SECTIONS` against both catalogues
 * instead, and renders every section with a positive ID and a negative
 * control.
 */

/** Simple, theme-drawn sketches — one per section. Decorative only. */
function HelpArt({ slug }: { slug: HelpSlug }) {
  const cls = "w-full max-w-[420px] text-fg-muted";
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (slug === "overview") {
    return (
      <svg viewBox="0 0 320 150" className={cls} aria-hidden>
        {/* rail | content | assistant panel — the shell's three columns */}
        <rect x="8" y="10" width="34" height="130" rx="6" {...common} />
        <circle cx="25" cy="30" r="6" {...common} className="text-accent" />
        <circle cx="25" cy="52" r="6" {...common} />
        <circle cx="25" cy="74" r="6" {...common} />
        <rect x="54" y="10" width="170" height="130" rx="6" {...common} />
        <line x1="70" y1="40" x2="208" y2="40" {...common} />
        <line x1="70" y1="60" x2="180" y2="60" {...common} />
        <rect x="70" y="90" width="138" height="30" rx="8" {...common} className="text-accent" />
        <rect x="236" y="10" width="76" height="130" rx="6" {...common} />
        <line x1="248" y1="36" x2="300" y2="36" {...common} />
        <line x1="248" y1="52" x2="288" y2="52" {...common} />
      </svg>
    );
  }
  if (slug === "assistant") {
    return (
      <svg viewBox="0 0 320 120" className={cls} aria-hidden>
        {/* the composer: input, mic, send, picker pills */}
        <rect x="10" y="20" width="300" height="52" rx="14" {...common} />
        <line x1="28" y1="46" x2="150" y2="46" {...common} />
        <circle cx="248" cy="46" r="10" {...common} />
        <rect x="270" y="32" width="28" height="28" rx="9" {...common} className="text-accent" />
        <path d="m279 46 10-5-3 5 3 5z" fill="currentColor" stroke="none" className="text-accent" />
        <rect x="18" y="86" width="70" height="20" rx="10" {...common} />
        <rect x="96" y="86" width="56" height="20" rx="10" {...common} />
        <rect x="180" y="86" width="120" height="20" rx="10" {...common} className="text-accent" />
      </svg>
    );
  }
  if (slug === "workflows") {
    return (
      <svg viewBox="0 0 320 120" className={cls} aria-hidden>
        {/* trigger → ordered steps, and the personal on/off switch */}
        <circle cx="30" cy="72" r="13" {...common} className="text-accent" />
        <line x1="44" y1="72" x2="64" y2="72" {...common} />
        <path d="m58 66 6 6-6 6" {...common} />
        <rect x="70" y="54" width="62" height="36" rx="8" {...common} />
        <line x1="134" y1="72" x2="150" y2="72" {...common} />
        <path d="m144 66 6 6-6 6" {...common} />
        <rect x="156" y="54" width="62" height="36" rx="8" {...common} />
        <line x1="220" y1="72" x2="236" y2="72" {...common} />
        <path d="m230 66 6 6-6 6" {...common} />
        <rect x="242" y="54" width="62" height="36" rx="8" {...common} className="text-accent" />
        <rect x="242" y="14" width="46" height="20" rx="10" {...common} className="text-accent" />
        <circle cx="278" cy="24" r="6" fill="currentColor" stroke="none" className="text-accent" />
      </svg>
    );
  }
  if (slug === "integrations") {
    return (
      <svg viewBox="0 0 320 120" className={cls} aria-hidden>
        {/* one sign-in in the middle, four sources around it */}
        <circle cx="160" cy="60" r="17" {...common} className="text-accent" />
        <line x1="145" y1="50" x2="76" y2="32" {...common} />
        <line x1="145" y1="70" x2="76" y2="88" {...common} />
        <line x1="175" y1="50" x2="244" y2="32" {...common} />
        <line x1="175" y1="70" x2="244" y2="88" {...common} />
        <rect x="36" y="14" width="38" height="28" rx="7" {...common} />
        <rect x="36" y="78" width="38" height="28" rx="7" {...common} />
        <rect x="246" y="14" width="38" height="28" rx="7" {...common} />
        <rect x="246" y="78" width="38" height="28" rx="7" {...common} />
      </svg>
    );
  }
  if (slug === "agents") {
    return (
      <svg viewBox="0 0 320 120" className={cls} aria-hidden>
        {/* three focused assistants; the chosen one opens a conversation */}
        {[24, 122, 220].map((x, i) => (
          <g key={x}>
            <rect x={x} y="34" width="76" height="60" rx="8" {...common}
              className={i === 1 ? "text-accent" : undefined} />
            <circle cx={x + 38} cy="54" r="9" {...common} />
            <line x1={x + 16} y1="74" x2={x + 60} y2="74" {...common} />
            <line x1={x + 22} y1="84" x2={x + 54} y2="84" {...common} />
          </g>
        ))}
        <rect x="136" y="6" width="48" height="20" rx="9" {...common} className="text-accent" />
        <path d="m152 26 6 8 4-8" {...common} className="text-accent" />
      </svg>
    );
  }
  if (slug === "echo") {
    return (
      <svg viewBox="0 0 320 120" className={cls} aria-hidden>
        {/* mic → level bars → transcript document */}
        <rect x="24" y="30" width="24" height="40" rx="12" {...common} className="text-accent" />
        <path d="M16 56c0 14 9 24 20 24s20-10 20-24" {...common} className="text-accent" />
        <line x1="36" y1="80" x2="36" y2="92" {...common} className="text-accent" />
        {[92, 106, 120, 134, 148, 162].map((x, i) => (
          <line key={x} x1={x} y1={62 - [8, 18, 26, 14, 22, 10][i]!} x2={x} y2={62} {...common} />
        ))}
        <path d="m184 56 26 0" {...common} />
        <path d="m204 48 8 8-8 8" {...common} />
        <rect x="228" y="20" width="72" height="80" rx="6" {...common} />
        <line x1="240" y1="40" x2="288" y2="40" {...common} />
        <line x1="240" y1="56" x2="280" y2="56" {...common} />
        <line x1="240" y1="72" x2="288" y2="72" {...common} />
      </svg>
    );
  }
  if (slug === "management") {
    return (
      <svg viewBox="0 0 320 120" className={cls} aria-hidden>
        {/* member rows with a selected pair and a check */}
        {[18, 52, 86].map((y, i) => (
          <g key={y}>
            <rect x="16" y={y} width="288" height="26" rx="6" {...common}
              className={i < 2 ? "text-accent" : undefined} />
            <circle cx="36" cy={y + 13} r="7" {...common} />
            <line x1="52" y1={y + 13} x2="150" y2={y + 13} {...common} />
            <rect x="240" y={y + 6} width="48" height="14" rx="7" {...common} />
          </g>
        ))}
        <path d="m286 30 6 6 10-12" {...common} className="text-accent" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 320 120" className={cls} aria-hidden>
      {/* settings sliders + avatar circle */}
      <circle cx="44" cy="60" r="24" {...common} className="text-accent" />
      <circle cx="44" cy="52" r="8" {...common} />
      <path d="M28 76c4-8 28-8 32 0" {...common} />
      {[36, 60, 84].map((y, i) => (
        <g key={y}>
          <line x1="100" y1={y} x2="300" y2={y} {...common} />
          <circle cx={[150, 250, 200][i]} cy={y} r="7" {...common} className="text-accent" />
        </g>
      ))}
    </svg>
  );
}

export default function HelpPage({
  params,
}: {
  params: Promise<{ section?: string[] }>;
}) {
  const t = useTranslations("help");
  const locale = useLocale();
  const { section } = use(params);
  const active =
    HELP_SECTIONS.find((s) => s.slug === section?.[0]) ?? HELP_SECTIONS[0]!;

  const groups = HELP_GROUPS.map((group) => ({
    key: group,
    title: t(`group.${group}`),
    items: HELP_SECTIONS.filter((s) => s.group === group).map((s) => ({
      slug: s.slug,
      href: s.slug === "overview" ? "/help" : `/help/${s.slug}`,
      label: t(`section.${s.slug}`),
    })),
  }));

  return (
    <TwoPane
      navLabel={t("title")}
      heading={t("title")}
      groups={groups}
      activeSlug={active.slug}
    >
      <PageHeader title={t(`section.${active.slug}`)} subtitle={t(`desc.${active.slug}`)} />

      <Section>
        <Card>
          <HelpArt slug={active.slug} />
          <h2 className="h-section mb-2 mt-4">{t("stepsTitle")}</h2>
          <ol className="space-y-2.5">
            {Array.from({ length: active.steps }, (_, i) => (
              <li key={i} className="flex gap-3 text-sm leading-7 text-fg">
                <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent">
                  {digits(i + 1, locale)}
                </span>
                <span>{t(`s.${active.slug}.step${i + 1}`)}</span>
              </li>
            ))}
          </ol>
        </Card>
      </Section>

      {active.slug === "overview" ? (
        <Section>
          <Card>
            <p className="text-sm font-semibold text-fg">{t("githubCard")}</p>
            <p className="mt-1 text-sm leading-7 text-fg-muted">{t("githubNote")}</p>
            <a
              href={GITHUB_HREF}
              target="_blank"
              rel="noreferrer"
              className="btn-secondary mt-3 inline-flex"
            >
              {t("openGithub")}
            </a>
          </Card>
        </Section>
      ) : null}
    </TwoPane>
  );
}
