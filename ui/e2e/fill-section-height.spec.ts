import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

async function open(page: Page, ui: object, width = 880, height = 600) {
  await page.setViewportSize({ width, height });
  await page.goto("/?preview=data-controls");
  await page.evaluate(async (layout) => {
    const harness = (window as any).__ksHarness;
    const { snapshot } = await harness.call({ op: "state.get" });
    const version = snapshot.shared.app_versions.find((v: any) => v.app_id === "data-controls");
    version.definition.state = { value: "", on: true, dialogOpen: false };
    version.definition.ui = layout;
    version.version += 1;
    const win = snapshot.shared.windows.find((w: any) => w.app_id === "data-controls");
    win.app_version = version.version;
    win.state = { value: "", on: true, dialogOpen: false };
    harness.emit({ event: "state.changed", snapshot });
  }, ui);
  return page.getByTestId("app-window-data-controls");
}

const input = (label: string) => ({ type: "input", label, label_position: "top", value: { state: "value" }, on_change: { set_state: "value" } });
const rows = Array.from({ length: 30 }, (_, i) => ({ key: String(i), title: `항목 ${i + 1}` }));
const list = { type: "list", items: rows };

test("중첩 구역의 끝 채움 칸은 바깥 구역의 바닥 여백만 쓴다", async ({ page }) => {
  const app = await open(page, { type: "section", title: "바깥", child: {
    type: "stack", direction: "column", fill: 0, children: [
      { type: "section", title: "안쪽", child: { type: "stack", direction: "column", children: [input("첫 값"), input("마지막 값")] } },
    ],
  } });
  const sections = app.locator(".ks-data-section");
  await expect(sections).toHaveCount(2);
  expect(await sections.evaluateAll(els => els.map(el => getComputedStyle(el).paddingBottom))).toEqual(["12px", "0px"]);
});

test("대화상자의 끝 채움 칸 구역은 대화상자의 바닥 간격만 쓴다", async ({ page }) => {
  const app = await open(page, { type: "dialog", title: "고르기", open: true, on_close: [{ set_state: "dialogOpen", value: false }], child: {
    type: "stack", direction: "column", fill: 0, children: [
      { type: "section", title: "목록", child: { type: "text", value: "내용" } },
    ],
  } });
  const dialog = app.getByRole("dialog");
  await expect(dialog).toBeVisible();
  expect(await dialog.locator(".ks-data-section").evaluate(el => getComputedStyle(el).paddingBottom)).toBe("0px");
});

test("보완 1: 채움 구역의 끝 칸에만 창 바닥 여백이 생긴다", async ({ page }) => {
  const section = (title: string) => ({ type: "section", title, child: { type: "stack", direction: "column", fill: 0, children: [list] } });
  const app = await open(page, { type: "stack", direction: "column", fill: [0, 1], children: [section("중간 구역"), section("마지막 구역")] });
  const padding = async () => app.locator(".ks-data-stack-item.is-fill > .ks-data-section").evaluateAll(els => els.map(el => parseFloat(getComputedStyle(el).paddingBottom)));
  await expect(app.getByText("마지막 구역")).toBeVisible();
  expect(await padding()).toEqual([0, 12]);

  await open(page, { type: "stack", direction: "column", fill: 0, children: [section("결정 앞 구역"), { type: "button", label: "결정", on_click: [] }] });
  await expect(app.getByRole("button", { name: "결정" })).toBeVisible();
  expect(await padding()).toEqual([0]);
});

for (const width of [1200, 880, 360]) test(`보완 2: 구역 안 채움 탭에 가로 넘침이 없다 (${width})`, async ({ page }) => {
  const app = await open(page, { type: "section", title: "옵션", child: { type: "stack", direction: "column", fill: 0, children: [
    { type: "tabs", tabs: [{ label: "기법", child: { type: "text", value: "기법 내용" } }, { label: "스타일", child: { type: "text", value: "스타일 내용" } }] },
  ] } }, width, 760);
  const fill = app.locator(".ks-data-section-child > .ks-data-stack > .ks-data-stack-item.is-fill");
  const tabs = fill.getByRole("tab");
  await expect(tabs).toHaveCount(2);
  const sizes = await fill.evaluate(el => ({ scroll: el.scrollWidth, client: el.clientWidth }));
  expect(sizes.scroll).toBe(sizes.client);
  for (const tab of [tabs.first(), tabs.last()]) {
    await tab.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(tab).toBeFocused();
    const ring = await tab.evaluate(el => {
      const list = el.closest(".ks-data-tab-list")!.getBoundingClientRect();
      const box = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      const outset = parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
      return { left: box.left - outset - list.left, right: list.right - box.right - outset, focusVisible: el.matches(":focus-visible") };
    });
    expect(ring.focusVisible).toBe(true);
    expect(ring.left).toBeGreaterThanOrEqual(0);
    expect(ring.right).toBeGreaterThanOrEqual(0);
  }
});

test("채움 칸의 구역은 안쪽 canvas에 높이를 전달한다", async ({ page }) => {
  const app = await open(page, { type: "stack", direction: "column", fill: 0, children: [
    { type: "section", title: "그림", child: { type: "stack", direction: "column", fill: [0], children: [
      { type: "canvas", surface: "stage", aspect_ratio: 1 },
    ] } },
  ] });
  const canvas = app.locator(".ks-canvas");
  await expect(canvas).toBeVisible();
  expect((await canvas.boundingBox())!.height).toBeGreaterThan(100);
  const heights = await app.locator(".ks-data-stack-item.is-fill > .ks-data-section").evaluate(el => ({
    section: el.getBoundingClientRect().height, slot: el.parentElement!.getBoundingClientRect().height,
  }));
  expect(Math.abs(heights.section - heights.slot)).toBeLessThanOrEqual(1);
});

test("쌓인 분할의 채움 목록에 든 폼은 자연 높이를 유지한다", async ({ page }) => {
  const app = await open(page, { type: "split", direction: "row", column_below: 640, children: [
    { type: "section", title: "위", child: { type: "text", value: "그림" } },
    { type: "section", title: "옵션", child: { type: "stack", direction: "column", gap: "medium", fill: [0, 1, 2], children: [input("첫 값"), input("둘째 값"), input("셋째 값")] } },
  ] }, 360);
  const split = app.locator(".ks-split.is-stacked");
  await expect(split).toBeVisible();
  for (const label of ["첫 값", "둘째 값", "셋째 값"]) {
    const field = app.getByLabel(label);
    await expect(field).toBeVisible();
    expect((await field.boundingBox())!.height).toBeGreaterThan(20);
  }
  const sizes = await split.evaluate(el => [...el.querySelectorAll(".ks-data-stack-item.is-fill")].map(item => item.getBoundingClientRect().height));
  expect(sizes.every(size => size > 20)).toBe(true);
});

test("채움 뒤 폼은 스크롤하고 결정 단추만 바닥에 남는다", async ({ page }) => {
  const app = await open(page, { type: "stack", direction: "column", gap: "medium", fill: 0, children: [
    list, input("첫 값"), input("둘째 값"), input("셋째 값"), { type: "button", label: "적용", on_click: [] },
  ] }, 880, 360);
  const scroll = app.locator(".ks-stack-scroll");
  const button = app.getByRole("button", { name: "적용" });
  await expect(button).toBeVisible();
  await expect(scroll.getByLabel("셋째 값")).toHaveCount(1);
  expect(await button.evaluate(el => Boolean(el.closest(".ks-stack-scroll")))).toBe(false);
  const before = await button.boundingBox();
  await scroll.evaluate(el => { el.scrollTop = el.scrollHeight; });
  expect(await scroll.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  expect((await button.boundingBox())!.y).toBeCloseTo(before!.y, 0);
});

test("결정 단추 없이 채움 뒤 입력만 있어도 목록과 입력은 제자리에 있다", async ({ page }) => {
  const app = await open(page, { type: "stack", direction: "column", fill: 0, children: [list, input("답장"), input("제목")] });
  const scroll = app.locator(".ks-stack-scroll");
  await expect(scroll.getByLabel("답장")).toHaveCount(1);
  await expect(scroll.getByLabel("제목")).toHaveCount(1);
  const inputBox = await app.getByLabel("제목").boundingBox();
  const body = await app.locator(".ks-data-window-body").boundingBox();
  expect(body!.y + body!.height - (inputBox!.y + inputBox!.height)).toBeLessThan(40);
});

for (const width of [880, 360]) test(`미리보기 격자는 가로 넘침과 불필요한 세로 넘침이 없다 (${width})`, async ({ page }) => {
  await page.setViewportSize({ width, height: 600 });
  await page.goto("/?preview=preview-grid-tabs");
  const app = page.getByTestId("app-window-preview-grid-tabs");
  await app.getByRole("tab", { name: "찾기" }).click();
  const fill = app.locator('.ks-data-tab-panel:not([hidden]) .ks-data-stack-item.is-fill');
  await expect(fill.locator(".ks-data-button-card-action").first()).toBeVisible();
  const size = await fill.evaluate(el => ({ sw: el.scrollWidth, cw: el.clientWidth, sh: el.scrollHeight, ch: el.clientHeight }));
  expect(size.sw).toBe(size.cw);
  const widths = await fill.locator(".ks-repeat.is-grid").evaluate(el => ({ grid: el.getBoundingClientRect().width, parent: el.parentElement!.clientWidth }));
  expect(widths.grid).toBeLessThanOrEqual(widths.parent);
  // 작은 창에서 내용이 길면 세로 스크롤은 필요하다.
  if (width === 880) expect(size.sh).toBe(size.ch);
});

test("보완 3: 대화상자를 열고 닫아도 뒤의 분할과 여백을 유지한다", async ({ page }) => {
  const dialog = (open: object | boolean) => ({ type: "dialog", title: "설정", open, on_close: [{ set_state: "dialogOpen", value: false }], child: { type: "text", value: "설정 내용" } });
  const app = await open(page, { type: "stack", direction: "column", gap: "small", fill: 1, children: [
    { type: "toolbar", start: [{ type: "button", label: "설정 열기", on_click: [{ set_state: "dialogOpen", value: true }] }] },
    { type: "stack", direction: "column", gap: "small", fill: 0, children: [
      { type: "when", value: true, child: { type: "split", direction: "row", children: [
        { type: "section", title: "첫 칸", child: { type: "text", value: "본문" } },
        { type: "section", title: "둘째 칸", child: { type: "text", value: "결과" } },
      ] } },
      { type: "when", value: false, child: { type: "text", value: "숨은 갈래" } },
    ] },
    dialog({ state: "dialogOpen" }),
    { type: "when", value: true, child: dialog(false) },
    { type: "anchor", id: "dialog-anchor-test", child: dialog(false) },
  ] }, 1200, 760);
  const split = app.locator(".ks-data-window-body .ks-split");
  await expect(split).toBeVisible();
  const geometry = await split.evaluate(el => {
    const split = el.getBoundingClientRect(), body = el.closest(".ks-data-window-body")!.getBoundingClientRect();
    return { height: split.height, gap: body.bottom - split.bottom };
  });
  expect(geometry.height).toBeGreaterThan(400);
  expect(Math.abs(geometry.gap)).toBeLessThanOrEqual(1);
  const sectionGap = await split.locator(".ks-data-section").first().evaluate(el => el.getBoundingClientRect().bottom - el.querySelector(".ks-data-section-child")!.getBoundingClientRect().bottom);
  expect(sectionGap).toBeCloseTo(12, 0);
  const opener = app.getByRole("button", { name: "설정 열기" });
  await opener.click();
  await expect(app.getByRole("dialog", { name: "설정" })).toBeVisible();
  await expect(app.getByText("설정 내용")).toBeVisible();
  await expect(app.getByRole("dialog").getByRole("button", { name: "닫기" })).toBeFocused();
  const openedGeometry = await split.evaluate(el => {
    const split = el.getBoundingClientRect(), body = el.closest(".ks-data-window-body")!.getBoundingClientRect();
    return { height: split.height, gap: body.bottom - split.bottom };
  });
  const openedSectionGap = await split.locator(".ks-data-section").first().evaluate(el => el.getBoundingClientRect().bottom - el.querySelector(".ks-data-section-child")!.getBoundingClientRect().bottom);
  expect(openedGeometry).toEqual(geometry);
  expect(openedSectionGap).toBeCloseTo(sectionGap, 0);
  const ownerModule = `/@fs${fileURLToPath(new URL("../src/share/overlay-owner.ts", import.meta.url))}`;
  const owner = await app.locator(".ks-data-window").evaluate(async (window, path) => {
    const { ownedOverlays, overlayOwner } = await import(/* @vite-ignore */ path);
    const id = (window as HTMLElement).dataset.windowId!;
    const overlay = ownedOverlays(id)[0];
    const record = overlay && overlayOwner(overlay);
    return { count: ownedOverlays(id).length, windowId: record?.windowId, id,
      anchorInDialogSlot: Boolean(record?.anchor?.closest(".ks-data-stack-item.is-dialog")), anchorConnected: record?.anchor?.isConnected ?? false };
  }, ownerModule);
  expect(owner).toEqual({ count: 1, windowId: owner.id, id: owner.id, anchorInDialogSlot: true, anchorConnected: true });
  await expect(app.locator(".ks-data-window-body > .ks-data-stack > .ks-data-stack-item.is-dialog")).toHaveCount(3);
  await page.keyboard.press("Escape");
  await expect(app.getByRole("dialog")).toHaveCount(0);
  await expect(opener).toBeFocused();
  const closedGeometry = await split.evaluate(el => {
    const split = el.getBoundingClientRect(), body = el.closest(".ks-data-window-body")!.getBoundingClientRect();
    return { height: split.height, gap: body.bottom - split.bottom };
  });
  expect(closedGeometry).toEqual(geometry);
  const closedSectionGap = await split.locator(".ks-data-section").first().evaluate(el => el.getBoundingClientRect().bottom - el.querySelector(".ks-data-section-child")!.getBoundingClientRect().bottom);
  expect(closedSectionGap).toBeCloseTo(sectionGap, 0);
});
