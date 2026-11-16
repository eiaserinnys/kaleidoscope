// 격리 iframe 안에서 난 누름을 창 틀에 알리는 공용 사건.
// 프레임에 넣은 브리지가 postMessage로 누름을 올리고, 그 메시지를 받은 블록이
// 자기 iframe 요소에서 이 사건을 띄운다. 창 틀은 이 사건을 듣고 그 창을 올린다.
// 호스트 문서는 iframe 안의 pointerdown을 받지 못해 window-chrome의 누름 경로가
// 돌지 않기 때문이다. 사건은 iframe에서 창 틀(section.ks-window)까지 올라가도록
// bubbles를 켠다. preventDefault나 stopPropagation은 부르지 않는다.
export const FRAME_PRESS_EVENT = "ks-frame-press";

export interface FramePressDetail {
  // 사용자가 낸 실제 누름인지. 호스트가 넣는 합성 누름(ks-html-point 등)은 거짓이다.
  trusted: boolean;
}

export function dispatchFramePress(frame: HTMLIFrameElement, trusted: boolean): void {
  frame.dispatchEvent(new CustomEvent<FramePressDetail>(FRAME_PRESS_EVENT, { bubbles: true, detail: { trusted } }));
}
