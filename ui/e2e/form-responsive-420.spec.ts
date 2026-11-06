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

const I = {type:'input',label:'값',value:{state:'value'},on_change:[]};
const S=(children:object[])=>({type:'stack',direction:'column',gap:'small',children});
const R=(children:object[])=>({type:'stack',direction:'row',children});
const B={type:'button',label:'단추',on_click:[]};
const T={type:'text',value:'글'};

test('기존 좁은 탭 안 채움 textarea의 이름표 배치는 보존한다',async({page})=>{
 const input=(label:string)=>({type:'input',label,multiline:true,value:{state:'value'},on_change:[]});
 const app=await open(page,{type:'tabs',tabs:[{label:'답글',child:{type:'stack',direction:'column',gap:'small',fill:[0,1],children:[input('한국어'),input('영어')]}},{label:'분할',child:S([seg(['A','B'])])}]},360);
 await expect(app.getByLabel('한국어',{exact:true})).toBeVisible();
 const m=await app.locator('.ks-input-field').first().evaluate(el=>{const s=getComputedStyle(el);const label=el.querySelector('.ks-field-label')!;return {offset:label.getBoundingClientRect().top-el.getBoundingClientRect().top,legacy:parseFloat(s.getPropertyValue('--ks-line-width'))+(parseFloat(s.getPropertyValue('--ks-control-height'))-parseFloat(s.getPropertyValue('--ks-type-body'))*parseFloat(s.getPropertyValue('--ks-line-body')))/2};});
 expect(m.offset).toBeCloseTo(m.legacy,0);
 await app.getByRole('tab',{name:'분할',exact:true}).click();
 const label=app.locator('.ks-select-field > .ks-field-label');await expect(label).toBeVisible();
 const size=await label.evaluate(el=>({height:el.getBoundingClientRect().height,line:parseFloat(getComputedStyle(el).lineHeight)}));
 expect(size.height).toBeCloseTo(size.line,0);
});
const seg=(items:string[])=>({type:'select',label:'방식',style:'segmented',options:items,value:items[0],on_change:[]});
for(const kind of ['pane','row','center']) for(const width of [880,480,360]) test(`좁은 양식 컨트롤: ${kind} ${width}`,async({page})=>{
 let ui:any=S([I,{type:'slider',label:'정도',value:10,min:0,max:100,on_change:[]}]);
 if(kind==='pane') ui={type:'split',direction:'row',sizes:[70,30],children:[T,ui]};
 if(kind==='row') ui=R([ui,S([{...I,label:'다른 값'}])]);
 if(kind==='center') ui={type:'stack',direction:'column',place:'center',children:[ui]};
 const app=await open(page,ui,width);
 await expect(app.getByLabel('값',{exact:true})).toBeVisible();
 const m=await app.locator('.ks-input-field').first().evaluate(el=>{const f=el.getBoundingClientRect(), l=el.querySelector('.ks-field-label')!.getBoundingClientRect(),c=el.querySelector('input')!.getBoundingClientRect();return {f:f.toJSON(),l:l.toJSON(),c:c.toJSON(),scroll:el.scrollWidth,client:el.clientWidth};});
 expect(m.c.width).toBeGreaterThan(50);expect(m.scroll).toBeLessThanOrEqual(m.client+1);
 if(m.f.width<=319){expect(m.c.top).toBeGreaterThanOrEqual(m.l.bottom);expect(m.c.width).toBeGreaterThanOrEqual(m.f.width-1);}
 const slider=app.locator('.ks-slider').first();expect((await slider.boundingBox())!.width).toBeGreaterThan(30);
});
for(const width of [880,360]) for(const items of [['잘 알려진 포트','등록된 포트','동적 포트','전체'],['중복 제거','연속 중복 제거']]) test(`분할 값이 읽힌다 ${width} ${items.length}`,async({page})=>{
 const app=await open(page,{type:'split',direction:'row',children:[{type:'section',title:'옵션',child:S([seg(items)])},T],column_below:640},width);
 await expect(app.locator('.ks-data-segmented')).toBeVisible();
 const cuts=await app.locator('.ks-data-segmented .ks-truncate-label').evaluateAll(els=>els.filter(e=>e.scrollWidth>e.clientWidth+1).map(e=>e.textContent));
 expect(cuts).toEqual([]);
});
test('짧은 두 칸과 입력의 시작선 유지',async({page})=>{
 const app=await open(page,S([I,seg(['너비','높이'])]),360);
 const x=await app.locator('.ks-field > .ks-data-input,.ks-field > .ks-data-segmented').evaluateAll(els=>els.map(e=>e.getBoundingClientRect().left));expect(Math.abs(x[0]-x[1])).toBeLessThanOrEqual(1);
});
for(const child of [S([T,B]),{type:'section',title:'구역',child:T},{type:'list',items:[{key:'1',title:'목록'}]},{type:'table',columns:[{field:'x',label:'값'}],rows:[{x:'값'}]}]) test(`가로 줄 안 ${child.type} 여백 중복 없음`,async({page})=>{
 const app=await open(page,S([R([child])]),880);
 const row=app.locator('.ks-data-window-body > .ks-data-stack > .ks-data-stack-item').first();
 expect(await row.evaluate(el=>parseFloat(getComputedStyle(el).paddingLeft))).toBe(0);
 if(child.type==='table') await expect(app.locator('.ks-table-scroll')).toBeVisible();
 if(child.type==='list') await expect(app.locator('.ks-list')).toBeVisible();
 if(child.type==='stack'){const x=await app.locator('.ks-data-text').evaluate(el=>{const r=document.createRange();r.selectNodeContents(el);return r.getBoundingClientRect().left-el.closest('.ks-data-window-body')!.getBoundingClientRect().left;});expect(x).toBe(12);}
});
test('무이름 색과 분할은 빈 이름표 열을 만들지 않는다',async({page})=>{
 const app=await open(page,S([T,{type:'slider',value:10,min:0,max:100,on_change:[]},{type:'color',value:'#112233',on_change:[]},{...seg(['하나','둘']),label:undefined}]),360);
 const x=await app.locator('.ks-slider,.ks-color-control,.ks-data-segmented').evaluateAll(els=>els.map(e=>e.getBoundingClientRect().left-e.closest('.ks-data-window-body')!.getBoundingClientRect().left));expect(x).toEqual([12,12,12]);
});
test('긴 토글 트랙은 줄어들지 않고 글은 시작 정렬',async({page})=>{
 const app=await open(page,S([I,{type:'toggle',label:'아주 긴 이름표가 붙은 토글로 설명까지 들어감',value:true,on_change:[]}]),360);
 await expect(app.getByRole('switch')).toBeVisible();
 const m=await app.locator('.ks-data-toggle-track').evaluate(el=>({width:el.getBoundingClientRect().width,expected:parseFloat(getComputedStyle(el).getPropertyValue('--ks-space-6')),align:getComputedStyle(el.parentElement!).textAlign}));expect(m.width).toBe(m.expected);expect(m.align).toBe('start');
});
