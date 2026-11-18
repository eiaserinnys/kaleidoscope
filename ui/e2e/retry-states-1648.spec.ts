import { mkdir } from "node:fs/promises";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { codeEditorLoadingApp, codeViewLoadingApp, explorerLoadingApp, markdownTabsLoadingApp } from "./fixtures/loading-center-1621";

const STYLE = "body { padding: 0; } .ks-harness { display: block; height: 100vh; } .ks-harness-header, .ks-harness-dev-panel { display: none; } .ks-harness-apps.is-preview { height: 100%; }";
const folderApp = {
  id: "storage-document", name: "폴더", requires: { blocks: 13, modules: { files: 3 } },
  permissions: [{ module: "files", id: "documents", access: "readwrite", label: "문서" }], state: {},
  ui: { type: "folder", root: { permission: "documents" }, extensions: [], read_only: false },
};
const markdownFileApp = { ...codeViewLoadingApp, ui: { type: "markdown", file: { permission: "documents", path: "README.md" }, read_only: true } };
const markdownEditorApp = { ...codeViewLoadingApp, name: "마크다운 편집기 시험", ui: { type: "markdown", file: { permission: "documents", path: "Kaleidoscope.md" } } };
// 보기 창의 창 초점 새로고침을 재려면 시험이 파일 내용을 바꿔야 해서 쓰기 권한을 선언한다.
const markdownFocusViewApp = {
  ...codeViewLoadingApp, name: "마크다운 보기 초점 시험",
  permissions: [{ module: "files", id: "documents", access: "readwrite", label: "문서" }],
  ui: { type: "markdown", file: { permission: "documents", path: "Kaleidoscope.md" }, read_only: true },
};

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
          if (gate.fail && request.op === "files.remove") return { op: "files.remove", results: request.paths.map((path: string) => ({ path, error: { code: "io", message: `${path}: 옮기지 못했습니다`, details: [] } })) };
          if (gate.fail && request.op === "files.list") throw { code: "io", id: "FILE_LIST_DIRECTORY_IO", message: "폴더 문서: 내용을 읽지 못했습니다. 파일 관리자에서 열리는지 확인하세요.", details: [] };
          if (gate.fail && request.op === "files.read") throw { code: "io", id: "FILE_READ_IO", message: "파일: 내용을 읽지 못했습니다. 파일 관리자에서 열리는지 확인하세요.", details: [] };
          if (gate.fail && request.op === "files.reveal") throw { code: "io", id: "FILE_REVEAL_OPEN_IO", message: "파일 settings.json: 파일 관리자에서 열지 못했습니다. 파일 관리자가 실행 중인지 확인하세요.", details: [] };
          if (gate.fail) throw { code: "io", message: "파일을 읽지 못했습니다", details: [] };
        }
        return call(request);
      };
      harness = value;
    } });
  }, ops);
}
async function mount(page: Page, definition: unknown, width: number, height = 820) {
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
    await expect(notice.locator('.ks-notice-message')).toHaveCSS('text-align', 'start');
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
    await expect.poll(() => page.evaluate(() => document.activeElement?.closest('.ks-explorer-content') !== null)).toBe(true);
    await capture(app, `${width}-retry-focus`);
    const tree = app.locator(".ks-file-tree").first();
    await tree.getByRole("button", { name: "다시 시도" }).click();
    await expect(tree.getByRole("treeitem", { name: "notes" })).toBeVisible();
    await page.evaluate(() => { (window as any).retryGate.fail = true; window.dispatchEvent(new Event("focus")); });
    await expect(notice).toBeVisible();
    await expect(body.getByRole("option", { name: "settings.json" })).toBeVisible();
    await expect(tree.getByRole("treeitem", { name: "notes" })).toBeVisible();
    await expect(tree.locator('.ks-notice[role="alert"]')).toBeVisible();
    const insets = await app.evaluate((root) => {
      const body = root.querySelector('.ks-explorer-content')!.getBoundingClientRect();
      const notice = root.querySelector('.ks-explorer-content .ks-notice')!.getBoundingClientRect();
      const tree = root.querySelector('.ks-file-tree-list')!.getBoundingClientRect();
      const treeNotice = root.querySelector('.ks-file-tree-list .ks-notice')!.getBoundingClientRect();
      return { body: notice.left - body.left, tree: treeNotice.left - tree.left, right: body.right - notice.right };
    });
    expect(Math.abs(insets.body - insets.tree)).toBeLessThanOrEqual(1);
    expect(insets.right).toBeGreaterThan(0);
    await capture(app, `${width}-refresh`);
    await page.evaluate(() => { (window as any).retryGate.fail = false; });
    await tree.locator('.ks-notice[role="alert"] button').focus();
    await page.keyboard.press("Space");
    await expect(tree.locator('.ks-notice[role="alert"]')).toHaveCount(0);
    await expect(tree.locator('.ks-file-tree-list')).toBeFocused();
    await notice.getByRole("button", { name: "다시 시도" }).click();
    await expect(notice).toHaveCount(0);
    await expect(body).toBeFocused();
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
    await expect.poll(() => page.evaluate(() => document.activeElement?.matches('.ks-focus-rescue-empty') === true)).toBe(true);
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
    await expect.poll(() => page.evaluate(() => document.activeElement?.matches('.ks-focus-rescue-empty') === true)).toBe(true);
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
    await expect.poll(() => page.evaluate(() => document.activeElement?.matches('.ks-focus-rescue-empty') === true)).toBe(true);
  });

  for (const editor of [
    { kind: "code-editor", definition: codeEditorLoadingApp },
    { kind: "markdown-editor", definition: markdownEditorApp },
  ] as const) {
    test(`${editor.kind === "code-editor" ? "코드" : "마크다운"} 편집기 읽기 실패와 다시 시도 ${width}`, async ({ page }) => {
      await gate(page, ["files.read"]);
      const app = await mount(page, editor.definition, width);
      await started(page); await release(page, true);
      const notice = app.locator(".ks-editor-error [role=alert]");
      await expect(notice).toBeVisible();
      await capture(app, `1668-${width}-${editor.kind}-retry`);
      await page.evaluate(() => { const g = (window as any).retryGate; g.hold = true; g.fail = false; });
      await notice.getByRole("button", { name: "다시 시도" }).click();
      await expect(app.locator(".ks-editor-loading")).toBeVisible();
      await expect(app.locator(".ks-editor-loading")).toContainText("불러오는 중");
      await capture(app, `1668-${width}-${editor.kind}-loading`);
      await release(page);
      await expect(app.locator(".cm-content")).toBeVisible();
      await expect(notice).toHaveCount(0);
      await expect.poll(() => page.evaluate(() => document.activeElement?.matches('.ks-focus-rescue-empty') === true)).toBe(true);
      await noOverflow(page);
    });
  }

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
    await expect(tree.locator('.ks-file-tree-list')).toBeFocused();
    await page.evaluate(() => { (window as any).retryGate.fail = true; });
    await notes.click();
    const error = tree.locator('[data-tree-row="error:notes"] .ks-notice');
    await expect(error).toBeVisible();
    await capture(app, `${width}-tree-child-error`);
    await page.evaluate(() => { (window as any).retryGate.fail = false; });
    await error.getByRole("button", { name: "다시 시도" }).click();
    await expect(error).toHaveCount(0);
    await expect(notes).toBeFocused();
  });

  test(`폴더 작업 실패 안내가 대상 행 아래에 선다 ${width}`, async ({ page }) => {
    await gate(page, ["files.reveal"]);
    const app = await mount(page, folderApp, width, 330);
    const target = app.getByRole("treeitem", { name: "settings.json" });
    await target.scrollIntoViewIfNeeded();
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
    await expect.poll(async () => app.locator('.ks-file-tree-list').evaluate((tree) => {
      const a = tree.querySelector('[role="alert"]')!.getBoundingClientRect();
      const b = tree.getBoundingClientRect();
      return a.top >= b.top && a.bottom <= b.bottom;
    })).toBe(true);
    await capture(app, `${width}-operation`);
    const close = alert.getByRole("button", { name: "닫기" });
    await close.focus(); await expect(close).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(alert).toHaveCount(0);
    await expect(target).toBeFocused();
    await noOverflow(page);
  });
}

test("마크다운 보기 창 초점 새로고침은 로더 없이 읽은 내용을 지키고 새 내용으로 바꾼다", async ({ page }) => {
  await gate(page, ["files.read"]);
  const app = await mount(page, markdownFocusViewApp, 1100);
  await started(page);
  await release(page);
  const view = app.locator(".ks-markdown-view");
  await expect(view.getByRole("heading", { name: "kaleidoscope 작업 메모" })).toBeVisible();

  // 파일을 바꿔 두고, 창 초점이 올 때의 다시 읽기를 관문으로 잡아 둔다.
  await page.evaluate(async () => {
    const harness = (window as any).__ksHarness;
    const first = await harness.call({ op: "files.read", window_id: "storage-window", permission: "documents", path: "Kaleidoscope.md" });
    await harness.call({ op: "files.write", window_id: "storage-window", permission: "documents", path: "Kaleidoscope.md", text: "# 새로 고친 문서\n\n창으로 돌아와도 그대로 보입니다.\n", expected_revision: first.revision });
    const readGate = (window as any).retryGate;
    readGate.hold = true;
    readGate.fail = false;
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => page.evaluate(() => (window as any).retryGate.started)).toBeGreaterThan(1);
  await expect(app.locator(".ks-markdown-loading")).toHaveCount(0);
  await expect(view.getByRole("heading", { name: "kaleidoscope 작업 메모" })).toBeVisible();
  await capture(app, "1668-markdown-view-focus-refresh");
  await release(page);
  await expect(view.getByRole("heading", { name: "새로 고친 문서" })).toBeVisible();
  await expect(app.locator(".ks-markdown-loading")).toHaveCount(0);
  await noOverflow(page);
});

test("루트 붙여넣기와 여러 항목 삭제 실패 안내를 조작한다", async ({ page }) => {
  await gate(page, ["files.copy", "files.remove"]);
  const app = await mount(page, folderApp, 1100);
  await release(page);
  const tree = app.locator('.ks-file-tree-list');
  const readme = app.getByRole('treeitem', { name: 'README.md' });
  await readme.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '복사', exact: true }).click();
  await page.evaluate(() => { (window as any).retryGate.fail = true; });
  const bounds = await tree.boundingBox();
  if (!bounds) throw new Error('트리 크기 없음');
  await page.mouse.click(bounds.x + 40, bounds.y + bounds.height - 20, { button: 'right' });
  await page.getByRole('menuitem', { name: '붙여넣기' }).click();
  const alert = tree.locator('.ks-notice[role=alert]');
  await expect(alert).toBeVisible();
  await expect.poll(() => tree.evaluate((element) => {
    const rows = Array.from(element.querySelectorAll('[data-tree-row]'));
    return rows.findIndex((row) => row.querySelector('[role=alert]'));
  })).toBe(0);
  await capture(app, '1100-paste-root');
  await alert.getByRole('button', { name: '닫기' }).click();
  await app.getByRole('treeitem', { name: 'Kaleidoscope.md' }).click();
  await app.getByRole('treeitem', { name: 'large.md' }).click({ modifiers: ['Control'] });
  await app.getByRole('treeitem', { name: 'large.md' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '휴지통으로 이동' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '휴지통으로 이동' }).click();
  await expect(alert).toBeVisible();
  await alert.getByRole('button', { name: '펼치기' }).click();
  await expect(alert).toContainText('Kaleidoscope.md');
  await expect(alert).toContainText('large.md');
  await capture(app, '1100-multiple-expanded');
  await alert.getByRole('button', { name: '접기' }).click();
  await alert.getByRole('button', { name: '닫기' }).click();
});

test("읽기 오류 문구는 선택하고 다시 시도 단추 글은 선택하지 않는다", async ({ page }) => {
  await gate(page, ['files.list']);
  const app = await mount(page, explorerLoadingApp, 1100);
  await started(page); await release(page, true);
  const notice = app.locator('.ks-explorer-content .ks-notice');
  const button = notice.getByRole('button', { name: '다시 시도' });
  await button.dblclick();
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');
  const message = notice.locator('.ks-notice-message');
  const bounds = await message.boundingBox();
  if (!bounds) throw new Error('오류 문구 크기 없음');
  await page.mouse.move(bounds.x + 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + Math.min(bounds.width - 2, 100), bounds.y + bounds.height / 2, { steps: 6 });
  await page.mouse.up();
  expect((await page.evaluate(() => window.getSelection()?.toString() ?? '')).length).toBeGreaterThan(0);
});

for (const method of ["click", "Enter", "Space"] as const) {
  for (const kind of ["explorer", "tree-root", "tree-refresh", "tree-child", "code", "code-editor", "markdown-editor", "markdown-file", "markdown-document"] as const) {
    test(`${kind} 다시 시도 ${method} 뒤 해당 칸에 초점을 둔다`, async ({ page }) => {
      const isTree = kind.startsWith("tree-");
      const definition = isTree || kind === "explorer" ? explorerLoadingApp
        : kind === "code" ? codeViewLoadingApp
          : kind === "code-editor" ? codeEditorLoadingApp
            : kind === "markdown-editor" ? markdownEditorApp
              : kind === "markdown-file" ? markdownFileApp : markdownTabsLoadingApp;
      const operation = isTree || kind === "explorer" ? "files.list" : kind === "markdown-document" ? "storage.get" : "files.read";
      await gate(page, [operation]);
      const app = await mount(page, definition, 1100);
      await started(page);
      const tree = app.locator('.ks-file-tree').first();
      const content = app.locator('.ks-explorer-content');
      let notice: Locator;
      if (kind === "tree-refresh" || kind === "tree-child") {
        await release(page);
        const notes = tree.getByRole('treeitem', { name: 'notes' });
        await expect(notes).toBeVisible();
        await page.evaluate(() => { (window as any).retryGate.fail = true; });
        if (kind === "tree-refresh") await page.evaluate(() => window.dispatchEvent(new Event('focus')));
        else await notes.click();
        notice = kind === "tree-refresh" ? tree.locator('[data-tree-row="error:"] .ks-notice') : tree.locator('[data-tree-row="error:notes"] .ks-notice');
      } else {
        await release(page, true);
        notice = kind === "explorer" ? content.locator('.ks-notice[role=alert]')
          : kind === "tree-root" ? tree.locator(':scope > [data-ks-fills-body] .ks-notice')
            : app.locator(kind === "code" || kind === "code-editor" || kind === "markdown-editor" ? '.ks-editor-error [role=alert]' : '.ks-markdown-error [role=alert]');
      }
      await expect(notice).toBeVisible();
      await page.evaluate(() => { (window as any).retryGate.fail = false; });
      const button = notice.getByRole('button', { name: '다시 시도' });
      if (method === 'click') await button.click();
      else { await button.focus(); await page.keyboard.press(method); }
      await expect(notice).toHaveCount(0);
      if (kind === "code-editor" || kind === "markdown-editor") await expect(app.locator(".cm-content")).toBeVisible();
      if (kind === "explorer") await expect(content).toBeFocused();
      else if (kind === "tree-child") await expect(tree.getByRole('treeitem', { name: 'notes' })).toBeFocused();
      else if (isTree) await expect(tree.locator('.ks-file-tree-list')).toBeFocused();
      else await expect.poll(() => page.evaluate(() => document.activeElement?.matches('.ks-focus-rescue-empty') === true)).toBe(true);
    });
  }
}
