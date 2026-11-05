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
  await page.keyboard.press("Tab");
  if (context === "tail") {
    await target.fill("두 줄 영어 입력\n둘째 줄 커서");
    await app.getByLabel("첨부 이름").last().focus();
    await page.keyboard.press("Shift+Tab");
    await expect(target).toBeFocused();
  } else await target.focus();
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

async function controlProbe(page: import("@playwright/test").Page) {
  await page.goto("/?preview=data-controls");
  await page.evaluate(async () => {
    const harness = (window as any).__ksHarness;
    const { snapshot } = await harness.call({ op: "state.get" });
    const app = snapshot.shared.app_versions.find((v: any) => v.app_id === "data-controls");
    app.definition.state = { on: true };
    app.definition.ui = { type: "stack", direction: "column", gap: "medium", children: [
      { type: "text", format: "markdown", value: "[출처 링크](https://example.com)" },
      { type: "text", value: "누르는 글", on_click: [] },
      { type: "toggle", label: "토글", value: { state: "on" }, on_change: { set_state: "on" } },
      { type: "slider", label: "슬라이더", value: 0, min: 0, max: 100, on_change: [] },
      ...["default", "primary", "danger"].map(variant => ({ type: "button", variant, label: variant, on_click: [] })),
    ] };
    app.version += 1;
    const win = snapshot.shared.windows.find((w: any) => w.app_id === "data-controls");
    win.app_version = app.version; win.state = { on: true };
    harness.emit({ event: "state.changed", snapshot });
  });
  return page.getByTestId("app-window-data-controls");
}

test("링크·누르는 글·토글·슬라이더는 정본 바깥 고리를 쓴다", async ({ page }) => {
  const app = await controlProbe(page);
  await page.keyboard.press("Tab");
  for (const target of [app.getByRole("link"), app.getByText("누르는 글", { exact: true }), app.getByRole("switch"), app.getByRole("slider")]) {
    await target.focus();
    expect(await target.evaluate(e => getComputedStyle(e).outlineOffset)).toBe("2px");
  }
  for (const label of ["default", "primary", "danger"]) {
    const target = app.getByRole("button", { name: label, exact: true }); await target.focus();
    expect(await target.evaluate(e => getComputedStyle(e).outlineOffset)).toBe("-2px");
  }
});

for (const theme of ["light", "dark"] as const) test(`${theme}: 강조 단추의 고리는 바탕 띠와 3:1 이상 대비한다`, async ({ page }, info) => {
  await page.emulateMedia({ colorScheme: theme });
  const app = await controlProbe(page);
  await page.keyboard.press("Tab");
  for (const label of ["default", "primary", "danger"]) {
    const target = app.getByRole("button", { name: label, exact: true }); await target.focus();
    const focused = await target.screenshot();
    await target.evaluate(e => (e as HTMLElement).style.setProperty("outline-style", "none", "important"));
    const noOutline = await target.screenshot();
    await target.evaluate(e => (e as HTMLElement).style.removeProperty("outline-style"));
    // 검수 contrast.py와 같은 네 변 중앙 0.5/1.5px의 화소 대비 중앙값.
    const contrast = await page.evaluate(async ({ a, b }) => {
      const pixels = async (data: string) => {
        const img = new Image(); img.src = `data:image/png;base64,${data}`; await img.decode();
        const canvas = document.createElement("canvas"); canvas.width = img.width; canvas.height = img.height;
        const ctx = canvas.getContext("2d")!; ctx.drawImage(img, 0, 0);
        return { data: ctx.getImageData(0, 0, img.width, img.height).data, w: img.width, h: img.height };
      };
      const [x, y] = await Promise.all([pixels(a), pixels(b)]);
      const lum = (d: Uint8ClampedArray, i: number) => [0.2126, 0.7152, 0.0722].reduce((sum, k, c) => { const v = d[i + c] / 255; return sum + k * (v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4); }, 0);
      const values: number[] = [];
      for (const o of [.5, 1.5]) for (const [px, py] of [[o,x.h/2],[x.w-1-o,x.h/2],[x.w/2,o],[x.w/2,x.h-1-o]]) {
        const i = (Math.round(py) * x.w + Math.round(px)) * 4, la = lum(x.data,i), lb = lum(y.data,i);
        values.push((Math.max(la,lb)+.05)/(Math.min(la,lb)+.05));
      }
      return values.sort((a,b) => a-b)[Math.floor(values.length/2)];
    }, { a: focused.toString("base64"), b: noOutline.toString("base64") });
    await info.attach(`${label}-contrast`, { body: String(contrast), contentType: "text/plain" });
    expect(contrast).toBeGreaterThanOrEqual(3);
    await target.screenshot({ path: info.outputPath(`${label}.png`) });
  }
});

test("키보드 조작 뒤 프로그램 preventScroll 초점은 본문 스크롤을 보존한다", async ({ page }) => {
  await page.setViewportSize({ width: 880, height: 600 });
  await page.goto("/?preview=stack-action-tail");
  const app = page.getByTestId("app-window-stack-action-tail"), target = app.getByLabel("영어");
  await page.keyboard.press("Tab");
  await app.getByRole("button", { name: "올리기", exact: true }).focus();
  const before = await target.evaluate(e => {
    const sc = e.closest<HTMLElement>(".ks-stack-scroll")!, r = e.getBoundingClientRect(), s = sc.getBoundingClientRect();
    sc.scrollTop += r.top - s.top + 10;
    (e as HTMLElement).focus({ preventScroll: true }); return sc.scrollTop;
  });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await target.evaluate(e => e.closest(".ks-stack-scroll")!.scrollTop)).toBe(before);
});
