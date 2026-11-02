import { afterEach, describe, expect, it, vi } from "vitest";
import { describeVisible, limitShareText } from "../share/visible";
import { SHARE_TEXT_CUT_MARK, SHARE_TEXT_MAX_BYTES } from "../contract/limits";

describe("같이 보기 글", () => {
  it("UTF-8 한도에서 줄 경계로 자르고 잘림을 알린다", () => {
    const text = limitShareText(`${"가".repeat(5000)}\n${"나".repeat(2000)}`);
    expect(text).toBe(`${"가".repeat(5000)}\n${SHARE_TEXT_CUT_MARK}`);
    expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(SHARE_TEXT_MAX_BYTES);
  });
  it("연속된 빈 줄은 하나로 줄인다", () => {
    expect(limitShareText("첫 줄\n\n\n둘째 줄")).toBe("첫 줄\n\n둘째 줄");
  });
});


afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });
it("보이는 블록과 인라인을 줄로 묶고 숨기거나 잘린 글을 뺀다", () => {
  document.body.innerHTML = '<div id="root"><p>첫 <span>문장</span></p><p hidden>숨김</p><p data-ks-share-skip>건너뜀</p><p class="outside">화면 밖</p><p>다음 줄</p></div>';
  const rect = (left: number, top: number, width: number, height: number) => ({ left, top, right: left + width, bottom: top + height, x: left, y: top, width, height, toJSON() {} });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) { return rect(0, this.classList.contains("outside") ? 200 : 0, 100, 40); });
  vi.spyOn(document, "createRange").mockImplementation(() => ({ setStart() {}, setEnd() {}, getClientRects: () => [rect(0, 0, 60, 20)] }) as unknown as Range);
  const result = describeVisible(document.getElementById("root")!);
  expect(result).toEqual({ text: "첫 문장\n다음 줄", visual: false });
});

it("보이는 캔버스의 PNG를 같이 보기 이미지로 옮긴다", () => {
  document.body.innerHTML = '<div id="root"><canvas></canvas></div>';
  const rect = { left: 0, top: 0, right: 100, bottom: 100, x: 0, y: 0, width: 100, height: 100, toJSON() {} };
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,cG5n");
  expect(describeVisible(document.getElementById("root")!)).toEqual({ text: "", visual: true, image_base64: "cG5n" });
});

it("가짜 코어는 같은 상태를 반복해도 이벤트를 보내지 않고 끈 창의 늦은 view를 무시한다", async () => {
  const { createFakeTransport } = await import("../core/fake-transport");
  const { makeTestSnapshot } = await import("./fixtures");
  const snapshot = makeTestSnapshot();
  const windowId = snapshot.shared.windows[0].id;
  const fake = createFakeTransport({ snapshot, folder: null, files: {} });
  const events: string[] = [];
  let desktopSharing: string[] = [];
  fake.subscribe((event) => {
    events.push(event.event);
    if (event.event === "state.changed") desktopSharing = event.snapshot.shared.desktops[0].sharing ?? [];
  });
  await fake.call({ op: "share.set", window_id: windowId, on: true });
  await fake.call({ op: "share.set", window_id: windowId, on: true });
  expect(events).toEqual(["state.changed"]);
  expect(desktopSharing).toEqual([windowId]);
  await fake.call({ op: "share.set", window_id: windowId, on: false });
  expect(desktopSharing).toEqual([]);
  await fake.call({ op: "share.view", window_id: windowId, view: { text: "늦은 글", visual: false, occluded: false, bounds: { x: 0, y: 0, width: 100, height: 100 } } });
  expect(fake.getShareCalls()).toEqual([]);
});
