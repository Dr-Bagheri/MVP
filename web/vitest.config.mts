import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

/**
 * Rule 13 needs an executable form in web/. Until now the only thing enforced
 * here at build time was types — which caught four invented vocabularies, but
 * cannot tell you that a one-way door actually refuses to close, or that a
 * delivery with no HTTP response renders as "no response" rather than a dash.
 * Those were verified by hand, which means verified once.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    server: {
      deps: {
        /*
         * The `next/server` alias below only applies to modules vite
         * PROCESSES — vitest externalizes node_modules by default, and an
         * externalized next-intl resolves `next/server` with raw Node rules,
         * where the extensionless subpath fails on Next 16. Inlining
         * next-intl routes its imports through the alias.
         */
        inline: [/next-intl/],
      },
    },
  },
  resolve: {
    // Array form: one list carries every alias (vite takes ONE resolve.alias).
    alias: [
      /*
       * Next 16: the `next/server` subpath resolves in Next's own bundlers
       * but not as bare ESM — vite-node needs the explicit `.js` (the exact
       * hint in the failure: 'Did you mean "next/server.js"?'). next-intl's
       * ESM middleware imports the bare form, which took out every test that
       * touches the intl middleware on the 15→16 upgrade (2026-08-20).
       * Regex-anchored so `next/server.js` itself is left alone.
       */
      { find: /^next\/server$/, replacement: "next/server.js" },
      { find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) },
      /*
       * tsconfig `paths` covers the TYPE-only guard, which never executes.
       * The coverage test imports this module as a VALUE — it enumerates the
       * real exports — so vitest needs its own alias. Without it the file
       * fails to import and vitest reports "no tests", which is a pass-shaped
       * silence: a coverage check that never ran looks identical to one with
       * nothing to report.
       */
      {
        find: "@echo/core/vocabulary",
        replacement: fileURLToPath(new URL("../core/src/api/vocabulary.ts", import.meta.url)),
      },
    ],
  },
});
