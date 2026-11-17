import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppDefinition, Block } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
import "../styles/data-blocks.css";
import "../styles/selection.css";
import { makeTestSeed, mdEditorDefinition } from "./fixtures";

function definition(ui: Block, state: Record<string, JsonValue>): AppDefinition {
  return {
    ...mdEditorDefinition,
    requires: { blocks: 64, modules: {} },
    state,
    ui,
  };
}

function setup(ui: Block, state: Record<string, JsonValue>) {
  const app = definition(ui, state);
  const seed = makeTestSeed({ definitions: [app] });
  seed.snapshot.shared.windows[0].state = structuredClone(state);
  const transport = createFakeTransport(seed);
  const store = createShellStore(transport);
  render(<AppWindowContent store={store} windowId="editor-window" />);
  return { store };
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("진행 막대 칸막이와 커서", () => {
  it("segments 7이면 칸막이 여섯 개를 k/7 자리에 오리고 커서를 marker/max 자리에 그린다", async () => {
    setup(
      { type: "progress", value: 72, max: 100, label: "7일 72% 남음", segments: 7, marker: { state: "elapsed" } },
      { elapsed: 50 },
    );
    const bar = await screen.findByRole("progressbar", { name: "7일 72% 남음" });
    expect(bar.classList.contains("is-segmented")).toBe(true);
    const mask = bar.style.getPropertyValue("--ks-progress-mask");
    expect(mask.startsWith("linear-gradient(to right,")).toBe(true);
    expect((mask.match(/transparent 0/g) ?? []).length).toBe(6);
    for (const index of [1, 2, 3, 4, 5, 6]) {
      expect(mask).toContain(`calc(100% / 7 * ${index} - var(--ks-line-width) / 2)`);
      expect(mask).toContain(`calc(100% / 7 * ${index} + var(--ks-line-width) / 2)`);
    }
    const marker = document.querySelector(".ks-data-progress-marker") as HTMLElement | null;
    expect(marker).not.toBeNull();
    expect(marker!.getAttribute("aria-hidden")).toBe("true");
    expect(marker!.style.left).toBe("50%");
    expect(marker!.parentElement?.className).toBe("ks-data-progress-pace");
    expect(marker!.parentElement?.querySelector(".ks-data-progress")).toBe(bar);
  });

  it("marker가 0..max 밖이면 끝으로 붙인다", async () => {
    setup(
      { type: "progress", value: 20, max: 100, label: "넘침", segments: 7, marker: { state: "elapsed" } },
      { elapsed: 150 },
    );
    await screen.findByRole("progressbar", { name: "넘침" });
    expect(document.querySelector<HTMLElement>(".ks-data-progress-marker")!.style.left).toBe("100%");
    cleanup();
    setup(
      { type: "progress", value: 20, max: 100, label: "모자람", segments: 7, marker: { state: "elapsed" } },
      { elapsed: -20 },
    );
    await screen.findByRole("progressbar", { name: "모자람" });
    expect(document.querySelector<HTMLElement>(".ks-data-progress-marker")!.style.left).toBe("0%");
  });

  it("marker가 수가 아니면 커서를 그리지 않는다", async () => {
    setup(
      { type: "progress", value: 48, max: 100, label: "모름", segments: 7, marker: { state: "elapsed" } },
      { elapsed: "50" },
    );
    await screen.findByRole("progressbar", { name: "모름" });
    expect(document.querySelector(".ks-data-progress-marker")).toBeNull();
    expect(document.querySelector(".ks-data-progress-pace")).not.toBeNull();
  });

  it("segments와 marker가 없으면 예전 그대로 그린다", async () => {
    setup(
      { type: "progress", value: 40, max: 100, label: "7일 40% 남음" },
      {},
    );
    const bar = await screen.findByRole("progressbar", { name: "7일 40% 남음" });
    expect(bar.classList.contains("is-segmented")).toBe(false);
    expect(bar.style.getPropertyValue("--ks-progress-mask")).toBe("");
    expect(bar.getAttribute("aria-valuenow")).toBe("40");
    expect(document.querySelector(".ks-data-progress-pace")).toBeNull();
    expect(document.querySelector(".ks-data-progress-marker")).toBeNull();
  });
});
