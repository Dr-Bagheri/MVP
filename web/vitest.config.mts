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
    },
  },
});
