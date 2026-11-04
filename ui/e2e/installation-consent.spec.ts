import { expect, test } from "@playwright/test";
import { writeFileSync } from "node:fs";

test.use({ deviceScaleFactor: 2 });

test("설치 전 권한의 실제 조작과 화면", async ({ page }) => {
  for (const [width, theme] of [[1000, "light"], [360, "dark"], [1000, "dark"], [360, "light"]] as const) {
    await page.setViewportSize({ width, height: 780 });
    await page.emulateMedia({ colorScheme: theme });
    await page.goto(`/installation-consent.html?link=${theme === "light" ? "embedded" : "remote"}`);
    await page.evaluate(async () => { await (window as any).installationHarness.ready; (window as any).installationHarness.show("heavy"); });
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "취소" })).toBeFocused();
    await expect(dialog).toContainText("https://apps.example.org/store");
    await expect(dialog).toContainText("서버 실행 코드");
    await expect(dialog.getByText("프로그램 실행", { exact: true })).toBeVisible();
    await expect(dialog).toContainText(theme === "light" ? "이 PC의 내장 서버에서 Python 코드를 실행합니다." : "server.example.org 서버에서 Python 코드를 실행합니다.");
    await expect(dialog).toContainText("기준 주소: https://archive.example.org");
    await expect(dialog).toContainText("허용 경로: /articles, /images");
    await expect(dialog).toContainText("모음: threads");
    await expect(dialog).toContainText("research/ 아래, 창별, 파일당 512 MiB");
    await expect(dialog).toContainText("research-client 1판");
    await expect(dialog).toContainText("1시간마다, settings로 켜고 끔");
    await expect(dialog).toContainText("archive-token (자료 연결 토큰)");
    await expect(dialog).not.toContainText("입력:");
    await expect(dialog).not.toContainText("출력:");
    await expect(dialog).not.toContainText("창 상태:");
    const alignment = await dialog.evaluate((node) => {
      const title = node.querySelector(".ks-dialog-title")!.getBoundingClientRect();
      const body = node.querySelector(".ks-dialog-body")!.getBoundingClientRect();
      const scroll = node.querySelector(".ks-dialog-scroll")!;
      const warning = node.querySelector<HTMLElement>(".ks-install-warning")!;
      const rect = warning.getBoundingClientRect();
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d")!;
      context.fillStyle = getComputedStyle(warning).color;
      context.fillRect(0, 0, 1, 1);
      const colorRgb = Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3);
      return { titleLeft: title.left, bodyLeft: body.left, scrollWidth: scroll.scrollWidth, clientWidth: scroll.clientWidth,
        color: getComputedStyle(warning).color, colorRgb, backgroundSample: { x: Math.floor(rect.left - 3), y: Math.floor(rect.top + rect.height / 2) } };
    });
    console.log(`installation-${width}-${theme}: ${JSON.stringify(alignment)}`);
    expect(Math.abs(alignment.titleLeft - alignment.bodyLeft)).toBeLessThanOrEqual(1);
    expect(alignment.scrollWidth).toBeLessThanOrEqual(alignment.clientWidth);
    expect(await dialog.getByText("자료 수집", { exact: true }).evaluate((node) => getComputedStyle(node).userSelect)).toBe("text");
    await page.screenshot({ path: `test-results/installation-consent-heavy-${width}-${theme}.png` });
    const scroll = dialog.locator(".ks-dialog-scroll");
    expect(await scroll.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
    const storage = dialog.locator("section").filter({ hasText: "자료 수집 설정" }).first();
    const fixedLabel = storage.locator(".ks-consent-label").first();
    const value = storage.getByText("자료 수집 설정", { exact: true });
    await fixedLabel.scrollIntoViewIfNeeded();
    await page.evaluate(() => getSelection()?.removeAllRanges());
    await fixedLabel.dblclick();
    expect(await page.evaluate(() => getSelection()?.toString())).toBe("");
    await value.dblclick();
    expect(await page.evaluate(() => getSelection()?.toString())).toMatch(/자료|수집|설정/);
    await page.evaluate(() => getSelection()?.removeAllRanges());
    const drag = async (locator: typeof value) => {
      const rect = await locator.boundingBox();
      if (!rect) throw new Error("선택 대상이 보이지 않습니다.");
      await page.mouse.move(rect.x + 1, rect.y + rect.height / 2);
      await page.mouse.down();
      await page.mouse.move(rect.x + rect.width - 1, rect.y + rect.height / 2, { steps: 8 });
      await page.mouse.up();
      return page.evaluate(() => getSelection()?.toString() ?? "");
    };
    expect(await drag(fixedLabel)).toBe("");
    expect(await drag(value)).toContain("자료 수집");
    await storage.getByText("기본값과 스키마").click();
    const spacing = await storage.locator("details").evaluate((details) => {
      const summary = details.querySelector("summary")!.getBoundingClientRect();
      const pre = details.querySelector("pre")!.getBoundingClientRect();
      const next = details.closest("section")!.nextElementSibling!.getBoundingClientRect();
      return { above: pre.top - summary.bottom, below: next.top - pre.bottom };
    });
    expect(spacing.above).toBe(4);
    expect(spacing.below).toBe(8);
    writeFileSync(`test-results/installation-consent-metrics-${width}-${theme}.json`, JSON.stringify({ alignment, spacing }));
    await page.screenshot({ path: `test-results/installation-consent-storage-${width}-${theme}.png` });
    await storage.getByText("기본값과 스키마").click();
    await dialog.getByText("코드 보기").click();
    await expect(dialog.getByText("def run(action, data):", { exact: false })).toBeVisible();
    await page.screenshot({ path: `test-results/installation-consent-details-${width}-${theme}.png` });
    const template = dialog.locator("details").filter({ hasText: "제목 양식" });
    await template.locator("summary").click();
    const templateCode = template.locator("pre.ks-process-command");
    await templateCode.scrollIntoViewIfNeeded();
    await expect(templateCode).toBeVisible();
    await expect(templateCode).toContainText("자료 정리");
    for (const label of ["처음 지시", "지시"]) await dialog.getByText(label, { exact: true }).click();
    const gaps = await template.evaluate((node) => {
      const result = [];
      for (let item: Element | null = node; item?.tagName === "DETAILS"; item = item.nextElementSibling) {
        const pre = item.querySelector("pre")!.getBoundingClientRect();
        const summary = item.querySelector("summary")!.getBoundingClientRect();
        result.push({ inside: pre.top - summary.bottom, after: item.nextElementSibling!.getBoundingClientRect().top - pre.bottom });
      }
      return result;
    });
    expect(gaps).toEqual(Array.from({ length: 3 }, () => ({ inside: 4, after: 8 })));
    await page.screenshot({ path: `test-results/installation-consent-template-${width}-${theme}.png` });
  }
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "허용하고 설치" }).evaluate((button: HTMLButtonElement) => button.click());
  expect(await page.evaluate(() => (window as any).installationHarness.answers)).toEqual([]);
  await dialog.getByRole("button", { name: "허용하고 설치" }).click();
  expect(await page.evaluate(() => (window as any).installationHarness.answers)).toEqual([
    { op: "app.respond_install_permission", window_id: "editor-window", request_id: "heavy", digest: "sha256-test-digest", allow: true },
  ]);

  for (const [width, theme] of [[1000, "light"], [360, "dark"], [1000, "dark"], [360, "light"]] as const) {
    await page.setViewportSize({ width, height: 780 });
    await page.emulateMedia({ colorScheme: theme });
    await page.goto("/installation-consent.html");
    await page.evaluate(async () => { await (window as any).installationHarness.ready; (window as any).installationHarness.show("light"); });
    await expect(page.getByRole("dialog")).toContainText("선언된 권한이 없습니다");
    await page.screenshot({ path: `test-results/installation-consent-light-${width}-${theme}.png` });
    await page.keyboard.press("Escape");
    expect(await page.evaluate(() => (window as any).installationHarness.answers[0].allow)).toBe(false);
  }
});


test("값 전체를 끌어 복사해도 구분자와 줄바꿈이 유지되고 이름표는 선택되지 않는다", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 1000, height: 780 });
  await page.goto("/installation-consent.html");
  await page.evaluate(async () => { await (window as any).installationHarness.ready; (window as any).installationHarness.show("heavy"); });
  const dialog = page.getByRole("dialog");
  const copy = async (locator: ReturnType<typeof page.locator>) => {
    await locator.scrollIntoViewIfNeeded();
    await page.evaluate(() => getSelection()?.removeAllRanges());
    const [start, end] = await locator.evaluate((node) => {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      const texts: Text[] = [];
      while (walker.nextNode()) if (walker.currentNode.textContent?.length) texts.push(walker.currentNode as Text);
      const point = (text: Text, end: boolean) => {
        const range = document.createRange();
        range.setStart(text, end ? text.length : 0);
        range.collapse(true);
        const rect = range.getBoundingClientRect();
        return { x: rect.x, y: rect.y + rect.height / 2 };
      };
      return [point(texts[0], false), point(texts[texts.length - 1], true)];
    });
    await page.mouse.move(start.x + 0.1, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x - 0.1, end.y, { steps: 15 });
    await page.mouse.up();
    await page.keyboard.press("Control+c");
    return page.evaluate(() => navigator.clipboard.readText());
  };
  expect(await copy(dialog.locator(".ks-dialog-body > div").first())).toBe("자료 수집 · 3판\nhttps://apps.example.org/store");
  const field = (name: string) => dialog.locator(".ks-consent-label").filter({ hasText: name }).locator("..").locator(":scope > .ks-consent-value");
  expect(await copy(field("허용 경로"))).toBe("/articles, /images, /public/long-path-for-research-materials");
  expect(await copy(field("기기 저장"))).toBe("research/ 아래, 창별, 파일당 512 MiB");
  await dialog.getByText("코드 보기", { exact: true }).click();
  expect(await copy(dialog.locator("details[open] pre"))).toBe("def run(action, data):\n    return {'status': 'ready'}");
  await dialog.getByRole("button", { name: "취소" }).click();
  await page.evaluate(() => (window as any).installationHarness.show("heavy", { storage: { entries: [{
    id: "options", key: "options", kind: "json", label: "고르기 설정", presentation: "settings", default: "", schema: {}, choices: { expr: "$source.options" },
  }] } }));
  const nestedLabel = dialog.locator(".ks-consent-value .ks-consent-label");
  await nestedLabel.scrollIntoViewIfNeeded();
  await page.evaluate(() => getSelection()?.removeAllRanges());
  await nestedLabel.dblclick();
  expect(await page.evaluate(() => getSelection()?.toString())).toBe("");
  expect(await nestedLabel.evaluate((node) => getComputedStyle(node).userSelect)).toBe("none");
  await expect(field("선택지")).toHaveText("식: $source.options");
});
