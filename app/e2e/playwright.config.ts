import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const artifactsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../.local/artifacts/20261028-2226-kaleidoscope-u3b",
);

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  outputDir: artifactsDir,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: "http://localhost:1420",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] },
  },
  webServer: {
    command: "corepack pnpm@10.32.1 run dev",
    url: "http://localhost:1420/harness.html",
    reuseExistingServer: false,
    timeout: 120_000,
    env: { NODE_ENV: "development" },
  },
});
