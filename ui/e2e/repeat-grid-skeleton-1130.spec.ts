import { expect, test, type Locator, type Page } from "@playwright/test";

const WINDOW_ID = "repeat-empty-center-window";
const WHEN_POINTER = "/ui/children/1/value";
const ITEMS_POINTER = "/ui/children/2/items";

const items = Array.from({ length: 12 }, (_, index) => ({ key: `entry-${index + 1}`, name: `항목 ${index + 1}` }));

const loading = { [WHEN_POINTER]: { status: "loading" }, [ITEMS_POINTER]: { status: "loading" } } as const;
const ready = { [WHEN_POINTER]: { status: "ready", value: false }, [ITEMS_POINTER]: { status: "ready", value: items } } as const;

async function emitState(page: Page, values: Record<string, unknown>) {
  await page.evaluate(({ windowId, values }) => {
    (window as any).conversationHarness.emit({ event: "data.update", window_id: windowId, view: { sources: {}, values } });
  }, { windowId: WINDOW_ID, values });
}

type Box = { top: number; left: number; width: number; height: number };
type Scroll = { scrollHeight: number; clientHeight: number };

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
    const cells = (selector: string) => Array.from(window_.querySelectorAll<HTMLElement>(`.ks-repeat-content > ${selector}`))
      .map((element) => {
        const box = element.getBoundingClientRect();
        return { top: +box.top.toFixed(2), left: +box.left.toFixed(2), width: +box.width.toFixed(2), height: +box.height.toFixed(2) };
      });
    const skeleton = window_.querySelector<HTMLElement>(".ks-repeat.is-loading");
    return {
      toolbar: rect(slots[0]),
      fill: rect(fill),
      repeat: rect(repeat),
      skeletonRoot: rect(skeleton),
      skeletonOverflowY: skeleton === null ? null : getComputedStyle(skeleton).overflowY,
      skeletonScrollTop: skeleton?.scrollTop ?? null,
      skeletonCells: cells(".ks-repeat-skeleton-item"),
      readyCells: cells(".ks-repeat-item"),
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
    await app.screenshot({ path: testInfo.outputPath(`${width}x${height}-불러오는 중.png`) });

    await emitState(page, ready);
    await expect(app.locator(".ks-repeat-item")).toHaveCount(items.length);
    const readyMeasure = await measure(app);
    await app.screenshot({ path: testInfo.outputPath(`${width}x${height}-항목 있음.png`) });

    console.log(`${width}x${height}: ${JSON.stringify({ loading: loadingMeasure, ready: readyMeasure })}`);

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
  });
}
