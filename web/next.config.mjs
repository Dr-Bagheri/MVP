import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  /**
   * The build gate builds into its OWN directory.
   *
   * `next build` and `next dev` both write `.next`, and several sessions share
   * one dev server in this repo — running the gate against the same directory
   * corrupts it for whoever is using the app. That is not theoretical: it
   * produced `Cannot find module for page: /_not-found` on the build and
   * `Cannot find module './6793.js'` 500s on every route in the browser, at the
   * same time, from exactly this collision.
   *
   * Default unchanged, so `next dev` and a plain `next build` behave as before.
   */
  distDir: process.env.NEXT_BUILD_DIR ?? ".next",
  // web/ is UI + BFF (M1): the browser never holds a token, so no API keys
  // or upstream URLs are ever exposed to the client bundle.
  poweredByHeader: false,
  // keeps the dev-only static-route badge out of screenshot captures
  devIndicators: { appIsrStatus: false },
};

export default withNextIntl(nextConfig);
