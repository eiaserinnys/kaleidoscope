import { mkdir, readFile, writeFile } from "node:fs/promises";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type { AppDefinition } from "../../src/contract/contract";

// 카드 #1667 후속: 깊은 트리 행의 읽기 실패·폴더 작업 안내 폭, 코드 편집기 칸의 구조용 초점 고리.
// 운영 형태의 데이터(하네스의 실제 폴더 트리)로 1100px과 360px을 재고 찍는다.
const STYLE = "body { padding: 0; } .ks-harness { display: block; height: 100vh; } .ks-harness-header, .ks-harness-dev-panel { display: none; } .ks-harness-apps.is-preview { height: 100%; }";
const output = process.env.KS_1667_RETRY_GUTTER_OUTPUT;
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

// 1648·1667 사양과 같은 관문: files.list와 files.read를 붙잡았다가 실패로 풀어 첫 읽기 실패를 만든다.
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
          if (gate.fail && request.op === "files.reveal") throw { code: "io", id: "FILE_REVEAL_OPEN_IO", message: "파일 memo.md: 파일 관리자에서 열지 못했습니다. 파일 관리자가 실행 중인지 확인하세요.", details: [] };
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
// 단추를 키보드로 눌러 구조용 초점 고리가 보이는 경로(:focus-visible)를 탄다.
async function activate(page: Page, button: Locator) {
  await button.focus();
  await page.keyboard.press("Enter");
}

const explorerApp: AppDefinition = {
  id: "storage-document", name: "탐색기 깊은 오류 행 시험", requires: { blocks: 13, modules: { files: 3 } },
  permissions: [{ module: "files", id: "documents", access: "readwrite", label: "문서 폴더" }], state: {},
  ui: { type: "explorer", root: { permission: "documents" } },
};
const folderApp: AppDefinition = {
  id: "storage-document", name: "폴더 작업 안내 시험", requires: { blocks: 13, modules: { files: 3 } },
  permissions: [{ module: "files", id: "documents", access: "readwrite", label: "문서 폴더" }], state: {},
  ui: { type: "folder", root: { permission: "documents" }, extensions: [], read_only: false },
};
const codeEditorSplitApp: AppDefinition = {
  id: "storage-document", name: "코드 편집기 초점 시험", requires: { blocks: 6, modules: { files: 1 } },
  permissions: [{ module: "files", id: "documents", access: "read", label: "문서 폴더" }], state: {},
  ui: { type: "split", direction: "row", sizes: [50, 50], column_below: 600, children: [
    { type: "code", file: { permission: "documents", path: "Kaleidoscope.md" } },
    { type: "markdown", file: { permission: "documents", path: "Kaleidoscope.md" }, read_only: true },
  ] },
};
const codeViewSplitApp: AppDefinition = {
  id: "storage-document", name: "코드 보기 초점 시험", requires: { blocks: 6, modules: { files: 1 } },
  permissions: [{ module: "files", id: "documents", access: "read", label: "문서 폴더" }], state: {},
  ui: { type: "split", direction: "row", sizes: [50, 50], column_below: 600, children: [
    { type: "code", file: { permission: "documents", path: "Kaleidoscope.md" }, read_only: true },
    { type: "markdown", file: { permission: "documents", path: "Kaleidoscope.md" }, read_only: true },
  ] },
};
const markdownEditorSplitApp: AppDefinition = {
  id: "storage-document", name: "마크다운 편집기 초점 시험", requires: { blocks: 6, modules: { files: 1 } },
  permissions: [{ module: "files", id: "documents", access: "read", label: "문서 폴더" }], state: {},
  ui: { type: "split", direction: "row", sizes: [50, 50], column_below: 600, children: [
    { type: "code", file: { permission: "documents", path: "Kaleidoscope.md" }, read_only: true },
    { type: "markdown", file: { permission: "documents", path: "Kaleidoscope.md" } },
  ] },
};

// 실패 알림 한 행의 폭, 단추, 코드, 목록 넘침, 대상 행과의 이웃 관계를 한 번에 모은다.
async function failureLayout(app: Locator, targetId: string, errorId: string) {
  return app.evaluate((root, ids) => {
    const box = (rect: DOMRect) => ({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height });
    const list = root.querySelector<HTMLElement>(".ks-file-tree-list");
    if (!list) throw new Error("트리 목록이 없습니다");
    const rows = Array.from(list.querySelectorAll<HTMLElement>("[data-tree-row]"));
    const targetRow = rows.find((row) => row.getAttribute("data-tree-row") === ids.targetId);
    const noticeRow = rows.find((row) => row.getAttribute("data-tree-row") === ids.errorId);
    if (!targetRow || !noticeRow) throw new Error(`행이 없습니다: ${ids.targetId} / ${ids.errorId}`);
    const notice = noticeRow.querySelector<HTMLElement>(".ks-notice");
    if (!notice) throw new Error("알림이 없습니다");
    const button = notice.querySelector<HTMLElement>(".ks-notice-actions button");
    const messageRoot = notice.querySelector<HTMLElement>(".ks-notice-message");
    const messageText = messageRoot ? document.createTreeWalker(messageRoot, NodeFilter.SHOW_TEXT).nextNode() : null;
    const messageLines: Array<{ top: number; text: string }> = [];
    const breaks: string[] = [];
    if (messageText && messageText.nodeType === Node.TEXT_NODE) {
      const value = messageText.nodeValue ?? "";
      for (let index = 0; index < value.length; index += 1) {
        const range = document.createRange();
        range.setStart(messageText, index);
        range.setEnd(messageText, index + 1);
        const rect = range.getBoundingClientRect();
        const line = messageLines.at(-1);
        if (!line || Math.abs(rect.top - line.top) > 1) messageLines.push({ top: rect.top, text: value[index] });
        else line.text += value[index];
      }
      for (let index = 0; index < messageLines.length - 1; index += 1) {
        const left = messageLines[index].text.at(-1) ?? "";
        const right = messageLines[index + 1].text[0] ?? "";
        if (left !== " " && right !== " ") breaks.push(`${left}|${right}`);
      }
    }
    const code = notice.querySelector<HTMLElement>(".ks-error-id");
    const codeLines: Array<{ text: string; left: number; right: number; top: number; bottom: number }> = [];
    if (code) {
      const chars: Array<{ ch: string; top: number; left: number; right: number; bottom: number }> = [];
      const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node as Text;
        for (let index = 0; index < text.data.length; index += 1) {
          const range = document.createRange();
          range.setStart(text, index);
          range.setEnd(text, index + 1);
          const rect = range.getBoundingClientRect();
          chars.push({ ch: text.data[index], top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom });
        }
      }
      for (const item of chars) {
        const line = codeLines.at(-1);
        if (line && Math.abs(line.top - item.top) <= 1) {
          line.text += item.ch;
          line.right = Math.max(line.right, item.right);
          line.bottom = Math.max(line.bottom, item.bottom);
        } else {
          codeLines.push({ text: item.ch, left: item.left, right: item.right, top: item.top, bottom: item.bottom });
        }
      }
    }
    const listStyle = getComputedStyle(list);
    const listRect = list.getBoundingClientRect();
    return {
      targetId: ids.targetId,
      errorId: ids.errorId,
      targetText: targetRow.textContent ?? "",
      notice: box(notice.getBoundingClientRect()),
      button: button ? box(button.getBoundingClientRect()) : null,
      message: { lines: messageLines.map((line) => line.text), breaks },
      code: { text: code?.textContent ?? null, lines: codeLines, overflow: code ? code.scrollWidth - code.clientWidth : 0 },
      noticeOverflow: notice.scrollWidth - notice.clientWidth,
      list: {
        left: listRect.left, right: listRect.right,
        contentLeft: listRect.left + parseFloat(listStyle.paddingLeft),
        contentRight: listRect.right - parseFloat(listStyle.paddingRight),
        clientWidth: list.clientWidth, scrollWidth: list.scrollWidth,
      },
      rows: { target: rows.indexOf(targetRow), notice: rows.indexOf(noticeRow) },
      indents: { target: getComputedStyle(targetRow).paddingInlineStart, notice: getComputedStyle(noticeRow).paddingInlineStart },
    };
  }, { targetId, errorId });
}

type FailureRecord = Awaited<ReturnType<typeof failureLayout>>;

function recordFailure(key: string, layout: FailureRecord) {
  const notice = layout.notice;
  const button = layout.button;
  expect(button, `${key}: 다시 시도 단추`).not.toBeNull();
  expect(button!.right, `${key}: 단추 오른쪽 끝이 알림 상자 안`).toBeLessThanOrEqual(notice.right + 1);
  expect(button!.left, `${key}: 단추 왼쪽 끝이 알림 상자 안`).toBeGreaterThanOrEqual(notice.left - 1);
  expect(button!.top, `${key}: 단추 위쪽 끝이 알림 상자 안`).toBeGreaterThanOrEqual(notice.top - 1);
  expect(button!.bottom, `${key}: 단추 아래쪽 끝이 알림 상자 안`).toBeLessThanOrEqual(notice.bottom + 1);
  for (const line of layout.code.lines) {
    expect(line.left, `${key}: 코드 글자가 알림 상자 안(왼쪽)`).toBeGreaterThanOrEqual(notice.left - 1);
    expect(line.right, `${key}: 코드 글자가 알림 상자 안(오른쪽)`).toBeLessThanOrEqual(notice.right + 1);
  }
  expect(layout.code.text?.replace(/\s/g, ""), `${key}: 오류 코드 전문`).toBe("FILE_LIST_DIRECTORY_IO");
  expect(layout.code.overflow, `${key}: 코드 상자 가로 넘침 없음`).toBeLessThanOrEqual(1);
  expect(layout.noticeOverflow, `${key}: 알림 상자 가로 넘침 없음`).toBeLessThanOrEqual(1);
  expect(layout.message.breaks, `${key}: 안내 글이 낱말 안에서 끊기지 않음`).toEqual([]);
  expect(layout.list.scrollWidth, `${key}: 트리 목록 가로 스크롤 없음`).toBeLessThanOrEqual(layout.list.clientWidth);
  expect(layout.rows.notice, `${key}: 알림 행이 대상 행 바로 아래`).toBe(layout.rows.target + 1);
  expect(layout.indents.notice, `${key}: 안내 행은 들여쓰기를 받지 않음`).toBe("0px");
  expect(layout.notice.left, `${key}: 안내 행이 목록 내용 왼쪽 끝에서 시작`).toBeLessThanOrEqual(layout.list.contentLeft + 1);
  expect(layout.list.contentRight - layout.notice.right, `${key}: 안내 행이 목록 오른쪽 끝까지 참`).toBeLessThanOrEqual(1);
  records[key] = layout;
}

// 모델 깊이 1부터 5까지의 실패 행을 만들 수 있게 폴더 사슬을 만들어 둔다.
// notes는 뿌리의 항목(깊이 0)이고, 그 아래 폴더를 펼치며 생기는 실패 행이 깊이 1부터 5다.
const CHAIN = [
  { name: "notes", path: "notes", depth: 1 },
  { name: "deep", path: "notes/deep", depth: 2 },
  { name: "deeper", path: "notes/deep/deeper", depth: 3 },
  { name: "deepest", path: "notes/deep/deeper/deepest", depth: 4 },
  { name: "bottom", path: "notes/deep/deeper/deepest/bottom", depth: 5 },
];
async function seedChain(page: Page) {
  await page.evaluate(async () => {
    const harness = (window as any).__ksHarness;
    await harness.call({ op: "files.write", window_id: "storage-window", permission: "documents", path: "notes/deep/deeper/deepest/bottom/memo.md", text: "# 깊은 폴더 메모" });
  });
}
async function openExplorer(page: Page, app: Locator) {
  const tree = app.locator(".ks-file-tree").first();
  const bodyNotice = app.locator(".ks-explorer-content .ks-notice[role=alert]");
  const rootError = tree.locator(":scope > [data-ks-fills-body] .ks-notice");
  await expect(rootError).toBeVisible();
  await page.evaluate(() => { (window as any).retryGate.fail = false; });
  await activate(page, rootError.getByRole("button", { name: "다시 시도" }));
  await expect(tree.locator(".ks-file-tree-list")).toBeFocused();
  if (await bodyNotice.count()) await activate(page, bodyNotice.getByRole("button", { name: "다시 시도" }));
  await expect(tree.getByRole("treeitem", { name: "notes", exact: true })).toBeVisible();
  return tree;
}
async function expandChain(page: Page, tree: Locator, count = 4) {
  for (const step of CHAIN.slice(0, count)) {
    const item = tree.getByRole("treeitem", { name: step.name, exact: true });
    await item.scrollIntoViewIfNeeded();
    await item.click();
    const next = CHAIN[CHAIN.indexOf(step) + 1];
    await expect(tree.getByRole("treeitem", { name: next.name, exact: true })).toBeVisible();
  }
}
// 폴더 사슬을 새로 연 화면에서 대상 깊이의 폴더를 실패 상태로 펼쳐 읽기 실패 행을 만든다.
// 이미 읽어 둔 폴더는 다시 펼쳐도 읽지 않으므로(캐시), 깊이마다 화면을 새로 세운다.
async function openFailureScene(page: Page, width: number, step: { name: string; path: string; depth: number }) {
  const app = await mount(page, explorerApp, width);
  await started(page);
  await release(page, true);
  const tree = await openExplorer(page, app);
  await seedChain(page);
  await expandChain(page, tree, step.depth - 1);
  const item = tree.getByRole("treeitem", { name: step.name, exact: true });
  await item.scrollIntoViewIfNeeded();
  await page.evaluate(() => { (window as any).retryGate.fail = true; });
  await item.click();
  const notice = tree.locator(`[data-tree-row="error:${step.path}"] .ks-notice`);
  await expect(notice).toBeVisible();
  await notice.scrollIntoViewIfNeeded();
  return { app, tree, notice };
}
test("360px 깊이 1~5 폴더 읽기 실패 안내가 행 전체 폭으로 선다", async ({ page }) => {
  await gate(page, ["files.list"]);
  let last: { app: Locator; notice: Locator } | null = null;
  for (const step of CHAIN) {
    const scene = await openFailureScene(page, 360, step);
    const layout = await failureLayout(scene.app, step.path, `error:${step.path}`);
    await capture(scene.app, `360-depth-${step.depth}`);
    recordFailure(`360-depth-${step.depth}`, layout);
    last = { app: scene.app, notice: scene.notice };
  }

  // 마지막 깊이 5의 실패 행을 남긴 채 폭을 넓혔다가 좁혀, 폭이 바뀌어도 같은 기준을 지키는지 본다.
  await page.setViewportSize({ width: 1100, height: 820 });
  await expect(last!.notice).toBeVisible();
  const wide = await failureLayout(last!.app, CHAIN[4].path, `error:${CHAIN[4].path}`);
  recordFailure("360-depth-5-resized-1100", wide);
  await page.setViewportSize({ width: 360, height: 820 });
  await expect(last!.notice).toBeVisible();
  const narrow = await failureLayout(last!.app, CHAIN[4].path, `error:${CHAIN[4].path}`);
  recordFailure("360-depth-5-resized-back", narrow);
  uiDesign["창 크기 바꾸기"] = { 통과: true, 비고: "360 → 1100 → 360에서 깊이 5 실패 안내가 매번 행 전체 폭으로 다시 섰음" };

  // 안내 단추에서 Tab을 눌러 초점이 보이는 조작으로 이어지는지 본다.
  await last!.notice.getByRole("button", { name: "다시 시도" }).focus();
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    return Boolean(active && active !== document.body && active.getClientRects().length > 0);
  })).toBe(true);
  uiDesign["Tab과 Esc"] = { 통과: true, 비고: "안내 단추에서 Tab이 보이는 조작으로 감. 이 화면에는 대화상자·시트·팝오버가 없어 Esc는 해당 없음" };
  uiDesign["최소 폭에서 넘침과 잘림"] = { 통과: true, 비고: "360px 깊이 1~5 실패 행에서 목록 가로 스크롤 0, 단추·코드가 상자 안" };
  uiDesign["오류 상태"] = { 통과: true, 비고: "읽기 실패 자리가 알림과 다시 시도로 바뀌고 같은 행 아래에 남음" };
  uiDesign["누른 뒤 초점"] = { 통과: true, 비고: "다시 시도 뒤 그 폴더 행이 초점을 받음" };
  await noOverflow(page);
  await syncMeasurements();
});

test("1100px 깊이 4 폴더 읽기 실패 안내가 행 전체 폭으로 선다", async ({ page }) => {
  await gate(page, ["files.list"]);
  const scene = await openFailureScene(page, 1100, CHAIN[3]);
  const layout = await failureLayout(scene.app, CHAIN[3].path, `error:${CHAIN[3].path}`);
  await capture(scene.app, "1100-depth-4");
  recordFailure("1100-depth-4", layout);
  await noOverflow(page);
  await syncMeasurements();
});

test("360px 깊은 폴더의 작업 실패 안내도 행 전체 폭으로 선다", async ({ page }) => {
  await gate(page, ["files.reveal"]);
  const app = await mount(page, folderApp, 360);
  await release(page);
  const tree = app.locator(".ks-file-tree").first();
  const list = tree.locator(".ks-file-tree-list");
  await expect(tree.getByRole("treeitem", { name: "notes", exact: true })).toBeVisible();
  await seedChain(page);
  await expandChain(page, tree);

  // 메뉴를 Esc로 닫는 조작을 한 번 하고, 다시 열어 파일 관리자에서 보기를 실패시킨다.
  await tree.getByRole("treeitem", { name: "bottom", exact: true }).click();
  const target = tree.locator('[data-tree-row="notes/deep/deeper/deepest/bottom/memo.md"] [role="treeitem"]');
  await expect(target).toBeVisible();
  await target.scrollIntoViewIfNeeded();
  await target.click({ button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await target.click({ button: "right" });
  await page.evaluate(() => { (window as any).retryGate.fail = true; });
  await page.getByRole("menuitem", { name: "파일 관리자에서 보기" }).click();
  const notice = tree.locator('[data-tree-row="folder-operation-notice"] .ks-notice');
  await expect(notice).toBeVisible();
  await notice.scrollIntoViewIfNeeded();
  const layout = await tree.evaluate((root) => {
    const box = (rect: DOMRect) => ({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height });
    const list = root.querySelector<HTMLElement>(".ks-file-tree-list");
    if (!list) throw new Error("트리 목록이 없습니다");
    const rows = Array.from(list.querySelectorAll<HTMLElement>("[data-tree-row]"));
    const targetRow = rows.find((row) => row.getAttribute("data-tree-row") === "notes/deep/deeper/deepest/bottom/memo.md");
    const noticeRow = rows.find((row) => row.getAttribute("data-tree-row") === "folder-operation-notice");
    if (!targetRow || !noticeRow) throw new Error("행이 없습니다");
    const element = noticeRow.querySelector<HTMLElement>(".ks-notice");
    if (!element) throw new Error("알림이 없습니다");
    const listStyle = getComputedStyle(list);
    const listRect = list.getBoundingClientRect();
    return {
      notice: box(element.getBoundingClientRect()),
      targetText: targetRow.textContent ?? "",
      list: {
        left: listRect.left, right: listRect.right,
        contentLeft: listRect.left + parseFloat(listStyle.paddingLeft),
        contentRight: listRect.right - parseFloat(listStyle.paddingRight),
        clientWidth: list.clientWidth, scrollWidth: list.scrollWidth,
      },
      rows: { target: rows.indexOf(targetRow), notice: rows.indexOf(noticeRow) },
      indent: getComputedStyle(noticeRow).paddingInlineStart,
    };
  });
  await capture(app, "360-operation");
  expect(layout.rows.notice, "폴더 작업 안내가 대상 행 바로 아래").toBe(layout.rows.target + 1);
  expect(layout.indent, "폴더 작업 안내 행은 들여쓰기를 받지 않음").toBe("0px");
  expect(layout.notice.left - layout.list.contentLeft, "안내 상자가 목록 내용 왼쪽 끝에서 시작").toBeLessThanOrEqual(1);
  expect(layout.list.contentRight - layout.notice.right, "안내 상자가 목록 내용 오른쪽 끝까지 참").toBeLessThanOrEqual(1);
  expect(layout.list.scrollWidth, "트리 목록 가로 스크롤 없음").toBeLessThanOrEqual(layout.list.clientWidth);
  records["360-operation"] = layout;
  await noOverflow(page);
  await syncMeasurements();
});

// 초점을 받은 칸과 그 안의 코드 보기, 거터의 사각형과 고리 모양을 한 번에 모은다.
async function measureRing(app: Locator) {
  return app.evaluate(() => {
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
    const boxOf = (element: Element | null) => {
      if (!element) return null;
      const r = element.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
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
      codeView: boxOf(active.querySelector(".ks-code-view")),
      codeViewPadding: (() => {
        const view = active.querySelector<HTMLElement>(".ks-code-view");
        return view ? getComputedStyle(view).paddingInlineStart : null;
      })(),
      editor: boxOf(active.querySelector(".cm-editor")),
      scroller: boxOf(active.querySelector(".cm-scroller")),
      gutters: boxOf(active.querySelector(".cm-gutters")),
    };
  });
}

function recordRing(key: string, measured: Awaited<ReturnType<typeof measureRing>>) {
  expect(measured.focusVisible, `${key}: 구조용 초점이 보여야 합니다`).toBe(true);
  expect(measured.outlineStyle, `${key}: 고리 모양`).toBe("solid");
  expect(measured.outlineOffset, `${key}: 고리는 안쪽에 그립니다`).toBe("-2px");
  expect(measured.marks, `${key}: 창 모서리에 닿는 모서리 표시`).toEqual(measured.expected);
  const expectedRadius = measured.frameRadius - measured.frameBorder;
  expect(measured.radius.bl, `${key}: 아래 왼쪽 반경`).toBeCloseTo(measured.expected.bl ? expectedRadius : 0, 1);
  expect(measured.radius.br, `${key}: 아래 오른쪽 반경`).toBeCloseTo(measured.expected.br ? expectedRadius : 0, 1);
  if (measured.codeView) {
    // 코드 보기의 테두리 상자는 칸을 채우고, 안쪽 여백만큼 들어간 CodeMirror 층이 고리 띠를 비운다.
    const editor = measured.editor!;
    expect(editor.left - measured.rect.left, `${key}: 편집기 층이 칸 왼쪽에서 고리 띠만큼 안쪽`).toBeGreaterThanOrEqual(1.5);
    expect(editor.top - measured.rect.top, `${key}: 편집기 층이 칸 위쪽에서 고리 띠만큼 안쪽`).toBeGreaterThanOrEqual(1.5);
    expect(measured.rect.right - editor.right, `${key}: 편집기 층이 칸 오른쪽에서 고리 띠만큼 안쪽`).toBeGreaterThanOrEqual(1.5);
    expect(measured.rect.bottom - editor.bottom, `${key}: 편집기 층이 칸 아래쪽에서 고리 띠만큼 안쪽`).toBeGreaterThanOrEqual(1.5);
    expect(measured.gutters, `${key}: 줄 번호 거터`).not.toBeNull();
    expect(measured.gutters!.left - measured.rect.left, `${key}: 거터가 칸 왼쪽 고리 띠를 덮지 않음`).toBeGreaterThanOrEqual(1.5);
  }
  records[key] = measured;
}

// 코드 편집기·코드 보기·마크다운 편집기가 든 분할 칸에 다시 시도로 구조용 초점을 준다.
// 재지 않는 칸을 먼저 다시 읽어 화면을 정리하고, 재는 칸을 마지막에 눌러 초점을 그 칸에 남긴다.
async function focusPaneOf(page: Page, app: Locator, focusIndex: number) {
  const panes = app.locator(".ks-split-pane");
  await expect(panes).toHaveCount(2);
  for (const index of focusIndex === 1 ? [0, 1] : [1, 0]) {
    const retry = panes.nth(index).getByRole("button", { name: "다시 시도" });
    await expect(retry).toBeVisible();
    await activate(page, retry);
  }
  await expect.poll(() => page.evaluate((index) => {
    const active = document.activeElement as HTMLElement | null;
    const root = document.querySelector('[data-testid="app-window-storage-document"]');
    const panes = root ? Array.from(root.querySelectorAll(".ks-split-pane")) : [];
    return Boolean(active && active.classList.contains("ks-split-pane") && active === panes[index]);
  }, focusIndex)).toBe(true);
  await expect(panes.nth(focusIndex).locator(".cm-content")).toHaveCount(1);
}

for (const width of [1100, 360]) {
  for (const scene of [
    { key: "code-editor", definition: codeEditorSplitApp },
    { key: "code-view", definition: codeViewSplitApp },
  ] as const) {
    test(`${scene.key} 칸의 초점 고리가 거터에 가리지 않는다 ${width}`, async ({ page }) => {
      await gate(page, ["files.read"]);
      const app = await mount(page, scene.definition, width);
      await started(page);
      await release(page, true);
      if (width < 600) await expect(app.locator(".ks-split.is-stacked")).toHaveCount(1);
      await page.evaluate(() => { (window as any).retryGate.fail = false; });
      await focusPaneOf(page, app, 0);
      await capture(app, `${width}-${scene.key}`);
      recordRing(`${width}-${scene.key}`, await measureRing(app));
      uiDesign["누른 뒤 초점"] = { 통과: true, 비고: "다시 시도 뒤 코드 칸이 구조용 초점을 받음" };
      await noOverflow(page);
      await syncMeasurements();
    });
  }

  test(`마크다운 편집기 칸의 초점 고리가 그대로다 ${width}`, async ({ page }) => {
    await gate(page, ["files.read"]);
    const app = await mount(page, markdownEditorSplitApp, width);
    await started(page);
    await release(page, true);
    if (width < 600) await expect(app.locator(".ks-split.is-stacked")).toHaveCount(1);
    await page.evaluate(() => { (window as any).retryGate.fail = false; });
    await focusPaneOf(page, app, 1);
    await capture(app, `${width}-markdown-editor`);
    recordRing(`${width}-markdown-editor`, await measureRing(app));
    await noOverflow(page);
    await syncMeasurements();
  });
}

test.afterAll(async () => { await syncMeasurements(); });
