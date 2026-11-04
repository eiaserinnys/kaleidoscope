import { expect, test } from "@playwright/test";

test("다른 창의 초안과 선택을 유지하며 입력, 메뉴와 탭을 조작한다", async ({ page }) => {
  await page.goto("/window-control.html");
  await expect(page.getByRole("button", { name: "실행" })).toBeVisible();
  const other = page.getByLabel("다른 창");
  await other.click(); await other.fill("미확정 초안");
  await other.evaluate((input: HTMLInputElement) => input.setSelectionRange(1, 4));
  const run = async (label: string, action: Record<string, unknown>) => page.evaluate(async ({ label, action }) => {
    const api = (window as any).controlHarness;
    const view = api.read();
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const target = Number(view.text.match(new RegExp(`\\[(\\d+)\\] [^\\n]*${escaped}`))?.[1]);
    return api.act(view.view_id, { ...action, target });
  }, { label, action });
  expect((await run("실행", { kind: "click" })).applied).toBe(true);
  expect((await run("대상 입력", { kind: "type", text: "바뀐 글", mode: "replace" })).applied).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as any).controlHarness.state().text)).toBe("바뀐 글");
  expect((await run("종류", { kind: "select", choice: { by: "value", value: "둘" } })).applied).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as any).controlHarness.state().selected)).toBe("둘");
  expect((await run("표시", { kind: "click" })).applied).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as any).controlHarness.state().enabled)).toBe(true);
  expect((await run("둘째 탭", { kind: "click" })).applied).toBe(true);
  await expect(page.getByText("둘째 내용")).toBeVisible();
  expect((await run("대상 입력", { kind: "key", key: "Enter" })).applied).toBe(true);
  expect(await other.inputValue()).toBe("미확정 초안");
  expect(await other.evaluate((input: HTMLInputElement) => [document.activeElement === input, input.selectionStart, input.selectionEnd])).toEqual([true, 1, 4]);
  expect(await page.evaluate(() => (window as any).controlHarness.blurCommits)).toBe(0);
  await page.screenshot({ path: "test-results/window-control-focus.png" });
});

test("좌표와 편집기, 허용 차단, 프레임 응답 완료를 실제 Chromium에서 확인한다", async ({ page }) => {
  await page.goto("/window-control.html");
  await expect(page.getByLabel("코드 입력")).toBeVisible();
  const run = (label: string, action: Record<string, unknown>) => page.evaluate(async ({label, action}) => {
    const api=(window as any).controlHarness, v=api.surfaceRead();
    const line=v.text.split("\n").find((line: string)=>line.includes(label)&&/^\[\d+\]/.test(line));
    if (!line) throw new Error(`번호 없음: ${label}\n${v.text}`);
    const target=Number(line.match(/^\[(\d+)\]/)[1]);
    return api.surfaceAct(v.view_id,{...action,target});
  }, {label,action});
  expect((await run("횟수",{kind:"click",gesture:"double_click"})).applied).toBe(true);
  expect(await page.evaluate(()=>(window as any).controlHarness.events.filter((x:string)=>x.startsWith("BUTTON:click")))).toEqual(["BUTTON:click:1","BUTTON:click:2"]);
  expect((await run("횟수",{kind:"key",key:"Enter"})).applied).toBe(true);
  expect((await run("횟수",{kind:"key",key:"Space"})).applied).toBe(true);
  expect((await run("체크",{kind:"click"})).applied).toBe(true);
  await expect(page.getByLabel("체크")).toBeChecked();
  expect((await run("목록 행",{kind:"click"})).applied).toBe(true);
  await expect(page.getByRole("row")).toHaveAttribute("aria-selected","true");
  expect((await run("스크롤 영역 스크롤",{kind:"scroll",direction:"down",amount:40})).applied).toBe(true);
  expect(await page.getByLabel("스크롤").evaluate(e=>e.scrollTop)).toBe(40);
  expect((await run("코드 입력",{kind:"type",mode:"replace",text:"새 코드"})).applied).toBe(true);
  expect((await run("코드 입력",{kind:"type",mode:"append",text:" 덧붙임"})).applied).toBe(true);
  expect(await page.evaluate(()=>(window as any).controlHarness.code())).toBe("새 코드 덧붙임");
  const canvas=page.locator('[data-window-id="surface"] canvas');
  const point=await canvas.evaluate(async e=>{const r=e.getBoundingClientRect(),p=e.closest('[data-window-id]')!.getBoundingClientRect();return (window as any).controlHarness.point(r.left-p.left+5,r.top-p.top+5);});
  expect(point.applied).toBe(true);
  expect(await page.evaluate(()=>(window as any).controlHarness.events.filter((x:string)=>x.startsWith("CANVAS:")))).toEqual(["CANVAS:pointerdown:1","CANVAS:mousedown:1","CANVAS:pointerup:1","CANVAS:mouseup:1","CANVAS:click:1"]);
  await run("폴더 허용",{kind:"click"});
  expect(await page.evaluate(()=>(window as any).controlHarness.permissionError)).toBe("SHELL_WINDOW_CONTROL_CONSENT_BLOCKED");
  await page.waitForTimeout(100); // 격리 프레임의 load 뒤 메시지를 보낸다.
  const start=Date.now();
  expect((await run("프레임 완료",{kind:"click"})).after.settled).toBe(true);
  expect(Date.now()-start).toBeGreaterThanOrEqual(250);
  expect(await page.evaluate(()=>(window as any).controlHarness.frameHasId)).toBe(true);
  await page.evaluate(()=>(window as any).controlHarness.humanAction());
  await expect.poll(()=>page.evaluate(()=>(window as any).controlHarness.frameHasId)).toBe(false);
  await page.evaluate(()=>(window as any).controlHarness.consent());
  for(const action of [{kind:"click",target:999},{kind:"point",x:1,y:1,gesture:"click"},{kind:"key",key:"Enter"}]) {
    const result=await page.evaluate(async a=>{const api=(window as any).controlHarness;return api.surfaceAct(api.surfaceRead().view_id,a);},action);
    expect(result.error.id).toBe("SHELL_WINDOW_CONTROL_CONSENT_BLOCKED");
  }
  await page.evaluate(()=>(window as any).controlHarness.clearConsent());
  await page.screenshot({path:"test-results/window-control-surfaces.png"});
});

test("실제 격리 프레임에서 좌표 클릭과 더블클릭이 동작한다", async ({ page }) => {
  await page.goto("/window-control.html?frames");
  const sandbox = page.frameLocator('iframe[title="실제 샌드박스"]');
  await expect(sandbox.locator("#counter")).toHaveText("횟수 0");
  const point = async (selector: string, gesture: "click" | "double_click") => {
    const frame = page.locator("[data-window-id] iframe");
    const child = page.frameLocator("[data-window-id] iframe").locator(selector);
    const box = await child.boundingBox(), root = await page.locator('[data-window-id="sandbox-frame"], [data-window-id="html-frame"]').boundingBox();
    if (!box || !root) throw new Error("프레임 대상의 좌표가 없습니다");
    await expect(frame).toBeVisible();
    return page.evaluate(({ x, y, gesture }) => (window as any).controlHarness.framePoint(x, y, gesture), { x: box.x + box.width / 2 - root.x, y: box.y + box.height / 2 - root.y, gesture });
  };
  let result = await point("#counter", "click");
  expect(result.applied).toBe(true); expect(result.after.settled).toBe(true); expect(result.after.text).toContain("횟수 1");
  result = await point("#counter", "double_click");
  expect(result.after.settled).toBe(true); expect(result.after.text).toContain("횟수 3");
  result = await point("#label", "click");
  await expect(sandbox.locator("#check")).toBeChecked(); expect(result.after.text).toContain("켜짐");
  await point("summary", "click"); await expect(sandbox.locator("details")).toHaveAttribute("open", "");
  await page.screenshot({ path: "test-results/frame-point-sandbox.png" });
  await page.evaluate(() => (window as any).controlHarness.chooseFrame("html"));
  const html = page.frameLocator('iframe[title="실제 HTML"]');
  await expect(html.locator("#target")).toHaveText("편집할 글");
  await page.locator('iframe[title="실제 HTML"]').evaluate((frame: HTMLIFrameElement) => frame.contentWindow!.postMessage({ type: "ks-html-mode", mode: "select" }, "*"));
  result = await point("#target", "double_click");
  expect(result.applied).toBe(true); expect(result.after.settled).toBe(true);
  await expect(html.locator("#target")).toHaveAttribute("contenteditable", "plaintext-only");
  await page.screenshot({ path: "test-results/frame-point-html.png" });
});
