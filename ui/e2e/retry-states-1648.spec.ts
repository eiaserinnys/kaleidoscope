import { mkdir } from "node:fs/promises";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { codeViewLoadingApp, explorerLoadingApp, markdownTabsLoadingApp } from "./fixtures/loading-center-1621";

const STYLE = "body { padding: 0; } .ks-harness { display: block; height: 100vh; } .ks-harness-header, .ks-harness-dev-panel { display: none; } .ks-harness-apps.is-preview { height: 100%; }";
const folderApp = {
  id: "storage-document", name: "폴더", requires: { blocks: 13, modules: { files: 3 } },
  permissions: [{ module: "files", id: "documents", access: "readwrite", label: "문서" }], state: {},
  ui: { type: "folder", root: { permission: "documents" }, extensions: [], read_only: false },
};
const markdownFileApp = { ...codeViewLoadingApp, ui: { type: "markdown", file: { permission: "documents", path: "README.md" }, read_only: true } };

async function gate(page: Page, ops: string[]) {
  await page.addInitScript((gatedOps) => {
    let harness: any;
    const gate = { hold: true, fail: false, started: 0, waiters: [] as Array<() => void>,
      release(fail = false) { this.fail = fail; this.hold = false; this.waiters.splice(0).forEach((wake) => wake()); },
    };
    (window as any).retryGate = gate;
    Object.defineProperty(window, "__ksHarness", { configurable: true, get: () => harness, set(value: any) {
      const call = value.call.bind(value);
      value.call = async (request: any) => {
        if (gatedOps.includes(request.op)) {
          gate.started++;
          if (gate.hold) await new Promise<void>((resolve) => gate.waiters.push(resolve));
          if (gate.fail) throw { code: "io", message: "파일을 읽지 못했습니다", details: [] };
        }
        return call(request);
      };
      harness = value;
    } });
  }, ops);
}
async function mount(page: Page, definition: unknown, width: number) {
  await page.setViewportSize({ width, height: 820 });
  await page.goto("/?preview=storage-document");
  await page.addStyleTag({ content: STYLE });
  await page.evaluate(async (definition) => {
    const harness = (window as any).__ksHarness;
    const { snapshot } = await harness.call({ op: "state.get" });
    const next = structuredClone(snapshot);
    next.supported.blocks = Math.max(next.supported.blocks, 15);
    next.supported.modules.files = 4;
    next.device.grants = [...next.device.grants.filter((g: any) => !(g.window_id === "storage-window" && g.permission === "documents")),
      { window_id: "storage-window", permission: "documents", root_path: "/fake/docs", root_name: "문서", granted_at: "2026-11-18T00:00:00Z" }];
    next.shared.apps = next.shared.apps.map((a: any) => a.id === "storage-document" ? { ...a, current_version: 2 } : a);
    next.shared.app_versions = [...next.shared.app_versions.filter((a: any) => !(a.app_id === "storage-document" && a.version === 2)),
      { app_id: "storage-document", version: 2, definition, created_at: "2026-11-18T00:00:00Z" }];
    next.shared.windows = next.shared.windows.map((w: any) => w.id === "storage-window" ? { ...w, app_version: 2, state: {} } : w);
    harness.emit({ event: "state.changed", snapshot: next });
  }, definition);
  return page.getByTestId("app-window-storage-document");
}
async function release(page: Page, failed = false) { await page.evaluate((fail) => (window as any).retryGate.release(fail), failed); }
async function started(page: Page) { await expect.poll(() => page.evaluate(() => (window as any).retryGate.started)).toBeGreaterThan(0); }
async function capture(app: Locator, name: string) {
  const output = process.env.KS_1648_VISUAL_OUTPUT;
  if (!output) return;
  await mkdir(output, { recursive: true });
  await app.screenshot({ path: `${output}/${name}.png` });
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}

for (const width of [1100, 360]) {
  test(`탐색기 첫 실패, 다시 읽기 로더와 새로고침 실패 ${width}`, async ({ page }) => {
    await gate(page, ["files.list"]);
    const app = await mount(page, explorerLoadingApp, width);
    const body = app.locator(".ks-explorer-content");
    await started(page);
    await release(page, true);
    const notice = body.locator(".ks-notice[role=alert]");
    await expect(notice).toBeVisible();
    await capture(app, `${width}-retry`);
    await noOverflow(page);
    await page.evaluate(() => { const g = (window as any).retryGate; g.hold = true; g.fail = false; });
    await notice.getByRole("button", { name: "다시 시도" }).focus();
    await expect(notice.getByRole("button", { name: "다시 시도" })).toBeFocused();
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement !== document.body && document.activeElement.getClientRects().length > 0)).toBe(true);
    await notice.getByRole("button", { name: "다시 시도" }).focus();
    await page.keyboard.press("Enter");
    await expect(body.locator(".ks-status-text")).toBeVisible();
    await capture(app, `${width}-loading`);
    await release(page);
    await expect(body.getByRole("option", { name: "settings.json" })).toBeVisible();
    const tree = app.locator(".ks-file-tree").first();
    await tree.getByRole("button", { name: "다시 시도" }).click();
    await expect(tree.getByRole("treeitem", { name: "notes" })).toBeVisible();
    await page.evaluate(() => { (window as any).retryGate.fail = true; window.dispatchEvent(new Event("focus")); });
    await expect(notice).toBeVisible();
    await expect(body.getByRole("option", { name: "settings.json" })).toBeVisible();
    await expect(tree.getByRole("treeitem", { name: "notes" })).toBeVisible();
    await expect(tree.locator('.ks-notice[role="alert"]')).toBeVisible();
    await capture(app, `${width}-refresh`);
    await page.evaluate(() => { (window as any).retryGate.fail = false; });
    await notice.getByRole("button", { name: "다시 시도" }).click();
    await expect(notice).toHaveCount(0);
    await page.setViewportSize({ width: width === 360 ? 1100 : 360, height: 820 });
    await expect(body.getByRole("option", { name: "settings.json" })).toBeVisible();
    await noOverflow(page);
  });

  test(`코드 보기 읽기 실패와 재시도 ${width}`, async ({ page }) => {
    await gate(page, ["files.read"]);
    const app = await mount(page, codeViewLoadingApp, width);
    await started(page); await release(page, true);
    const notice = app.locator(".ks-editor-error [role=alert]");
    await expect(notice).toBeVisible();
    await capture(app, `${width}-code-error`);
    await page.evaluate(() => { (window as any).retryGate.fail = false; });
    await notice.getByRole("button", { name: "다시 시도" }).click();
    await expect(app.locator(".ks-code-view")).toBeVisible();
  });

  test(`마크다운 문서 읽기 실패와 재시도 ${width}`, async ({ page }) => {
    await gate(page, ["storage.get"]);
    const app = await mount(page, markdownTabsLoadingApp, width);
    await started(page); await release(page, true);
    const notice = app.locator(".ks-markdown-error [role=alert]");
    await expect(notice).toBeVisible();
    await capture(app, `${width}-markdown-error`);
    await page.evaluate(() => { (window as any).retryGate.fail = false; });
    await notice.getByRole("button", { name: "다시 시도" }).click();
    await expect(app.locator(".ks-markdown-view")).toBeVisible();
  });

  test(`마크다운 파일 읽기 실패와 재시도 ${width}`, async ({ page }) => {
    await gate(page, ["files.read"]);
    const app = await mount(page, markdownFileApp, width);
    await started(page); await release(page, true);
    const notice = app.locator(".ks-markdown-error [role=alert]");
    await expect(notice).toBeVisible();
    await capture(app, `${width}-markdown-file-error`);
    await page.evaluate(() => { (window as any).retryGate.fail = false; });
    await notice.getByRole("button", { name: "다시 시도" }).click();
    await expect(app.locator(".ks-markdown-view")).toBeVisible();
  });

  test(`트리 루트와 하위 폴더를 각각 다시 읽는다 ${width}`, async ({ page }) => {
    await gate(page, ["files.list"]);
    const app = await mount(page, explorerLoadingApp, width);
    await started(page); await release(page, true);
    const tree = app.locator(".ks-file-tree").first();
    const rootError = tree.locator(":scope > [data-ks-fills-body] .ks-notice");
    await expect(rootError).toBeVisible();
    await capture(app, `${width}-tree-root-error`);
    await page.evaluate(() => { (window as any).retryGate.fail = false; });
    await rootError.getByRole("button", { name: "다시 시도" }).click();
    const notes = tree.getByRole("treeitem", { name: "notes" });
    await expect(notes).toBeVisible();
    await page.evaluate(() => { (window as any).retryGate.fail = true; });
    await notes.click();
    const error = tree.locator('[data-tree-row="error:notes"] .ks-notice');
    await expect(error).toBeVisible();
    await capture(app, `${width}-tree-child-error`);
    await page.evaluate(() => { (window as any).retryGate.fail = false; });
    await error.getByRole("button", { name: "다시 시도" }).click();
    await expect(error).toHaveCount(0);
  });

  test(`폴더 작업 실패 안내가 대상 행 아래에 선다 ${width}`, async ({ page }) => {
    await gate(page, ["files.reveal"]);
    const app = await mount(page, folderApp, width);
    const target = app.getByRole("treeitem", { name: "settings.json" });
    await expect(target).toBeVisible();
    await release(page, true);
    await target.click({ button: "right" });
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await target.click({ button: "right" });
    await page.getByRole("menuitem", { name: "파일 관리자에서 보기" }).click();
    const alert = app.locator(".ks-file-tree .ks-notice[role=alert]");
    await expect(alert).toBeVisible();
    const positions = await app.locator(".ks-file-tree-list").evaluate((tree) => {
      const rows = Array.from(tree.querySelectorAll<HTMLElement>("[data-tree-row]"));
      const target = rows.findIndex((row) => row.querySelector('[data-tree-id="settings.json"]'));
      const notice = rows.findIndex((row) => row.querySelector('[role="alert"]'));
      const a = rows[target].getBoundingClientRect(), b = rows[notice].getBoundingClientRect();
      return { target, notice, gap: b.top - a.bottom };
    });
    expect(positions.notice).toBe(positions.target + 1);
    expect(Math.abs(positions.gap)).toBeLessThanOrEqual(1);
    await capture(app, `${width}-operation`);
    const close = alert.getByRole("button", { name: "닫기" });
    await close.focus(); await expect(close).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(alert).toHaveCount(0);
    await expect(target).toBeFocused();
    await noOverflow(page);
  });
}
