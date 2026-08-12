import type { Metadata } from "next";
import type { ReactNode } from "react";
import localFont from "next/font/local";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing, dirFor } from "@/i18n/routing";
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
    ? { title: "اکو", description: "گفت‌وگوهای کاری، قابل جست‌وجو و قابل اتکا" }
    : { title: "Echo", description: "Business conversations, searchable and reliable" };
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
        {/* theme applied before paint so dark never flashes light */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('echo-theme')||'light';document.documentElement.dataset.theme=t;}catch(e){}})();`,
          }}
        />
      </head>
      <body className={`${vazirmatn.variable} font-sans`}>
        <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
