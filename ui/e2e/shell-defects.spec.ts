import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

async function capture(page: import("@playwright/test").Page, name: string) {
  const directory = process.env.KS_DATA_CAPTURE_DIR;
  if (directory) { mkdirSync(directory, { recursive: true }); await page.screenshot({ path: join(directory, `${name}.png`) }); }
}

test("여러 줄 입력은 여덟 줄까지 스크롤 없이 자라고 폭에 맞춰 다시 잰다", async ({ page }) => {
  await page.setViewportSize({ width: 1049, height: 900 });
  await page.goto("/?preview=input-autogrow-fixture");
  const app = page.getByTestId("app-window-input-autogrow-fixture");
  const field = app.getByRole("textbox", { name: "한국어" });
  const fixed = app.getByRole("textbox", { name: "고정" });
  expect((await field.boundingBox())!.height).toBe(32);
  const heights = () => field.evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }));
  for (const lines of [1, 3, 8]) {
    await field.fill(Array(lines).fill("한 줄").join("\n"));
    await expect.poll(async () => { const h = await heights(); return h.scroll - h.client; }).toBe(0);
  }
  await field.fill(Array(9).fill("한 줄").join("\n"));
  await expect.poll(async () => { const h = await heights(); return h.scroll - h.client; }).toBeGreaterThan(0);
  const fixedHeight = (await fixed.boundingBox())!.height;
  await fixed.fill(Array(6).fill("한 줄").join("\n"));
  expect((await fixed.boundingBox())!.height).toBe(fixedHeight);
  await field.fill("자동 높이의 긴 문장이 창 크기에 맞추어 줄바꿈됩니다. ".repeat(3));
  for (const width of [1049, 640, 520, 360]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(async () => { const h = await heights(); return h.scroll - h.client; }).toBe(0);
    const alignment = await field.evaluate((el) => {
      const input = el.getBoundingClientRect();
      const label = el.closest(".ks-field")!.querySelector(".ks-field-label")!.getBoundingClientRect();
      const style = getComputedStyle(el);
      const firstLineCenter = input.top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop) + parseFloat(style.lineHeight) / 2;
      return getComputedStyle(el.closest(".ks-field")!).flexDirection === "column"
        ? Math.max(0, label.bottom - input.top)
        : Math.abs(label.top + label.height / 2 - firstLineCenter);
    });
    expect(alignment).toBeLessThanOrEqual(1);
    await capture(page, `autogrow-${width}`);
  }
});

test("중첩 입력과 대화상자 입력은 같은 안쪽 선과 쌓기 간격을 쓴다", async ({ page }) => {
  for (const width of [1049, 360]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/?preview=input-inset-fixture");
    const app = page.getByTestId("app-window-input-inset-fixture");
    const section = app.locator(".ks-data-section");
    const title = await section.locator(".ks-data-section-title").boundingBox();
    const inputs = await Promise.all(["첫 입력", "둘째 입력", "중첩 입력"].map((name) => section.getByPlaceholder(name).boundingBox()));
    for (const box of inputs) {
      expect(Math.abs(box!.x - title!.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(box!.x + box!.width - (inputs[0]!.x + inputs[0]!.width))).toBeLessThanOrEqual(1);
    }
    const gaps = [inputs[1]!.y - inputs[0]!.y - inputs[0]!.height, inputs[2]!.y - inputs[1]!.y - inputs[1]!.height];
    expect(Math.abs(gaps[0] - gaps[1])).toBeLessThanOrEqual(1);
    expect(gaps[0]).toBe(8);
    await capture(page, `input-inset-${width}`);
    await app.getByRole("button", { name: "찾기 열기" }).click();
    const dialog = app.getByRole("dialog");
    const [heading, input, close] = await Promise.all([
      dialog.locator(".ks-dialog-title").boundingBox(),
      dialog.getByPlaceholder("찾기 입력").boundingBox(),
      dialog.getByRole("button", { name: "닫기" }).boundingBox(),
    ]);
    expect(Math.abs(heading!.x - input!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(input!.x + input!.width - (close!.x + close!.width))).toBeLessThanOrEqual(1);
    await capture(page, `input-dialog-${width}`);
  }
});

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

test("숫자 폭이 다른 글꼴의 좁은 시간축에서 눈금이 겹치지 않는다", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 600 });
  await page.goto("/?preview=timeline-fixture");
  await page.evaluate(() => document.fonts.ready);
  const app = page.getByTestId("app-window-timeline-fixture");
  const scroll = app.locator(".ks-timeline-scroll");
  await scroll.evaluate((el) => { (el as HTMLElement).style.flex = "0 0 218px"; });
  const labels = app.locator(".ks-timeline-ruler > span");
  await expect(labels.first()).toBeVisible();
  await expect.poll(() => labels.count()).toBeGreaterThan(1);
  const geometry = await labels.evaluateAll((elements) => elements.map((el) => ({ text: el.textContent, ...el.getBoundingClientRect().toJSON() })));
  expect(Math.max(...geometry.slice(1).map((el, index) => geometry[index].right - el.left))).toBeLessThanOrEqual(0);
  await capture(page, "ruler-narrow");
});

test("화면보다 키 큰 안내 대상은 시작을 보여 준다", async ({ page }) => {
  await page.setViewportSize({ width: 880, height: 600 });
  await page.goto("/?preview=tour-fixture");
  const app = page.getByTestId("app-window-tour-fixture");
  const target = app.locator(".ks-anchor > *");
  await target.evaluate((el) => { (el as HTMLElement).style.height = "1200px"; (el as HTMLElement).style.marginTop = "100px"; });
  await app.getByRole("button", { name: "안내 시작" }).click();
  await expect(app.locator(".ks-tour-card")).toBeVisible();
  const geometry = await target.evaluate((el) => ({ target: el.getBoundingClientRect().toJSON(), body: el.closest(".ks-data-window-body")!.getBoundingClientRect().toJSON() }));
  expect(Math.abs(geometry.target.top - geometry.body.top)).toBeLessThanOrEqual(1);
  await capture(page, "tour-tall");
});

for (const width of [360, 1000]) test(`${width} 폭에서 가로 채움 칸의 입력이 칸을 채운다`, async ({ page }) => {
  await page.setViewportSize({ width, height: 600 });
  await page.goto("/?preview=row-fields-fixture");
  const app = page.getByTestId("app-window-row-fields-fixture");
  for (const selector of [".ks-slider-field", ".ks-select-field", ".ks-input-field"]) {
    const field = app.locator(`${selector}.is-label-hidden`);
    await expect(field).toBeVisible();
    const widths = await field.evaluate((el) => ({ field: el.getBoundingClientRect().width, control: el.querySelector<HTMLElement>(".ks-slider, .ks-button, .ks-data-input")!.getBoundingClientRect().width, item: el.parentElement!.getBoundingClientRect().width, margin: parseFloat(getComputedStyle(el).marginLeft) + parseFloat(getComputedStyle(el).marginRight) }));
    // 이름 없는 입력처럼 입력 칸은 항목 안쪽 여백을 두므로, 마진까지 합쳐 항목을 채우면 된다(카드 #1051).
    expect(Math.abs(widths.item - widths.field - widths.margin)).toBeLessThanOrEqual(1);
    expect(Math.abs(widths.field - widths.control)).toBeLessThanOrEqual(4);
  }
  const inline = app.locator(".ks-slider-field:not(.is-label-hidden)");
  const layout = await inline.evaluate((el) => ({ field: el.getBoundingClientRect().toJSON(), label: el.querySelector(".ks-field-label")!.getBoundingClientRect().toJSON(), slider: el.querySelector(".ks-slider")!.getBoundingClientRect().toJSON() }));
  expect(layout.label.right).toBeLessThan(layout.slider.left);
  expect(layout.field.width).toBeLessThan(300);
  await capture(page, `row-fill-fields-${width}`);
});

for (const id of ["columns-plain", "columns-tabs"]) test(`${id}에서 위 이름표 입력의 columns는 높이를 늘리지 않는다`, async ({ page }) => {
  for (const width of [1000, 360]) {
    await page.setViewportSize({ width, height: 600 });
    await page.goto(`/?preview=${id}`);
    const app = page.getByTestId(`app-window-${id}`);
    const short = app.locator(".ks-input-field.is-label-top").filter({ hasText: "짧은 입력" });
    const long = app.locator(".ks-input-field.is-label-top").filter({ hasText: "긴 입력" });
    await expect(short).toBeVisible(); await expect(long).toBeVisible();
    const measure = (field: import("@playwright/test").Locator) => field.evaluate((el) => {
      const label = el.querySelector(".ks-field-label")!.getBoundingClientRect();
      const wrapper = el.querySelector(".ks-data-input")!.getBoundingClientRect();
      const input = el.querySelector("input")!.getBoundingClientRect();
      return { label: label.toJSON(), wrapper: wrapper.toJSON(), input: input.toJSON() };
    });
    const [a, b] = await Promise.all([measure(short), measure(long)]);
    expect(Math.abs(a.wrapper.height - a.input.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(b.wrapper.height - b.input.height)).toBeLessThanOrEqual(1);
    expect(a.wrapper.width).toBeLessThan(b.wrapper.width);
    expect(a.input.top - a.label.bottom).toBeLessThanOrEqual(4);
    const button = await app.getByRole("button", { name: "새 값" }).boundingBox();
    expect(Math.abs(button!.y + button!.height / 2 - (b.input.top + b.input.height / 2))).toBeLessThanOrEqual(1);
    const inline = app.locator(".ks-input-field:not(.is-label-top)").filter({ hasText: "기본" });
    const inlineGeometry = await inline.evaluate((el) => ({ label: el.querySelector(".ks-field-label")!.getBoundingClientRect().toJSON(), input: el.querySelector("input")!.getBoundingClientRect().toJSON() }));
    if (id === "columns-tabs" && width === 360) expect(inlineGeometry.label.bottom).toBeLessThanOrEqual(inlineGeometry.input.top);
    else expect(inlineGeometry.label.right).toBeLessThan(inlineGeometry.input.left);
    await capture(page, `${id}-${width}`);
  }
});
