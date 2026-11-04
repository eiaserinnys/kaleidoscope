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
  const boxes=await Promise.all([last.boundingBox(),button.boundingBox()]);
  expect(boxes[0]!.y+boxes[0]!.height).toBeLessThanOrEqual(boxes[1]!.y);
  await app.screenshot({path:info.outputPath("action-tail.png")});
});
