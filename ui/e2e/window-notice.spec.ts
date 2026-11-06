import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

for (const width of [880, 360]) test(`${width} 폭의 오류 알림은 본문을 밀지 않고 창 안에 뜬다`, async ({ page }) => {
  await page.setViewportSize({ width, height: 600 });
  await page.goto("/?preview=notice-fixture");
  await page.getByTestId("fake-files-panel").evaluate((element) => { element.remove(); });
  const app = page.getByTestId("app-window-notice-fixture");
  const body = app.locator(".ks-data-window-body");
  await expect(app.getByRole("button", { name: "시작 단추" })).toBeVisible();
  const before = await body.boundingBox();
  await page.evaluate(() => (window as any).noticeFixture.alert());
  const notice = app.getByRole("alert");
  await expect(notice).toContainText("TEST_ERROR");
  expect(await body.boundingBox()).toEqual(before);
  const geometry = await notice.evaluate((element) => {
    const n = element.getBoundingClientRect(), w = element.closest(".ks-data-window")!.getBoundingClientRect();
    return { left: n.left - w.left, right: w.right - n.right, bottom: w.bottom - n.bottom, radius: getComputedStyle(element).borderRadius };
  });
  expect(geometry).toEqual({ left: 8, right: 8, bottom: 8, radius: "8px" });
  if (width === 880) {
    const centers = await notice.evaluate((element) => {
      const message = element.querySelector(".ks-notice-message")!.getBoundingClientRect();
      const button = element.querySelector("button")!.getBoundingClientRect();
      return Math.abs((message.top + message.bottom - button.top - button.bottom) / 2);
    });
    expect(centers).toBeLessThanOrEqual(1);
  }
  expect(await page.evaluate(() => (window as any).noticeFixture.read())).toContain("파일을 받을 수 없습니다");
  const output = process.env.KS_NOTICE_CAPTURE_DIR;
  if (output) { mkdirSync(output, { recursive: true }); await app.screenshot({ path: join(output, `alert-${width}.png`) }); }
  await notice.getByRole("button", { name: "닫기" }).click();
  await expect(notice).toHaveCount(0);
});

test("낮은 창의 긴 오류는 알림 안에서 스크롤하고 닫을 수 있다", async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 500 });
  await page.goto("/?preview=notice-fixture");
  await page.getByTestId("fake-files-panel").evaluate((element) => element.remove());
  const app = page.getByTestId("app-window-notice-fixture");
  await app.evaluate((element) => { element.style.width = "360px"; element.style.height = "240px"; });
  await expect(app.getByRole("button", { name: "시작 단추" })).toBeVisible();
  await page.evaluate(() => (window as any).noticeFixture.alert("긴 오류 설명입니다. ".repeat(80)));
  const notice = app.getByRole("alert");
  await expect(notice).toBeVisible();
  const metrics = await notice.evaluate((element) => {
    const rect = element.getBoundingClientRect(), windowRect = element.closest(".ks-data-window")!.getBoundingClientRect();
    const message = element.querySelector(".ks-notice-message")!;
    return { top: rect.top - windowRect.top, bottom: windowRect.bottom - rect.bottom, scroll: message.scrollHeight - message.clientHeight, noticeScroll: element.scrollHeight - element.clientHeight };
  });
  expect(metrics.top).toBeGreaterThanOrEqual(7);
  expect(metrics.bottom).toBe(8);
  expect(metrics.scroll).toBeGreaterThan(0);
  expect(metrics.noticeScroll).toBe(0);
  const close = notice.getByRole("button", { name: "닫기" });
  const position = () => close.evaluate((element) => {
    const button = element.getBoundingClientRect(), surface = element.closest(".ks-notice")!.getBoundingClientRect();
    return { buttonTop: button.top, buttonBottom: button.bottom, surfaceTop: surface.top, surfaceBottom: surface.bottom };
  });
  const atTop = await position();
  expect(atTop.buttonTop).toBeGreaterThanOrEqual(atTop.surfaceTop);
  expect(atTop.buttonBottom).toBeLessThanOrEqual(atTop.surfaceBottom);
  const output = process.env.KS_NOTICE_CAPTURE_DIR;
  if (output) { mkdirSync(output, { recursive: true }); await app.screenshot({ path: join(output, "alert-long-top-360x240.png") }); }
  const message = notice.locator(".ks-notice-message");
  await message.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  expect(await message.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  const atBottom = await position();
  if (output) { mkdirSync(output, { recursive: true }); await app.screenshot({ path: join(output, "alert-long-360x240.png") }); }
  console.log(JSON.stringify({ atTop, atBottom }));
  expect(atBottom.buttonBottom).toBeLessThanOrEqual(atBottom.surfaceBottom);
  expect(atBottom.buttonTop).toBeGreaterThanOrEqual(atBottom.surfaceTop);
  expect(atBottom.buttonTop).toBe(atTop.buttonTop);
  await close.click();
  await expect(notice).toHaveCount(0);
});

test("360 폭의 원천 실패 알림은 글과 다시 받기, 닫기를 함께 보인다", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 600 });
  await page.goto("/?preview=paging-test");
  await page.evaluate(() => document.querySelector('[data-testid="fake-files-panel"]')?.remove());
  const app = page.getByTestId("app-window-paging-test");
  await expect(app.getByRole("tab", { name: "목록", exact: true })).toBeVisible();
  const failSource = () => page.evaluate(() => (window as any).conversationHarness.emit({ event: "data.update", window_id: "paging-test-window", view: {
    sources: { list_items: { state: "failed", has_value: true, message: "원인: 서버 오류", id: "SOURCE_ERROR" } }, values: {},
  } }));
  await failSource();
  const notice = app.getByRole("alert");
  await expect(notice).toContainText("이전에 받은 내용을 보이고 있습니다.");
  const positions = await notice.evaluate((element) => {
    const rect = element.getBoundingClientRect(), text = element.querySelector(".ks-notice-message")!.getBoundingClientRect();
    const buttons = Array.from(element.querySelectorAll("button"), (button) => button.getBoundingClientRect().toJSON());
    return { notice: rect.toJSON(), text: text.toJSON(), buttons };
  });
  const output = process.env.KS_NOTICE_CAPTURE_DIR;
  if (output) { mkdirSync(output, { recursive: true }); await app.screenshot({ path: join(output, "source-error-360.png") }); }
  console.log(JSON.stringify(positions));
  expect(positions.buttons).toHaveLength(2);
  expect(positions.text.right).toBeLessThanOrEqual(positions.buttons[0].left);
  expect(positions.buttons[1].right).toBeLessThanOrEqual(positions.notice.right);
  await notice.getByRole("button", { name: "다시 받기" }).click();
  await expect(notice).toHaveCount(0);
  await failSource();
  await expect(notice).toBeVisible();
  await notice.getByRole("button", { name: "닫기" }).click();
  await expect(notice).toHaveCount(0);
});

test("오류 알림 그림자가 알림 바깥에 그려진다", async ({ page }) => {
  await page.setViewportSize({ width: 880, height: 600 });
  await page.goto("/?preview=notice-fixture");
  await page.getByTestId("fake-files-panel").evaluate((element) => element.remove());
  const app = page.getByTestId("app-window-notice-fixture");
  await expect(app.getByRole("button", { name: "시작 단추" })).toBeVisible();
  await page.evaluate(() => (window as any).noticeFixture.alert());
  const notice = app.getByRole("alert");
  const box = (await notice.boundingBox())!;
  const withShadow = await page.screenshot();
  await notice.evaluate((element) => { element.style.boxShadow = "none"; });
  const withoutShadow = await page.screenshot();
  const different = await page.evaluate(async ({ a, b, box }) => {
    const load = (src: string) => new Promise<HTMLImageElement>((resolve) => { const image = new Image(); image.onload = () => resolve(image); image.src = `data:image/png;base64,${src}`; });
    const [first, second] = await Promise.all([load(a), load(b)]);
    const pixels = (image: HTMLImageElement) => { const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height; const context = canvas.getContext("2d")!; context.drawImage(image, 0, 0); return context.getImageData(0, 0, image.width, image.height).data; };
    const x1 = pixels(first), x2 = pixels(second); let count = 0;
    for (let y = Math.max(0, Math.floor(box.y) - 12); y < Math.floor(box.y); y++) for (let x = Math.ceil(box.x + 12); x < Math.floor(box.x + box.width - 12); x++) {
      const i = (y * first.width + x) * 4;
      if (Math.max(Math.abs(x1[i] - x2[i]), Math.abs(x1[i + 1] - x2[i + 1]), Math.abs(x1[i + 2] - x2[i + 2])) > 1) count++;
    }
    return count;
  }, { a: withShadow.toString("base64"), b: withoutShadow.toString("base64"), box });
  expect(different).toBeGreaterThan(0);
});

test("정보 알림은 몸통 높이를 유지하고 시간이 지나면 사라진다", async ({ page }) => {
  await page.setViewportSize({ width: 880, height: 600 });
  await page.goto("/?preview=client-chat-test");
  const app = page.getByTestId("app-window-client-chat");
  await expect(app.locator(".ks-agent-chat-history")).toBeVisible();
  const body = app.locator(".ks-data-window-body");
  const before = await body.boundingBox();
  await page.evaluate(() => window.clientChatHarness.control("chat-test-notice"));
  const notice = app.getByRole("status").filter({ hasText: "저장했습니다" });
  await expect(notice).toBeVisible();
  const after = await body.boundingBox();
  expect(after!.height).toBe(before!.height);
  expect(await notice.getAttribute("data-ks-overlay")).toBeNull();
  expect(await notice.locator("..").getAttribute("data-ks-overlay")).not.toBeNull();
  expect(await page.evaluate(() => window.clientChatHarness.visibleText())).toContain("저장했습니다");
  const output = process.env.KS_NOTICE_CAPTURE_DIR;
  if (output) { mkdirSync(output, { recursive: true }); await app.screenshot({ path: join(output, "status-wide.png") }); }
  await expect(notice).toHaveCount(0, { timeout: 8000 });
  expect(await page.evaluate(() => window.clientChatHarness.visibleText())).not.toContain("저장했습니다");
});

test("최소 창에서도 정보 알림이 본문 높이를 유지하고 자동으로 사라진다", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 600 });
  await page.goto("/?preview=client-chat-test");
  const app = page.getByTestId("app-window-client-chat");
  await expect(app.locator(".ks-agent-chat-history")).toBeVisible();
  const body = app.locator(".ks-data-window-body");
  const before = await body.boundingBox();
  await page.evaluate(() => window.clientChatHarness.control("chat-test-notice"));
  const notice = app.getByRole("status").filter({ hasText: "저장했습니다" });
  await expect(notice).toBeVisible();
  expect((await body.boundingBox())!.height).toBe(before!.height);
  const output = process.env.KS_NOTICE_CAPTURE_DIR;
  if (output) { mkdirSync(output, { recursive: true }); await app.screenshot({ path: join(output, "status-narrow.png") }); }
  await expect(notice.getByRole("button")).toHaveCount(0);
  await expect(notice).toHaveCount(0, { timeout: 8000 });
});

for (const width of [1000, 360]) test(`${width} 폭에서 떠 있는 알림 아래 도구 단추를 누르고 자동 소멸한다`, async ({ page }) => {
  await page.setViewportSize({ width, height: 600 });
  await page.goto("/?preview=notice-fixture");
  const app = page.getByTestId("app-window-notice-fixture");
  const target = app.getByRole("button", { name: width === 360 ? "시작 단추" : "끝 단추 하나" });
  await expect(target).toBeVisible();
  await page.evaluate(() => (window as unknown as { noticeFixture: { show(): void } }).noticeFixture.show());
  const notice = app.getByRole("status").filter({ hasText: "저장했습니다" });
  await expect(notice).toBeVisible();
  const geometry = await target.evaluate((el) => {
    const button = el.getBoundingClientRect();
    const notice = el.closest(".ks-data-window")!.querySelector('.ks-window-status [role="status"]')!.getBoundingClientRect();
    const x = button.left + button.width / 2, y = button.top + button.height / 2;
    return { button: button.toJSON(), notice: notice.toJSON(), overlap: x > notice.left && x < notice.right && y > notice.top && y < notice.bottom };
  });
  const output = process.env.KS_NOTICE_CAPTURE_DIR;
  if (output) { mkdirSync(output, { recursive: true }); await app.screenshot({ path: join(output, `notice-click-${width}.png`) }); }
  const placement = await notice.evaluate(el => {
    const n = el.getBoundingClientRect(), w = el.closest('.ks-data-window')!.getBoundingClientRect();
    return { center: Math.abs((n.left + n.right - w.left - w.right) / 2), bottom: w.bottom - n.bottom };
  });
  expect(placement.center).toBeLessThanOrEqual(1);
  expect(placement.bottom).toBeLessThan(30);
  await expect(notice.getByRole("button")).toHaveCount(0);
  await target.click({ timeout: 1500 });
  await expect(app.getByText(width === 360 ? "시작 누름" : "끝 누름")).toBeVisible();
  await expect(notice).toBeVisible();
  // 모든 알림 표면이 클릭을 아래로 전달해야 한다.
  expect(await notice.evaluate(el => getComputedStyle(el).pointerEvents)).toBe("none");
  await expect(notice).toHaveCount(0, { timeout: 8000 });
});

 test("본문의 표 머리와 붙는 머리는 창 알림 위로 새지 않는다", async ({ page }) => {
  await page.goto("/?preview=notice-fixture");
  await page.getByTestId("fake-files-panel").evaluate(e => e.remove());
  const app = page.getByTestId("app-window-notice-fixture");
  await expect(app.getByRole("button", { name: "시작 단추" })).toBeVisible();
  await app.evaluate(e => {
    e.style.width = "360px"; e.style.height = "240px";
    const body = e.querySelector<HTMLElement>(".ks-data-window-body")!;
    const header = document.createElement("div"); header.className = "ks-table-header";
    header.style.cssText = "position:absolute;inset:0"; header.textContent = "이름 상태";
    body.append(header);
  });
  await page.evaluate(() => (window as any).noticeFixture.alert());
  const n = app.getByRole("alert");
  const bad = await n.evaluate(e => {
    const r = e.getBoundingClientRect(); let bad = 0;
    for (let y = r.top + 3; y < r.bottom - 3; y += 5) for (let x = r.left + 3; x < r.right - 3; x += 5) if (!e.contains(document.elementFromPoint(x, y))) bad++;
    return bad;
  });
  expect(bad).toBe(0);
 });

 test("키보드로 알림을 닫고 Enter를 다시 눌러도 본문 동작이 실행되지 않는다", async ({ page }) => {
  await page.goto("/?preview=notice-fixture");
  const app = page.getByTestId("app-window-notice-fixture");
  await expect(app.getByRole("button", { name: "시작 단추" })).toBeVisible();
  await page.evaluate(() => (window as any).noticeFixture.alert());
  await app.getByRole("button", { name: "닫기", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(app.getByRole("alert")).toHaveCount(0);
  // 초점 복구는 창 초점 코드가 맡는다. 알림 자리에 초점이 남거나 몸통 동작 단추로 가지 않는다.
  await expect(app.getByRole("button", { name: "시작 단추" })).not.toBeFocused();
  await page.keyboard.press("Enter");
  await expect(app.getByText("시작 누름", { exact: true })).toHaveCount(0);
 });

 test("행 오류가 있는 표는 낮은 채움 칸에도 정상 행을 남기고 부모를 넘치지 않는다", async ({ page }) => {
  await page.goto("/?preview=paging-test");
  await page.evaluate(() => document.querySelector('[data-testid="fake-files-panel"]')?.remove());
  const app = page.getByTestId("app-window-paging-test");
  await app.getByRole("tab", { name: "표", exact: true }).click();
  await expect(app.getByRole("table")).toBeVisible();
  await page.evaluate(() => (window as any).conversationHarness.emit({ event: "data.update", window_id: "paging-test-window", view: { sources: {}, values: { "/ui/tabs/1/child/children/1/rows": { status: "ready", value: [{ name: "빠진 키" }, ...Array.from({ length: 40 }, (_, i) => ({ key: String(i), name: `정상 ${i}` }))] } } } }));
  await expect(app.getByRole("alert")).toBeVisible();
  await app.evaluate(e => { e.style.width = "360px"; e.style.height = "240px"; });
  const metrics = await app.getByRole("table").evaluate(e => {
    const parent = e.parentElement!, r = e.getBoundingClientRect();
    const row = e.querySelector('[data-row-key]')!.getBoundingClientRect();
    return { overflow: parent.scrollHeight - parent.clientHeight, visibleRow: Math.min(row.bottom, r.bottom) - Math.max(row.top, r.top) };
  });
  expect(metrics.overflow).toBeLessThanOrEqual(1);
  expect(metrics.visibleRow).toBeGreaterThan(10);
 });


for (const layout of ["section", "middle", "other-fill"]) test(`비채움 ${layout}의 표 경고는 정상 행을 접지 않는다`, async ({ page }) => {
  await page.goto(`/?preview=data-views-test&warning-layout=${layout}`);
  const app = page.getByTestId("app-window-data-views-test");
  await expect(app.getByRole("alert")).toBeVisible();
  for (const [width,height] of [[880,600],[360,180]]) {
    await app.evaluate((e,[w,h]) => {e.style.width=`${w}px`;e.style.height=`${h}px`;},[width,height]);
    await expect.poll(() => app.getByRole("table").evaluate(e=>e.getBoundingClientRect().height)).toBeGreaterThan(0);
    await app.getByRole("table").evaluate(e=>{e.scrollTop=e.scrollHeight;});
    await app.getByRole("table").getByText("행 40", {exact:true}).scrollIntoViewIfNeeded();
    await expect(app.getByRole("table").getByText("행 40",{exact:true})).toBeInViewport();
  }
});

test("높은 표 경고는 문구와 코드를 모두 보이고 낮은 창에만 한 줄을 쓴다", async ({ page }) => {
  await page.goto("/?preview=data-views-test&warning-layout=root");
  const app = page.getByTestId("app-window-data-views-test");
  await expect(app.getByRole("alert")).toBeVisible();
  await app.evaluate(e=>{e.style.width="360px";e.style.height="600px";});
  const metrics = await app.getByRole("alert").evaluate(e=>{
    const m=e.querySelector(".ks-notice-message")!,b=e.closest(".ks-data-window")!.querySelector(".ks-data-window-body")!;
    return {client:m.clientHeight,scroll:m.scrollHeight,top:e.getBoundingClientRect().top-b.getBoundingClientRect().top};
  });
  expect(metrics.client).toBe(metrics.scroll);
  expect(metrics.top).toBe(8);
  await app.evaluate(e=>{e.style.height="180px";});
  expect(await app.getByRole("alert").evaluate(e=>e.getBoundingClientRect().top-e.closest(".ks-data-window")!.querySelector(".ks-data-window-body")!.getBoundingClientRect().top)).toBe(8);
});

test('낮은 쌓인 칸 첫 표의 경고도 몸통 위 여백을 둔다', async ({ page }) => {
  await page.goto('/?preview=data-views-test&warning-layout=other-fill');
  const app = page.getByTestId('app-window-data-views-test');
  await app.evaluate(e => { e.style.width='360px'; e.style.height='240px'; });
  await expect(app.getByRole('alert')).toBeVisible();
  expect(await app.getByRole('alert').evaluate(e => e.getBoundingClientRect().top-e.closest('.ks-data-window')!.querySelector('.ks-data-window-body')!.getBoundingClientRect().top)).toBe(8);
});
