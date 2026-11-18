import { mkdir, writeFile } from "node:fs/promises";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { codeViewLoadingApp, explorerLoadingApp, sandboxLoadingApp } from "./fixtures/loading-center-1621";

// 카드 #1621: 첫 읽기가 끝나기 전에 보이는 로딩 표시가 창 본문(프레임)의 가로·세로 가운데에 서는지 잰다.
// 가운데만 보면 "글자 상자 하나가 어딘가에 떠 있는" 상태도 통과하므로, 글자 상자가 프레임 가장자리에
// 닿을 만큼 프레임을 채우는지도 함께 잰다. 창이 좁을 때(360)도 같은 기준을 쓴다.
//
// 읽기는 하네스의 __ksHarness가 꽂히는 순간 transport.call을 감싸 붙잡는다. 스토어가 transport.call을
// 매번 객체에서 찾으므로 이 감싸기가 그대로 쓰인다. 붙잡은 응답은 재고 난 뒤 시험이 풀어 준다.
const STYLE = ".ks-harness { height: calc(100vh - 2 * var(--ks-space-4)); min-height: 0; } .ks-harness-dev-panel { display: none; }";
const phase = process.env.KS_LOADING_EVIDENCE ?? "after";
const captureDir = () => test.info().outputPath("captures");

type Op = "files.read" | "files.list" | "storage.get";
type Box = { left: number; top: number; right: number; bottom: number };
type Measured = { frame: Box; loading: Box; text: Box };

async function installGate(page: Page, ops: Op[]) {
  await page.addInitScript((gatedOps) => {
    let harness: any = null;
    const gate = {
      hold: true,
      started: false,
      waiters: [] as Array<() => void>,
      release() {
        gate.hold = false;
        for (const wake of gate.waiters.splice(0)) wake();
      },
      wait() {
        return new Promise<void>((resolve) => gate.waiters.push(resolve));
      },
    };
    (window as any).loadingCenterGate = gate;
    Object.defineProperty(window, "__ksHarness", {
      configurable: true,
      get() { return harness; },
      set(value: any) {
        const call = value.call.bind(value);
        value.call = async (request: any) => {
          if (gate.hold && gatedOps.includes(request.op)) {
            gate.started = true;
            await gate.wait();
          }
          return call(request);
        };
        harness = value;
      },
    });
  }, ops);
}

async function waitGateStarted(page: Page) {
  await expect.poll(() => page.evaluate(() => (window as any).loadingCenterGate.started)).toBe(true);
}

async function releaseGate(page: Page) {
  await page.evaluate(() => (window as any).loadingCenterGate.release());
}

// 저장소 문서 창(storage-window)의 앱 정의를 새 버전으로 바꿔 끼우고 폴더 권한을 심는다.
// 스토어가 같은 app_id·version의 정의는 이전 객체를 그대로 쓰므로(참조 안정), 버전을 올려야
// 새 정의가 화면에 닿는다. 창의 app_version도 함께 올린다.
async function mountFixture(page: Page, definition: unknown) {
  await page.evaluate(async (nextDefinition) => {
    const harness = (window as any).__ksHarness;
    const { snapshot } = await harness.call({ op: "state.get" });
    const next = JSON.parse(JSON.stringify(snapshot));
    const version = 2;
    next.device.grants = [
      ...next.device.grants.filter((grant: any) => !(grant.window_id === "storage-window" && grant.permission === "documents")),
      { window_id: "storage-window", permission: "documents", root_path: "/fake/docs", root_name: "문서", granted_at: "2026-11-18T00:00:00Z" },
    ];
    next.shared.apps = next.shared.apps.map((app: any) =>
      app.id === "storage-document" ? { ...app, current_version: version } : app);
    next.shared.app_versions = [
      ...next.shared.app_versions.filter((item: any) => !(item.app_id === "storage-document" && item.version === version)),
      { app_id: "storage-document", version, definition: nextDefinition, created_at: "2026-11-18T00:00:00Z" },
    ];
    next.shared.windows = next.shared.windows.map((window: any) =>
      window.id === "storage-window" ? { ...window, app_version: version, state: {} } : window);
    harness.emit({ event: "state.changed", snapshot: next });
  }, definition);
}

// 로딩 상자와 그 부모(프레임)를 잰다. 코드 보기·샌드박스는 창 본문이, 마크다운 보기는 분할 칸이 프레임이다.
// 숨은 다른 창에도 같은 클래스가 있으므로 반드시 이 앱 창 안에서만 찾는다.
async function measure(app: Locator, selector: string): Promise<Measured | null> {
  return app.evaluate((root, loadingSelector) => {
    const loading = root.querySelector<HTMLElement>(loadingSelector);
    const frame = loading?.parentElement;
    if (!loading || !frame) return null;
    const text = loading.querySelector<HTMLElement>(".ks-status-text") ?? loading;
    const box = (element: Element): Box => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    };
    return { frame: box(frame), loading: box(loading), text: box(text) };
  }, selector);
}

// 탐색기의 프레임은 본문 칸에서 도구 줄을 뺀 나머지다. 로딩 글자는 그 칸의 직접 자식이다.
async function measureExplorer(app: Locator): Promise<Measured | null> {
  return app.evaluate((root) => {
    const content = root.querySelector<HTMLElement>(".ks-explorer-content");
    const loading = content?.querySelector<HTMLElement>(":scope > .ks-status-text");
    const toolbar = content?.querySelector<HTMLElement>(".ks-explorer-toolbar");
    if (!content || !loading || !toolbar) return null;
    const box = (element: Element): Box => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    };
    const contentBox = box(content);
    const toolbarBox = box(toolbar);
    return {
      frame: { left: contentBox.left, top: toolbarBox.bottom, right: contentBox.right, bottom: contentBox.bottom },
      loading: box(loading),
      text: box(loading),
    };
  });
}

function assertFills(label: string, measured: Measured | null) {
  expect(measured, `${label} 측정`).not.toBeNull();
  const { frame, loading } = measured!;
  for (const side of ["left", "top", "right", "bottom"] as const) {
    expect(Math.abs(loading[side] - frame[side]), `${label} ${side} 가장자리에서 ${Math.abs(loading[side] - frame[side]).toFixed(1)}px`).toBeLessThanOrEqual(1);
  }
}

function assertCenter(label: string, measured: Measured | null) {
  expect(measured, `${label} 측정`).not.toBeNull();
  const { frame, text } = measured!;
  const dx = Math.abs((text.left + text.right) / 2 - (frame.left + frame.right) / 2);
  const dy = Math.abs((text.top + text.bottom) / 2 - (frame.top + frame.bottom) / 2);
  expect(dx, `${label} 가로 가운데에서 ${dx.toFixed(1)}px`).toBeLessThanOrEqual(1);
  expect(dy, `${label} 세로 가운데에서 ${dy.toFixed(1)}px`).toBeLessThanOrEqual(1);
}

function boundsRow(target: string, width: number, measured: Measured) {
  const center = (value: Box) => ({ x: (value.left + value.right) / 2, y: (value.top + value.bottom) / 2 });
  return { target, width, frame: measured.frame, loading: measured.loading, text: measured.text, textCenter: center(measured.text), frameCenter: center(measured.frame) };
}

test("마크다운 보기의 첫 읽기 표시가 프레임 가운데에서 프레임을 채운다", async ({ page }) => {
  await mkdir(captureDir(), { recursive: true });
  const rows: Array<Record<string, unknown>> = [];
  const measuredRows: Array<{ width: number; measured: Measured | null }> = [];
  await installGate(page, ["storage.get"]);
  for (const width of [1100, 360]) {
    await page.setViewportSize({ width, height: 820 });
    await page.goto("/?preview=storage-document");
    await page.addStyleTag({ content: STYLE });
    const app = page.getByTestId("app-window-storage-document");
    const loading = app.locator(".ks-markdown-loading");
    await expect(loading).toBeVisible();
    await waitGateStarted(page);
    const measured = await measure(app, ".ks-markdown-loading");
    await app.screenshot({ path: `${captureDir()}/20261118-${phase}-${width}-markdown-loading.png` });
    rows.push(boundsRow("markdown", width, measured!));
    await writeFile(`${captureDir()}/20261118-${phase}-loading-center-markdown.json`, JSON.stringify(rows, null, 2));
    measuredRows.push({ width, measured });
    await releaseGate(page);
    await expect(loading).toHaveCount(0);
  }
  for (const { width, measured } of measuredRows) {
    assertFills(`마크다운 보기 ${width}`, measured);
    assertCenter(`마크다운 보기 ${width}`, measured);
  }
});

test("코드 보기의 첫 읽기 표시가 프레임 가운데에서 프레임을 채운다", async ({ page }) => {
  await mkdir(captureDir(), { recursive: true });
  const rows: Array<Record<string, unknown>> = [];
  const measuredRows: Array<{ width: number; measured: Measured | null }> = [];
  await installGate(page, ["files.read"]);
  for (const width of [1100, 360]) {
    await page.setViewportSize({ width, height: 820 });
    await page.goto("/?preview=storage-document");
    await page.addStyleTag({ content: STYLE });
    await mountFixture(page, codeViewLoadingApp);
    const app = page.getByTestId("app-window-storage-document");
    const loading = app.locator(".ks-editor-loading");
    await expect(loading).toBeVisible();
    await waitGateStarted(page);
    const measured = await measure(app, ".ks-editor-loading");
    await app.screenshot({ path: `${captureDir()}/20261118-${phase}-${width}-code-loading.png` });
    rows.push(boundsRow("code", width, measured!));
    await writeFile(`${captureDir()}/20261118-${phase}-loading-center-code.json`, JSON.stringify(rows, null, 2));
    measuredRows.push({ width, measured });
    await releaseGate(page);
    await expect(loading).toHaveCount(0);
  }
  for (const { width, measured } of measuredRows) {
    assertFills(`코드 보기 ${width}`, measured);
    assertCenter(`코드 보기 ${width}`, measured);
  }
});

test("탐색기의 첫 읽기 표시가 본문 프레임 가운데에서 본문을 채운다", async ({ page }) => {
  await mkdir(captureDir(), { recursive: true });
  const rows: Array<Record<string, unknown>> = [];
  const measuredRows: Array<{ width: number; measured: Measured | null }> = [];
  await installGate(page, ["files.list"]);
  for (const width of [1100, 360]) {
    await page.setViewportSize({ width, height: 820 });
    await page.goto("/?preview=storage-document");
    await page.addStyleTag({ content: STYLE });
    await mountFixture(page, explorerLoadingApp);
    const app = page.getByTestId("app-window-storage-document");
    const loading = app.locator(".ks-explorer-content > .ks-status-text");
    await expect(loading).toBeVisible();
    await waitGateStarted(page);
    const measured = await measureExplorer(app);
    await app.screenshot({ path: `${captureDir()}/20261118-${phase}-${width}-explorer-loading.png` });
    rows.push(boundsRow("explorer", width, measured!));
    await writeFile(`${captureDir()}/20261118-${phase}-loading-center-explorer.json`, JSON.stringify(rows, null, 2));
    measuredRows.push({ width, measured });
    await releaseGate(page);
    await expect(app.getByRole("option", { name: "settings.json" })).toBeVisible();
  }
  for (const { width, measured } of measuredRows) {
    assertFills(`탐색기 ${width}`, measured);
    assertCenter(`탐색기 ${width}`, measured);
  }
});

test("샌드박스의 첫 읽기 표시가 프레임 가운데에서 프레임을 채운다", async ({ page }) => {
  await mkdir(captureDir(), { recursive: true });
  const rows: Array<Record<string, unknown>> = [];
  const measuredRows: Array<{ width: number; measured: Measured | null }> = [];
  await installGate(page, ["files.read"]);
  for (const width of [1100, 360]) {
    await page.setViewportSize({ width, height: 820 });
    await page.goto("/?preview=storage-document");
    await page.addStyleTag({ content: STYLE });
    await mountFixture(page, sandboxLoadingApp);
    const app = page.getByTestId("app-window-storage-document");
    const loading = app.locator(".ks-html-state");
    await expect(loading).toBeVisible();
    await waitGateStarted(page);
    const measured = await measure(app, ".ks-html-state");
    await app.screenshot({ path: `${captureDir()}/20261118-${phase}-${width}-sandbox-loading.png` });
    rows.push(boundsRow("sandbox", width, measured!));
    await writeFile(`${captureDir()}/20261118-${phase}-loading-center-sandbox.json`, JSON.stringify(rows, null, 2));
    measuredRows.push({ width, measured });
    await releaseGate(page);
    await expect(app.locator(".ks-sandbox iframe")).toBeVisible();
  }
  for (const { width, measured } of measuredRows) {
    assertFills(`샌드박스 ${width}`, measured);
    assertCenter(`샌드박스 ${width}`, measured);
  }
});
