import { expect, test, type Page } from "@playwright/test";

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

const field = (label: string, position = 'inline') => ({ type: 'input', label, label_position: position, value: {state:'value'}, on_change: {set_state:'value'} });
const stack = (children: object[]) => ({type:'stack',direction:'column',children});
const form = () => stack([field('값'), field('긴 이름표'), {type:'select',label:'방식',value:'a',options:['a','b'],on_change:[]}, {type:'slider',label:'정도',value:10,min:0,max:100,on_change:[]}, {type:'color',label:'색상',value:'#112233',on_change:[]}, {type:'toggle',label:'켜기',value:true,on_change:[]}]);
for (const wrap of ['direct','section','nested','tab','dialog','pane','middle','stacked']) {
  test(`양식 공통 열: ${wrap}`, async ({page}) => {
    let ui: any = form();
    if(wrap==='section') ui={type:'section',title:'옵션',child:ui};
    if(wrap==='nested') ui={type:'section',title:'바깥',child:{type:'section',title:'안쪽',child:ui}};
    if(wrap==='tab') ui={type:'tabs',tabs:[{label:'옵션',child:ui}]};
    if(wrap==='dialog') ui={type:'dialog',title:'옵션',open:true,on_close:[],child:ui};
    if(['pane','middle','stacked'].includes(wrap)) ui={type:'split',direction:wrap==='middle'?'column':'row',column_below:640,children:[{type:'text',value:'앞'},ui,{type:'text',value:'뒤'}]};
    const app=await open(page,ui,wrap==='stacked'?360:880);
    await expect(app.getByRole('switch')).toBeVisible();
    const lefts=await app.locator('.ks-field > .ks-data-input, .ks-field > .ks-select-button, .ks-field > .ks-slider, .ks-field > .ks-color-control, .ks-data-toggle').evaluateAll(els=>els.map(e=>e.getBoundingClientRect().left));
    console.log(wrap,lefts);
    expect(lefts).toHaveLength(6);
    expect(Math.max(...lefts)-Math.min(...lefts)).toBeLessThanOrEqual(1);
  });
}
for(const width of [880,360]) test(`쌓기 글과 컨트롤 여백 ${width}`,async({page})=>{
  const app=await open(page,stack([{type:'text',value:'글'}, {type:'button',label:'확인',on_click:[]},field('입력','top'),{type:'select',label:'고르기',label_position:'top',value:'a',options:['a'],on_change:[]},{type:'toggle',label:'켜기',value:true,on_change:[]}, {type:'stack',direction:'row',children:[{type:'button',label:'나란히',on_click:[]}]}]),width);
  await expect(app.getByRole('button',{name:'확인',exact:true})).toBeVisible();
  const m=await app.evaluate(root=>{const b=root.querySelector('.ks-data-window-body')!;const x=b.getBoundingClientRect().left; const text=b.querySelector('.ks-data-text')!; const r=document.createRange();r.selectNodeContents(text);return {space:parseFloat(getComputedStyle(b).getPropertyValue('--ks-space-3')),left:[r.getBoundingClientRect().left,...[...b.querySelectorAll('.ks-data-button > button, .ks-field-label, .ks-data-toggle')].map(e=>e.getBoundingClientRect().left)].map(v=>v-x)};});
  for(const x of m.left) expect(Math.abs(x-m.space)).toBeLessThanOrEqual(1);
});
test('루트 글 여백',async({page})=>{
 const app=await open(page,{type:'text',value:'직속 글'});
 const m=await app.locator('.ks-data-text').evaluate(el=>({pad:parseFloat(getComputedStyle(el).paddingLeft),space:parseFloat(getComputedStyle(el).getPropertyValue('--ks-space-3'))}));
 expect(m.pad).toBe(m.space);
});
test('쌓인 목록은 남는 높이를 채운다',async({page})=>{
 const app=await open(page,{type:'split',direction:'row',column_below:640,children:[{type:'text',value:'앞'}, {type:'list',items:Array.from({length:40},(_,i)=>({key:String(i),title:`항목 ${i}`}))}]},360,760);
 const split=app.locator('.ks-split.is-stacked');await expect(split).toBeVisible();
 const m=await split.evaluate(el=>({end:el.getBoundingClientRect().bottom,last:el.lastElementChild!.getBoundingClientRect().bottom,scroll:el.scrollHeight,client:el.clientHeight}));
 expect(Math.abs(m.end-m.last)).toBeLessThanOrEqual(1);expect(m.scroll).toBeLessThanOrEqual(m.client+1);
});
test('위·숨김 이름표와 가로 쌓기 배치는 유지한다',async({page})=>{
 const app=await open(page,stack([field('위','top'),field('숨김','hidden'),{type:'stack',direction:'row',children:[field('가로')]}]));
 await expect(app.getByLabel('위',{exact:true})).toBeVisible();
 await expect(app.locator('.is-label-top')).toHaveCSS('flex-direction','column');
 await expect(app.locator('.is-label-hidden .ks-field-label')).toHaveCount(0);
 await expect(app.locator('.is-row .ks-field')).toHaveCSS('grid-template-columns','none');
});
test('최소 높이 합이 넘치면 쌓인 칸 바깥이 스크롤한다',async({page})=>{
 const list={type:'list',items:Array.from({length:40},(_,i)=>({key:String(i),title:`행 ${i}`}))};
 const app=await open(page,{type:'split',direction:'row',column_below:640,children:[list,list]},360,360);
 const split=app.locator('.ks-split.is-stacked');await expect(split).toBeVisible();
 const m=await split.evaluate(el=>({scroll:el.scrollHeight,client:el.clientHeight,panes:[...el.querySelectorAll(':scope > .ks-split-pane')].map(p=>p.getBoundingClientRect().height)}));
 expect(m.scroll).toBeGreaterThan(m.client);expect(m.panes.every(h=>h>=320)).toBe(true);
});
test('좁은 탭은 기존 위아래 양식과 슬라이더 열을 유지한다',async({page})=>{
 const app=await open(page,{type:'tabs',tabs:[{label:'옵션',child:form()}]},300);
 const slider=app.locator('.ks-slider-field');await expect(slider).toBeVisible();
 expect(await app.locator('.ks-data-tab-panel').evaluate(el=>el.clientWidth-parseFloat(getComputedStyle(el).paddingLeft)-parseFloat(getComputedStyle(el).paddingRight))).toBeLessThanOrEqual(319);
 const m=await slider.evaluate(el=>{const label=el.querySelector('.ks-field-label')!.getBoundingClientRect();const control=el.querySelector('.ks-slider')!.getBoundingClientRect();return {label:label.toJSON(),control:control.toJSON(),width:el.getBoundingClientRect().width};});
 expect(m.control.top).toBeGreaterThanOrEqual(m.label.bottom);expect(m.control.width).toBeGreaterThan(m.width/2);
 const toggle=app.getByRole('switch');expect(await toggle.evaluate(el=>parseFloat(getComputedStyle(el).marginInlineStart))).toBe(0);
});
