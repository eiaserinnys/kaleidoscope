import { expect, test } from "@playwright/test";

test.use({ deviceScaleFactor: 2 });

test("호스트 사이는 호스트와 그 경로 사이보다 넓다", async ({ page }) => {
  await page.goto("/installation-consent.html");
  await page.evaluate(async () => {
    await (window as any).installationHarness.ready;
    (window as any).installationHarness.show("light", { permissions: [
      { module: "http", id: "first", label: "자료", base_url: "https://first.example.org", paths: ["/articles", "/images"] },
      { module: "http", id: "second", label: "그림", base_url: "https://second.example.org", paths: ["/pictures"] },
    ] });
  });
  const details = page.getByRole("dialog").locator("details");
  await details.locator("summary").click();
  const gaps = await details.evaluate((node) => {
    const values = Array.from(node.querySelectorAll(".ks-consent-value"));
    const first = values.find((el) => el.textContent === "first.example.org")!;
    const second = values.find((el) => el.textContent === "second.example.org")!;
    const paths = first.nextElementSibling!.querySelectorAll("li");
    return {
      inside: paths[0].getBoundingClientRect().top - first.getBoundingClientRect().bottom,
      between: second.getBoundingClientRect().top - paths[paths.length - 1].getBoundingClientRect().bottom,
    };
  });
  expect(gaps.between).toBeGreaterThan(gaps.inside);
});

test("설치 전 권한의 실제 조작과 화면", async ({ page }) => {
  for (const [width, theme] of [[1000, "light"], [360, "dark"], [1000, "dark"], [360, "light"]] as const) {
    await page.setViewportSize({ width, height: 780 });
    await page.emulateMedia({ colorScheme: theme });
    await page.goto(`/installation-consent.html?link=${theme === "light" ? "embedded" : "remote"}`);
    await page.evaluate(async () => { await (window as any).installationHarness.ready; (window as any).installationHarness.show("heavy"); });
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "취소" })).toBeFocused();
    await expect(dialog).toContainText("apps.example.org");
    await expect(dialog).toContainText("이 PC에서 프로그램을 실행합니다");
    await expect(dialog).toContainText(theme === "light" ? "이 PC에서 앱의 Python 코드를 실행합니다" : "server.example.org 서버에서 앱의 Python 코드를 실행합니다");
    await expect(dialog).toContainText("인터넷에서 자료를 받아옵니다");
    await expect(dialog).toContainText("archive.example.org");
    await expect(dialog).toContainText("1시간마다 스스로 실행됩니다");
    for (const hidden of ["settings", "research-client", "archive-token", "threads", "입력:", "출력:", "창 상태:"]) await expect(dialog).not.toContainText(hidden);
    const details = dialog.locator("details").filter({ hasText: "자세히" });
    await expect(details).not.toHaveAttribute("open", "");
    await expect(details.locator(".ks-install-paths")).toBeHidden();
    const alignment = await dialog.evaluate((node) => {
      const title = node.querySelector(".ks-dialog-title")!.getBoundingClientRect();
      const body = node.querySelector(".ks-dialog-body")!.getBoundingClientRect();
      const scroll = node.querySelector(".ks-dialog-scroll")!;
      return { titleLeft: title.left, bodyLeft: body.left, scrollWidth: scroll.scrollWidth, clientWidth: scroll.clientWidth };
    });
    console.log(`installation-${width}-${theme}: ${JSON.stringify(alignment)}`);
    expect(Math.abs(alignment.titleLeft - alignment.bodyLeft)).toBeLessThanOrEqual(1);
    expect(alignment.scrollWidth).toBeLessThanOrEqual(alignment.clientWidth);
    expect(await dialog.getByText("자료 수집", { exact: true }).evaluate((node) => getComputedStyle(node).userSelect)).toBe("text");
    const sentence = dialog.getByText("인터넷에서 자료를 받아옵니다", { exact: true });
    const target = dialog.getByText("archive.example.org", { exact: true });
    expect(await sentence.evaluate((node) => getComputedStyle(node).userSelect)).toBe("none");
    expect(await target.evaluate((node) => getComputedStyle(node).userSelect)).toBe("text");
    await sentence.scrollIntoViewIfNeeded();
    await page.evaluate(() => getSelection()?.removeAllRanges());
    await sentence.dblclick();
    expect(await page.evaluate(() => getSelection()?.toString())).toBe("");
    await target.dblclick();
    expect(await page.evaluate(() => getSelection()?.toString())).toMatch(/archive|example|org/);
    await details.locator("summary").click();
    await expect(details.locator(".ks-install-paths")).toBeVisible();
    await expect(details.locator(".ks-install-path").first()).toHaveText("/articles");
    expect(await details.locator(".ks-install-path").first().evaluate((node) => getComputedStyle(node).userSelect)).toBe("text");
    await details.locator("summary").click();
    await dialog.getByText("코드 보기").click();
    await expect(dialog.getByText("def run(action, data):", { exact: false })).toBeVisible();
    await page.screenshot({ path: `test-results/installation-consent-details-${width}-${theme}.png` });
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
    await expect(page.getByRole("dialog")).toContainText("이 앱은 창 안에서만 동작합니다");
    await page.screenshot({ path: `test-results/installation-consent-light-${width}-${theme}.png` });
    await page.keyboard.press("Escape");
    expect(await page.evaluate(() => (window as any).installationHarness.answers[0].allow)).toBe(false);
  }
});

test("사이트와 상세 코드를 끌어 복사할 수 있다", async ({ page, context }) => {
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
        range.setStart(text, end ? text.length : 0); range.collapse(true);
        const rect = range.getBoundingClientRect();
        return { x: rect.x, y: rect.y + rect.height / 2 };
      };
      return [point(texts[0], false), point(texts[texts.length - 1], true)];
    });
    await page.mouse.move(start.x + 0.1, start.y); await page.mouse.down();
    await page.mouse.move(end.x - 0.1, end.y, { steps: 15 }); await page.mouse.up();
    await page.keyboard.press("Control+c");
    return page.evaluate(() => navigator.clipboard.readText());
  };
  const sentence = dialog.getByText("인터넷에서 자료를 받아옵니다", { exact: true });
  await sentence.scrollIntoViewIfNeeded();
  await page.evaluate(() => getSelection()?.removeAllRanges());
  const rect = (await sentence.boundingBox())!;
  await page.mouse.move(rect.x + 1, rect.y + rect.height / 2); await page.mouse.down();
  await page.mouse.move(rect.x + rect.width - 1, rect.y + rect.height / 2, { steps: 8 }); await page.mouse.up();
  expect(await page.evaluate(() => getSelection()?.toString())).toBe("");
  expect(await copy(dialog.getByText("archive.example.org", { exact: true }))).toBe("archive.example.org");
  await dialog.getByText("자세히", { exact: true }).click();
  expect(await copy(dialog.locator("details[open] .ks-install-path").last())).toBe("/public/long-path-for-research-materials");
  await dialog.getByText("자세히", { exact: true }).click();
  await dialog.getByText("코드 보기", { exact: true }).click();
  expect(await copy(dialog.locator("details[open] pre"))).toBe("def run(action, data):\n    return {'status': 'ready'}");
});

test("긴 사이트 이름과 프로그램도 좁은 창에서 잘리지 않는다", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto("/installation-consent.html");
  const host = `${"long".repeat(14)}.example.org`;
  const command = `${"long-program-name-".repeat(8)}tool`;
  await page.evaluate(async ({ host, command }) => {
    await (window as any).installationHarness.ready;
    (window as any).installationHarness.show("light", { permissions: [
      { module: "http", id: "web", label: "자료", base_url: `https://${host}`, paths: ["/path"] },
      { module: "process", id: "run", label: "변환", command },
    ] });
  }, { host, command });
  const dialog = page.getByRole("dialog");
  const sizes = await dialog.evaluate((node) => {
    const scroll = node.querySelector(".ks-dialog-scroll")!;
    const body = node.querySelector(".ks-dialog-body")!.getBoundingClientRect();
    const targets = Array.from(node.querySelectorAll(".ks-install-rows .ks-consent-value"), (item) => item.getBoundingClientRect());
    return { scrollWidth: scroll.scrollWidth, clientWidth: scroll.clientWidth, bodyLeft: body.left, bodyRight: body.right, targets: targets.map(({ left, right }) => ({ left, right })) };
  });
  expect(sizes.scrollWidth).toBeLessThanOrEqual(sizes.clientWidth);
  expect(sizes.targets).toHaveLength(2);
  for (const target of sizes.targets) {
    expect(target.left).toBeGreaterThanOrEqual(sizes.bodyLeft);
    expect(target.right).toBeLessThanOrEqual(sizes.bodyRight);
  }
  await expect(dialog.getByText(command, { exact: true })).toBeVisible();
  await expect(dialog.getByText(host, { exact: true })).toBeVisible();
});

test("경고와 일반 권한의 내용이 한 선에 맞는다", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 780 });
  await page.goto("/installation-consent.html?link=embedded");
  await page.evaluate(async () => { await (window as any).installationHarness.ready; (window as any).installationHarness.show("heavy"); });
  const positions = await page.getByRole("dialog").evaluate((node) => {
    const groups = node.querySelectorAll(".ks-install-group");
    const x = (element: Element | null) => element!.getBoundingClientRect().left;
    return {
      processText: x(groups[0].querySelector(".ks-install-sentence > span")),
      processRow: x(groups[0].querySelector(".ks-install-rows li")),
      processNote: x(groups[0].querySelector(".ks-install-content > .ks-install-meta")),
      workerText: x(groups[1].querySelector(".ks-install-sentence > span")),
      workerNote: x(groups[1].querySelector(".ks-install-content > .ks-install-meta")),
      workerSummary: x(groups[1].querySelector("summary")),
      normalRow: x(groups[2].querySelector(".ks-install-rows li")),
    };
  });
  console.log("installation-alignment:", JSON.stringify(positions));
  expect(Math.max(...Object.values(positions)) - Math.min(...Object.values(positions))).toBeLessThanOrEqual(1);
});

test("설치 동의 창은 창 중앙에 놓이고 열두 경로를 펼치고 접을 수 있다", async ({ page }) => {
  for (const width of [1000, 360]) {
    await page.setViewportSize({ width, height: 780 });
    await page.goto("/installation-consent.html");
    await page.evaluate(async () => {
      await (window as any).installationHarness.ready;
      (window as any).installationHarness.show("light", { permissions: [
        { module: "files", id: "docs", label: "고칠 그림", access: "read", scope: "folder" },
        { module: "http", id: "web", label: "글자 읽기 언어 자료", base_url: "https://cdn.jsdelivr.net", paths: Array.from({ length: 12 }, (_, i) => `/자료/경로-${i}`) },
      ] });
    });
    const dialog = page.getByRole("dialog");
    const details = dialog.locator("details");
    const summary = details.locator("summary");
    const centers = () => dialog.evaluate((node) => {
      const overlay = node.closest(".ks-window-consent-overlay") as HTMLElement;
      const box = overlay.getBoundingClientRect();
      const style = getComputedStyle(overlay);
      const px = (value: string) => Number.parseFloat(value);
      const contentCenterX = (box.left + px(style.paddingLeft) + box.right - px(style.paddingRight)) / 2;
      const contentCenterY = (box.top + px(style.paddingTop) + box.bottom - px(style.paddingBottom)) / 2;
      const rect = node.getBoundingClientRect();
      const dialogCenterX = (rect.left + rect.right) / 2;
      const dialogCenterY = (rect.top + rect.bottom) / 2;
      return { contentCenterX, contentCenterY, dialogCenterX, dialogCenterY };
    });
    const before = await centers();
    const beforeDiff = { x: Math.abs(before.dialogCenterX - before.contentCenterX), y: Math.abs(before.dialogCenterY - before.contentCenterY) };
    console.log(`installation-consent-center-${width}:`, JSON.stringify({ state: "closed", ...before, diff: beforeDiff }));
    expect(beforeDiff.x).toBeLessThanOrEqual(1);
    expect(beforeDiff.y).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `test-results/installation-consent-omni-image-${width}-light.png` });
    await summary.click();
    await expect(details).toHaveAttribute("open", "");
    await expect(details.locator(".ks-install-path")).toHaveCount(12);
    await expect(details.locator(".ks-install-paths")).not.toContainText("https://");
    const after = await centers();
    const afterDiff = { x: Math.abs(after.dialogCenterX - after.contentCenterX), y: Math.abs(after.dialogCenterY - after.contentCenterY) };
    console.log(`installation-consent-center-${width}:`, JSON.stringify({ state: "open", ...after, diff: afterDiff }));
    expect(afterDiff.x).toBeLessThanOrEqual(1);
    expect(afterDiff.y).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `test-results/installation-consent-omni-image-open-${width}-light.png` });
    await summary.click();
    await expect(details).not.toHaveAttribute("open", "");
  }
});
