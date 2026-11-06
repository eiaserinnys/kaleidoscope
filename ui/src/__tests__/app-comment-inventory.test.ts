import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Block } from "../contract/contract";
import { normalizeBlock } from "../render/render-block";

// The dispatcher is the inventory, including branches with more than one renderer.
const inventory = {
  repeat: "repeat.tsx", when: "transparent", progress: "progress.tsx", dialog: "dialog.tsx", anchor: "anchor.tsx", tour: "tour.tsx",
  canvas: "canvas.tsx", timeline: "timeline.tsx", split: "split.tsx", tree: "data-tree.tsx", folder: "folder.tsx",
  markdown: "markdown-view.tsx", html_view: "html-view.tsx", sandbox: "sandbox.tsx", chat: "client-chat.tsx",
  stack: "data-layout.tsx", tabs: "data-layout.tsx", toolbar: "data-layout.tsx", section: "data-layout.tsx",
  list: "data-list.tsx", table: "data-table.tsx", properties: "data-properties.tsx", notice: "data-notice.tsx", feed: "data-feed.tsx",
  text: "data-layout.tsx", input: "input-block.tsx", slider: "data-input.tsx", color: "data-input.tsx", select: "data-input.tsx",
  toggle: "data-input.tsx", button: "data-input.tsx", code: "code-view.tsx", image: "data-image.tsx", media: "data-media.tsx",
  metrics: "data-metrics.tsx", button_grid: "data-keypad.tsx", chart: "data-chart.tsx", map: "data-map.tsx", web_view: "web-view.tsx", explorer: "explorer.tsx",
} satisfies Record<Block["type"], string>;

describe("블록 표식 inventory", () => {
  it("정본 dispatch의 모든 type을 covered 또는 transparent로 분류한다", () => {
    const root = resolve(import.meta.dirname, "..");
    const source = readFileSync(resolve(root, "render/render-block.tsx"), "utf8").split("function BlockContent")[1].split("export function normalizeBlock")[0];
    const cases = [...source.matchAll(/case "([^"]+)"/g)].map((match) => match[1]).sort();
    expect(Object.keys(inventory).sort()).toEqual(cases);
    for (const [type, file] of Object.entries(inventory)) {
      if (file === "transparent") { expect(type).toBe("when"); continue; }
      expect(readFileSync(resolve(root, "blocks", file), "utf8"), `${type} marker hook`).toContain("useBlockRootProps");
    }
  });
  it("옛 tree root도 folder 렌더러로 간다", () => {
    expect(normalizeBlock({ type: "tree", root: { permission: "files" } } as unknown as Block).type).toBe("folder");
  });
  it.each([
    ["interactive_html", "sandbox"], ["textarea", "input"], ["file_tree", "folder"],
    ["markdown_editor", "markdown"], ["markdown_view", "markdown"], ["code_editor", "code"], ["code_view", "code"], ["agent_chat", "chat"], ["keypad", "button_grid"],
  ])("옛 이름 %s는 정본 %s로 정규화", (oldType, type) => {
    const raw = { type: oldType, root: { permission: "files" }, columns: 1, buttons: [], on_press: [] } as unknown as Block;
    expect(normalizeBlock(raw).type).toBe(type);
  });
});
