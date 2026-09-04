"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { AmbientNetwork } from "./AmbientNetwork";

/**
 * THE COMPANY'S FRONT PAGE, inside the platform app (user directive,
 * 2026-09-05: "site becomes a public route in the platform app and the login
 * is a local link").
 *
 * ── WHAT IT REPLACES, AND WHY THE COPY IS DIFFERENT ───────────────────────
 *
 * The old site said «calls become knowledge, meetings become memory» over a
 * violet field. That was a claim about RECORDING, written when Echo was the
 * product — and Echo stopped being a surface on 2026-09-04. What the platform
 * is now is agents that do work: they answer in the team's rooms, read the
 * board and the calendar, draft the reply that waits in your Drafts, and hand
 * the rest to each other. So the page says that instead, on the product's own
 * green rather than a retired brand.
 *
 * ── THE ONE DOOR ──────────────────────────────────────────────────────────
 *
 * There is no call to action in the middle of anything. The directive is
 * explicit and the reasoning is sound: a page whose every section ends in a
 * button is a page that does not trust its own words. «ورود» sits in the top
 * bar, it is the only control here, and it is a LOCAL link to this app's own
 * sign-in — same deployment, same session, no cross-domain hop.
 *
 * ── EVERY FIGURE IS MEASURED, AND SAYS SO ─────────────────────────────────
 *
 * The old site rendered its numbers as `0%` and `0` because they were never
 * filled in — a placeholder that reads as a claim. These four are real, and
 * each carries the conditions that make it checkable. The two that change
 * with every release carry their measurement DATE as well, because a bare
 * count on a public page is wrong within a month and nobody is watching.
 */

/* ── the shared scaffolding ─────────────────────────────────────────────── */

/** rise-and-fade on entry; instant for anybody who asked for less movement */
function Reveal({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (node === null) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting === true) {
        window.setTimeout(() => setShown(true), delay);
        observer.disconnect();
      }
    }, { rootMargin: "0px 0px -12% 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [delay]);
  return <div ref={ref} className={shown ? "site-shown" : "site-hidden"}>{children}</div>;
}

/**
 * THE SECTION LABEL, and why it is a function of the locale.
 *
 * The design's small mono caps are a LATIN device: uppercase does nothing to
 * Persian letterforms and `letter-spacing` pulls apart the joins that make a
 * Persian word one shape. The first version applied both to every label and
 * `persianType.guard` caught it — correctly, and it is not a lint nit: a
 * Persian reader would have seen «ه و ش ‌ م ص ن و ع ی» where a word should be.
 *
 * So the treatment splits. Latin keeps the mono caps that make the page feel
 * like an instrument; Persian gets the platform's own group-label role, which
 * is the same size and weight and is BUILT for joined script.
 */
function useLabelClass(): string {
  const locale = useLocale();
  return locale === "fa"
    ? "text-group-label text-fg-subtle"
    : "font-mono text-[10px] uppercase tracking-[0.16em] text-fg-subtle";
}
const TITLE = "mt-6 max-w-3xl text-balance text-[clamp(2.25rem,4.5vw,4rem)] font-medium leading-[1.18] text-fg";
const SECTION = "border-b border-border";
const COLUMN = "mx-auto w-full max-w-[1240px] px-7 py-24 sm:py-32";

/* ── the page ───────────────────────────────────────────────────────────── */

export function MarketingSite() {
  const t = useTranslations("site");

  return (
    /* `site-dark` re-declares the dark tokens on this subtree only — see
       globals.css for why the page does not follow the reader's theme */
    <main className="site-dark min-h-screen overflow-clip bg-bg text-fg">
      <SiteHeader />
      <Hero />
      <Principles />
      <Agents />
      <Surfaces />
      <Wall />
      <Measured />
      <Closing />
      <footer className="py-10 text-center font-mono text-[10px] tracking-[0.14em] text-fg-subtle">
        {t("footer")}
      </footer>
    </main>
  );
}

function SiteHeader() {
  const t = useTranslations("site");
  const nav = [
    ["navPrinciples", "#principles"],
    ["navAgents", "#agents"],
    ["navSurfaces", "#surfaces"],
    ["navSecurity", "#security"],
  ] as const;

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-border bg-bg/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1240px] items-center justify-between px-7">
        <a href="#top" className="tap text-base font-semibold text-fg" aria-label="NeurAI">
          Neur<span className="text-accent">AI</span>
        </a>
        <nav className="hidden items-center gap-8 md:flex" aria-label={t("navPrinciples")}>
          {nav.map(([key, href]) => (
            <a key={href} href={href} className="tap text-xs text-fg-muted transition-colors hover:text-fg">
              {t(key)}
            </a>
          ))}
        </nav>
        {/*
          THE ONLY DOOR ON THE PAGE, and a LOCAL one.
          The generated draft pointed this at `#login` while the header itself
          carried `id="login"` — so the one control on the site scrolled to the
          element it was already inside. It is the app's own sign-in now,
          through the locale-aware Link, so «ورود» keeps the reader's language
          and never leaves the deployment.
          It NEVER collapses into a menu: the nav above it may hide below md,
          this may not.
        */}
        <Link
          href="/sign-in"
          className="tap border-s border-border-strong ps-3 text-sm text-fg-muted transition-colors hover:text-fg"
        >
          {t("login")}
        </Link>
      </div>
    </header>
  );
}

function Hero() {
  const t = useTranslations("site");
  const label = useLabelClass();
  return (
    <section id="top" className={`relative flex min-h-[94svh] items-center overflow-hidden pt-16 ${SECTION}`}
      aria-labelledby="site-hero">
      <AmbientNetwork />
      <div className={`relative z-10 ${COLUMN}`}>
        <Reveal><p className={label}>{t("heroLabel")}</p></Reveal>
        <Reveal delay={80}>
          <h1 id="site-hero"
            className="mt-8 max-w-4xl text-balance text-[clamp(2.5rem,6vw,5.5rem)] font-semibold leading-[1.14] text-fg">
            {t("heroThesisA")}
            <span className="text-accent">{t("heroThesisAccent")}</span>
            {t("heroThesisB")}
          </h1>
        </Reveal>
        <Reveal delay={160}>
          <p className="mt-10 max-w-2xl text-base leading-8 text-fg-muted">{t("heroLead")}</p>
        </Reveal>
      </div>
      <p className={`absolute bottom-8 start-7 ${label}`}>{t("heroNote")}</p>
    </section>
  );
}

function Principles() {
  const t = useTranslations("site");
  const label = useLabelClass();
  return (
    <section id="principles" className={SECTION} aria-labelledby="site-principles">
      <div className={COLUMN}>
        <Reveal>
          <p className={label}>{t("principlesLabel")}</p>
          <h2 id="site-principles" className={TITLE}>{t("principlesTitle")}</h2>
        </Reveal>
        <div className="mt-16 grid gap-x-14 md:grid-cols-3">
          {(["p1", "p2", "p3"] as const).map((key, i) => (
            <Reveal key={key} delay={i * 70}>
              <article className="border-t border-border py-7">
                <h3 className="text-lg font-medium text-fg">{t(`${key}Title`)}</h3>
                <p className="mt-3 text-sm leading-7 text-fg-muted">{t(`${key}Body`)}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function Agents() {
  const t = useTranslations("site");
  const label = useLabelClass();
  return (
    <section id="agents" className={`bg-surface ${SECTION}`} aria-labelledby="site-agents">
      <div className={COLUMN}>
        <Reveal>
          <p className={label}>{t("agentsLabel")}</p>
          <h2 id="site-agents" className={TITLE}>{t("agentsTitle")}</h2>
        </Reveal>

        {/*
          THE SET-PIECE: a task travelling between two agents and back.
          The names are OURS — the generated draft invented «@Arman» and
          «@Dena», and naming agents this product does not have is a
          fabrication about our own platform on our own front page.
        */}
        <Reveal delay={80}>
          <div className="site-handoff" role="img" aria-label={t("a3Body")}>
            <div className="site-agent">
              <span className="site-dot" />
              <strong>@roya</strong>
            </div>
            <div className="site-track">
              <span className="site-line" />
              <span className="site-pulse" />
              <span className={`site-track-label ${label}`}>{t("handoffLabel")}</span>
            </div>
            <div className="site-agent">
              <span className="site-dot" />
              <strong>@ava</strong>
            </div>
          </div>
        </Reveal>

        <div className="mt-16 grid gap-x-14 lg:grid-cols-2">
          {(["a1", "a2", "a3", "a4", "a5"] as const).map((key, i) => (
            <Reveal key={key} delay={(i % 2) * 70}>
              <article className="border-t border-border py-7">
                <p className="font-mono text-[10px] tracking-[0.14em] text-fg-subtle">
                  {`0${i + 1}`}
                </p>
                <h3 className="mt-3 text-lg font-medium text-fg">{t(`${key}Title`)}</h3>
                <p className="mt-2.5 max-w-xl text-sm leading-7 text-fg-muted">{t(`${key}Body`)}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
      {/* FOUR, the cap that actually shipped — the draft said 03 */}
      <p className={`px-7 pb-8 text-end ${label}`}>{"// CHAIN_LIMIT: 04"}</p>
    </section>
  );
}

function Surfaces() {
  const t = useTranslations("site");
  const label = useLabelClass();
  const codes = ["ROOMS", "MEETINGS", "TASKS", "PROJECTS",
    "WORKFLOWS", "RECORDS", "INTEGRATIONS", "ASSISTANT"] as const;
  return (
    <section id="surfaces" className={SECTION} aria-labelledby="site-surfaces">
      <div className={COLUMN}>
        <Reveal>
          <p className={label}>{t("surfacesLabel")}</p>
          <h2 id="site-surfaces" className={TITLE}>{t("surfacesTitle")}</h2>
        </Reveal>
        <div className="mt-16 grid border-s border-t border-border sm:grid-cols-2 lg:grid-cols-4">
          {codes.map((code, i) => (
            <Reveal key={code} delay={(i % 4) * 60}>
              <article className="site-cell group">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] tracking-[0.14em] text-fg-subtle">{code}</span>
                  <span className="h-px w-5 bg-border-strong transition-colors group-hover:bg-accent" />
                </div>
                <h3 className="mt-9 text-xl font-medium text-fg">{t(`s${i + 1}Title`)}</h3>
                <p className="mt-3 text-sm leading-7 text-fg-muted">{t(`s${i + 1}Body`)}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function Wall() {
  const t = useTranslations("site");
  const label = useLabelClass();
  return (
    <section id="security" className={`bg-surface ${SECTION}`} aria-labelledby="site-security">
      <div className={COLUMN}>
        <Reveal>
          <p className={label}>{t("securityLabel")}</p>
          <h2 id="site-security" className={TITLE}>{t("securityTitle")}</h2>
        </Reveal>
        <div className="mt-16 max-w-3xl">
          {(["w1", "w2", "w3", "w4"] as const).map((key, i) => (
            <Reveal key={key} delay={i * 60}>
              <p className="border-t border-border py-6 text-base leading-8 text-fg-muted">{t(key)}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function Measured() {
  const t = useTranslations("site");
  const label = useLabelClass();
  /*
   * STATIC TEXT, never a count-up. The old site showed these as zeros because
   * nobody filled them in, and an animation that starts at zero can be read
   * as exactly that wrong number by anybody who glances during the first
   * frame. The Latin digits are deliberate too: these are measurements, and
   * `dir="ltr"` keeps «2.1%» from being reordered on a Persian line.
   */
  const figures = [["2.1%", "m1Cond"], ["2,394", "m2Cond"],
    ["190", "m3Cond"], ["0", "m4Cond"]] as const;
  return (
    <section id="measured" className={SECTION} aria-labelledby="site-measured">
      <div className={COLUMN}>
        <Reveal>
          <p className={label}>{t("metricsLabel")}</p>
          <h2 id="site-measured" className={TITLE}>{t("metricsTitle")}</h2>
        </Reveal>
        <div className="mt-16 grid gap-x-10 gap-y-12 sm:grid-cols-2 lg:grid-cols-4">
          {figures.map(([value, cond], i) => (
            <Reveal key={value} delay={i * 60}>
              <article className="border-t border-border-strong pt-6">
                <p className="font-mono text-4xl text-fg sm:text-5xl" dir="ltr">{value}</p>
                <p className="mt-6 font-mono text-[11px] leading-6 text-fg-subtle">{t(cond)}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function Closing() {
  const t = useTranslations("site");
  return (
    <section className="flex min-h-[70svh] items-center" aria-labelledby="site-closing">
      <div className={COLUMN}>
        <Reveal>
          {/* no button here either — the door is still at the top */}
          <p id="site-closing"
            className="max-w-3xl text-balance text-[clamp(1.75rem,3.5vw,3rem)] font-medium leading-[1.3] text-fg">
            {t("closing")}
          </p>
        </Reveal>
      </div>
    </section>
  );
}
