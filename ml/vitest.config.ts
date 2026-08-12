import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // ffmpeg fixtures and the transcode matrix are real work, not mocks.
    testTimeout: 60_000,
    hookTimeout: 120_000,
    setupFiles: ["test/setup.ts"],
  },
});
