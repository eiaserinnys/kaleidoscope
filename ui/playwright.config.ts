import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testTimeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 2,
  outputDir: process.env.KS_PLAYWRIGHT_OUTPUT ?? "test-results",
  use: {
    baseURL: "http://127.0.0.1:5173",
    browserName: "chromium",
    screenshot: "off",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `${process.platform === "win32" ? "" : "exec "}node ./harness/e2e-server.mjs`,
    url: "http://127.0.0.1:5173",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
