import { expect, it } from "vitest";
import { canvasRect, canvasPoint, surfaceDpr } from "../blocks/canvas";

it("contain 여백과 cover 잘림을 그림 좌표로 변환한다", () => {
  const contain = canvasRect(200, 200, 2, "contain");
  expect(contain).toEqual({ x: 0, y: 50, width: 200, height: 100 });
  expect(canvasPoint(contain, 100, 10)).toBeNull();
  expect(canvasPoint(contain, 100, 100)).toEqual({ x: 0.5, y: 0.5 });
  const cover = canvasRect(200, 200, 2, "cover");
  expect(cover).toEqual({ x: -100, y: 0, width: 400, height: 200 });
  expect(canvasPoint(cover, 0, 100)).toEqual({ x: 0.25, y: 0.5 });
  expect(surfaceDpr(3840, 2160, 2)).toBe(1);
});
