import { chromium } from "../../../ui/node_modules/@playwright/test/index.mjs";
import { readFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

// 실제 앱 정의의 시작 실패 블록을 기존 렌더러 하니스에 넣어 두 문구를 같은 조건에서 찍는다.
const root = resolve(import.meta.dirname, "../../..");
const output = resolve(root, ".local/card1837/shots");
const port = process.env.KS_E2E_PORT ?? "15183";
const server = spawn("node", ["harness/e2e-server.mjs"], { cwd: resolve(root, "ui"), env: { ...process.env, KS_E2E_PORT: port }, stdio: ["pipe", "inherit", "inherit"] });
const definition = JSON.parse(await readFile(resolve(root, "apps/agent.json"), "utf8"));
const reason = String.raw`Internal error: Claude Code native binary not found at C:\Users\홍승현\AppData\Local\npm-cache\_npx\a1b2c3\node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe. Please ensure Claude Code is installed via native installer or specify a valid path with options.pathToClaudeCodeExecutable.`;
const messages = {
  before: `에이전트 Claude Code의 응답을 읽지 못했습니다. 에이전트 프로그램을 업데이트한 뒤 다시 시도하세요. 원인: ${reason}`,
  after: `에이전트 Claude Code에서 오류가 났습니다. 원인을 확인한 뒤 다시 시도하세요. 원인: ${reason}`,
};
let browser;
try {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/`)).ok) break; } catch {}
    if (i === 119) throw new Error("하니스 서버를 시작하지 못했습니다");
    await new Promise((done) => setTimeout(done, 250));
  }
  await mkdir(output, { recursive: true });
  browser = await chromium.launch({ headless: true, executablePath: process.env.KS_CHROMIUM_PATH });
  for (const width of [1280, 420]) {
    for (const [stage, message] of Object.entries(messages)) {
      const page = await browser.newPage({ viewport: { width, height: 800 } });
      await page.goto(`http://127.0.0.1:${port}/?preview=notice-fixture`);
      await page.getByRole("button", { name: "시작 단추" }).waitFor();
      await page.addStyleTag({ content: "body { padding: 0; } .ks-harness { display: block; height: 100vh; } .ks-harness-header, .ks-harness-dev-panel, [data-testid=fake-files-panel] { display: none; } .ks-harness-apps.is-preview { height: 100%; }" });
      await page.evaluate(async ({ definition, message }) => {
        const harness = window.__ksHarness;
        const { snapshot } = await harness.call({ op: "state.get" });
        const app = snapshot.shared.app_versions.find((entry) => entry.app_id === "notice-fixture");
        const values = { show_start: true, show_failed: true, show_selected: true, show_single: true, show_picked_folder: true, agent_label: "Claude Code", folder_label: "작업 폴더", error_message: message, error_id: "AGENT_ACP_PROTOCOL_FAILED" };
        function bind(value) {
          if (Array.isArray(value)) return value.map(bind);
          if (!value || typeof value !== "object") return value;
          if (Object.keys(value).length === 1 && typeof value.client === "string") return values[value.client] ?? false;
          return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === "on_click" ? [] : bind(item)]));
        }
        app.definition.ui = bind(definition.ui);
        harness.emit({ event: "state.changed", snapshot });
      }, { definition, message });
      const notice = page.locator(".ks-notice-message").filter({ hasText: message });
      await notice.waitFor({ state: "visible", timeout: 10000 });
      await page.getByTestId("app-window-notice-fixture").screenshot({ path: resolve(output, `${stage}-${width}.png`) });
      console.log(`${stage}-${width}: ${await notice.innerText()}`);
      await page.close();
    }
  }
} finally {
  await browser?.close();
  server.kill();
}
