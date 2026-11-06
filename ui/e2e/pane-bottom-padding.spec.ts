import { expect, test, type Page } from "@playwright/test";

test('가로 쌓기의 앞 칸도 창 바닥 여백을 갖는다', async ({ page }) => {
  await page.goto('/?preview=bottom-horizontal-stack');
  const section = page.getByTestId('app-window-bottom-horizontal-stack').locator('.ks-data-section');
  await expect(section).toBeVisible();
  expect(await section.evaluate(el => getComputedStyle(el).paddingBottom)).toBe('12px');
});

for (const width of [880, 360]) test(`분할 구역 스크롤 바깥에 바닥 여백이 남는다 (${width})`, async ({ page }) => {
  await page.setViewportSize({ width, height: 600 });
  await page.goto('/?preview=nested-fill-split');
  const app = page.getByTestId('app-window-nested-fill-split');
  const sections = app.locator('.ks-split-pane > .ks-data-section');
  await expect(sections).toHaveCount(2);
  for (const section of await sections.all()) {
    const measure = () => section.evaluate(el => {
      const child = el.querySelector(':scope > .ks-data-section-child')!;
      return { gap: el.getBoundingClientRect().bottom - child.getBoundingClientRect().bottom,
        expected: parseFloat(getComputedStyle(el).getPropertyValue('--ks-space-3')) };
    });
    const before = await measure();
    expect(before.gap).toBeCloseTo(before.expected, 0);
    await section.locator(':scope > .ks-data-section-child').evaluate(el => { el.scrollTop = el.scrollHeight; });
    expect(await measure()).toEqual(before);
  }
});

test('창 직속 구역도 스크롤 바깥에 여백을 남긴다', async ({ page }) => {
  await page.goto('/?preview=root-section-list');
  const section = page.getByTestId('app-window-root-section-list').locator('.ks-data-window-body > .ks-data-section');
  await expect(section).toBeVisible();
  const gap = await section.evaluate(el => el.getBoundingClientRect().bottom - el.querySelector(':scope > .ks-data-section-child')!.getBoundingClientRect().bottom);
  expect(gap).toBeCloseTo(12, 0);
});

for (const kind of ['controls', 'markdown', 'editor', 'folder']) test(`구역 안 탭은 바닥 여백을 중복하지 않는다 (${kind})`, async ({ page }) => {
  await page.goto(`/?preview=bottom-tabs-${kind}`);
  const app = page.getByTestId(`app-window-bottom-tabs-${kind}`);
  const section = app.locator('.ks-split-pane > .ks-data-section');
  await expect(section).toBeVisible();
  expect(await section.evaluate(el => getComputedStyle(el).paddingBottom)).toBe('0px');
  const panel = section.locator('.ks-data-tab-panel');
  expect(await panel.evaluate(el => getComputedStyle(el).paddingBottom)).toBe(kind === 'controls' ? '12px' : '0px');
});

for (const width of [880, 360]) test(`구역 옆 직접 콘텐츠도 같은 바닥 끝선을 쓴다 (${width})`, async ({ page }) => {
  await page.setViewportSize({ width, height: 600 });
  await page.goto('/?preview=bottom-split-last');
  const app = page.getByTestId('app-window-bottom-split-last');
  const pane = app.locator('.ks-split-pane').first();
  const list = pane.locator(':scope > .ks-table-scroll');
  await expect(list).toBeVisible();
  if (width === 880) {
    const bottoms = await app.locator('.ks-split-pane > .ks-table-scroll, .ks-data-section-child').evaluateAll(els => els.map(el => el.getBoundingClientRect().bottom));
    expect(Math.abs(bottoms[0] - bottoms[1])).toBeLessThanOrEqual(1);
    expect(await pane.evaluate(el => el.getBoundingClientRect().bottom - el.firstElementChild!.getBoundingClientRect().bottom)).toBeCloseTo(12, 0);
  } else {
    // 중간 칸에는 기존 칸 사이 여백만 남는다.
    expect(await pane.evaluate(el => getComputedStyle(el).paddingBottom)).toBe('8px');
    const section = app.locator('.ks-data-section');
    expect(await section.evaluate(el => getComputedStyle(el).paddingBottom)).toBe('12px');
  }
  const header = list.locator('.ks-table-header');
  const top = (await header.boundingBox())!.y;
  await list.evaluate(el => { el.scrollTop = el.scrollHeight; });
  expect(await list.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  expect((await header.boundingBox())!.y).toBeCloseTo(top, 0);
});

test('뒤에 탭이 이어지는 중간 분할은 바닥 여백을 더하지 않는다', async ({ page }) => {
  await page.goto('/?preview=bottom-split-middle');
  const app = page.getByTestId('app-window-bottom-split-middle');
  const section = app.locator('.ks-split-pane > .ks-data-section');
  await expect(section).toBeVisible();
  expect(await section.evaluate(el => getComputedStyle(el).paddingBottom)).toBe('0px');
  const pane = app.locator('.ks-split-pane').first();
  expect(await pane.evaluate(el => getComputedStyle(el).paddingBottom)).toBe('0px');
});

test('창 본문이 스크롤하는 쌓기의 마지막 글 아래에 여백을 남긴다', async ({ page }) => {
  await page.setViewportSize({ width: 880, height: 600 });
  await page.goto('/?preview=bottom-body-scroll');
  const app = page.getByTestId('app-window-bottom-body-scroll');
  const body = app.locator('.ks-data-window-body');
  const last = app.getByText('출처', { exact: true });
  await expect(last).toBeVisible();
  await body.evaluate(el => { [el, ...el.querySelectorAll('*')].forEach(node => { if (/(auto|scroll)/.test(getComputedStyle(node).overflowY)) node.scrollTop = node.scrollHeight; }); });
  const space = await last.evaluate(el => {
    const body = el.closest('.ks-data-window-body')!;
    return body.getBoundingClientRect().bottom - el.getBoundingClientRect().bottom + parseFloat(getComputedStyle(el).paddingBottom);
  });
  expect(space).toBeCloseTo(12, 0);
});

async function openBottom(page: Page, ui: object, width = 880, height = 600) {
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

const bottomRows = Array.from({length:80},(_,i)=>({key:String(i),title:`항목 ${i+1}`}));
const bottomList = (layout='rows', grouped=false, count=80) => ({type:'list',layout,grouped,items:grouped?[{title:'도구',items:bottomRows.slice(0,count)}]:bottomRows.slice(0,count)});
for(const layout of ['rows','grouped','grid','icons']) test(`칸 직속 ${layout} 목록의 스크롤 안쪽 끝 여백`,async({page})=>{
 const app=await openBottom(page,{type:'split',direction:'row',children:[bottomList(layout==='grouped'?'rows':layout,layout==='grouped'),{type:'text',value:'그림'}]});
 const list=app.locator('.ks-list');await expect(list).toBeVisible();
 const height=await list.evaluate(el=>el.clientHeight);
 await list.evaluate(el=>el.scrollTop=el.scrollHeight);await expect(list.getByText('항목 80',{exact:true})).toBeVisible();await list.evaluate(el=>el.scrollTop=el.scrollHeight);
 const m=await list.evaluate(el=>{const last=[...el.querySelectorAll('[data-focus-index]')].at(-1)!;return {gap:el.getBoundingClientRect().bottom-last.getBoundingClientRect().bottom,space:parseFloat(getComputedStyle(el).getPropertyValue('--ks-space-3')),height:el.clientHeight,pane:el.parentElement!.clientHeight};});
 expect(m.gap).toBeCloseTo(m.space,0);expect(m.height).toBe(height);expect(m.height).toBe(m.pane);
});
for(const place of ['tab','section','dialog','stacked','short']) test(`목록 끝 여백 소유: ${place}`,async({page})=>{
 let ui:any=bottomList('rows',true,place==='short'?1:80);
 if(place==='tab') ui={type:'tabs',tabs:[{label:'도구',child:ui}]};
 if(place==='section') ui={type:'section',title:'도구',child:ui};
 if(place==='dialog') ui={type:'dialog',title:'도구',open:true,on_close:[],child:ui};
 ui={type:'split',direction:'row',column_below:640,children:[{type:'text',value:'앞'},ui]};
 const app=await openBottom(page,ui,place==='stacked'?360:880);
 const list=app.locator('.ks-list');await expect(list).toBeVisible();
 const m=await list.evaluate(el=>{const s=getComputedStyle(el);return {pad:parseFloat(s.paddingBottom),space:parseFloat(s.getPropertyValue('--ks-space-3')),scroll:el.scrollHeight,client:el.clientHeight};});
 if(['tab','section','dialog'].includes(place)) expect(m.pad).toBe(0);
 else expect(m.pad).toBe(m.space);
 if(place==='short')expect(m.scroll).toBe(m.client);
});
for(const state of ['loading','failed']) for(const layout of ['rows','grid','icons']) test(`목록 끝 ${state} 표시 뒤 여백: ${layout}`,async({page})=>{
 const app=await openBottom(page,{type:'split',direction:'row',children:[{...bottomList(layout),items:{expr:'$data.fixture'}},{type:'text',value:'옆'}]});
 await expect(app.locator('.ks-split-row')).toBeVisible();
 await page.evaluate(async({value,state})=>{const h=(window as any).__ksHarness;const {snapshot}=await h.call({op:'state.get'});const win=snapshot.shared.windows.find((w:any)=>w.app_id==='data-controls');h.emit({event:'data.update',window_id:win.id,view:{sources:{},values:{'/ui/children/0/items':{status:'ready',value,more:{source:'fixture',state,retry:false,message:'목록을 읽지 못했습니다.',id:'DATA_SOURCE_MORE_REQUEST_FAILED'}}}}});},{value:bottomRows,state});
 const list=app.locator('.ks-list'),footer=list.locator(':scope > .ks-load-more');await expect(footer).toBeVisible();await list.evaluate(el=>el.scrollTop=el.scrollHeight);
 const m=await list.evaluate(el=>{const f=el.querySelector('.ks-load-more')!;const content=f.firstElementChild!;return {gap:el.getBoundingClientRect().bottom-content.getBoundingClientRect().bottom,space:parseFloat(getComputedStyle(el).getPropertyValue('--ks-space-3'))};});expect(Math.abs(m.gap-m.space)).toBeLessThanOrEqual(1);
});
