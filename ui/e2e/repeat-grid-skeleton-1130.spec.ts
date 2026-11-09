import { expect, test, type Locator, type Page } from "@playwright/test";

const WINDOW_ID = "repeat-empty-center-window";
const WHEN_POINTER = "/ui/children/1/value";
const ITEMS_POINTER = "/ui/children/2/items";

const items = Array.from({ length: 12 }, (_, index) => ({ key: `entry-${index + 1}`, name: `항목 ${index + 1}`, on: true }));

const loading = { [WHEN_POINTER]: { status: "loading" }, [ITEMS_POINTER]: { status: "loading" } } as const;
const ready = { [WHEN_POINTER]: { status: "ready", value: false }, [ITEMS_POINTER]: { status: "ready", value: items } } as const;

async function emitState(page: Page, values: Record<string, unknown>) {
  await page.evaluate(({ windowId, values }) => {
    (window as any).conversationHarness.emit({ event: "data.update", window_id: windowId, view: { sources: {}, values } });
  }, { windowId: WINDOW_ID, values });
}

// 픽스처를 고치지 않고 하네스로 창 정의만 바꿔 끼운다. 되돌릴 필요가 없도록 시험마다 새 페이지에서 한 번만 바꾼다.
type RepeatPatch = { layout?: "column"; virtual?: boolean; item_width?: "small"; gap?: "small"; whenTemplate?: boolean };

async function patchRepeat(page: Page, patch: RepeatPatch) {
  await page.evaluate(async (patch) => {
    const harness = (window as any).__ksHarness;
    const { snapshot } = await harness.call({ op: "state.get" });
    const version = snapshot.shared.app_versions.find((item: any) => item.app_id === "repeat-empty-center");
    const repeat = version.definition.ui.children[2];
    if (patch.layout !== undefined) repeat.layout = patch.layout;
    if (patch.virtual !== undefined) repeat.virtual = patch.virtual;
    if (patch.gap !== undefined) repeat.gap = patch.gap;
    if (patch.item_width !== undefined) repeat.grid.item_width = patch.item_width;
    if (patch.whenTemplate) repeat.template = { type: "when", value: { item: "on" }, child: repeat.template };
    version.version += 1;
    const appWindow = snapshot.shared.windows.find((item: any) => item.id === "repeat-empty-center-window");
    appWindow.app_version = version.version;
    harness.emit({ event: "state.changed", snapshot });
  }, patch);
}

test("1180×720 열 반복의 when 템플릿도 불러오는 중 칸 높이와 막대를 유지한다", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1182, height: 762 });
  await page.goto("/?preview=repeat-empty-center");
  await page.addStyleTag({ content: "body { padding: 0; } .ks-harness { display: block; height: 100vh; } .ks-harness-header, .ks-harness-dev-panel { display: none; } .ks-harness-apps.is-preview { height: 100%; }" });
  const app = page.getByTestId("app-window-repeat-empty-center");
  await expect(app.getByText("받은 항목", { exact: true })).toBeVisible();
  await patchRepeat(page, { layout: "column", whenTemplate: true });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));

  await emitState(page, loading);
  await expect(app.locator(".ks-repeat.is-loading.is-column")).toBeVisible();
  const loadingMeasure = await measure(app);
  const visibleBars = await app.locator(".ks-repeat-skeleton-item .ks-repeat-skeleton-line:visible").count();
  await app.screenshot({ path: testInfo.outputPath("when-column-1180x720-불러오는 중.png") });

  await emitState(page, ready);
  await expect(app.locator(".ks-repeat-item")).toHaveCount(items.length);
  const readyMeasure = await measure(app);
  await app.screenshot({ path: testInfo.outputPath("when-column-1180x720-항목 있음.png") });
  console.log(`when column 1180x720: ${JSON.stringify({ loading: loadingMeasure.skeletonCells.slice(0, 3), ready: readyMeasure.readyCells.slice(0, 3), visibleBars })}`);

  expect(loadingMeasure.skeletonCells).toHaveLength(3);
  expect(Math.abs(loadingMeasure.skeletonCells[0].height - readyMeasure.readyCells[0].height), "when 칸 높이 차이").toBeLessThanOrEqual(2);
  expect(visibleBars, "보이는 뼈대 막대").toBeGreaterThan(0);
});

type Box = { top: number; left: number; width: number; height: number };
type Scroll = { scrollHeight: number; clientHeight: number };
type Bar = { top: number; bottom: number; height: number; width: number };

function measure(app: Locator) {
  return app.evaluate((root) => {
    const rect = (element: Element | null | undefined) => {
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return { top: +box.top.toFixed(2), left: +box.left.toFixed(2), width: +box.width.toFixed(2), height: +box.height.toFixed(2) };
    };
    const window_ = root.querySelector<HTMLElement>(".ks-data-window")!;
    const body = window_.querySelector<HTMLElement>(".ks-data-window-body")!;
    const stack = body.querySelector<HTMLElement>(":scope > .ks-data-stack")!;
    const slots = Array.from(stack.children) as HTMLElement[];
    const fill = slots[2];
    const repeat = window_.querySelector<HTMLElement>(".ks-repeat");
    const scroll = (element: HTMLElement | null): { scrollHeight: number; clientHeight: number } | null => element === null
      ? null
      : { scrollHeight: element.scrollHeight, clientHeight: element.clientHeight };
    const cells = (selector: string) => Array.from((repeat ?? window_).querySelectorAll<HTMLElement>(selector))
      .map((element) => {
        const box = element.getBoundingClientRect();
        return { top: +box.top.toFixed(2), left: +box.left.toFixed(2), width: +box.width.toFixed(2), height: +box.height.toFixed(2) };
      });
    const skeleton = window_.querySelector<HTMLElement>(".ks-repeat.is-loading");
    // 뼈대 막대는 줄 상자 안에 세로 가운데로 그린다. ::before가 없던 판은 줄 상자 자체가 막대다.
    const bar = (line: Element | null): { top: number; bottom: number; height: number; width: number } | null => {
      if (!line) return null;
      const box = line.getBoundingClientRect();
      const pseudoHeight = parseFloat(getComputedStyle(line, "::before").height);
      const height = Number.isFinite(pseudoHeight) ? pseudoHeight : box.height;
      const top = Number.isFinite(pseudoHeight) ? box.top + (box.height - height) / 2 : box.top;
      return { top: +top.toFixed(2), bottom: +(top + height).toFixed(2), height: +height.toFixed(2), width: +box.width.toFixed(2) };
    };
    const firstItem = repeat?.querySelector<HTMLElement>(".ks-repeat-skeleton-item") ?? null;
    // 막대의 오른쪽 끝은 그 막대를 담은 구역(없으면 칸)의 안쪽 오른쪽 끝을 넘지 않아야 한다.
    const barEdges = Array.from(repeat?.querySelectorAll<HTMLElement>(".ks-repeat-skeleton-item") ?? []).flatMap((item) => {
      const section = item.querySelector<HTMLElement>(".ks-data-section");
      const limitElement = section ?? item;
      const limit = limitElement.getBoundingClientRect().right - parseFloat(getComputedStyle(limitElement).paddingRight);
      return Array.from(item.querySelectorAll<HTMLElement>(".ks-repeat-skeleton-line")).map((line) => ({
        right: +line.getBoundingClientRect().right.toFixed(2),
        limit: +limit.toFixed(2),
      }));
    });
    return {
      toolbar: rect(slots[0]),
      fill: rect(fill),
      repeat: rect(repeat),
      skeletonRoot: rect(skeleton),
      skeletonOverflowY: skeleton === null ? null : getComputedStyle(skeleton).overflowY,
      skeletonScrollTop: skeleton?.scrollTop ?? null,
      skeletonCells: cells(".ks-repeat-skeleton-item"),
      readyCells: cells(".ks-repeat-item"),
      titleBar: bar(firstItem?.querySelector(".ks-data-section-title .ks-repeat-skeleton-line") ?? null),
      bodyBar: bar(firstItem?.querySelector(".ks-data-text .ks-repeat-skeleton-line") ?? null),
      barEdges,
      bodyScroll: scroll(body)!,
      fillScroll: scroll(fill)!,
      repeatScroll: scroll(repeat),
    };
  });
}

function firstRow(cells: Box[]): Box[] {
  if (!cells.length) return [];
  const top = Math.min(...cells.map((cell) => cell.top));
  return cells.filter((cell) => Math.abs(cell.top - top) <= 0.5).sort((a, b) => a.left - b.left);
}

function firstRows(cells: Box[], count: number): Box[] {
  return [...cells].sort((a, b) => a.top - b.top).slice(0, count);
}

function expectSameRows(loadingRows: Box[], readyRows: Box[], label: string) {
  expect(loadingRows, `${label} 불러오는 중 칸`).toHaveLength(readyRows.length);
  loadingRows.forEach((cell, index) => {
    expect(Math.abs(cell.left - readyRows[index].left), `${label} ${index + 1}번째 칸 left`).toBeLessThanOrEqual(1);
    expect(Math.abs(cell.width - readyRows[index].width), `${label} ${index + 1}번째 칸 width`).toBeLessThanOrEqual(1);
    expect(Math.abs(cell.top - readyRows[index].top), `${label} ${index + 1}번째 칸 top`).toBeLessThanOrEqual(1);
    expect(Math.abs(cell.height - readyRows[index].height), `${label} ${index + 1}번째 칸 높이`).toBeLessThanOrEqual(2);
  });
}

for (const [width, height] of [[1180, 720], [360, 240]] as const) {
  test(`${width}×${height} 창에서 불러오는 중 격자 뼈대가 받은 뒤와 같은 칸 배치를 미리 보여 준다`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: width + 2, height: height + 42 });
    await page.goto("/?preview=repeat-empty-center");
    await page.addStyleTag({ content: "body { padding: 0; } .ks-harness { display: block; height: 100vh; } .ks-harness-header, .ks-harness-dev-panel { display: none; } .ks-harness-apps.is-preview { height: 100%; }" });
    const app = page.getByTestId("app-window-repeat-empty-center");
    await expect(app.getByText("받은 항목", { exact: true })).toBeVisible();
    await page.evaluate(() => document.fonts.ready.then(() => undefined));

    // 고치기 전에는 일반 뼈대(.ks-data-skeleton)만 있으므로, 두 구현 모두에서 기다릴 수 있는 대상으로 기다린다.
    await emitState(page, loading);
    await expect(app.locator(".ks-repeat.is-loading, .ks-data-skeleton").first()).toBeVisible();
    const loadingMeasure = await measure(app);
    await app.screenshot({ path: testInfo.outputPath(`grid-${width}x${height}-불러오는 중.png`) });

    await emitState(page, ready);
    await expect(app.locator(".ks-repeat-item")).toHaveCount(items.length);
    const readyMeasure = await measure(app);
    await app.screenshot({ path: testInfo.outputPath(`grid-${width}x${height}-항목 있음.png`) });

    console.log(`grid ${width}x${height}: ${JSON.stringify({ loading: loadingMeasure, ready: readyMeasure })}`);

    const loadingRow = firstRow(loadingMeasure.skeletonCells);
    const readyRow = firstRow(readyMeasure.readyCells);

    // 1. 불러오는 중 뼈대의 첫 줄 칸 수가 받은 뒤 첫 줄 칸 수와 같다.
    expect(loadingRow.length, `불러오는 중 첫 줄 칸 수 ${JSON.stringify(loadingMeasure.skeletonCells)}`).toBe(readyRow.length);
    expect(readyRow.length, `${width}px 창의 한 줄 칸 수`).toBe(width >= 1180 ? 4 : 1);
    expect(loadingMeasure.skeletonRoot, "불러오는 중 격자 뼈대 뿌리").not.toBeNull();

    // 2. 첫 줄 칸의 left, width, top과 칸 높이가 받은 뒤와 같다.
    loadingRow.forEach((cell, index) => {
      expect(Math.abs(cell.left - readyRow[index].left), `${width}px ${index + 1}번째 칸 left`).toBeLessThanOrEqual(1);
      expect(Math.abs(cell.width - readyRow[index].width), `${width}px ${index + 1}번째 칸 width`).toBeLessThanOrEqual(1);
      expect(Math.abs(cell.height - readyRow[index].height), `${width}px ${index + 1}번째 칸 높이`).toBeLessThanOrEqual(2);
    });
    expect(Math.abs(loadingRow[0].top - readyRow[0].top), `${width}px 첫 줄 top`).toBeLessThanOrEqual(1);

    // 3. 도구막대 top과 반복 뿌리의 상자(top, left, width)가 두 상태에서 같다.
    expect(loadingMeasure.toolbar!.top).toBe(readyMeasure.toolbar!.top);
    expect(loadingMeasure.repeat!.top).toBe(readyMeasure.repeat!.top);
    expect(loadingMeasure.repeat!.left).toBe(readyMeasure.repeat!.left);
    expect(loadingMeasure.repeat!.width).toBe(readyMeasure.repeat!.width);

    // 4. 불러오는 중 창 몸통과 채움 칸에는 스크롤이 생기지 않는다.
    //    뼈대는 받은 뒤처럼 남은 칸 아래로 잘리고, 사용자 스크롤은 생기지 않는다.
    expect(loadingMeasure.bodyScroll.scrollHeight, "창 몸통 스크롤").toBeLessThanOrEqual(loadingMeasure.bodyScroll.clientHeight + 1);
    expect(loadingMeasure.fillScroll.scrollHeight, "채움 칸 스크롤").toBeLessThanOrEqual(loadingMeasure.fillScroll.clientHeight + 1);
    expect(loadingMeasure.skeletonOverflowY, "뼈대 뿌리 overflow-y").toBe("hidden");
    expect(loadingMeasure.skeletonScrollTop, "뼈대 뿌리 scrollTop").toBe(0);

    // 5. 막대는 줄 상자 안에서 얇게 서고, 제목 막대와 본문 막대 사이에 틈이 보인다.
    expect(loadingMeasure.titleBar, "제목 막대").not.toBeNull();
    expect(loadingMeasure.bodyBar, "본문 막대").not.toBeNull();
    expect(loadingMeasure.titleBar!.height, "막대 두께").toBeCloseTo(14, 1);
    expect(loadingMeasure.titleBar!.width, "제목 막대 폭").toBeCloseTo(4 * 32, 0);
    expect(loadingMeasure.bodyBar!.width, "본문 막대 폭").toBeCloseTo(6 * 32, 0);
    expect(loadingMeasure.bodyBar!.top - loadingMeasure.titleBar!.bottom, "제목·본문 막대 틈").toBeGreaterThanOrEqual(2);
  });
}

test("small 칸 격자에서 뼈대 막대가 칸 오른쪽 끝을 넘지 않는다", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1182, height: 762 });
  await page.goto("/?preview=repeat-empty-center");
  await page.addStyleTag({ content: "body { padding: 0; } .ks-harness { display: block; height: 100vh; } .ks-harness-header, .ks-harness-dev-panel { display: none; } .ks-harness-apps.is-preview { height: 100%; }" });
  const app = page.getByTestId("app-window-repeat-empty-center");
  await expect(app.getByText("받은 항목", { exact: true })).toBeVisible();
  await patchRepeat(page, { item_width: "small", gap: "small" });
  await expect(app.locator(".ks-repeat")).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));

  await emitState(page, loading);
  await expect(app.locator(".ks-repeat.is-loading")).toBeVisible();
  const loadingMeasure = await measure(app);
  await app.screenshot({ path: testInfo.outputPath("small-small-1180x720-불러오는 중.png") });

  await emitState(page, ready);
  await expect(app.locator(".ks-repeat-item")).toHaveCount(items.length);
  const readyMeasure = await measure(app);
  await app.screenshot({ path: testInfo.outputPath("small-small-1180x720-항목 있음.png") });

  console.log(`small-small 1180x720: ${JSON.stringify({ loading: loadingMeasure, ready: readyMeasure })}`);

  const loadingRow = firstRow(loadingMeasure.skeletonCells);
  const readyRow = firstRow(readyMeasure.readyCells);
  expect(loadingRow.length).toBe(readyRow.length);
  expect(readyRow.length, "small 칸 1180px 창의 한 줄 칸 수").toBe(8);
  expect(loadingMeasure.barEdges.length, "잰 뼈대 막대 수").toBe(48);
  const overflow = loadingMeasure.barEdges.filter((edge) => edge.right > edge.limit + 0.5);
  expect(overflow, `칸을 넘는 뼈대 막대 ${JSON.stringify(overflow)}`).toEqual([]);
  const maxRight = Math.max(...loadingMeasure.barEdges.map((edge) => edge.right));
  expect(maxRight, "마지막 열 뼈대 막대 오른쪽 끝").toBeLessThanOrEqual(1169.5);
  // 좁은 칸에서는 막대가 칸 안쪽 끝까지 채워져야 한다. 뼈대 막대가 고유 폭(공백)으로 접히면 여기서 걸린다.
  expect(maxRight, "마지막 열 뼈대 막대 오른쪽 끝이 칸 안쪽 끝에 닿는다").toBeGreaterThanOrEqual(1168.5);
});

for (const [width, height] of [[1180, 720], [360, 240]] as const) {
  test(`${width}×${height} 창에서 불러오는 중 열 반복 뼈대가 받은 뒤와 같은 위치에 선다`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: width + 2, height: height + 42 });
    await page.goto("/?preview=repeat-empty-center");
    await page.addStyleTag({ content: "body { padding: 0; } .ks-harness { display: block; height: 100vh; } .ks-harness-header, .ks-harness-dev-panel { display: none; } .ks-harness-apps.is-preview { height: 100%; }" });
    const app = page.getByTestId("app-window-repeat-empty-center");
    await expect(app.getByText("받은 항목", { exact: true })).toBeVisible();
    await patchRepeat(page, { layout: "column" });
    await expect(app.locator(".ks-repeat")).toBeVisible();
    await page.evaluate(() => document.fonts.ready.then(() => undefined));

    await emitState(page, loading);
    await expect(app.locator(".ks-repeat.is-loading.is-column")).toBeVisible();
    await expect(app.locator(".ks-repeat-skeleton-item")).toHaveCount(3);
    const loadingMeasure = await measure(app);
    await app.screenshot({ path: testInfo.outputPath(`column-${width}x${height}-불러오는 중.png`) });

    await emitState(page, ready);
    await expect(app.locator(".ks-repeat-item")).toHaveCount(items.length);
    const readyMeasure = await measure(app);
    await app.screenshot({ path: testInfo.outputPath(`column-${width}x${height}-항목 있음.png`) });

    console.log(`column ${width}x${height}: ${JSON.stringify({ loading: loadingMeasure, ready: readyMeasure })}`);

    expectSameRows(firstRows(loadingMeasure.skeletonCells, 3), firstRows(readyMeasure.readyCells, 3), `column ${width}px`);
    expect(loadingMeasure.repeat!.top).toBe(readyMeasure.repeat!.top);
    expect(loadingMeasure.repeat!.left).toBe(readyMeasure.repeat!.left);
    expect(loadingMeasure.repeat!.width).toBe(readyMeasure.repeat!.width);
  });
}

test("1180×720 창에서 virtual 열 반복 뼈대도 받은 뒤 첫 세 줄과 같은 위치에 선다", async ({ page }) => {
  await page.setViewportSize({ width: 1182, height: 762 });
  await page.goto("/?preview=repeat-empty-center");
  await page.addStyleTag({ content: "body { padding: 0; } .ks-harness { display: block; height: 100vh; } .ks-harness-header, .ks-harness-dev-panel { display: none; } .ks-harness-apps.is-preview { height: 100%; }" });
  const app = page.getByTestId("app-window-repeat-empty-center");
  await expect(app.getByText("받은 항목", { exact: true })).toBeVisible();
  await patchRepeat(page, { layout: "column", virtual: true });
  await expect(app.locator(".ks-repeat")).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));

  await emitState(page, loading);
  await expect(app.locator(".ks-repeat.is-loading.is-column.is-virtual")).toBeVisible();
  await expect(app.locator(".ks-repeat-skeleton-item")).toHaveCount(3);
  const loadingMeasure = await measure(app);

  await emitState(page, ready);
  await expect(app.locator(".ks-repeat-item").first()).toBeVisible();
  // 가상 행은 잰 높이로 자리를 잡으므로 몇 프레임 뒤에 잰다.
  await app.evaluate(async () => {
    for (let index = 0; index < 5; index += 1) await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  });
  await expect.poll(async () => (await measure(app)).readyCells.length).toBeGreaterThanOrEqual(3);
  const readyMeasure = await measure(app);

  console.log(`column virtual 1180x720: ${JSON.stringify({ loading: loadingMeasure, ready: readyMeasure })}`);

  expectSameRows(firstRows(loadingMeasure.skeletonCells, 3), firstRows(readyMeasure.readyCells, 3), "column virtual 1180px");
});
