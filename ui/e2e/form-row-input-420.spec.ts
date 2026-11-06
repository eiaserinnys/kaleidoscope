import { expect, test, type Page } from "@playwright/test";

// 몸통 스크롤 보정이 실제 스크롤바 폭을 전제하므로 운영처럼 띄운다.
test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

async function open(page: Page, ui: object, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.goto("/?preview=data-controls");
  await page.evaluate(async (layout) => {
    const harness = (window as any).__ksHarness;
    const { snapshot } = await harness.call({ op: "state.get" });
    const version = snapshot.shared.app_versions.find((v: any) => v.app_id === "data-controls");
    version.definition.state = { value: "" };
    version.definition.ui = layout;
    version.version += 1;
    const win = snapshot.shared.windows.find((w: any) => w.app_id === "data-controls");
    win.app_version = version.version;
    win.state = { value: "" };
    harness.emit({ event: "state.changed", snapshot });
  }, ui);
  return page.getByTestId("app-window-data-controls");
}

const plain = { type: "input", value: { state: "value" }, on_change: [] };
const hidden = { ...plain, label: "숨긴 이름", label_position: "hidden" };
const button = { type: "button", label: "단추", on_click: [] };
const text = { type: "text", value: "글" };
const row = (children: object[]) => ({ type: "stack", direction: "row", children });
const filler = Array.from({ length: 40 }, () => text);

for (const width of [880, 360]) for (const scrolls of [false, true]) {
  test(`가로 줄의 이름표 없는 입력은 쌓기 직속 입력과 시작선과 끝선이 같다 ${width} ${scrolls ? "스크롤" : "스크롤 없음"}`, async ({ page }) => {
    const app = await open(page, { type: "stack", direction: "column", children: [plain, row([plain, button]), row([hidden, button]), row([button, plain]), row([text, plain]), ...(scrolls ? filler : [])] }, width, 600);
    const edges = await app.locator(".ks-data-window-body > .ks-data-stack > .ks-data-stack-item").evaluateAll((items) => items.slice(0, 5).map((item) => {
      const inputs = [...item.querySelectorAll(".ks-data-input")].map((input) => input.getBoundingClientRect());
      return { left: inputs[0].left, right: inputs[0].right, body: item.closest(".ks-data-window-body")!.clientHeight < item.closest(".ks-data-window-body")!.scrollHeight };
    }));
    if (process.env.KS_ROW_CAPTURE_DIR) await app.screenshot({ path: `${process.env.KS_ROW_CAPTURE_DIR}/row-${width}-${scrolls ? "scroll" : "plain"}.png` });
    expect(edges[0].body).toBe(scrolls);
    expect(Math.abs(edges[1].left - edges[0].left)).toBeLessThanOrEqual(1);
    expect(Math.abs(edges[2].left - edges[0].left)).toBeLessThanOrEqual(1);
    expect(Math.abs(edges[3].right - edges[0].right)).toBeLessThanOrEqual(1);
    expect(Math.abs(edges[4].right - edges[0].right)).toBeLessThanOrEqual(1);
  });
}
