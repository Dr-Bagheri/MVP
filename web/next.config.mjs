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
  /**
   * NEXT DOES NOT WRITE OUR AGENT INSTRUCTIONS (review F8).
   *
   * `next dev` generates `web/AGENTS.md` and an 11-byte `web/CLAUDE.md`
   * (exactly `@AGENTS.md\n`) whenever it detects an agent session. The root
   * files are the repository's own; an 11-byte one in `web/` shadows them for
   * anyone working in this package, and it appears and disappears with
   * whoever last ran the dev server — which is why a fresh checkout looks
   * innocent. Both files were present in the ver4 tree and absent in ver5,
   * with nothing deliberate in between.
   *
   * `agentRules` is a real key in the INSTALLED Next (16.3.1
   * `config-schema.js:496`, `config-shared.d.ts:1574`) — checked before being
   * added, because an invented config key is silently ignored and would give
   * a fix that reads as applied and does nothing.
   *
   * NOTE FOR WHOEVER VERIFIES THIS: a production build never writes those
   * files at all — the writer is called from `start-server.js` inside
   * `if (isDev)` — so "build it and see if they come back" cannot distinguish
   * the two outcomes. Only `next dev`, run with and without this line, can.
   */
  agentRules: false,
  // (devIndicators.appIsrStatus was removed in Next 16 with the option itself)
};

export default withNextIntl(nextConfig);
