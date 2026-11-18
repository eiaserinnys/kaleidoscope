import { mkdir, writeFile } from "node:fs/promises";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { codeEditorLoadingApp, codeViewLoadingApp, explorerLoadingApp, markdownTabsLoadingApp, sandboxLoadingApp } from "./fixtures/loading-center-1621";

// 카드 #1621: 첫 읽기가 끝나기 전에 보이는 로딩 표시가 창 본문(프레임)의 가로·세로 가운데에 서는지 잰다.
// 가운데만 보면 "글자 상자 하나가 어딘가에 떠 있는" 상태도 통과하므로, 글자 상자가 프레임 가장자리에
// 닿을 만큼 프레임을 채우는지도 함께 잰다. 창이 좁을 때(360)도 같은 기준을 쓴다.
// 글자 위치는 요소 상자가 아니라 범위(Range)로 잰다. 프레임을 채우는 요소는 요소 상자 중심이 늘 프레임
// 중심이라, 요소로 재면 가운데가 저절로 0이 된다.
//
// 읽기는 하네스의 __ksHarness가 꽂히는 순간 transport.call을 감싸 붙잡는다. 스토어가 transport.call을
// 매번 객체에서 찾으므로 이 감싸기가 그대로 쓰인다. 붙잡은 응답은 재고 난 뒤 시험이 풀어 주며,
// 실패로 풀면 같은 자리에서 실패 안내로 바뀌는지도 잰다.
const STYLE = ".ks-harness { height: calc(100vh - 2 * var(--ks-space-4)); min-height: 0; } .ks-harness-dev-panel { display: none; }";
const phase = process.env.KS_LOADING_EVIDENCE ?? "after";
const captureDir = () => test.info().outputPath("captures");

type Op = "files.read" | "files.list" | "storage.get" | "storage.list";
type Box = { left: number; top: number; right: number; bottom: number };
type Measured = { frame: Box; loading: Box; text: Box };

async function installGate(page: Page, ops: Op[]) {
  await page.addInitScript((gatedOps) => {
    let harness: any = null;
    const gate = {
      hold: true,
      fail: false,
      started: false,
      waiters: [] as Array<() => void>,
      release(fail = false) {
        gate.fail = fail;
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
          if (gatedOps.includes(request.op) && (gate.hold || gate.fail)) {
            gate.started = true;
            if (gate.hold) await gate.wait();
            if (gate.fail) throw { code: "E_TEST", message: "파일을 읽지 못했습니다" };
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

async function releaseGate(page: Page, fail = false) {
  await page.evaluate((failed) => (window as any).loadingCenterGate.release(failed), fail);
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
// 숨은 다른 창에도 같은 클래스가 있으므로 반드시 이 앱 창 안에서만 찾는다. 글자는 StatusText의 범위로 잰다.
async function measure(app: Locator, selector: string): Promise<Measured | null> {
  return app.evaluate((root, loadingSelector) => {
    const loading = root.querySelector<HTMLElement>(loadingSelector);
    const frame = loading?.parentElement;
    if (!loading || !frame) return null;
    const text = loading.querySelector<HTMLElement>(".ks-status-text") ?? loading;
    const box = (rect: DOMRect): Box => ({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
    const range = document.createRange();
    range.selectNodeContents(text);
    return { frame: box(frame.getBoundingClientRect()), loading: box(loading.getBoundingClientRect()), text: box(range.getBoundingClientRect()) };
  }, selector);
}

// 실패 안내(.ks-notice[role=alert])의 글자 범위와 그 블록·부모(프레임)를 잰다.
async function measureAlert(app: Locator, selector: string): Promise<Measured | null> {
  return app.evaluate((root, blockSelector) => {
    const block = root.querySelector<HTMLElement>(blockSelector);
    const alert = block?.querySelector<HTMLElement>('[role="alert"]');
    const frame = block?.parentElement;
    if (!block || !alert || !frame) return null;
    const box = (rect: DOMRect): Box => ({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
    const range = document.createRange();
    range.selectNodeContents(alert);
    return { frame: box(frame.getBoundingClientRect()), loading: box(block.getBoundingClientRect()), text: box(range.getBoundingClientRect()) };
  }, selector);
}

// 탐색기의 프레임은 본문 칸에서 도구 줄을 뺀 나머지다. 로딩 글자는 그 칸의 직접 자식이다.
async function measureExplorer(app: Locator): Promise<Measured | null> {
  return app.evaluate((root) => {
    const content = root.querySelector<HTMLElement>(".ks-explorer-content");
    const loading = content?.querySelector<HTMLElement>(":scope > .ks-status-text");
    const toolbar = content?.querySelector<HTMLElement>(".ks-explorer-toolbar");
    if (!content || !loading || !toolbar) return null;
    const box = (rect: DOMRect): Box => ({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
    const contentBox = box(content.getBoundingClientRect());
    const toolbarBox = box(toolbar.getBoundingClientRect());
    const range = document.createRange();
    range.selectNodeContents(loading);
    return {
      frame: { left: contentBox.left, top: toolbarBox.bottom, right: contentBox.right, bottom: contentBox.bottom },
      loading: box(loading.getBoundingClientRect()),
      text: box(range.getBoundingClientRect()),
    };
  });
}

// 트리 칸의 첫 읽기 글자(로딩 또는 루트 실패)를 잰다. 트리 칸의 머리(폴더 바꾸기 줄)는 프레임에서 뺀다.
// 탐색기 본문이 도구 줄을 뺀 칸 가운데에 서는 것과 같은 기준이다. 머리가 없는 트리(md-editor 서버 탭)는
// 칸 전체가 프레임이다.
async function measureTree(app: Locator): Promise<Measured | null> {
  const tree = app.locator(".ks-file-tree:visible").first();
  return tree.evaluate((element) => {
    const status = element.querySelector<HTMLElement>(".ks-status-text, .ks-inline-error");
    if (!status) return null;
    const header = element.querySelector<HTMLElement>(":scope > .ks-file-tree-header");
    const box = (rect: DOMRect): Box => ({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
    const treeBox = box(element.getBoundingClientRect());
    const range = document.createRange();
    range.selectNodeContents(status);
    return {
      frame: { left: treeBox.left, top: header ? box(header.getBoundingClientRect()).bottom : treeBox.top, right: treeBox.right, bottom: treeBox.bottom },
      loading: treeBox,
      text: box(range.getBoundingClientRect()),
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

function assertWithin(label: string, measured: Measured | null) {
  expect(measured, `${label} 측정`).not.toBeNull();
  const { frame, text } = measured!;
  for (const side of ["left", "top", "right", "bottom"] as const) {
    const over = side === "left" || side === "top" ? frame[side] - text[side] : text[side] - frame[side];
    expect(over, `${label} 글자가 ${side} 가장자리 밖으로 ${over.toFixed(1)}px`).toBeLessThanOrEqual(1);
  }
}

// 실패 안내 중심이 로딩 글자 중심과 같은 자리인지 잰다.
function assertSameCenter(label: string, loading: Box, failed: Box) {
  const dx = Math.abs((failed.left + failed.right) / 2 - (loading.left + loading.right) / 2);
  const dy = Math.abs((failed.top + failed.bottom) / 2 - (loading.top + loading.bottom) / 2);
  expect(dx, `${label} 실패 안내가 로딩 글자 가로 가운데에서 ${dx.toFixed(1)}px`).toBeLessThanOrEqual(1);
  expect(dy, `${label} 실패 안내가 로딩 글자 세로 가운데에서 ${dy.toFixed(1)}px`).toBeLessThanOrEqual(1);
}

function boundsRow(target: string, width: number, state: string, measured: Measured) {
  const center = (value: Box) => ({ x: (value.left + value.right) / 2, y: (value.top + value.bottom) / 2 });
  return { target, width, state, frame: measured.frame, loading: measured.loading, text: measured.text, textCenter: center(measured.text), frameCenter: center(measured.frame) };
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
    rows.push(boundsRow("markdown", width, "loading", measured!));
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
    rows.push(boundsRow("code", width, "loading", measured!));
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
    rows.push(boundsRow("explorer", width, "loading", measured!));
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
    rows.push(boundsRow("sandbox", width, "loading", measured!));
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

test("md-editor 서버 탭 폴더 트리의 첫 읽기 표시가 트리 칸 가운데에 선다", async ({ page }) => {
  await mkdir(captureDir(), { recursive: true });
  const rows: Array<Record<string, unknown>> = [];
  const measuredRows: Array<{ width: number; loading: Measured | null; failed: Measured | null }> = [];
  await installGate(page, ["storage.list"]);
  for (const width of [1100, 360]) {
    await page.setViewportSize({ width, height: 820 });
    await page.goto("/?preview=md-editor");
    await page.addStyleTag({ content: STYLE });
    const app = page.getByTestId("app-window-md-editor");
    const tree = app.locator(".ks-file-tree:visible").first();
    await expect(tree.locator(".ks-status-text")).toBeVisible();
    await waitGateStarted(page);
    const loading = await measureTree(app);
    await app.screenshot({ path: `${captureDir()}/20261118-${phase}-${width}-md-tree-loading.png` });
    rows.push(boundsRow("md-tree", width, "loading", loading!));
    await releaseGate(page, true);
    await expect(tree.locator(".ks-inline-error")).toBeVisible();
    const failed = await measureTree(app);
    await app.screenshot({ path: `${captureDir()}/20261118-${phase}-${width}-md-tree-failed.png` });
    rows.push(boundsRow("md-tree", width, "failed", failed!));
    await writeFile(`${captureDir()}/20261118-${phase}-md-tree.json`, JSON.stringify(rows, null, 2));
    measuredRows.push({ width, loading, failed });
  }
  for (const { width, loading, failed } of measuredRows) {
    assertCenter(`md-editor 트리 ${width}`, loading);
    assertWithin(`md-editor 트리 ${width}`, loading);
    expect(failed, `md-editor 트리 실패 ${width} 측정`).not.toBeNull();
    assertSameCenter(`md-editor 트리 ${width}`, loading!.text, failed!.text);
    assertWithin(`md-editor 트리 실패 ${width}`, failed);
  }
});

test("탐색기 왼쪽 트리 칸의 첫 읽기 표시가 트리 칸 가운데에 선다", async ({ page }) => {
  await mkdir(captureDir(), { recursive: true });
  const rows: Array<Record<string, unknown>> = [];
  const measuredRows: Array<{ width: number; loading: Measured | null; failed: Measured | null }> = [];
  await installGate(page, ["files.list"]);
  for (const width of [1100, 360]) {
    await page.setViewportSize({ width, height: 820 });
    await page.goto("/?preview=storage-document");
    await page.addStyleTag({ content: STYLE });
    await mountFixture(page, explorerLoadingApp);
    const app = page.getByTestId("app-window-storage-document");
    const tree = app.locator(".ks-file-tree:visible").first();
    await expect(tree.locator(".ks-status-text")).toBeVisible();
    await waitGateStarted(page);
    const loading = await measureTree(app);
    await app.screenshot({ path: `${captureDir()}/20261118-${phase}-${width}-explorer-tree-loading.png` });
    rows.push(boundsRow("explorer-tree", width, "loading", loading!));
    await releaseGate(page, true);
    await expect(tree.locator(".ks-inline-error")).toBeVisible();
    const failed = await measureTree(app);
    await app.screenshot({ path: `${captureDir()}/20261118-${phase}-${width}-explorer-tree-failed.png` });
    rows.push(boundsRow("explorer-tree", width, "failed", failed!));
    await writeFile(`${captureDir()}/20261118-${phase}-explorer-tree.json`, JSON.stringify(rows, null, 2));
    measuredRows.push({ width, loading, failed });
  }
  for (const { width, loading, failed } of measuredRows) {
    assertCenter(`탐색기 트리 ${width}`, loading);
    assertWithin(`탐색기 트리 ${width}`, loading);
    expect(failed, `탐색기 트리 실패 ${width} 측정`).not.toBeNull();
    assertSameCenter(`탐색기 트리 ${width}`, loading!.text, failed!.text);
    assertWithin(`탐색기 트리 실패 ${width}`, failed);
  }
});

test("코드 보기가 실패하면 안내가 로딩 글자 자리에 선다", async ({ page }) => {
  await mkdir(captureDir(), { recursive: true });
  const rows: Array<Record<string, unknown>> = [];
  const measuredRows: Array<{ width: number; loading: Measured | null; failed: Measured | null }> = [];
  await installGate(page, ["files.read"]);
  for (const width of [1100, 360]) {
    await page.setViewportSize({ width, height: 820 });
    await page.goto("/?preview=storage-document");
    await page.addStyleTag({ content: STYLE });
    await mountFixture(page, codeViewLoadingApp);
    const app = page.getByTestId("app-window-storage-document");
    await expect(app.locator(".ks-editor-loading")).toBeVisible();
    await waitGateStarted(page);
    const loading = await measure(app, ".ks-editor-loading");
    await app.screenshot({ path: `${captureDir()}/20261118-${phase}-${width}-code-view-loading.png` });
    rows.push(boundsRow("code-view", width, "loading", loading!));
    await releaseGate(page, true);
    await expect(app.locator(".ks-editor-error [role=alert]")).toBeVisible();
    const failed = await measureAlert(app, ".ks-editor-error");
    await app.screenshot({ path: `${captureDir()}/20261118-${phase}-${width}-code-view-failed.png` });
    rows.push(boundsRow("code-view", width, "failed", failed!));
    await writeFile(`${captureDir()}/20261118-${phase}-code-view.json`, JSON.stringify(rows, null, 2));
    measuredRows.push({ width, loading, failed });
  }
  for (const { width, loading, failed } of measuredRows) {
    assertCenter(`코드 보기 로딩 ${width}`, loading);
    expect(failed, `코드 보기 실패 ${width} 측정`).not.toBeNull();
    assertSameCenter(`코드 보기 ${width}`, loading!.text, failed!.text);
    assertCenter(`코드 보기 실패 ${width}`, failed);
  }
});

test("코드 편집기가 실패하면 안내가 로딩 글자 자리에 선다", async ({ page }) => {
  await mkdir(captureDir(), { recursive: true });
  const rows: Array<Record<string, unknown>> = [];
  const measuredRows: Array<{ width: number; loading: Measured | null; failed: Measured | null }> = [];
  await installGate(page, ["files.read"]);
  for (const width of [1100, 360]) {
    await page.setViewportSize({ width, height: 820 });
    await page.goto("/?preview=storage-document");
    await page.addStyleTag({ content: STYLE });
    await mountFixture(page, codeEditorLoadingApp);
    const app = page.getByTestId("app-window-storage-document");
    await expect(app.locator(".ks-editor-loading")).toBeVisible();
    await waitGateStarted(page);
    const loading = await measure(app, ".ks-editor-loading");
    await app.screenshot({ path: `${captureDir()}/20261118-${phase}-${width}-code-editor-loading.png` });
    rows.push(boundsRow("code-editor", width, "loading", loading!));
    await releaseGate(page, true);
    await expect(app.locator(".ks-editor-error [role=alert]")).toBeVisible();
    const failed = await measureAlert(app, ".ks-editor-error");
    await app.screenshot({ path: `${captureDir()}/20261118-${phase}-${width}-code-editor-failed.png` });
    rows.push(boundsRow("code-editor", width, "failed", failed!));
    await writeFile(`${captureDir()}/20261118-${phase}-code-editor.json`, JSON.stringify(rows, null, 2));
    measuredRows.push({ width, loading, failed });
  }
  for (const { width, loading, failed } of measuredRows) {
    assertCenter(`코드 편집기 로딩 ${width}`, loading);
    expect(failed, `코드 편집기 실패 ${width} 측정`).not.toBeNull();
    assertSameCenter(`코드 편집기 ${width}`, loading!.text, failed!.text);
    assertCenter(`코드 편집기 실패 ${width}`, failed);
  }
});

test("마크다운 편집기와 보기가 실패하면 안내가 각자의 로딩 글자 자리에 선다", async ({ page }) => {
  await mkdir(captureDir(), { recursive: true });
  const rows: Array<Record<string, unknown>> = [];
  const measuredRows: Array<{ width: number; editorLoading: Measured | null; editorFailed: Measured | null; viewLoading: Measured | null; viewFailed: Measured | null }> = [];
  await installGate(page, ["storage.get"]);
  for (const width of [1100, 360]) {
    await page.setViewportSize({ width, height: 820 });
    await page.goto("/?preview=storage-document");
    await page.addStyleTag({ content: STYLE });
    const app = page.getByTestId("app-window-storage-document");
    await expect(app.locator(".ks-editor-loading")).toBeVisible();
    await expect(app.locator(".ks-markdown-loading")).toBeVisible();
    await waitGateStarted(page);
    const editorLoading = await measure(app, ".ks-editor-loading");
    const viewLoading = await measure(app, ".ks-markdown-loading");
    await app.screenshot({ path: `${captureDir()}/20261118-${phase}-${width}-markdown-editor-loading.png` });
    await app.screenshot({ path: `${captureDir()}/20261118-${phase}-${width}-markdown-view-loading.png` });
    rows.push(boundsRow("markdown-editor", width, "loading", editorLoading!));
    rows.push(boundsRow("markdown-view", width, "loading", viewLoading!));
    await releaseGate(page, true);
    await expect(app.locator(".ks-editor-error [role=alert]")).toBeVisible();
    await expect(app.locator(".ks-markdown-error [role=alert]")).toBeVisible();
    const editorFailed = await measureAlert(app, ".ks-editor-error");
    const viewFailed = await measureAlert(app, ".ks-markdown-error");
    await app.screenshot({ path: `${captureDir()}/20261118-${phase}-${width}-markdown-editor-failed.png` });
    await app.screenshot({ path: `${captureDir()}/20261118-${phase}-${width}-markdown-view-failed.png` });
    rows.push(boundsRow("markdown-editor", width, "failed", editorFailed!));
    rows.push(boundsRow("markdown-view", width, "failed", viewFailed!));
    await writeFile(`${captureDir()}/20261118-${phase}-markdown-pair.json`, JSON.stringify(rows, null, 2));
    measuredRows.push({ width, editorLoading, editorFailed, viewLoading, viewFailed });
  }
  for (const { width, editorLoading, editorFailed, viewLoading, viewFailed } of measuredRows) {
    assertCenter(`마크다운 편집기 로딩 ${width}`, editorLoading);
    expect(editorFailed, `마크다운 편집기 실패 ${width} 측정`).not.toBeNull();
    assertSameCenter(`마크다운 편집기 ${width}`, editorLoading!.text, editorFailed!.text);
    assertCenter(`마크다운 편집기 실패 ${width}`, editorFailed);
    assertCenter(`마크다운 보기 로딩 ${width}`, viewLoading);
    expect(viewFailed, `마크다운 보기 실패 ${width} 측정`).not.toBeNull();
    assertSameCenter(`마크다운 보기 ${width}`, viewLoading!.text, viewFailed!.text);
    assertCenter(`마크다운 보기 실패 ${width}`, viewFailed);
  }
});

test("탭 칸 안의 마크다운 보기와 편집기도 로딩·실패 글자가 탭 판 가운데에 선다", async ({ page }) => {
  await mkdir(captureDir(), { recursive: true });
  const rows: Array<Record<string, unknown>> = [];
  const measuredRows: Array<{ width: number; viewLoading: Measured | null; viewFailed: Measured | null; editorLoading: Measured | null; editorFailed: Measured | null }> = [];
  await installGate(page, ["storage.get"]);
  for (const width of [1100, 360]) {
    await page.setViewportSize({ width, height: 820 });
    await page.goto("/?preview=storage-document");
    await page.addStyleTag({ content: STYLE });
    await mountFixture(page, markdownTabsLoadingApp);
    const app = page.getByTestId("app-window-storage-document");
    await expect(app.locator(".ks-markdown-loading")).toBeVisible();
    await expect(app.locator(".ks-editor-loading")).toBeVisible();
    await waitGateStarted(page);
    const viewLoading = await measure(app, ".ks-markdown-loading");
    const editorLoading = await measure(app, ".ks-editor-loading");
    await app.screenshot({ path: `${captureDir()}/20261118-${phase}-${width}-tabs-view-loading.png` });
    await app.screenshot({ path: `${captureDir()}/20261118-${phase}-${width}-tabs-editor-loading.png` });
    rows.push(boundsRow("tabs-view", width, "loading", viewLoading!));
    rows.push(boundsRow("tabs-editor", width, "loading", editorLoading!));
    await releaseGate(page, true);
    await expect(app.locator(".ks-markdown-error [role=alert]")).toBeVisible();
    await expect(app.locator(".ks-editor-error [role=alert]")).toBeVisible();
    const viewFailed = await measureAlert(app, ".ks-markdown-error");
    const editorFailed = await measureAlert(app, ".ks-editor-error");
    await app.screenshot({ path: `${captureDir()}/20261118-${phase}-${width}-tabs-view-failed.png` });
    await app.screenshot({ path: `${captureDir()}/20261118-${phase}-${width}-tabs-editor-failed.png` });
    rows.push(boundsRow("tabs-view", width, "failed", viewFailed!));
    rows.push(boundsRow("tabs-editor", width, "failed", editorFailed!));
    await writeFile(`${captureDir()}/20261118-${phase}-tabs.json`, JSON.stringify(rows, null, 2));
    measuredRows.push({ width, viewLoading, viewFailed, editorLoading, editorFailed });
  }
  for (const { width, viewLoading, viewFailed, editorLoading, editorFailed } of measuredRows) {
    assertFills(`탭 보기 로딩 ${width}`, viewLoading);
    assertCenter(`탭 보기 로딩 ${width}`, viewLoading);
    expect(viewFailed, `탭 보기 실패 ${width} 측정`).not.toBeNull();
    assertSameCenter(`탭 보기 ${width}`, viewLoading!.text, viewFailed!.text);
    assertCenter(`탭 보기 실패 ${width}`, viewFailed);
    assertFills(`탭 편집기 로딩 ${width}`, editorLoading);
    assertCenter(`탭 편집기 로딩 ${width}`, editorLoading);
    expect(editorFailed, `탭 편집기 실패 ${width} 측정`).not.toBeNull();
    assertSameCenter(`탭 편집기 ${width}`, editorLoading!.text, editorFailed!.text);
    assertCenter(`탭 편집기 실패 ${width}`, editorFailed);
  }
});
