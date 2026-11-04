import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

async function capture(page: import("@playwright/test").Page, name: string) {
  const directory = process.env.KS_DATA_CAPTURE_DIR;
  if (directory) { mkdirSync(directory, { recursive: true }); await page.screenshot({ path: join(directory, `${name}.png`) }); }
}

test("따라갈 목록이 넘치면 목록만 움직인다", async ({ page }) => {
  await page.setViewportSize({ width: 880, height: 600 });
  await page.goto("/?preview=follow-fixture");
  const app = page.getByTestId("app-window-follow-fixture");
  const list = app.locator(".ks-repeat");
  await expect(list.getByText("항목 29")).toHaveCount(1);
  await app.getByRole("button", { name: "마지막 항목" }).click();
  await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(await app.locator(".ks-data-window-body").evaluate((el) => el.scrollTop)).toBe(0);
  expect(await app.locator(".ks-harness-window-content").evaluate((el) => el.scrollTop)).toBe(0);
});

test("목록이 스크롤되지 않으면 넘친 창 몸통만 따라간다", async ({ page }) => {
  await page.setViewportSize({ width: 880, height: 600 });
  await page.goto("/?preview=follow-fixture");
  const app = page.getByTestId("app-window-follow-fixture");
  const list = app.locator(".ks-repeat");
  await list.evaluate((el) => { const list = el as HTMLElement; list.style.overflow = "visible"; list.style.height = "auto"; list.style.flex = "none"; });
  await app.locator(".ks-data-stack-item.is-fill").evaluate((el) => { (el as HTMLElement).style.overflow = "visible"; });
  const body = app.locator(".ks-data-window-body");
  await expect.poll(() => body.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(0);
  await app.getByRole("button", { name: "마지막 항목" }).click();
  await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(await list.evaluate((el) => el.scrollTop)).toBe(0);
});

test("따라갈 스크롤 영역이 없으면 숨은 조상을 밀지 않는다", async ({ page }) => {
  await page.setViewportSize({ width: 880, height: 600 });
  await page.goto("/?preview=follow-fixture");
  const app = page.getByTestId("app-window-follow-fixture");
  const list = app.locator(".ks-repeat");
  await list.evaluate((el) => { el.style.overflow = "visible"; el.style.height = "auto"; el.style.maxHeight = "none"; el.style.flex = "none"; });
  await app.locator(".ks-data-stack-item.is-fill").evaluate((el) => { (el as HTMLElement).style.overflow = "visible"; });
  await app.locator(".ks-data-window-body").evaluate((el) => { const body = el as HTMLElement; body.style.flex = "none"; body.style.height = "max-content"; });
  const bodySize = await app.locator(".ks-data-window-body").evaluate((el) => [el.scrollHeight, el.clientHeight]);
  expect(bodySize[0]).toBe(bodySize[1]);
  await app.getByRole("button", { name: "마지막 항목" }).click();
  await page.waitForTimeout(500);
  await expect.poll(() => app.locator(".ks-harness-window-content").evaluate((el) => el.scrollTop)).toBe(0);
  expect(await app.locator(".ks-data-window-body").evaluate((el) => el.scrollTop)).toBe(0);
});

test("좁은 시간축의 눈금 글자가 겹치지 않고 가림막이 재생선을 덮는다", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 600 });
  await page.goto("/?preview=timeline-fixture");
  const app = page.getByTestId("app-window-timeline-fixture");
  const labels = app.locator(".ks-timeline-ruler > span");
  await expect(labels.first()).toBeVisible();
  await expect.poll(() => labels.count()).toBeGreaterThan(1);
  const overlaps = () => labels.evaluateAll((elements) => elements.slice(1).filter((element, index) => elements[index].getBoundingClientRect().right > element.getBoundingClientRect().left + 0.5).length);
  expect(await overlaps()).toBe(0);
  // 로딩 중인 글꼴이 뒤늦게 넓어진 경우를 재현한다.
  await page.addStyleTag({ content: ".ks-timeline-ruler span, .ks-timeline-ruler-measure { font-size: 40px; }" });
  await expect.poll(overlaps).toBe(0);
  await app.getByRole("button", { name: "대화상자 열기" }).click();
  const covered = await app.evaluate((root) => {
    const head = root.querySelector<HTMLElement>(".ks-timeline-playhead")!;
    const overlay = root.querySelector<HTMLElement>(".ks-dialog-overlay")!;
    head.style.pointerEvents = "auto";
    root.querySelector(".ks-data-window-body")!.removeAttribute("inert");
    const r = head.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + 0.5, r.bottom - 2);
    return { overlay: overlay.contains(top), head: head.contains(top) };
  });
  expect(covered).toEqual({ overlay: true, head: false });
  await capture(page, "timeline-dialog");
});

test("작은 창에서 스크롤 뒤 안내 카드가 창 안에 남는다", async ({ page }) => {
  await page.setViewportSize({ width: 880, height: 600 });
  await page.goto("/?preview=tour-fixture");
  const app = page.getByTestId("app-window-tour-fixture");
  await app.locator(".ks-anchor > *").evaluate((el) => { (el as HTMLElement).style.marginTop = "1400px"; });
  await app.locator(".ks-data-window-body").evaluate((el) => { (el as HTMLElement).style.overflowY = "auto"; });
  await app.getByRole("button", { name: "안내 시작" }).click();
  const card = app.locator(".ks-tour-card");
  await expect(card).toBeVisible();
  const positions = await app.evaluate((root) => ({ card: root.querySelector(".ks-tour-card")!.getBoundingClientRect().toJSON(), frame: root.querySelector(".ks-harness-window-content")!.getBoundingClientRect().toJSON() }));
  expect(await app.locator(".ks-data-window-body").evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(positions.card.top).toBeGreaterThanOrEqual(positions.frame.top - 1);
  expect(positions.card.bottom).toBeLessThanOrEqual(positions.frame.bottom + 1);
  await capture(page, "tour-scrolled");
});


test("탭에서 위 이름표와 숨긴 이름표가 자기 칸에 정렬된다", async ({ page }) => {
  await page.setViewportSize({ width: 880, height: 600 });
  await page.goto("/?preview=field-layout-sample");
  const app = page.getByTestId("app-window-field-layout-sample");
  const input = app.getByRole("textbox", { name: "이름" });
  const select = app.getByRole("button", { name: "시간" });
  const slider = app.getByRole("slider", { name: "밝기" });
  await expect(input).toBeVisible(); await expect(select).toBeVisible(); await expect(slider).toBeVisible();
  const positions = await app.locator(".ks-data-tab-panel").evaluate((panel) => {
    const field = panel.querySelector<HTMLElement>(".ks-input-field")!;
    const label = field.querySelector<HTMLElement>(".ks-field-label")!.getBoundingClientRect();
    const control = field.querySelector<HTMLElement>(".ks-data-input")!.getBoundingClientRect();
    const next = panel.querySelector<HTMLElement>(".ks-select-field")!.getBoundingClientRect();
    const hidden = panel.querySelector<HTMLElement>(".ks-slider-field")!.getBoundingClientRect();
    const range = panel.querySelector<HTMLElement>(".ks-slider")!.getBoundingClientRect();
    return { label: label.toJSON(), control: control.toJSON(), next: next.toJSON(), hidden: hidden.toJSON(), range: range.toJSON() };
  });
  expect(Math.abs(positions.label.left - positions.control.left)).toBeLessThanOrEqual(1);
  expect(positions.control.top).toBeGreaterThanOrEqual(positions.label.bottom);
  expect(positions.control.top - positions.label.bottom).toBeLessThan(positions.next.top - positions.control.bottom);
  expect(Math.abs(positions.range.left - positions.hidden.left)).toBeLessThanOrEqual(1);
  await expect(app.locator(".ks-slider-value")).toHaveCount(0);
  await capture(page, "fields-wide");
});

test("중첩 스크롤 칸의 안내 대상을 창 안까지 가져온다", async ({ page }) => {
  await page.setViewportSize({ width: 880, height: 600 });
  await page.goto("/?preview=tour-fixture");
  const app = page.getByTestId("app-window-tour-fixture");
  const target = app.locator(".ks-anchor > *");
  await target.evaluate((el) => {
    const item = el.closest<HTMLElement>(".ks-data-stack-item")!;
    item.style.marginTop = "700px";
    item.style.height = "160px";
    item.style.flex = "0 0 160px";
    item.style.overflowY = "auto";
    (el as HTMLElement).style.marginTop = "700px";
  });
  await app.locator(".ks-data-window-body").evaluate((el) => { (el as HTMLElement).style.overflowY = "auto"; });
  await app.getByRole("button", { name: "안내 시작" }).click();
  const positions = await target.evaluate((el) => {
    const inner = el.closest<HTMLElement>(".ks-data-stack-item")!;
    const body = el.closest<HTMLElement>(".ks-data-window-body")!;
    return { innerScroll: inner.scrollTop, bodyScroll: body.scrollTop, target: el.getBoundingClientRect().toJSON(), frame: body.getBoundingClientRect().toJSON() };
  });
  expect(positions.innerScroll).toBeGreaterThan(0);
  expect(positions.bodyScroll).toBeGreaterThan(0);
  expect(positions.target.top).toBeGreaterThanOrEqual(positions.frame.top - 1);
  expect(positions.target.bottom).toBeLessThanOrEqual(positions.frame.bottom + 1);
});


test("탭에서 이름표를 숨긴 분할 고르기는 이름표 열을 비우지 않는다", async ({ page }) => {
  await page.setViewportSize({ width: 880, height: 600 });
  await page.goto("/?preview=segmented-fixture");
  const field = page.getByTestId("app-window-segmented-fixture").locator(".ks-select-field");
  const group = field.getByRole("group", { name: "선택" });
  await expect(group).toBeVisible();
  const widths = await field.evaluate((el) => ({ field: el.getBoundingClientRect().width, group: el.querySelector(".ks-data-segmented")!.getBoundingClientRect().width }));
  expect(Math.abs(widths.field - widths.group)).toBeLessThanOrEqual(1);
});
