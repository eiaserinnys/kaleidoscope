import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e-perf",
  testMatch: ["chat-long-history.perf.ts"],
  timeout: 1_800_000,
  expect: { timeout: 30_000 },
  workers: 1,
  outputDir: process.env.KS_PLAYWRIGHT_OUTPUT ?? "test-results-perf/playwright-output",
  use: {
    baseURL: "http://127.0.0.1:5174",
    browserName: "chromium",
    viewport: { width: 1100, height: 700 },
    screenshot: "off",
    trace: "off",
  },
  webServer: {
    command: "pnpm exec vite build --config vite.config.ts && pnpm exec vite preview --config vite.config.ts --host 127.0.0.1 --port 5174 --strictPort",
    url: "http://127.0.0.1:5174",
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
