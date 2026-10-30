import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
export default defineConfig({ ...base, testMatch: "share-view.spec.ts", workers: 1, webServer: { command: "corepack pnpm@10.32.1 dev --host 127.0.0.1 --port 1420", url: "http://127.0.0.1:1420/harness.html", cwd: "..", reuseExistingServer: false, timeout: 60000 } });
