import { expect, test, type Locator, type Page } from "@playwright/test";

// 블록 세트 60의 눈 확인용 시나리오. 확인 상자, 데이터 트리 바로 입력과 끌어 옮기기, 구역 머리 메뉴와
// 이름 바꾸기를 실제 브라우저에서 캡처하고, 확인 상자 크기·행 높이·머리 높이·정렬 좌표를 잰다.
const APP = "tree-edit-move-1112";
const ROW = (key: string) => `[data-tree-id="item:${key}"]`;
const HIDE_CHROME = `
  body { padding: 0; }
  .ks-harness { display: block; height: 100vh; }
  .ks-harness-header, .ks-harness-dev-panel { display: none; }
  .ks-harness-apps.is-preview { height: 100%; }
`;

type Box = { top: number; left: number; right: number; bottom: number; width: number; height: number };

async function open(page: Page, appId: string, width: number, height: number, theme: "light" | "dark" = "light") {
  await page.emulateMedia({ colorScheme: theme });
  await page.setViewportSize({ width, height });
  await page.goto(`/?preview=${appId}`);
  await page.addStyleTag({ content: HIDE_CHROME });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  return page.getByTestId(`app-window-${appId}`);
}

function box(locator: Locator): Promise<Box> {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
  });
}

function round(value: number) {
  return +value.toFixed(2);
}

async function capture(locator: Locator | Page, testInfo: { outputPath: (name: string) => string }, name: string) {
  await locator.screenshot({ path: testInfo.outputPath(name) });
}

// 끌기 표시는 브라우저의 실제 끌기 이벤트를 흉내 내 같은 자료 전달자를 이어 쓴다. 좌표를 직접 정해
// 위 1/4, 가운데, 아래 1/4, 행 없는 빈 자리를 각각 만든다.
type DragState = { source: string; dataTransfer: DataTransfer };

async function pageDragStart(page: Page, key: string) {
  await page.evaluate((key) => {
    const source = document.querySelector<HTMLElement>(`[data-tree-id="item:${key}"]`)!;
    const holder = window as unknown as { __ksDrag?: { source: string; dataTransfer: DataTransfer } };
    const dataTransfer = new DataTransfer();
    holder.__ksDrag = { source: key, dataTransfer };
    source.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer }));
  }, key);
}

async function pageDragOver(page: Page, target: string | null, ratio: number) {
  await page.evaluate(({ target, ratio }) => {
    const holder = window as unknown as { __ksDrag?: DragState };
    const dataTransfer = holder.__ksDrag!.dataTransfer;
    const element = target === null
      ? document.querySelector<HTMLElement>(".ks-data-tree")!
      : document.querySelector<HTMLElement>(`[data-tree-id="item:${target}"]`)!;
    const rect = element.getBoundingClientRect();
    const clientY = target === null ? rect.bottom - 2 : rect.top + rect.height * ratio;
    const clientX = rect.left + Math.min(20, rect.width / 2);
    element.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer, clientX, clientY }));
  }, { target, ratio });
}

async function pageDrop(page: Page, target: string | null, ratio: number) {
  await page.evaluate(({ target, ratio }) => {
    const holder = window as unknown as { __ksDrag?: DragState };
    const dataTransfer = holder.__ksDrag!.dataTransfer;
    const element = target === null
      ? document.querySelector<HTMLElement>(".ks-data-tree")!
      : document.querySelector<HTMLElement>(`[data-tree-id="item:${target}"]`)!;
    const rect = element.getBoundingClientRect();
    const clientY = target === null ? rect.bottom - 2 : rect.top + rect.height * ratio;
    const clientX = rect.left + Math.min(20, rect.width / 2);
    element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer, clientX, clientY }));
    delete holder.__ksDrag;
  }, { target, ratio });
}

async function pageDragEnd(page: Page) {
  await page.evaluate(() => {
    const holder = window as unknown as { __ksDrag?: DragState };
    const drag = holder.__ksDrag!;
    const source = document.querySelector<HTMLElement>(`[data-tree-id="item:${drag.source}"]`)!;
    source.dispatchEvent(new DragEvent("dragend", { bubbles: true, cancelable: true, dataTransfer: drag.dataTransfer }));
    delete holder.__ksDrag;
  });
}

async function openSectionMenu(page: Page, app: Locator) {
  await app.locator(".ks-data-section-title").click({ button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();
}

test("넓은 창 확인 상자: 크기·둥글기·세로 가운데·열 정렬 (밝음)", async ({ page }, testInfo) => {
  const app = await open(page, APP, 1182, 800, "light");
  const tree = app.locator(".ks-data-tree");
  await expect(tree).toBeVisible();

  const unchecked = app.locator(".ks-tree-check:not(.is-checked)");
  const checked = app.locator(".ks-tree-check.is-checked");
  await expect(unchecked).toHaveCount(3);
  await expect(checked).toHaveCount(1);

  const geometry = await tree.evaluate((root) => {
    const check = root.querySelector<HTMLElement>(".ks-tree-check:not(.is-checked)")!;
    const style = getComputedStyle(check);
    const checkedBox = root.querySelector<HTMLElement>(".ks-tree-check.is-checked")!;
    const svg = checkedBox.querySelector<SVGSVGElement>("svg");
    const rect = (element: Element) => {
      const value = element.getBoundingClientRect();
      return { left: value.left, top: value.top, width: value.width, height: value.height };
    };
    return {
      size: rect(check),
      radius: Number.parseFloat(style.borderRadius),
      checkedSvg: svg === null ? null : rect(svg),
      checkedSvgCount: checkedBox.querySelectorAll("svg").length,
      uncheckedSvgCount: check.querySelectorAll("svg").length,
    };
  });
  console.log(`확인 상자: ${JSON.stringify(geometry)}`);
  expect(geometry.size.width, "확인 상자 폭").toBeGreaterThan(13);
  expect(geometry.size.width, "확인 상자 폭").toBeLessThan(15);
  expect(Math.abs(geometry.size.width - geometry.size.height), "정사각형").toBeLessThanOrEqual(0.5);
  expect(geometry.radius, "둥근 사각형").toBeGreaterThanOrEqual(2.5);
  expect(geometry.radius, "둥근 사각형").toBeLessThanOrEqual(3.5);
  expect(geometry.uncheckedSvgCount, "빈 상자에는 체크가 없다").toBe(0);
  expect(geometry.checkedSvgCount, "확인된 상자에 체크가 있다").toBe(1);
  expect(geometry.checkedSvg!.width, "체크가 상자 안에 들어간다").toBeLessThanOrEqual(geometry.size.width);

  const alignment = await tree.evaluate((root) => {
    const rows = Array.from(root.querySelectorAll<HTMLElement>('[role="treeitem"]'));
    const rootRows = rows.filter((row) => row.getAttribute("aria-level") === "1");
    const centers = rootRows.map((row) => {
      const rowRect = row.getBoundingClientRect();
      const check = row.querySelector<HTMLElement>(".ks-tree-check");
      const name = row.querySelector<HTMLElement>(".ks-tree-name");
      const checkRect = check?.getBoundingClientRect();
      const nameRect = name?.getBoundingClientRect();
      return {
        name: name?.textContent,
        rowCenter: rowRect.top + rowRect.height / 2,
        checkLeft: checkRect?.left ?? null,
        checkCenter: checkRect === undefined ? null : checkRect.top + checkRect.height / 2,
        titleLeft: nameRect?.left ?? null,
      };
    });
    return centers;
  });
  console.log(`행 정렬: ${JSON.stringify(alignment)}`);
  const lefts = alignment.map((row) => row.checkLeft!);
  const titles = alignment.map((row) => row.titleLeft!);
  for (const value of lefts) expect(Math.abs(value - lefts[0]), "확인 상자 왼쪽 선").toBeLessThanOrEqual(1);
  for (const value of titles) expect(Math.abs(value - titles[0]), "제목 왼쪽 선").toBeLessThanOrEqual(1);
  for (const row of alignment) expect(Math.abs(row.checkCenter! - row.rowCenter), "세로 가운데").toBeLessThanOrEqual(1);

  await capture(app, testInfo, "넓은-확인상자-밝음.png");
});

test("넓은 창 확인 상자 (어두움)", async ({ page }, testInfo) => {
  const app = await open(page, APP, 1182, 800, "dark");
  await expect(app.locator(".ks-tree-check.is-checked")).toHaveCount(1);
  await capture(app, testInfo, "넓은-확인상자-어두움.png");
});

test("구역 머리 메뉴와 이름 바꾸기: 높이 유지, 초점 복귀, pending 제목 (밝음)", async ({ page }, testInfo) => {
  const app = await open(page, APP, 1182, 800, "light");
  const header = app.locator(".ks-data-section-header");
  const toggle = app.locator(".ks-data-section-toggle");
  await expect(header).toBeVisible();
  const before = await box(header);

  await openSectionMenu(page, app);
  await expect(page.getByRole("menuitem", { name: "구역 이름 바꾸기" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "할 일 이름 바꾸기" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "제목 복사" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("넓은-구역-메뉴-밝음.png") });

  await page.getByRole("menuitem", { name: "구역 이름 바꾸기" }).click();
  const input = app.getByRole("textbox", { name: "구역 이름" });
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("이번 주");
  const selection = await input.evaluate((element) => {
    const field = element as HTMLInputElement;
    return { start: field.selectionStart, end: field.selectionEnd, length: field.value.length };
  });
  expect(selection, "처음 값은 글 전체를 고른 채 연다").toEqual({ start: 0, end: 4, length: 4 });

  const during = await box(header);
  const toggleBox = await box(toggle);
  const inputBox = await box(input);
  console.log(`구역 머리 높이: ${JSON.stringify({ before: round(before.height), during: round(during.height) })}`);
  console.log(`구역 머리 폭: ${JSON.stringify({ toggle: round(toggleBox.width), input: round(inputBox.width) })}`);
  expect(Math.abs(before.height - during.height), "머리 높이는 편집 전후 같다").toBeLessThanOrEqual(1);
  expect(toggleBox.width, "편집 중 접기 단추는 화살표 폭").toBeLessThanOrEqual(32);
  expect(inputBox.width, "글칸이 남은 폭을 쓴다").toBeGreaterThan(toggleBox.width);
  await expect(toggle.locator("input")).toHaveCount(0);
  await expect(app.getByRole("button", { name: "+", exact: true })).toBeVisible();
  await capture(app, testInfo, "넓은-구역-이름-밝음.png");

  await input.press("Escape");
  await expect(input).toHaveCount(0);
  await expect(app.locator(".ks-data-section-title")).toHaveText("이번 주");
  await expect(toggle).toBeFocused();

  await openSectionMenu(page, app);
  await page.getByRole("menuitem", { name: "구역 이름 바꾸기" }).click();
  const second = app.getByRole("textbox", { name: "구역 이름" });
  await expect(second).toBeFocused();
  await second.fill("다음 주");
  await second.press("Enter");
  await expect(second).toHaveCount(0);
  await expect(app.locator(".ks-data-section-title")).toHaveText("다음 주");
  await expect(toggle).toBeFocused();
});

test("구역 이름 글칸 (어두움)", async ({ page }, testInfo) => {
  const app = await open(page, APP, 1182, 800, "dark");
  const header = app.locator(".ks-data-section-header");
  const before = await box(header);
  await openSectionMenu(page, app);
  await page.getByRole("menuitem", { name: "구역 이름 바꾸기" }).click();
  const input = app.getByRole("textbox", { name: "구역 이름" });
  await expect(input).toBeFocused();
  const during = await box(header);
  expect(Math.abs(before.height - during.height), "어두움에서도 머리 높이는 같다").toBeLessThanOrEqual(1);
  await capture(app, testInfo, "넓은-구역-이름-어두움.png");
});

test("트리 행 이름 바꾸기: 전체 고름, 행 높이, 취소와 확정", async ({ page }, testInfo) => {
  const app = await open(page, APP, 1182, 800, "light");
  const row = app.locator(ROW("a"));
  await expect(row).toBeVisible();
  const before = await box(row);

  await row.click({ button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();
  await page.getByRole("menuitem", { name: "이름 바꾸기" }).click();
  const input = app.getByRole("textbox", { name: "항목 이름" });
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("설계 정리");
  const selection = await input.evaluate((element) => {
    const field = element as HTMLInputElement;
    return { start: field.selectionStart, end: field.selectionEnd, length: field.value.length };
  });
  expect(selection, "이름은 글 전체를 고른 채 연다").toEqual({ start: 0, end: 5, length: 5 });

  const editRow = app.locator(".ks-file-tree-create-row");
  await expect(editRow).toBeVisible();
  const during = await box(editRow);
  console.log(`트리 행 높이: ${JSON.stringify({ before: round(before.height), during: round(during.height) })}`);
  expect(Math.abs(before.height - during.height), "이름 글칸 행 높이는 행 높이와 같다").toBeLessThanOrEqual(1);
  await capture(app, testInfo, "넓은-트리-이름-밝음.png");

  await input.press("Escape");
  await expect(input).toHaveCount(0);
  await expect(app.getByText("마지막 이름: 취소", { exact: true })).toBeVisible();

  await app.locator(ROW("a")).click({ button: "right" });
  await page.getByRole("menuitem", { name: "이름 바꾸기" }).click();
  const second = app.getByRole("textbox", { name: "항목 이름" });
  await second.fill("설계 정리 v2");
  await second.press("Enter");
  await expect(second).toHaveCount(0);
  await expect(app.getByText("마지막 이름: 설계 정리 v2", { exact: true })).toBeVisible();
});

test("끌어 옮기기: before·inside·after·end 표시와 놓은 뒤", async ({ page }, testInfo) => {
  const app = await open(page, APP, 1182, 800, "light");
  const tree = app.locator(".ks-data-tree");
  await expect(tree).toBeVisible();

  await pageDragStart(page, "a");
  await pageDragOver(page, "c", 0.1);
  await expect(app.locator(ROW("c"))).toHaveAttribute("data-drop-position", "before");
  await capture(app, testInfo, "넓은-끌기-before.png");
  await pageDragEnd(page);

  await pageDragStart(page, "a");
  await pageDragOver(page, "b", 0.5);
  await expect(app.locator(ROW("b"))).toHaveAttribute("data-drop-state", "valid");
  await expect(app.locator(ROW("b"))).not.toHaveAttribute("data-drop-position");
  await capture(app, testInfo, "넓은-끌기-inside.png");
  await pageDragEnd(page);

  await pageDragStart(page, "a");
  await pageDragOver(page, "c", 0.9);
  await expect(app.locator(ROW("c"))).toHaveAttribute("data-drop-position", "after");
  await capture(app, testInfo, "넓은-끌기-after.png");
  await pageDragEnd(page);

  await pageDragStart(page, "a");
  await pageDragOver(page, null, 0);
  await expect(tree).toHaveAttribute("data-drop-state", "valid");
  await capture(app, testInfo, "넓은-끌기-end.png");
  await pageDragEnd(page);

  await pageDragStart(page, "b");
  await pageDragOver(page, "b1", 0.5);
  await expect(app.locator(ROW("b1"))).toHaveAttribute("data-drop-state", "invalid");
  await capture(app, testInfo, "넓은-끌기-invalid.png");
  await pageDragEnd(page);

  await pageDragStart(page, "a");
  await pageDragOver(page, "c", 0.9);
  await pageDrop(page, "c", 0.9);
  await expect(app.getByText("마지막 이동: a → c (after)", { exact: true })).toBeVisible();
  await expect(app.locator("[data-drop-state]")).toHaveCount(0);
  await capture(app, testInfo, "넓은-끌기-놓은뒤.png");

  await pageDragStart(page, "a");
  await pageDragOver(page, null, 0);
  await pageDrop(page, null, 0);
  await expect(app.getByText("마지막 이동: a → 끝 (end)", { exact: true })).toBeVisible();
});

test("좁은 창: 확인 상자와 구역 이름 글칸", async ({ page }, testInfo) => {
  const app = await open(page, APP, 560, 800, "light");
  await expect(app.locator(".ks-data-tree")).toBeVisible();
  await capture(app, testInfo, "좁은-확인상자-밝음.png");

  const header = app.locator(".ks-data-section-header");
  const before = await box(header);
  await openSectionMenu(page, app);
  await page.getByRole("menuitem", { name: "구역 이름 바꾸기" }).click();
  const input = app.getByRole("textbox", { name: "구역 이름" });
  await expect(input).toBeFocused();
  const during = await box(header);
  expect(Math.abs(before.height - during.height), "좁은 창에서도 머리 높이는 같다").toBeLessThanOrEqual(1);
  const overflow = await app.locator(".ks-data-section").evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(overflow, "가로로 넘치지 않는다").toBeLessThanOrEqual(1);
  await capture(app, testInfo, "좁은-구역-이름-밝음.png");
});

test("폴더 트리의 새 항목·하위 항목·이름 바꾸기 글칸 행", async ({ page }, testInfo) => {
  const app = await open(page, "md-editor", 1182, 800, "light");
  await app.getByRole("tab", { name: "내 폴더" }).click();
  await app.getByRole("button", { name: "문서 폴더 고르기" }).click();
  const readme = app.getByRole("treeitem", { name: "README.md" });
  await expect(readme).toBeVisible();

  await app.getByRole("button", { name: "새 파일" }).click();
  const rootCreate = app.locator(".ks-file-tree-create-row");
  await expect(rootCreate).toBeVisible();
  const [rootCreateBox, readmeBox] = await Promise.all([box(rootCreate), box(readme)]);
  console.log(`새 항목 행: ${JSON.stringify({ create: round(rootCreateBox.height), file: round(readmeBox.height) })}`);
  expect(Math.abs(rootCreateBox.height - readmeBox.height), "새 항목 글칸 행 높이는 파일 행과 같다").toBeLessThanOrEqual(1);
  await capture(app, testInfo, "넓은-새항목-밝음.png");
  await rootCreate.getByRole("textbox", { name: "새 파일 이름" }).press("Escape");

  const notes = app.getByRole("treeitem", { name: "notes" });
  await notes.click();
  const meeting = app.getByRole("treeitem", { name: "meeting.md" });
  await expect(meeting).toBeVisible();
  await notes.click({ button: "right" });
  await page.getByRole("menuitem", { name: "새 파일" }).click();
  const childCreate = app.locator(".ks-file-tree-create-row");
  await expect(childCreate).toBeVisible();
  const [childCreateBox, meetingBox] = await Promise.all([box(childCreate), box(meeting)]);
  console.log(`하위 항목 행: ${JSON.stringify({ create: round(childCreateBox.left), file: round(meetingBox.left) })}`);
  expect(Math.abs(childCreateBox.left - meetingBox.left), "하위 항목 글칸 행이 하위 파일 행과 같은 들여쓰기").toBeLessThanOrEqual(1);
  await capture(app, testInfo, "넓은-하위항목-밝음.png");
  await childCreate.getByRole("textbox", { name: "새 파일 이름" }).press("Escape");

  await readme.click({ button: "right" });
  await page.getByRole("menuitem", { name: "이름 바꾸기" }).click();
  const rename = app.getByRole("textbox", { name: "이름 바꾸기" });
  await expect(rename).toBeFocused();
  const selection = await rename.evaluate((element) => {
    const field = element as HTMLInputElement;
    return { value: field.value, start: field.selectionStart, end: field.selectionEnd };
  });
  console.log(`이름 바꾸기 선택: ${JSON.stringify(selection)}`);
  expect(selection.value, "확장자 앞까지 고른다").toBe("README.md");
  expect(selection.start, "확장자 앞까지 고른다").toBe(0);
  expect(selection.end, "확장자 앞까지 고른다").toBe("README.md".length - ".md".length);
  await capture(app, testInfo, "넓은-이름바꾸기-밝음.png");
});
