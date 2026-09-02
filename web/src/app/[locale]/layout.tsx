import type { Metadata } from "next";
import type { ReactNode } from "react";
import localFont from "next/font/local";
import { NextIntlClientProvider } from "next-intl";
import { DirectionProvider } from "@radix-ui/react-direction";
import { getMessages, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing, dirFor } from "@/i18n/routing";
import { CrumbTitleProvider } from "@/components/platform/CrumbTitle";
import { PresenceDock } from "@/components/platform/PresenceDock";
import { FloatingRecorder } from "@/components/echo/FloatingRecorder";
import { TourOverlay } from "@/components/platform/TourOverlay";
import { themeBootScript } from "@/lib/theme";
import "../globals.css";

const vazirmatn = localFont({
  src: [
    { path: "../fonts/Vazirmatn-Regular.ttf", weight: "400", style: "normal" },
    { path: "../fonts/Vazirmatn-Medium.ttf", weight: "500", style: "normal" },
    { path: "../fonts/Vazirmatn-SemiBold.ttf", weight: "600", style: "normal" },
    { path: "../fonts/Vazirmatn-Bold.ttf", weight: "700", style: "normal" },
  ],
  variable: "--font-vazirmatn",
  display: "swap",
});

/**
 * Locale-aware title. The Persian name «اکو» is the product's name in fa —
 * it is not decoration bolted onto the English build, so the EN title is just
 * "Echo" (M18 brand family).
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return locale === "fa"
    ? { title: "پلتفرم نورای", description: "گفت‌وگوهای کاری، قابل جست‌وجو و قابل اتکا" }
    : { title: "NeurAI Platform", description: "Business conversations, searchable and reliable" };
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!routing.locales.includes(locale as never)) notFound();
  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <html lang={locale} dir={dirFor(locale)} suppressHydrationWarning>
      <head>
        {/*
          Theme applied before paint so dark never flashes light. The script is
          BUILT from the same constants the toggle writes (src/lib/theme.ts) —
          it used to be a hand-written string with a different key and the
          opposite default, which meant this script caused the flash it exists
          to prevent, and a stored preference lost every first paint.
        */}
        <script dangerouslySetInnerHTML={{ __html: themeBootScript() }} />
      </head>
      <body className={`${vazirmatn.variable} font-sans`}>
        <NextIntlClientProvider messages={messages}>
          {/*
            EVERY RADIX PANEL LEARNS THE DIRECTION HERE. Radix reads `dir`
            from this context and defaults to "ltr" when nothing provides it
            — it does NOT look at <html dir>. Without this, a submenu flies
            out to the RIGHT of its parent in a Persian menu, `align="end"`
            aligns to the wrong edge, and ArrowLeft/ArrowRight step the wrong
            way through a menu. All of it renders, none of it errors, and the
            whole platform is subtly mirrored — the direction of failure this
            repo keeps meeting: correct-looking and silently wrong.
          */}
          <DirectionProvider dir={dirFor(locale)}>
          {/*
            The breadcrumb's entity title lives here, ABOVE every page, because
            a page sets its own title and then renders the shell — so a provider
            inside the shell is the page's child and can never receive the
            write. This is the only place that is an ancestor of both the page
            and the top bar the page renders.
          */}
          <CrumbTitleProvider>{children}</CrumbTitleProvider>
          {/* M34: the agent's presence — every route, one continuous thread.
              Renders nothing for signed-out visitors and on the hub (the hub
              IS the maximized presence). */}
          <PresenceDock />
          {/* the mini recorder (2026-08-22; docked 2026-08-23): a live take
              stays visible and controllable on every page except the
              recorder's own — portalled into the top bar's slot beside the
              clock when a bar is present, floating otherwise; renders
              nothing when no take is rolling */}
          <FloatingRecorder />
          {/* the guided tours (2026-08-26) — mounted here so a lesson
              survives the navigations its own steps ask for */}
          <TourOverlay />
          </DirectionProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
