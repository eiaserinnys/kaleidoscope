import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { afterEach, expect, it, vi } from "vitest";
import type { Block } from "../contract/contract";
import type { BlockContext } from "../blocks/block-context";

vi.mock("../blocks/data-input", async (original) => {
  const module = await original<typeof import("../blocks/data-input")>();
  function Broken(): never { throw new Error("시험 예외"); }
  function Adjacent() {
    const [count, setCount] = useState(0);
    return <button onClick={() => setCount(count + 1)}>옆 단추 {count}</button>;
  }
  return { ...module, InputBlock: ({ block }: { block: { kind?: string } }) => block.kind === "date" ? createPortal(<Broken />, document.body) : <span>복구됨</span>, ButtonBlock: Adjacent };
});

import { renderBlock } from "../render/render-block";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("포털 렌더 예외를 해당 블록에 가두고 정의가 바뀌면 다시 그린다", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const context = { window: { id: "test" } } as BlockContext;
  const broken = { type: "input", kind: "date", value: "" } as Block;
  const repaired = { type: "input", kind: "time", value: "" } as Block;
  const adjacent = { type: "button", label: "옆 단추" } as Block;
  const view = render(<div>{renderBlock(broken, context)}{renderBlock(adjacent, context, "/ui/next")}</div>);
  expect(screen.getByRole("alert").textContent).toContain("SHELL_BLOCK_RENDER_FAILED");
  expect(screen.getByRole("alert").textContent).toContain("시험 예외");
  fireEvent.click(screen.getByRole("button", { name: "옆 단추 0" }));
  expect(screen.getByRole("button", { name: "옆 단추 1" })).toBeTruthy();
  view.rerender(<div>{renderBlock(broken, context)}{renderBlock(adjacent, context, "/ui/next")}</div>);
  expect(screen.getByRole("alert")).toBeTruthy();
  view.rerender(<div>{renderBlock(repaired, context)}{renderBlock(adjacent, context, "/ui/next")}</div>);
  expect(screen.getByText("복구됨")).toBeTruthy();
  expect(screen.getByRole("button", { name: "옆 단추 1" })).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});
