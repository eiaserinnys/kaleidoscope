import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CommentComposer } from "../comments/composer";
import { describeTarget } from "../comments/target";
import type { ShellStore } from "../core/shell-store";
import * as shareView from "../share/share-view";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("창 그림을 빼면 전송 안내와 저장 요청에서 그림이 빠진다", async () => {
  vi.spyOn(shareView, "captureWindowForComment").mockResolvedValue({
    meta: { width: 100, height: 80, byte_size: 3, capture_surface: "window_body", target_rect: { x: 0, y: 0, width: 20, height: 20 } },
    image_base64: "AAA",
  });
  const frame = document.createElement("section");
  frame.className = "ks-window";
  const content = document.createElement("div");
  content.className = "ks-window-content";
  const block = document.createElement("button");
  block.dataset.ksBlock = "/ui";
  block.dataset.ksBlockType = "button";
  block.textContent = "대상";
  content.append(block); frame.append(content); document.body.append(frame);
  const target = describeTarget(block, content)!;
  const call = vi.fn(async (request: { op: string; request?: { image?: unknown } }) => ({ op: request.op }));
  const index = new Map([["/ui", { type: "button", own_fingerprint: "fingerprint", parent_child_types: ["button"], meaningful: true, empty_fingerprint: "empty" }]]);
  render(<CommentComposer store={{ call } as unknown as ShellStore} content={content} windowId="window" appId="app" appName="앱" version={3} shellVersion="1" origin={{ kind: "personal" }} digest="digest" index={index} target={target} onRetarget={() => {}} onClose={() => {}} onError={() => {}} onPositioned={() => {}} />);
  await screen.findByRole("button", { name: "창 그림 빼기" });
  expect(screen.getByText("“대상”")).toBeTruthy();
  expect(screen.getByText("앱 3판, 창 그림이 에이전트에게 갑니다")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "창 그림 빼기" }));
  expect(screen.getByText("앱 3판이 에이전트에게 갑니다")).toBeTruthy();
  fireEvent.change(screen.getByRole("textbox", { name: "커멘트" }), { target: { value: "고쳐 주세요" } });
  fireEvent.click(screen.getByRole("button", { name: "추가" }));
  await waitFor(() => expect(call).toHaveBeenCalledOnce());
  expect(call).toHaveBeenCalledWith(expect.objectContaining({ op: "comment.create", app_id: "app", request: expect.objectContaining({ text: "고쳐 주세요" }) }));
  expect(call.mock.calls[0][0].request).not.toHaveProperty("image");
  frame.remove();
});
