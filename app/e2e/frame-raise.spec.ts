import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { coreUrl, pathsFor, requiredRuntimeDir } from "./runtime.ts";

const paths = pathsFor(requiredRuntimeDir());
const { docsDir } = paths;
// 시험이 단계마다 고를 파일을 바꾸도록 devbridge의 파일 고르기 주입에 경로를 써 둔다.
const pickFiles = (files: string[]) => writeFile(paths.pickFilesFile, JSON.stringify(files));
// 증거 그림을 남길 폴더는 환경 변수로만 받는다. CI에서는 넘기지 않아 아무것도 쓰지 않는다.
const captureDir = process.env.KS_FRAME_RAISE_CAPTURE_DIR;

test.beforeEach(async ({ page }) => {
  await page.goto(`/?core=${coreUrl}`);
});

test("뒤 창의 샌드박스 내용을 누르면 그 창이 앞으로 오고 누름은 내용에 그대로 들어간다", async ({ page }) => {
  test.setTimeout(120_000);

  // 누를 때마다 횟수가 오르는 단추가 프레임 전체를 채운다. 누름이 내용에 들어가는지
  // 프레임 안 글자로 확인하고, 창이 올라오는지 zIndex로 확인한다.
  const definition = {
    id: "frame-press", name: "프레임 누름", requires: { blocks: 11, modules: {} },
    permissions: [], state: {},
    ui: {
      type: "sandbox", title: "누름 시험",
      value: `<style>html,body{margin:0;height:100%}</style>`
        + `<button id="counter" style="position:absolute;left:0;top:0;width:100%;height:100%">횟수 0</button>`
        + `<script>let n=0;document.querySelector('#counter').addEventListener('click',()=>{document.querySelector('#counter').textContent='횟수 '+(++n)})</script>`,
    },
  };
  await writeFile(path.join(docsDir, "frame-press.json"), JSON.stringify(definition));
  await pickFiles([path.join(docsDir, "frame-press.json")]);

  // 커스텀 앱은 앱스토어의 「파일에서 가져오기」로 들인다.
  await page.locator(".ks-taskbar").getByRole("button", { name: "앱 열기" }).click();
  await page.getByRole("dialog", { name: "앱 열기" }).getByRole("button", { name: "앱스토어" }).click();
  const storeWindow = page.getByTestId("app-window-store");
  await expect(storeWindow).toBeVisible();
  await storeWindow.getByRole("option", { name: "커스텀 앱" }).click();
  await storeWindow.getByRole("button", { name: "파일에서 가져오기" }).click();
  await expect(storeWindow.getByRole("option", { name: "프레임 누름" })).toBeVisible();
  await storeWindow.getByRole("option", { name: "프레임 누름" }).click();
  await storeWindow.getByRole("button", { name: "열기" }).click();
  const sandboxWindow = page.getByTestId("app-window-frame-press");
  await expect(sandboxWindow).toBeVisible();
  const frame = sandboxWindow.locator(".ks-sandbox iframe");
  await expect(frame).toHaveCount(1);

  // 다른 창을 그 위에 띄운다.
  await page.locator(".ks-taskbar").getByRole("button", { name: "앱 열기" }).click();
  await page.getByRole("dialog", { name: "앱 열기" }).getByRole("button", { name: "마크다운 편집기" }).click();
  const editorWindow = page.getByTestId("app-window-md-editor");
  await expect(editorWindow).toBeVisible();

  // 위 창을 오른쪽으로 끌어 뒤 창의 왼쪽 일부가 드러나게 한다.
  const titlebar = editorWindow.locator(".ks-window-titlebar");
  const titleBox = await titlebar.boundingBox();
  if (!titleBox) throw new Error("편집기 창 제목 줄을 찾지 못했습니다");
  await page.mouse.move(titleBox.x + 200, titleBox.y + 16);
  await page.mouse.down();
  await page.mouse.move(titleBox.x + 500, titleBox.y + 16);
  await page.mouse.up();
  await expect.poll(async () => (await editorWindow.boundingBox())?.x ?? 0).toBeGreaterThan(titleBox.x + 200);

  const frameBox = await frame.boundingBox();
  const editorBox = await editorWindow.boundingBox();
  if (!frameBox || !editorBox) throw new Error("겹친 창의 위치를 확인하지 못했습니다");
  // 누를 자리: 뒤 창 iframe 안에서 위 창에 가리지 않은 곳.
  const exposedWidth = editorBox.x - frameBox.x;
  expect(exposedWidth).toBeGreaterThan(120);
  const clickX = frameBox.x + Math.min(100, exposedWidth / 2);
  const clickY = frameBox.y + Math.min(120, frameBox.height / 2);
  expect(clickX).toBeLessThan(editorBox.x);

  const zIndexes = async () => page.locator(".ks-window").evaluateAll((elements) => elements.map((element) => Number(getComputedStyle(element).zIndex)));
  const zOf = async (locator: typeof sandboxWindow) => locator.evaluate((element) => Number(getComputedStyle(element).zIndex));
  const [sandboxZ, editorZ] = [await zOf(sandboxWindow), await zOf(editorWindow)];
  expect(sandboxZ).toBeLessThan(editorZ);

  if (captureDir) {
    await mkdir(captureDir, { recursive: true });
    await page.screenshot({ path: path.join(captureDir, "before.png") });
  }

  await page.mouse.click(clickX, clickY);

  // 누름은 프레임 안 내용에 그대로 들어가고, 그 창이 맨 위로 올라온다.
  await expect(sandboxWindow.frameLocator(".ks-sandbox iframe").locator("#counter")).toHaveText("횟수 1");
  await expect.poll(async () => (await zOf(sandboxWindow)) > (await zOf(editorWindow))).toBe(true);
  expect(await zOf(sandboxWindow)).toBe(Math.max(...await zIndexes()));

  if (captureDir) await page.screenshot({ path: path.join(captureDir, "after.png") });
});
