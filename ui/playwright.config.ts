import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const port = Number(process.env.KS_E2E_PORT ?? 5173);
const appPort = Number(process.env.KS_E2E_APP_PORT ?? port + 1);
const appDir = fileURLToPath(new URL("../app", import.meta.url));

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 2,
  outputDir: process.env.KS_PLAYWRIGHT_OUTPUT ?? "test-results",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    screenshot: "off",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", testIgnore: /\/ipad-touch[^/]*\.spec\.ts$/, use: { browserName: "chromium" } },
    {
      // 이 노드의 WebKit은 iPad 가로 화면과 손가락 입력을 흉내 낸다. 기기 고유 동작은 흉내 내지 않는다.
      name: "webkit-ipad",
      testMatch: /\/ipad-touch[^/]*\.spec\.ts$/,
      use: {
        browserName: "webkit",
        viewport: { width: 1194, height: 834 },
        hasTouch: true,
        isMobile: true,
        deviceScaleFactor: 2,
      },
    },
  ],
  webServer: [
    {
      command: `${process.platform === "win32" ? "" : "exec "}node ./harness/e2e-server.mjs`,
      url: `http://127.0.0.1:${port}`,
      env: { KS_E2E_PORT: String(port) },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      // 창 제목줄 두 번 누르기는 셸 상태를 가진 앱 하네스에서 확인한다.
      command: `node ./node_modules/vite/bin/vite.js --host 127.0.0.1 --port ${appPort} --strictPort`,
      cwd: appDir,
      url: `http://127.0.0.1:${appPort}/harness.html`,
      env: { NODE_ENV: "development" },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
