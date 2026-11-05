import { expect, test, type Locator } from "@playwright/test";

// 외곽선까지 포함한 사각형이 모든 자르기 조상 안에 있어야 한다.
async function visibleRing(target: Locator) {
  return target.evaluate(e => {
    const r = e.getBoundingClientRect(), s = getComputedStyle(e);
    const bleed = Math.max(0, parseFloat(s.outlineWidth) + parseFloat(s.outlineOffset));
    const ring = { left: r.left - bleed, right: r.right + bleed, top: r.top - bleed, bottom: r.bottom + bleed };
    const clipped = [];
    for (let p = e.parentElement; p; p = p.parentElement) {
      const cs = getComputedStyle(p), b = p.getBoundingClientRect();
      if (cs.overflowX !== "visible" && (ring.left < b.left - .5 || ring.right > b.right + .5) ||
          cs.overflowY !== "visible" && (ring.top < b.top - .5 || ring.bottom > b.bottom + .5)) clipped.push(p.className);
    }
    return { ring, clipped, outline: s.outlineStyle, width: s.outlineWidth, radius: s.borderRadius };
  });
}

for (const context of ["fill", "dialog", "tail"]) test(`${context}: 스크롤 경계에서도 초점 네 변을 보인다`, async ({ page }, info) => {
  await page.setViewportSize({ width: 880, height: 600 });
  const id = context === "tail" ? "stack-action-tail" : "sel-probe-b";
  await page.goto(`/?preview=${id}`);
  const app = page.getByTestId(`app-window-${id}`);
  if (context === "dialog") await app.getByRole("button", { name: "대화상자 열기" }).click();
  const target = context === "tail" ? app.getByLabel("영어") : context === "dialog" ? app.getByRole("dialog").getByLabel("메모") : app.getByLabel("가로");
  // 실제 키보드 모드에서 앞으로/뒤로 모두 확인한다.
  await page.keyboard.press("Tab"); await target.focus();
  for (const step of ["first", "back"]) {
    if (step === "back") { await page.keyboard.press("Tab"); await page.keyboard.press("Shift+Tab"); }
    const result = await visibleRing(target);
    await info.attach(`${step}-geometry`, { body: JSON.stringify(result), contentType: "application/json" });
    await app.screenshot({ path: info.outputPath(`${step}.png`) });
    expect(result.width).toBe("2px");
    expect(result.outline).toBe("solid");
    expect(result.clipped).toEqual([]);
  }
});
