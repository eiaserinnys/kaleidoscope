import { expect, test } from "@playwright/test";

test("구역·탭·분할 칸의 숫자·목록 채움은 결정 줄 유무와 관계없이 같은 맥락을 쓴다",async({page},info)=>{
  await page.setViewportSize({width:1049,height:780});
  for(const context of ['section','tab','pane']) for(const fill of ['number','list']) {
    const pair=[];
    for(const tail of [0,1]) {
      const id=`context-${context}-${fill}-${tail}`;
      await page.goto(`/?preview=${id}`);
      const app=page.getByTestId(`app-window-${id}`);
      await expect(app.locator('.ks-list')).toBeVisible();
      pair.push(await app.evaluate(root=>{
        const stack=root.querySelector('.ks-data-stack.has-explicit-fill')!;
        const body=stack.querySelector(':scope > .ks-stack-scroll > .ks-stack-scroll-content')??stack;
        const first=body.querySelector('.ks-properties')!;
        const slot=body.querySelector(':scope > .ks-data-stack-item.is-fill')!;
        const tail=stack.querySelector(':scope > .ks-data-stack-item:not(.ks-stack-scroll):last-child');
        const hasTail=stack.classList.contains('has-action-tail');
        return {fill:slot.getBoundingClientRect().height,first:getComputedStyle(first).paddingTop,root:stack.getBoundingClientRect().height,tail:hasTail?tail!.getBoundingClientRect().height:0,gap:parseFloat(getComputedStyle(stack).rowGap),pane:root.querySelector('.ks-split-pane')!.getBoundingClientRect().bottom,tailBottom:tail!.getBoundingClientRect().bottom};
      }));
      if(tail) await app.screenshot({path:info.outputPath(`${context}-${fill}.png`)});
    }
    await info.attach(`${context}-${fill}`,{body:JSON.stringify(pair),contentType:"application/json"});
    expect(pair[1].first,`${context}/${fill} 첫 칸`).toBe(pair[0].first);
    expect(Math.abs(pair[0].fill-pair[1].fill-pair[1].tail-pair[1].gap),`${context}/${fill} 채움 높이`).toBeLessThanOrEqual(1);
    expect(pair[1].tailBottom,`${context}/${fill} 결정 줄`).toBeLessThanOrEqual(pair[1].pane);
  }
});

test("좁은 위 이름표 슬라이더는 값과 같은 줄에 놓인다",async({page})=>{
  for(const width of [1000,720]) {
    await page.setViewportSize({width,height:900});await page.goto('/?preview=sel-probe-side');
    const field=page.getByTestId('app-window-sel-probe-side').locator('.ks-slider-field').first();
    const d=await field.evaluate(e=>{const a=e.querySelector('input')!.getBoundingClientRect();const b=e.querySelector('.ks-slider-value')!.getBoundingClientRect();return Math.abs(a.y+a.height/2-b.y-b.height/2)});
    expect(d).toBeLessThanOrEqual(1);
  }
});
