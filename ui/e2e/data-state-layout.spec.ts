import { expect, test, type Locator, type Page } from "@playwright/test";

async function selectText(page: Page, target: Locator) {
  const rect = await target.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (!(node.textContent ?? "").trim()) continue;
      const range = document.createRange();
      range.setStart(node, 0);
      range.setEnd(node, Math.min(node.textContent!.length, 8));
      const bounds = range.getBoundingClientRect();
      if (bounds.width && bounds.height) return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
    }
    return null;
  });
  expect(rect).not.toBeNull();
  await page.mouse.move(rect!.x + 1, rect!.y + rect!.height / 2);
  await page.mouse.down();
  await page.mouse.move(rect!.x + rect!.width + 8, rect!.y + rect!.height / 2, { steps: 8 });
  await page.mouse.up();
  return page.evaluate(() => window.getSelection()?.toString() ?? "");
}

for (const [name, index, pointer] of [
  ["탭 상태", 6, "/ui/tabs/6/child/children/1/items"],
  ["구역 상태", 7, "/ui/tabs/7/child/child/children/1/items"],
] as const) {
  test(`${name}의 찾기 아래 실패 상태가 남은 칸을 채운다`, async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 700 });
    await page.goto("/?preview=paging-test");
    const app = page.getByTestId("app-window-paging-test");
    await app.getByRole("tab", { name }).click();
    const panel = app.getByRole("tabpanel");
    await expect(panel.getByPlaceholder("찾기")).toBeVisible();
    await expect(panel.getByRole("option", { name: "항목 1", exact: true })).toBeVisible();
    await page.evaluate(({ pointer, index }) => {
      (window as any).conversationHarness.emit({ event: "data.update", window_id: "paging-test-window", view: {
        sources: {}, values: { [pointer]: { status: "failed", message: `서버 오류 ${index}`, retry: ["list_items"] } },
      } });
    }, { pointer, index });
    const state = panel.locator(".ks-data-state");
    await expect(state).toBeVisible();
    const geometry = await state.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const stack = el.closest(".ks-data-stack")!.getBoundingClientRect();
      const container = el.closest(".ks-data-section-child, .ks-data-tab-panel")!.getBoundingClientRect();
      const button = el.querySelector("button")!.getBoundingClientRect();
      return { height: box.height, stackHeight: stack.height, containerHeight: container.height, buttonBottom: button.bottom, containerBottom: container.bottom };
    });
    expect(geometry.stackHeight).toBeGreaterThan(geometry.containerHeight - 20);
    expect(geometry.height).toBeGreaterThan(geometry.containerHeight / 2);
    expect(geometry.buttonBottom).toBeLessThanOrEqual(geometry.containerBottom);
  });
}

test("이전 값 알림의 문구는 끌어 선택하고 단추는 선택하지 않는다", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 700 });
  await page.goto("/?preview=paging-test");
  const app = page.getByTestId("app-window-paging-test");
  await expect(app.getByRole("tab", { name: "목록" })).toBeVisible();
  await page.evaluate(() => (window as any).conversationHarness.emit({ event: "data.update", window_id: "paging-test-window", view: {
    sources: { list_items: { state: "failed", has_value: true, message: "원인: 서버 오류", id: "SOURCE_ERROR" } }, values: {},
  } }));
  const notice = app.getByRole("alert");
  await expect(notice).toBeVisible();
  expect(await selectText(page, notice.locator(".ks-notice-message"))).not.toBe("");
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  expect(await selectText(page, notice.getByRole("button", { name: "다시 받기" }))).toBe("");
});
