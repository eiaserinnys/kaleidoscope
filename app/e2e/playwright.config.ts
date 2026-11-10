import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";
import {
  appDir,
  corePort,
  devbridgeBinary,
  pathsFor,
  requiredRuntimeDir,
  repoRoot,
  uiOrigin,
  uiPort,
} from "./runtime.ts";

const paths = pathsFor(requiredRuntimeDir());
const devbridge = devbridgeBinary();
if (!existsSync(devbridge)) {
  throw new Error(
    `개발용 다리를 찾을 수 없습니다: ${devbridge}\n먼저 cargo build --locked -p kaleidoscope-devbridge를 실행하십시오.`,
  );
}
if (!existsSync(paths.docsDir)) {
  throw new Error(
    `문서 폴더가 없습니다: ${paths.docsDir}\napp/e2e/run.mjs로 실행해 문서를 복사하십시오.`,
  );
}

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["json", { outputFile: paths.reportFile }]],
  outputDir: paths.outputDir,
  use: {
    baseURL: uiOrigin,
    // 머리 없는 Chromium은 기본으로 스크롤바를 숨긴다. 셸은 스크롤바 폭(8px)과
    // 손잡이 안쪽 여백(2px)에 맞춰 분할 손잡이를 배치하므로, 스크롤바를 보이게 둔다.
    launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] },
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: `corepack pnpm@10.32.1 run dev --host localhost --port ${uiPort} --strictPort`,
      cwd: appDir,
      url: `${uiOrigin}/harness.html`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { NODE_ENV: "development" },
    },
    {
      command: `"${devbridge}" --data-dir "${paths.dataDir}" --port ${corePort} --device-name app-e2e --ui-origin "${uiOrigin}"`,
      cwd: repoRoot,
      port: corePort,
      reuseExistingServer: false,
      timeout: 120_000,
      gracefulShutdown: { signal: "SIGINT", timeout: 5_000 },
      env: {
        KALEIDOSCOPE_DEV_PICK: paths.docsDir,
        KALEIDOSCOPE_DEV_PICK_FILES_FILE: paths.pickFilesFile,
      },
    },
  ],
});
