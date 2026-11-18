import { mkdir, readFile, writeFile } from "node:fs/promises";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type { AppDefinition } from "../../src/contract/contract";
import { markdownTabsLoadingApp } from "./fixtures/loading-center-1621";

// 카드 #1667: 창 아래 모서리 초점 고리, 360px 오류 코드, 360px 탐색기 경로.
// 운영 형태의 데이터(하네스의 실제 폴더 트리)로 1100px과 360px을 재고 찍는다.
const STYLE = "body { padding: 0; } .ks-harness { display: block; height: 100vh; } .ks-harness-header, .ks-harness-dev-panel { display: none; } .ks-harness-apps.is-preview { height: 100%; }";
const output = process.env.KS_1667_VISUAL_OUTPUT;
const records: Record<string, unknown> = {};
const uiDesign: Record<string, unknown> = {};

// 시험이 하나씩 끝날 때마다 측정값을 합쳐 둔다. 시험이 시간 초과로 끊겨 워커가 새로 서도
// 앞선 시험의 측정값이 사라지지 않는다.
async function syncMeasurements() {
  if (!output) return;
  let existing: { records?: Record<string, unknown>; uiDesign?: Record<string, unknown> } = {};
  try { existing = JSON.parse(await readFile(`${output}/measurements.json`, "utf8")); } catch { /* 첫 기록 */ }
  const merged = {
    records: { ...existing.records, ...records },
    uiDesign: { ...existing.uiDesign, ...uiDesign },
  };
  await mkdir(output, { recursive: true });
  await writeFile(`${output}/measurements.json`, JSON.stringify(merged, null, 2) + "\n", "utf8");
}

// 1648 사양과 같은 관문: files.list와 files.read를 붙잡았다가 실패로 풀어 첫 읽기 실패를 만든다.
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
          if (gate.fail && request.op === "files.list") throw { code: "io", id: "FILE_LIST_DIRECTORY_IO", message: "폴더 문서: 내용을 읽지 못했습니다. 파일 관리자에서 열리는지 확인하세요.", details: [] };
          if (gate.fail && request.op === "files.read") throw { code: "io", id: "FILE_READ_IO", message: "파일: 내용을 읽지 못했습니다. 파일 관리자에서 열리는지 확인하세요.", details: [] };
          if (gate.fail && request.op === "storage.get") throw { code: "io", id: "STORAGE_GET_IO", message: "문서: 내용을 읽지 못했습니다.", details: [] };
        }
        return call(request);
      };
      harness = value;
    } });
  }, ops);
}
async function mount(page: Page, definition: AppDefinition, width: number, height = 820) {
  await page.setViewportSize({ width, height });
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
async function raisePreviewWindow(page: Page) {
  await page.evaluate(async () => {
    const harness = (window as any).__ksHarness;
    const { snapshot } = await harness.call({ op: "state.get" });
    const target = snapshot.shared.windows.find((window: any) => window.app_id === "notice-fixture");
    target.z = Math.max(...snapshot.shared.windows.map((window: any) => window.z)) + 1;
    harness.emit({ event: "state.changed", snapshot });
  });
  await page.waitForTimeout(200);
}
async function release(page: Page, failed = false) { await page.evaluate((fail) => (window as any).retryGate.release(fail), failed); }
async function started(page: Page) { await expect.poll(() => page.evaluate(() => (window as any).retryGate.started)).toBeGreaterThan(0); }
async function capture(app: Locator, name: string) {
  if (!output) return;
  await mkdir(output, { recursive: true });
  await app.screenshot({ path: `${output}/${name}.png` });
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}
// 다시 시도 단추를 키보드로 눌러 구조용 초점 고리가 보이는 경로(:focus-visible)를 탄다.
async function activate(page: Page, button: Locator) {
  await button.focus();
  await page.keyboard.press("Enter");
}

// 초점을 가진 구조용 칸의 사각형과 창 본문 상자를 견준 결과, 실제 계산 반경, 고리 모양을 한 번에 모은다.
async function measureFocus(app: Locator, key: string) {
  const measured = await app.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    if (!active) throw new Error("초점을 가진 요소가 없습니다");
    const style = getComputedStyle(active);
    const rect = active.getBoundingClientRect();
    const content = active.closest<HTMLElement>(".ks-harness-window-content, .ks-window-content");
    if (!content) throw new Error("창 본문 상자를 찾지 못했습니다");
    const box = content.getBoundingClientRect();
    const frame = active.closest<HTMLElement>(".ks-harness-window, .ks-window-frame");
    if (!frame) throw new Error("창틀을 찾지 못했습니다");
    const frameStyle = getComputedStyle(frame);
    const appRoot = active.closest<HTMLElement>('[data-testid^="app-window-"]');
    if (!appRoot) throw new Error("앱 창을 찾지 못했습니다");
    const appBox = appRoot.getBoundingClientRect();
    const bottom = Math.abs(rect.bottom - box.bottom) <= 1;
    return {
      className: String(active.className),
      focusVisible: active.matches(":focus-visible"),
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      outlineOffset: style.outlineOffset,
      outlineColor: style.outlineColor,
      radius: { bl: parseFloat(style.borderBottomLeftRadius), br: parseFloat(style.borderBottomRightRadius) },
      rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
      content: { left: box.left, top: box.top, right: box.right, bottom: box.bottom },
      expected: { bl: bottom && Math.abs(rect.left - box.left) <= 1, br: bottom && Math.abs(rect.right - box.right) <= 1 },
      marks: { bl: active.hasAttribute("data-ks-corner-bl"), br: active.hasAttribute("data-ks-corner-br") },
      frameRadius: parseFloat(frameStyle.borderBottomLeftRadius),
      frameBorder: parseFloat(frameStyle.borderBottomWidth),
      app: { left: appBox.left, top: appBox.top, width: appBox.width, height: appBox.height },
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  });
  const expectedRadius = measured.frameRadius - measured.frameBorder;
  expect(measured.focusVisible, `${key}: 구조용 초점이 보여야 합니다`).toBe(true);
  expect(measured.outlineStyle, `${key}: 고리 모양`).toBe("solid");
  expect(measured.outlineOffset, `${key}: 고리는 안쪽에 그립니다`).toBe("-2px");
  expect(measured.marks, `${key}: 창 모서리에 닿는 모서리 표시`).toEqual(measured.expected);
  expect(measured.radius.bl, `${key}: 아래 왼쪽 반경`).toBeCloseTo(measured.expected.bl ? expectedRadius : 0, 1);
  expect(measured.radius.br, `${key}: 아래 오른쪽 반경`).toBeCloseTo(measured.expected.br ? expectedRadius : 0, 1);
  records[key] = measured;
  return measured;
}

// 초점을 둔 칸의 표시가 지금 배치와 맞아질 때까지 기다린다. 창 크기를 바꾼 뒤 다시 잰다.
async function marksMatchLayout(page: Page) {
  await expect.poll(() => page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    if (!active) return false;
    const content = active.closest<HTMLElement>(".ks-harness-window-content, .ks-window-content");
    if (!content) return false;
    const rect = active.getBoundingClientRect();
    const box = content.getBoundingClientRect();
    const bottom = Math.abs(rect.bottom - box.bottom) <= 1;
    const bl = bottom && Math.abs(rect.left - box.left) <= 1;
    const br = bottom && Math.abs(rect.right - box.right) <= 1;
    return active.hasAttribute("data-ks-corner-bl") === bl && active.hasAttribute("data-ks-corner-br") === br;
  })).toBe(true);
}

// 오류 코드의 글자 하나하나의 사각형으로 줄을 다시 세운다. <wbr>는 글자가 아니라 경계만 만든다.
async function codeLayout(notice: Locator) {
  return notice.evaluate((element) => {
    const code = element.querySelector<HTMLElement>(".ks-error-id");
    if (!code) throw new Error("오류 코드가 없습니다");
    const noticeBox = element.getBoundingClientRect();
    const codeBox = code.getBoundingClientRect();
    const chars: Array<{ ch: string; top: number; left: number; right: number; bottom: number }> = [];
    const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node as Text;
      for (let index = 0; index < text.data.length; index++) {
        const range = document.createRange();
        range.setStart(text, index);
        range.setEnd(text, index + 1);
        const rect = range.getBoundingClientRect();
        chars.push({ ch: text.data[index], top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom });
      }
    }
    const lines: Array<{ text: string; left: number; right: number; top: number; bottom: number }> = [];
    for (const item of chars) {
      const line = lines.at(-1);
      if (line && Math.abs(line.top - item.top) <= 1) {
        line.text += item.ch;
        line.right = Math.max(line.right, item.right);
        line.bottom = Math.max(line.bottom, item.bottom);
      } else {
        lines.push({ text: item.ch, left: item.left, right: item.right, top: item.top, bottom: item.bottom });
      }
    }
    return {
      text: code.textContent,
      noticeBox: { left: noticeBox.left, top: noticeBox.top, right: noticeBox.right, bottom: noticeBox.bottom },
      codeBox: { left: codeBox.left, top: codeBox.top, right: codeBox.right, bottom: codeBox.bottom, width: codeBox.width },
      lines,
      codeOverflow: code.scrollWidth - code.clientWidth,
      noticeOverflow: element.scrollWidth - element.clientWidth,
    };
  });
}

function recordCode(key: string, layout: Awaited<ReturnType<typeof codeLayout>>, treeOverflow: number) {
  const inside = layout.lines.every((line) => line.left >= layout.noticeBox.left - 1
    && line.right <= layout.noticeBox.right + 1
    && line.top >= layout.noticeBox.top - 1
    && line.bottom <= layout.noticeBox.bottom + 1);
  expect(layout.text?.replace(/\s/g, ""), `${key}: 코드 전문`).toBe("FILE_LIST_DIRECTORY_IO");
  expect(inside, `${key}: 코드 글자가 알림 상자 안`).toBe(true);
  expect(layout.codeOverflow, `${key}: 코드 상자 가로 넘침 없음`).toBeLessThanOrEqual(1);
  expect(layout.noticeOverflow, `${key}: 알림 상자 가로 넘침 없음`).toBeLessThanOrEqual(1);
  expect(treeOverflow, `${key}: 트리 목록 가로 스크롤 없음`).toBeLessThanOrEqual(0);
  expect(layout.lines.length, `${key}: 두 줄 이상`).toBeGreaterThanOrEqual(2);
  records[key] = layout;
}

// 분할 칸 안에는 여백이 있는 마크다운 보기를 둔다. 코드 편집기는 자기 배경과 줄 번호 홈이
// 칸 테두리 위를 덮어 초점 고리가 보이지 않으므로, 실제 탐색기 분할 칸처럼 여백이 있는 내용으로 잰다.
const splitMarkdownApp: AppDefinition = {
  id: "storage-document", name: "모서리 초점 시험", requires: { blocks: 6, modules: { storage: 1 } },
  permissions: [], state: {},
  storage: { entries: [
    { id: "kaleidoscope", key: "kaleidoscope", kind: "md", default: "# Kaleidoscope", label: "문서", presentation: "hidden" },
    { id: "readme", key: "readme", kind: "md", default: "# README", label: "문서", presentation: "hidden" },
  ] },
  ui: { type: "split", direction: "row", sizes: [50, 50], column_below: 600, children: [
    { type: "markdown", document: { entry: "kaleidoscope" }, read_only: true },
    { type: "markdown", document: { entry: "readme" }, read_only: true },
  ] },
};
const explorerApp: AppDefinition = {
  id: "storage-document", name: "탐색기 모서리 시험", requires: { blocks: 13, modules: { files: 3 } },
  permissions: [{ module: "files", id: "documents", access: "readwrite", label: "문서 폴더" }], state: {},
  ui: { type: "explorer", root: { permission: "documents" } },
};

for (const width of [1100, 360]) {
  test(`분할 칸과 창 본문 모서리 초점 고리 ${width}`, async ({ page }) => {
    await gate(page, ["storage.get"]);
    const app = await mount(page, splitMarkdownApp, width);
    await started(page);
    await release(page, true);
    const panes = app.locator(".ks-split-pane");
    await expect(panes).toHaveCount(2);
    const retry = (index: number) => panes.nth(index).locator(".ks-markdown-error").getByRole("button", { name: "다시 시도" });
    await expect(retry(0)).toBeVisible();
    await expect(retry(1)).toBeVisible();
    if (width < 600) await expect(app.locator(".ks-split.is-stacked")).toHaveCount(1);
    await page.evaluate(() => { (window as any).retryGate.fail = false; });

    await activate(page, retry(0));
    await expect.poll(() => page.evaluate(() => document.activeElement?.classList.contains("ks-split-pane") === true)).toBe(true);
    await marksMatchLayout(page);
    await capture(app, `${width}-corner-split-left`);
    await measureFocus(app, `${width}-corner-split-left`);

    await activate(page, retry(1));
    await expect.poll(() => page.evaluate(() => document.activeElement?.classList.contains("ks-split-pane") === true)).toBe(true);
    await marksMatchLayout(page);
    await capture(app, `${width}-corner-split-right`);
    const right = await measureFocus(app, `${width}-corner-split-right`);

    // 초점을 둔 채 창 폭을 바꾸면 지금 배치의 모서리로 표시를 다시 정한다.
    const flip = width === 1100 ? 360 : 1100;
    await page.setViewportSize({ width: flip, height: 820 });
    if (flip < 600) await expect(app.locator(".ks-split.is-stacked")).toHaveCount(1);
    else await expect(app.locator(".ks-split.is-stacked")).toHaveCount(0);
    await marksMatchLayout(page);
    await capture(app, `${width}-corner-resize`);
    await measureFocus(app, `${width}-corner-resize`);
    uiDesign["창 크기 바꾸기"] = { 통과: true, 비고: `${width} → ${flip}` };

    await page.setViewportSize({ width, height: 820 });
    await marksMatchLayout(page);
    expect(right.expected.br || right.expected.bl).toBe(true);
    await noOverflow(page);
    await syncMeasurements();
  });

  test(`탐색기 본문과 트리 목록 모서리 초점 고리 ${width}`, async ({ page }) => {
    await gate(page, ["files.list"]);
    const app = await mount(page, explorerApp, width);
    await started(page);
    await release(page, true);
    const tree = app.locator(".ks-file-tree").first();
    const rootError = tree.locator(":scope > [data-ks-fills-body] .ks-notice");
    await expect(rootError).toBeVisible();
    await page.evaluate(() => { (window as any).retryGate.fail = false; });
    await activate(page, rootError.getByRole("button", { name: "다시 시도" }));
    await expect(tree.locator(".ks-file-tree-list")).toBeFocused();
    await marksMatchLayout(page);
    await capture(app, `${width}-corner-tree-list`);
    await measureFocus(app, `${width}-corner-tree-list`);

    const bodyNotice = app.locator(".ks-explorer-content .ks-notice[role=alert]");
    await expect(bodyNotice).toBeVisible();
    await activate(page, bodyNotice.getByRole("button", { name: "다시 시도" }));
    await expect(app.locator(".ks-explorer-content")).toBeFocused();
    await marksMatchLayout(page);
    await capture(app, `${width}-corner-explorer-content`);
    await measureFocus(app, `${width}-corner-explorer-content`);
    await noOverflow(page);
    uiDesign["최소 폭에서 넘침과 잘림"] = { 통과: true, 비고: `${width}px 화면 가로 넘침 없음` };
    uiDesign["오류 상태"] = { 통과: true, 비고: "읽기 실패 안내와 다시 시도가 제자리에서 바뀜" };
    uiDesign["누른 뒤 초점"] = { 통과: true, 비고: "다시 시도 뒤 구조용 칸이 초점을 받음" };
    await syncMeasurements();
  });

  test(`탭 판 모서리 초점 고리 ${width}`, async ({ page }) => {
    await gate(page, ["storage.get"]);
    const app = await mount(page, markdownTabsLoadingApp, width);
    await started(page);
    await release(page, true);
    const panel = app.locator('[role="tabpanel"]').first();
    const notice = panel.locator(".ks-markdown-error [role=alert]");
    await expect(notice).toBeVisible();
    await page.evaluate(() => { (window as any).retryGate.fail = false; });
    await activate(page, notice.getByRole("button", { name: "다시 시도" }));
    await expect.poll(() => page.evaluate(() => document.activeElement?.matches('[role="tabpanel"]') === true)).toBe(true);
    await marksMatchLayout(page);
    await capture(app, `${width}-corner-tab-panel`);
    await measureFocus(app, `${width}-corner-tab-panel`);
    await syncMeasurements();
  });

  test(`알림을 닫은 뒤 창 본문 모서리 초점 ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 820 });
    await page.goto("/?preview=notice-fixture");
    await page.addStyleTag({ content: STYLE });
    await page.getByTestId("fake-files-panel").evaluate((element) => element.remove());
    await raisePreviewWindow(page);
    const app = page.getByTestId("app-window-notice-fixture");
    await expect(app.getByRole("button", { name: "시작 단추" })).toBeVisible();
    await page.evaluate(() => (window as any).noticeFixture.alert());
    const notice = app.getByRole("alert");
    const close = notice.getByRole("button", { name: "닫기" });
    await close.focus();
    await page.keyboard.press("Enter");
    await expect(notice).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.activeElement?.classList.contains("ks-data-window-body") === true)).toBe(true);
    await marksMatchLayout(page);
    await capture(app, `${width}-corner-window-body`);
    await measureFocus(app, `${width}-corner-window-body`);

    // 닫은 뒤 초점에서 Tab을 누르면 창 안의 보이는 조작으로 간다.
    await page.keyboard.press("Tab");
    await expect.poll(() => page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      return Boolean(active && active !== document.body && active.getClientRects().length > 0
        && active.closest('[data-testid="app-window-notice-fixture"]'));
    })).toBe(true);
    uiDesign["Tab과 Esc"] = { 통과: true, 비고: "Tab이 창 안 보이는 조작으로 감. 이번 화면에는 대화상자·시트·팝오버·메뉴가 없어 Esc는 해당 없음" };
    await syncMeasurements();
  });
}

test("360px 오류 코드가 알림 상자 안에서 _ 경계로 나뉜다", async ({ page }) => {
  await gate(page, ["files.list"]);
  const app = await mount(page, explorerApp, 360);
  await started(page);
  await release(page, true);
  const tree = app.locator(".ks-file-tree").first();
  const treeList = tree.locator(".ks-file-tree-list");
  const bodyNotice = app.locator(".ks-explorer-content .ks-notice[role=alert]");
  await expect(bodyNotice).toBeVisible();

  // 본문 실패: 코드 글자가 모두 알림 상자 안에 있다. 트리 목록은 아직 없으므로 생기면 잰다.
  const bodyOverflow = async () => (await treeList.count())
    ? treeList.evaluate((element) => element.scrollWidth - element.clientWidth)
    : 0;
  recordCode("360-code-body", await codeLayout(bodyNotice), await bodyOverflow());
  await capture(app, "360-code-body");
  expect((records["360-code-body"] as any).lines[0].text).toBe("FILE_LIST_");

  await page.evaluate(() => { (window as any).retryGate.fail = false; });
  await activate(page, bodyNotice.getByRole("button", { name: "다시 시도" }));
  await expect(bodyNotice).toHaveCount(0);
  const rootError = tree.locator(":scope > [data-ks-fills-body] .ks-notice");
  await activate(page, rootError.getByRole("button", { name: "다시 시도" }));
  const notes = tree.getByRole("treeitem", { name: "notes" });
  await expect(notes).toBeVisible();

  // 한 단계 아래 폴더를 하나 더 만들어 두 단계 깊이의 좁은 행도 잰다.
  await page.evaluate(async () => {
    const harness = (window as any).__ksHarness;
    await harness.call({ op: "files.write", window_id: "storage-window", permission: "documents", path: "notes/deep/memo.md", text: "# 깊은 폴더" });
  });

  await page.evaluate(() => { (window as any).retryGate.fail = true; });
  await notes.click();
  const one = tree.locator('[data-tree-row="error:notes"] .ks-notice');
  await expect(one).toBeVisible();
  recordCode("360-code-tree-child-1", await codeLayout(one), await bodyOverflow());
  await capture(app, "360-code-tree-child-1");
  expect((records["360-code-tree-child-1"] as any).lines[0].text).toBe("FILE_LIST_");

  await page.evaluate(() => { (window as any).retryGate.fail = false; });
  await activate(page, one.getByRole("button", { name: "다시 시도" }));
  await expect(one).toHaveCount(0);
  const deep = tree.getByRole("treeitem", { name: "deep" });
  await expect(deep).toBeVisible();
  await page.evaluate(() => { (window as any).retryGate.fail = true; });
  await deep.click();
  const two = tree.locator('[data-tree-row="error:notes/deep"] .ks-notice');
  await expect(two).toBeVisible();
  recordCode("360-code-tree-child-2", await codeLayout(two), await bodyOverflow());
  await capture(app, "360-code-tree-child-2");
  await noOverflow(page);
  await syncMeasurements();
});

test("360px notes 폴더 경로가 앞자리 없이 … › notes로 보인다", async ({ page }) => {
  const app = await mount(page, explorerApp, 360);
  await expect(app.getByRole("option", { name: "settings.json" })).toBeVisible();
  const tree = app.locator(".ks-file-tree").first();
  await tree.getByRole("treeitem", { name: "notes" }).click();
  await expect(app.locator(".ks-explorer-crumb-current")).toHaveText("notes");

  const layout = () => app.evaluate(() => {
    const nav = document.querySelector<HTMLElement>('[data-testid="app-window-storage-document"] .ks-explorer-breadcrumb');
    if (!nav) throw new Error("경로 줄이 없습니다");
    const navBox = nav.getBoundingClientRect();
    const crumbs = Array.from(nav.querySelectorAll<HTMLElement>(".ks-explorer-crumb"));
    const indicator = nav.querySelector<HTMLElement>(".ks-explorer-collapsed");
    const current = nav.querySelector<HTMLElement>(".ks-explorer-crumb-current");
    if (!indicator || !current) throw new Error("경로 표시가 없습니다");
    const visible = [indicator, ...crumbs, current].filter((element) => element.getClientRects().length > 0);
    const left = Math.min(...visible.map((element) => element.getBoundingClientRect().left));
    return {
      hasCollapsed: nav.classList.contains("has-collapsed"),
      indicatorVisible: indicator.getClientRects().length > 0,
      indicatorText: indicator.textContent,
      collapsed: crumbs.map((crumb) => crumb.classList.contains("is-collapsed")),
      visibleCrumbTexts: crumbs.filter((crumb) => crumb.getClientRects().length > 0)
        .map((crumb) => crumb.querySelector("button")?.textContent ?? ""),
      nav: { left: navBox.left, right: navBox.right, width: navBox.width },
      gap: left - navBox.left,
      current: current.textContent,
    };
  });

  const narrow = await layout();
  records["360-path-notes"] = narrow;
  expect(narrow.hasCollapsed, "360: 접힌 조상이 있음").toBe(true);
  expect(narrow.indicatorVisible, "360: 「…」가 보임").toBe(true);
  expect(narrow.collapsed[0], "360: 뿌리 조상부터 접음").toBe(true);
  expect(narrow.gap, "360: 첫 보이는 글자가 경로 줄 왼쪽 끝에서 시작").toBeLessThanOrEqual(1);
  expect(narrow.current).toBe("notes");
  expect(narrow.indicatorText).toContain("…");
  await capture(app, "360-path-notes");

  await page.setViewportSize({ width: 1100, height: 820 });
  await expect.poll(() => app.evaluate(() => document.querySelector('[data-testid="app-window-storage-document"] .ks-explorer-breadcrumb')?.classList.contains("has-collapsed") === false)).toBe(true);
  const wide = await layout();
  records["1100-path-notes"] = wide;
  expect(wide.hasCollapsed, "1100: 접힘 없음").toBe(false);
  expect(wide.indicatorVisible, "1100: 「…」 없음").toBe(false);
  expect(wide.visibleCrumbTexts, "1100: 뿌리부터 다 보임").toEqual(["문서"]);
  expect(wide.gap, "1100: 첫 보이는 글자가 경로 줄 왼쪽 끝에서 시작").toBeLessThanOrEqual(1);
  expect(wide.current).toBe("notes");
  await capture(app, "1100-path-notes");

  await page.setViewportSize({ width: 360, height: 820 });
  await expect.poll(() => app.evaluate(() => document.querySelector('[data-testid="app-window-storage-document"] .ks-explorer-breadcrumb')?.classList.contains("has-collapsed") === true)).toBe(true);
  const again = await layout();
  records["360-path-notes-back"] = again;
  expect(again.hasCollapsed, "360으로 다시 좁히면 접힘").toBe(true);
  expect(again.indicatorVisible, "360으로 다시 좁히면 「…」").toBe(true);
  expect(again.gap, "다시 좁혀도 빈 앞자리 없음").toBeLessThanOrEqual(1);
  expect(again.current).toBe("notes");
  await capture(app, "360-path-notes-back");
  await noOverflow(page);
  uiDesign["창 크기 바꾸기"] = { 통과: true, 비고: "360 → 1100 → 360 경로 모양이 각각 맞음" };
  await syncMeasurements();
});

test.afterAll(async () => { await syncMeasurements(); });
