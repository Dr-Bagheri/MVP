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
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      /*
       * tsconfig `paths` covers the TYPE-only guard, which never executes.
       * The coverage test imports this module as a VALUE — it enumerates the
       * real exports — so vitest needs its own alias. Without it the file
       * fails to import and vitest reports "no tests", which is a pass-shaped
       * silence: a coverage check that never ran looks identical to one with
       * nothing to report.
       */
      "@echo/core/vocabulary": fileURLToPath(
        new URL("../core/src/api/vocabulary.ts", import.meta.url),
      ),
    },
  },
});
