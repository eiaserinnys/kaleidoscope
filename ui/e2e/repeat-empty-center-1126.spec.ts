import { expect, test, type Locator, type Page } from "@playwright/test";

const WINDOW_ID = "repeat-empty-center-window";
const WHEN_POINTER = "/ui/children/1/value";
const ITEMS_POINTER = "/ui/children/2/items";
const EMPTY_TEXT = "받은 항목 없음";
const FAILURE_MESSAGE = "서버 오류";

const items = Array.from({ length: 12 }, (_, index) => ({ key: `entry-${index + 1}`, name: `항목 ${index + 1}` }));

const states = [
  { name: "불러오는 중", values: { [WHEN_POINTER]: { status: "loading" }, [ITEMS_POINTER]: { status: "loading" } } },
  { name: "첫 실패", values: {
    [WHEN_POINTER]: { status: "failed", message: FAILURE_MESSAGE, retry: ["load_entries"] },
    [ITEMS_POINTER]: { status: "failed", message: FAILURE_MESSAGE, retry: ["load_entries"] },
  } },
  { name: "빈 상태", values: { [WHEN_POINTER]: { status: "ready", value: true }, [ITEMS_POINTER]: { status: "ready", value: [] } } },
  { name: "항목 있음", values: { [WHEN_POINTER]: { status: "ready", value: false }, [ITEMS_POINTER]: { status: "ready", value: items } } },
] as const;

async function emitState(page: Page, values: Record<string, unknown>) {
  await page.evaluate(({ windowId, values }) => {
    (window as any).conversationHarness.emit({ event: "data.update", window_id: windowId, view: { sources: {}, values } });
  }, { windowId: WINDOW_ID, values });
}

function measure(app: Locator) {
  return app.evaluate((root) => {
    const window_ = root.querySelector<HTMLElement>(".ks-data-window")!;
    const body = window_.querySelector<HTMLElement>(".ks-data-window-body")!;
    const stack = body.querySelector<HTMLElement>(":scope > .ks-data-stack")!;
    const slots = Array.from(stack.children) as HTMLElement[];
    const stackRect = stack.getBoundingClientRect();
    const toolbarRect = slots[0].getBoundingClientRect();
    const gap = parseFloat(getComputedStyle(stack).rowGap) || 0;
    const area = { top: toolbarRect.bottom + gap, bottom: stackRect.bottom, left: stackRect.left, right: stackRect.right };
    const rect = (element: Element | null | undefined) => {
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return { top: +box.top.toFixed(2), bottom: +box.bottom.toFixed(2), left: +box.left.toFixed(2), right: +box.right.toFixed(2), width: +box.width.toFixed(2), height: +box.height.toFixed(2), centerX: +(box.left + box.width / 2).toFixed(2), centerY: +(box.top + box.height / 2).toFixed(2) };
    };
    const slot = slots[2];
    const repeat = window_.querySelector<HTMLElement>(".ks-repeat");
    return {
      window: rect(window_),
      body: { scrollTop: body.scrollTop, scrollHeight: body.scrollHeight, clientHeight: body.clientHeight },
      gap,
      area,
      areaCenterY: +((area.top + area.bottom) / 2).toFixed(2),
      areaCenterX: +((area.left + area.right) / 2).toFixed(2),
      toolbar: rect(slots[0]),
      whenSlot: rect(slots[1]),
      fillSlot: { ...rect(slot), display: getComputedStyle(slot).display, scrollTop: slot.scrollTop, scrollHeight: slot.scrollHeight, clientHeight: slot.clientHeight },
      centerStack: rect(window_.querySelector<HTMLElement>(".ks-data-stack.is-center")),
      centerText: rect(window_.querySelector<HTMLElement>(".ks-data-stack.is-center .ks-data-text")),
      state: rect(window_.querySelector<HTMLElement>(".ks-data-state")),
      skeleton: rect(window_.querySelector<HTMLElement>(".ks-data-skeleton")),
      repeat: repeat === null ? null : { ...rect(repeat), className: repeat.className, scrollHeight: repeat.scrollHeight, clientHeight: repeat.clientHeight },
      repeatItems: window_.querySelectorAll(".ks-repeat-item").length,
    };
  });
}

for (const [width, height] of [[1180, 720], [360, 240]] as const) {
  test(`${width}×${height} 창에서 빈 반복의 빈 상태 글이 남은 자리 한가운데에 온다`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: width + 2, height: height + 42 });
    await page.goto("/?preview=repeat-empty-center");
    await page.addStyleTag({ content: "body { padding: 0; } .ks-harness { display: block; height: 100vh; } .ks-harness-header, .ks-harness-dev-panel { display: none; } .ks-harness-apps.is-preview { height: 100%; }" });
    const app = page.getByTestId("app-window-repeat-empty-center");
    await expect(app.getByText("받은 항목", { exact: true })).toBeVisible();
    await page.evaluate(() => document.fonts.ready.then(() => undefined));

    const log: Record<string, unknown> = {};

    for (const state of states) {
      await emitState(page, state.values);
      if (state.name === "불러오는 중") {
        await expect(app.locator(".ks-data-skeleton")).toBeVisible();
      } else if (state.name === "첫 실패") {
        await expect(app.locator(".ks-data-state")).toBeVisible();
        await expect(app.locator(".ks-data-state")).toContainText(FAILURE_MESSAGE);
      } else if (state.name === "빈 상태") {
        await expect(app.locator(".ks-data-stack.is-center")).toContainText(EMPTY_TEXT);
      } else {
        await expect(app.locator(".ks-repeat-item")).toHaveCount(items.length);
        await expect(app.locator(".ks-repeat.is-empty")).toHaveCount(0);
      }
      await app.screenshot({ path: testInfo.outputPath(`${width}x${height}-${state.name}.png`) });
      log[state.name] = await measure(app);
    }

    console.log(`${width}x${height}: ${JSON.stringify(log)}`);

    const empty = log["빈 상태"] as Awaited<ReturnType<typeof measure>>;
    const failure = log["첫 실패"] as Awaited<ReturnType<typeof measure>>;
    const loading = log["불러오는 중"] as Awaited<ReturnType<typeof measure>>;
    const populated = log["항목 있음"] as Awaited<ReturnType<typeof measure>>;

    for (const [name, state] of Object.entries(log) as Array<[string, Awaited<ReturnType<typeof measure>>]>) {
      expect(state.window?.width, `${name} 창 폭`).toBe(width);
      expect(state.window?.height, `${name} 창 높이`).toBe(height);
    }

    // 빈 상태: 남은 자리(toolbar 자리 아래 + 쌓기 간격 → 쌓기 아래)의 한가운데에 글이 온다.
    expect(empty.centerText, "빈 상태 글").not.toBeNull();
    expect(Math.abs(empty.centerText!.centerY - empty.areaCenterY), `빈 상태 세로 중심 ${JSON.stringify(empty)}`).toBeLessThanOrEqual(1);
    expect(Math.abs(empty.centerText!.centerX - empty.areaCenterX), `빈 상태 가로 중심 ${JSON.stringify(empty)}`).toBeLessThanOrEqual(1);
    expect(empty.fillSlot.display, "빈 반복 자리").toBe("none");

    // 첫 실패: 같은 앱의 DataState가 남은 자리 한가운데에 있다.
    expect(failure.state, "첫 실패 상태").not.toBeNull();
    expect(Math.abs(failure.state!.centerY - failure.areaCenterY), `첫 실패 세로 중심 ${JSON.stringify(failure)}`).toBeLessThanOrEqual(1);
    expect(Math.abs(failure.state!.centerX - failure.areaCenterX), `첫 실패 가로 중심 ${JSON.stringify(failure)}`).toBeLessThanOrEqual(1);
    expect(failure.state!.top).toBeGreaterThanOrEqual(failure.area.top - 1);
    expect(failure.state!.bottom).toBeLessThanOrEqual(failure.area.bottom + 1);

    // 불러오는 중 뼈대는 전과 같은 자리(반복이 받던 채움 자리 전체)에 있다.
    expect(loading.skeleton, "불러오는 중 뼈대").not.toBeNull();
    expect(loading.fillSlot.height).toBeGreaterThanOrEqual(loading.area.bottom - loading.area.top - 1);
    expect(loading.skeleton!.top).toBeGreaterThanOrEqual(loading.area.top - 1);
    expect(loading.skeleton!.bottom).toBeLessThanOrEqual(loading.area.bottom + 1);

    // 항목 있음: 반복이 채움 자리를 그대로 채운다. 좁은 창에서는 그리드 자리만 스크롤된다.
    expect(populated.repeatItems).toBe(items.length);
    expect(populated.fillSlot.display).not.toBe("none");
    expect(Math.abs(populated.repeat!.top - populated.area.top)).toBeLessThanOrEqual(1);
    expect(populated.repeat!.bottom).toBeLessThanOrEqual(populated.area.bottom + 1);
    expect(populated.body.scrollTop).toBe(0);
    expect(populated.body.scrollHeight).toBeLessThanOrEqual(populated.body.clientHeight + 1);
    expect(populated.toolbar!.top).toBe(loading.toolbar!.top);
    if (height <= 300) expect(populated.repeat!.scrollHeight).toBeGreaterThan(populated.repeat!.clientHeight);
  });
}
