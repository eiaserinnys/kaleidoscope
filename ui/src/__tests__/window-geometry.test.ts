import { afterEach, describe, expect, it } from "vitest";
import {
  RESIZE_EDGES,
  readSafeAreaInsets,
  resizeWindowRect,
  usableWindowArea,
  type ResizeEdges,
  type WindowResizeEdge,
} from "../../../app/src/shell/window-geometry";

const start = { x: 100, y: 100, width: 400, height: 300 };
const min = { width: 360, height: 240 };
const usable = { x: 12, y: 12, width: 936, height: 476 };

function resize(edge: WindowResizeEdge, dx: number, dy: number) {
  return resizeWindowRect(start, RESIZE_EDGES[edge], dx, dy, min, usable);
}

describe("resizeWindowRect", () => {
  it.each([
    ["east", 50, 0, { x: 100, y: 100, width: 450, height: 300 }],
    ["south", 0, 50, { x: 100, y: 100, width: 400, height: 350 }],
    ["west", 20, 0, { x: 120, y: 100, width: 380, height: 300 }],
    ["north", 0, 40, { x: 100, y: 140, width: 400, height: 260 }],
    ["north-east", 20, -20, { x: 100, y: 80, width: 420, height: 320 }],
    ["north-west", -10, -20, { x: 90, y: 80, width: 410, height: 320 }],
    ["south-east", 20, 30, { x: 100, y: 100, width: 420, height: 330 }],
    ["south-west", -10, 30, { x: 90, y: 100, width: 410, height: 330 }],
  ] as [WindowResizeEdge, number, number, typeof start][])("여덟 방향 %s는 그 가장자리만 움직인다", (edge, dx, dy, expected) => {
    expect(resize(edge, dx, dy)).toEqual(expected);
  });

  it.each([
    ["east", -1000, 0, { x: 100, y: 100, width: 360, height: 300 }],
    ["south", 0, -1000, { x: 100, y: 100, width: 400, height: 240 }],
    ["west", 1000, 0, { x: 140, y: 100, width: 360, height: 300 }],
    ["north", 0, 1000, { x: 100, y: 160, width: 400, height: 240 }],
  ] as [WindowResizeEdge, number, number, typeof start][])("%s는 반대쪽 끝을 고정하고 최소 크기에서 멈춘다", (edge, dx, dy, expected) => {
    expect(resize(edge, dx, dy)).toEqual(expected);
  });

  it.each([
    ["east", 1000, 0, { x: 100, y: 100, width: 848, height: 300 }],
    ["south", 0, 1000, { x: 100, y: 100, width: 400, height: 388 }],
    ["west", -1000, 0, { x: 12, y: 100, width: 488, height: 300 }],
    ["north", 0, -1000, { x: 100, y: 12, width: 400, height: 388 }],
  ] as [WindowResizeEdge, number, number, typeof start][])("%s는 쓸 수 있는 바탕 영역에서 멈춘다", (edge, dx, dy, expected) => {
    expect(resize(edge, dx, dy)).toEqual(expected);
  });

  it("여덟 방향 모두 가장자리 조합을 가진다", () => {
    expect(Object.keys(RESIZE_EDGES).sort()).toEqual([
      "east", "north", "north-east", "north-west", "south", "south-east", "south-west", "west",
    ]);
    const diagonal: [WindowResizeEdge, ResizeEdges][] = [
      ["north-east", { north: true, east: true }],
      ["north-west", { north: true, west: true }],
      ["south-east", { south: true, east: true }],
      ["south-west", { south: true, west: true }],
    ];
    for (const [edge, edges] of diagonal) expect(RESIZE_EDGES[edge]).toEqual(edges);
  });
});

describe("안전 영역과 쓸 수 있는 창 영역", () => {
  afterEach(() => {
    for (const token of ["--ks-safe-top", "--ks-safe-right", "--ks-safe-bottom", "--ks-safe-left"]) {
      document.documentElement.style.removeProperty(token);
    }
  });

  it("안전 영역이 0이면 PC 계산값이 지금과 같다", () => {
    expect(usableWindowArea({ width: 1000, height: 800 }, { top: 0, right: 0, bottom: 0, left: 0 }))
      .toEqual({ x: 12, y: 12, width: 976, height: 724 });
  });

  it("아래 안전 영역이 12px보다 크면 작업 표시줄 위로 그만큼 더 비운다", () => {
    expect(usableWindowArea({ width: 1024, height: 720 }, { top: 0, right: 0, bottom: 20, left: 0 }))
      .toEqual({ x: 12, y: 12, width: 1000, height: 636 });
  });

  it("위 안전 영역은 쉘 막대가 이미 안고 있으므로 창 위 여백을 더 비키지 않는다", () => {
    expect(usableWindowArea({ width: 1024, height: 720 }, { top: 24, right: 0, bottom: 0, left: 0 }))
      .toEqual({ x: 12, y: 12, width: 1000, height: 644 });
  });

  it("안전 영역 네 값을 :root 사용자 속성에서 읽는다", () => {
    const root = document.documentElement;
    root.style.setProperty("--ks-safe-top", "0px");
    root.style.setProperty("--ks-safe-right", "2px");
    root.style.setProperty("--ks-safe-bottom", "20px");
    root.style.setProperty("--ks-safe-left", "3px");
    expect(readSafeAreaInsets()).toEqual({ top: 0, right: 2, bottom: 20, left: 3 });
  });
});
