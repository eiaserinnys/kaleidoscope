import { expect, test } from "@playwright/test";

test("쌓인 상세의 뼈대와 격자는 속성 시작선에 맞는다", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.goto("/?preview=stacked-grid-detail-1");
  const app = page.getByTestId("app-window-stacked-grid-detail-1");
  const skeleton = app.locator(".ks-data-skeleton > i").first();
  const label = app.locator(".ks-properties dt").first();
  const card = app.locator(".ks-list.is-grid .ks-list-card").first();
  await expect(card).toBeVisible();
  const left = async (locator: typeof card) => (await locator.boundingBox())!.x;
  expect.soft(Math.abs(await left(skeleton) - await left(label))).toBeLessThanOrEqual(1);
  expect.soft(Math.abs(await left(card) - await left(label))).toBeLessThanOrEqual(1);
});

test("긴 속성 배지는 말줄이고 툴팁으로 전문을 보인다", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.goto("/?preview=stacked-grid-detail-1");
  const app = page.getByTestId("app-window-stacked-grid-detail-1");
  const dd = app.locator(".ks-properties dd").first();
  await dd.evaluate(element => {
    element.style.width = "500px";
    const before = document.createElement("button"); before.id = "badge-before";
    const after = document.createElement("button"); after.id = "badge-after";
    element.before(before); element.after(after);
  });
  const badge = dd.locator(".ks-badge");
  await expect(badge).not.toHaveAttribute("tabindex");
  await badge.hover();
  await page.waitForTimeout(600);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await expect(badge).not.toHaveAttribute("aria-describedby");
  await page.locator("#badge-before").focus();
  await page.keyboard.press("Tab");
  await expect(page.locator("#badge-after")).toBeFocused();
  await page.mouse.move(0, 0);
  await dd.evaluate(element => { element.style.width = "120px"; });
  await expect(badge).toHaveAttribute("tabindex", "0");
  const size = await badge.evaluate(element => ({ width: element.getBoundingClientRect().width, scroll: element.scrollWidth, parent: element.parentElement!.parentElement!.getBoundingClientRect().width, overflow: getComputedStyle(element).textOverflow }));
  expect(size.width).toBeLessThanOrEqual(size.parent + 1);
  expect(size.scroll).toBeGreaterThan(size.width);
  expect(size.overflow).toBe("ellipsis");
  await badge.hover();
  await expect(page.getByRole("tooltip")).toHaveText("아주 긴 외부 서비스 접속 권한을 표시하는 배지");
  await page.mouse.move(0, 0);
  await page.locator("#badge-before").focus();
  await page.keyboard.press("Tab");
  await expect(badge).toBeFocused();
  await expect(page.getByRole("tooltip")).toHaveText("아주 긴 외부 서비스 접속 권한을 표시하는 배지");
  await expect(badge).toHaveAttribute("aria-describedby", /.+/);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await expect(badge).not.toHaveAttribute("aria-describedby");
  const copied = await badge.evaluate(element => {
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
    return { text: selection.toString(), selectable: getComputedStyle(element).userSelect };
  });
  expect(copied).toEqual({ text: "아주 긴 외부 서비스 접속 권한을 표시하는 배지", selectable: "text" });
  await page.keyboard.press("Control+C");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(copied.text);
});

for (const tail of [0, 1]) test(`격자가 든 상세 칸은 바깥 스크롤로 끝까지 읽는다 (결정 줄 ${tail})`, async ({ page }) => {
  await page.setViewportSize({ width: 1049, height: 780 });
  await page.goto(`/?preview=stacked-grid-detail-${tail}`);
  const app = page.getByTestId(`app-window-stacked-grid-detail-${tail}`);
  const panes = app.locator(".ks-split.is-stacked > .ks-split-pane");
  await expect(panes).toHaveCount(2);
  await expect(app.locator(".ks-list.is-grid .ks-list-card").first()).toBeVisible();
  const heights = await panes.evaluateAll(elements => elements.map(element => element.getBoundingClientRect().height));
  expect(heights[0]).toBe(480);
  expect(heights[1]).toBeGreaterThan(320);
  const detail = panes.nth(1);
  const inner = detail.locator(".ks-stack-scroll");
  if (tail) expect(await inner.evaluate(element => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1);
  await app.getByText("상세 설명의 마지막 문장입니다.").scrollIntoViewIfNeeded();
  await expect(app.getByText("상세 설명의 마지막 문장입니다.")).toBeVisible();
  if (tail) await expect(app.getByRole("button", { name: "설치" })).toBeVisible();
});

test("쌓인 분할 칸의 fill 목록은 내용 높이를 유지한다", async ({ page }) => {
  await page.setViewportSize({ width: 1049, height: 780 });
  await page.goto('/?preview=stacked-fill-detail');
  const app = page.getByTestId('app-window-stacked-fill-detail');
  const slot = app.locator('.ks-split.is-stacked > .ks-split-pane > .ks-data-stack.has-fill-list > .ks-data-stack-item.is-fill');
  await expect(slot).toHaveCount(2);
  for (const item of await slot.all()) expect((await item.boundingBox())!.height).toBeGreaterThan(0);
});

test("구역·탭·분할 칸의 숫자·목록 채움은 결정 줄 유무와 관계없이 같은 맥락을 쓴다",async({page},info)=>{
  await page.setViewportSize({width:1049,height:780});
  for(const [context,kind] of [['section','list'],['section','markdown'],['tab','list'],['pane','list']]) for(const fill of ['number','list']) {
    const pair=[];
    for(const tail of [0,1]) {
      const id=`context-${context}-${fill}-${tail}-${kind}`;
      await page.goto(`/?preview=${id}`);
      const app=page.getByTestId(`app-window-${id}`);
      await expect(app.locator('.ks-list,.ks-markdown-view')).toBeVisible();
      pair.push(await app.evaluate(root=>{
        const stack=root.querySelector('.ks-data-stack.has-explicit-fill')!;
        const body=stack.querySelector(':scope > .ks-stack-scroll > .ks-stack-scroll-content')??stack;
        const first=body.querySelector('.ks-properties')!;
        const slot=body.querySelector(':scope > .ks-data-stack-item.is-fill')!;
        const tail=stack.querySelector(':scope > .ks-data-stack-item:not(.ks-stack-scroll):last-child');
        const hasTail=stack.classList.contains('has-action-tail');
        return {fill:slot.getBoundingClientRect().height,first:getComputedStyle(first).paddingTop,root:stack.getBoundingClientRect().height,tail:hasTail?tail!.getBoundingClientRect().height:0,gap:parseFloat(getComputedStyle(stack).rowGap),pane:root.querySelector('.ks-split-pane')!.getBoundingClientRect().bottom,tailBottom:tail!.getBoundingClientRect().bottom};
      }));
      if(tail) await app.screenshot({path:info.outputPath(`${context}-${fill}-${kind}.png`)});
    }
    await info.attach(`${context}-${fill}-${kind}`,{body:JSON.stringify(pair),contentType:"application/json"});
    expect(pair[1].first,`${context}/${fill} 첫 칸`).toBe(pair[0].first);
    expect(Math.abs(pair[0].fill-pair[1].fill-pair[1].tail-pair[1].gap),`${context}/${fill} 채움 높이`).toBeLessThanOrEqual(1);
    expect(pair[1].tailBottom,`${context}/${fill} 결정 줄`).toBeLessThanOrEqual(pair[1].pane);
  }
});

test("좁은 위 이름표 슬라이더는 값과 같은 줄에 놓인다",async({page},info)=>{
  for(const width of [1000,720]) {
    await page.setViewportSize({width,height:900});await page.goto('/?preview=sel-probe-side');
    const field=page.getByTestId('app-window-sel-probe-side').locator('.ks-slider-field').first();
    const m=await field.evaluate(e=>{const a=e.querySelector('input')!.getBoundingClientRect();const b=e.querySelector('.ks-slider-value')!.getBoundingClientRect();return {width:e.getBoundingClientRect().width,delta:Math.abs(a.y+a.height/2-b.y-b.height/2)}});
    await info.attach(`slider-${width}`,{body:JSON.stringify(m),contentType:"application/json"});
    expect(m.delta).toBeLessThanOrEqual(1);
  }
});
