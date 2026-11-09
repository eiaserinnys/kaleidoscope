import { expect, test } from "@playwright/test";

test("내용 높이 쌓기와 가로 쌓기 및 대화상자의 입력은 계속 자란다", async ({ page }) => {
  await page.setViewportSize({ width: 1049, height: 900 });
  await page.goto("/?preview=sel-probe-b");
  const app = page.getByTestId("app-window-sel-probe-b");
  const five = Array(5).fill("한 줄").join("\n");
  for (const field of [app.getByLabel("메모"), app.getByLabel("가로")]) {
    await field.fill(five);
    expect((await field.boundingBox())!.height).toBeGreaterThan(100);
    expect(await field.evaluate(e => e.scrollHeight - e.clientHeight)).toBe(0);
  }
  await app.getByRole("button", { name: "대화상자 열기" }).click();
  const note = app.getByRole("dialog").getByLabel("메모");
  await note.fill(five);
  expect((await note.boundingBox())!.height).toBeGreaterThan(100);
  await note.fill(Array(9).fill("한 줄").join("\n"));
  expect(await note.evaluate(e => e.scrollHeight - e.clientHeight)).toBeGreaterThan(0);
  await page.goto("/?preview=standalone-textarea");
  const standalone = page.getByTestId("app-window-standalone-textarea").getByRole("textbox");
  await standalone.fill(five);
  expect((await standalone.boundingBox())!.height).toBeGreaterThan(100);
});

test("좁은 탭의 옆 이름표는 properties와 함께 위로 옮겨 칸 폭을 지킨다", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 900 });
  await page.goto("/?preview=sel-probe-a");
  const card = page.getByTestId("app-window-sel-probe-a").locator(".ks-data-section").filter({ has: page.locator(".ks-data-section-title", { hasText: "카드" }) });
  const field = card.locator(".ks-input-field").first();
  const geometry = await field.evaluate(e => ({ label:e.querySelector('.ks-field-label')!.getBoundingClientRect().toJSON(), input:e.querySelector('input')!.getBoundingClientRect().toJSON(), field:e.getBoundingClientRect().toJSON() }));
  expect(geometry.input.y).toBeGreaterThanOrEqual(geometry.label.bottom);
  expect(Math.abs(geometry.input.width - geometry.field.width)).toBeLessThanOrEqual(1);
});

test("채움이 최소에 닿아도 결정 줄을 남기고 위 내용만 스크롤한다", async ({ page }, info) => {
  await page.setViewportSize({ width:880,height:600 });
  await page.goto("/?preview=stack-action-tail");
  const app=page.getByTestId("app-window-stack-action-tail");
  const button=app.getByRole("button",{name:"올리기",exact:true});
  const result=await button.evaluate(e=>{const pane=e.closest('.ks-data-window-body')!.getBoundingClientRect();const rect=e.getBoundingClientRect();return {bottom:rect.bottom,pane:pane.bottom};});
  expect(result.bottom).toBeLessThanOrEqual(result.pane);
  const last=app.getByLabel("첨부 이름").last();
  await last.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(last).toBeFocused();
  const boxes=await Promise.all([last.boundingBox(),button.boundingBox()]);
  expect(boxes[0]!.y+boxes[0]!.height).toBeLessThanOrEqual(boxes[1]!.y);
  await page.keyboard.press("Tab");
  await expect(button).toBeFocused();
  await app.screenshot({path:info.outputPath("action-tail.png")});
});

test("결정 줄이 붙은 stack에서 fill 칸이 결정 줄 위까지 채운다", async ({ page }, info) => {
  await page.setViewportSize({ width: 1040, height: 700 });
  await page.goto("/?preview=stack-action-tail-fill");
  const app = page.getByTestId("app-window-stack-action-tail-fill");
  const m = await app.evaluate(root => {
    const header = [...root.querySelectorAll(".ks-data-section > .ks-data-section-header")].find(h => h.textContent!.trim() === "메모")!;
    const section = header.parentElement as HTMLElement;
    const item = section.parentElement as HTMLElement;
    const content = item.parentElement as HTMLElement;
    const wrapper = content.parentElement as HTMLElement;
    const toolbar = root.querySelector(".ks-data-toolbar") as HTMLElement;
    const child = section.querySelector(":scope > .ks-data-section-child") as HTMLElement;
    const rect = (el: HTMLElement) => el.getBoundingClientRect();
    return {
      wrapper: wrapper.className, content: content.className,
      wrapperHeight: rect(wrapper).height, contentHeight: rect(content).height,
      itemBottom: rect(item).bottom, contentBottom: rect(content).bottom,
      memoHeight: rect(section).height, toolbarTop: rect(toolbar).top,
      childScroll: child.scrollHeight - child.clientHeight,
    };
  });
  // 스크롤 래퍼가 배분된 높이를 갖고(기준 0), 그 안의 fill 칸이 래퍼 바닥까지 자란다.
  expect(m.wrapper).toContain("ks-stack-scroll");
  expect(m.content).toContain("ks-stack-scroll-content");
  expect(Math.abs(m.contentHeight - m.wrapperHeight)).toBeLessThanOrEqual(1);
  expect(Math.abs(m.itemBottom - m.contentBottom)).toBeLessThanOrEqual(1);
  expect(m.toolbarTop - m.itemBottom).toBeLessThanOrEqual(16);
  expect(m.childScroll).toBeLessThanOrEqual(1);
  await app.screenshot({ path: info.outputPath("action-tail-fill-wide.png") });
});

test("좁은 창에서 결정 줄이 붙은 stack은 쌓인 꼴로 결정 줄을 남긴다", async ({ page }, info) => {
  await page.setViewportSize({ width: 380, height: 700 });
  await page.goto("/?preview=stack-action-tail-fill");
  const app = page.getByTestId("app-window-stack-action-tail-fill");
  await expect(app.locator(".ks-split.is-stacked")).toHaveCount(1);
  const button = app.getByRole("button", { name: "지우기", exact: true });
  await expect(button).toBeVisible();
  const m = await app.evaluate(root => {
    const header = [...root.querySelectorAll(".ks-data-section > .ks-data-section-header")].find(h => h.textContent!.trim() === "메모")!;
    const section = header.parentElement as HTMLElement;
    const content = section.parentElement!.parentElement as HTMLElement;
    const wrapper = content.parentElement as HTMLElement;
    const toolbar = root.querySelector(".ks-data-toolbar") as HTMLElement;
    const rect = (el: HTMLElement) => el.getBoundingClientRect();
    return {
      wrapperHeight: rect(wrapper).height, contentHeight: rect(content).height,
      memoHeight: rect(section).height, memoBottom: rect(section).bottom, toolbarTop: rect(toolbar).top,
    };
  });
  // 쌓인 꼴에서도 내용이 래퍼를 채우고, 결정 줄은 접히지 않고 메모 아래에 남는다.
  expect(m.wrapperHeight).toBeGreaterThan(0);
  expect(m.memoHeight).toBeGreaterThan(0);
  expect(Math.abs(m.contentHeight - m.wrapperHeight)).toBeLessThanOrEqual(1);
  expect(m.toolbarTop).toBeGreaterThanOrEqual(m.memoBottom);
  expect((await button.boundingBox())!.height).toBeGreaterThan(0);
  await app.screenshot({ path: info.outputPath("action-tail-fill-narrow.png") });
});
