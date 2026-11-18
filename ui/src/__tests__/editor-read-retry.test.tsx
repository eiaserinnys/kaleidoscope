import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppDefinition, CoreError } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
import { grantFor, makeTestSeed } from "./fixtures";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const READ_ERROR: CoreError = { code: "io", id: "FILE_READ_IO", message: "파일 README.md: 내용을 읽지 못했습니다.", details: [] };

function editorDefinition(ui: AppDefinition["ui"]): AppDefinition {
  return {
    id: "md-editor", name: "편집기 읽기 재시도", requires: { blocks: 4, modules: { files: 1 } },
    permissions: [{ module: "files", id: "docs", access: "readwrite", label: "문서" }],
    state: {}, ui,
  };
}

function setup(ui: AppDefinition["ui"], files: Record<string, string>) {
  const transport = createFakeTransport(makeTestSeed({
    definitions: [editorDefinition(ui)],
    grants: [grantFor("editor-window", "docs")],
    files,
  }));
  const original = transport.call.bind(transport);
  const control = {
    fail: true,
    hold: false,
    reads: 0,
    waiters: [] as Array<() => void>,
    release() { this.hold = false; this.waiters.splice(0).forEach((wake) => wake()); },
  };
  vi.spyOn(transport, "call").mockImplementation(async (request) => {
    if (request.op === "files.read") {
      control.reads++;
      if (control.hold) await new Promise<void>((resolve) => control.waiters.push(resolve));
      if (control.fail) throw { ...READ_ERROR };
    }
    return original(request as never) as never;
  });
  const store = createShellStore(transport);
  const { container } = render(<AppWindowContent store={store} windowId="editor-window" />);
  return { container, control, store };
}

function expectRetryFocus() {
  return waitFor(() => expect(document.activeElement?.classList.contains("ks-focus-rescue-empty")).toBe(true));
}

describe("편집기 첫 읽기 실패의 다시 시도", () => {
  it("코드 편집기는 다시 읽는 동안 로더를 세우고, 성공하면 내용을 보이며 초점을 칸에 남긴다", async () => {
    const { container, control, store } = setup(
      { type: "code", file: { permission: "docs", path: "README.md" } },
      { "README.md": "let value = 1;\n" },
    );
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("내용을 읽지 못했습니다");
    expect(screen.queryByRole("textbox", { name: "코드 편집기" })).toBeNull();

    control.fail = false;
    control.hold = true;
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(container.querySelector(".ks-editor-loading")?.textContent).toContain("불러오는 중");
    await act(async () => { control.release(); });

    const editor = await screen.findByRole("textbox", { name: "코드 편집기" });
    expect(editor.textContent).toContain("let value = 1;");
    expect(container.querySelector(".ks-editor-error")).toBeNull();
    expect(control.reads).toBe(2);
    await expectRetryFocus();
    store.dispose();
  });

  it("마크다운 편집기는 다시 읽는 동안 로더를 세우고, 성공하면 내용을 보이며 초점을 칸에 남긴다", async () => {
    const { container, control, store } = setup(
      { type: "markdown", file: { permission: "docs", path: "README.md" } },
      { "README.md": "# 다시 읽은 제목\n" },
    );
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("내용을 읽지 못했습니다");
    expect(screen.queryByRole("textbox", { name: "마크다운 편집기" })).toBeNull();

    control.fail = false;
    control.hold = true;
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(container.querySelector(".ks-editor-loading")?.textContent).toContain("불러오는 중");
    await act(async () => { control.release(); });

    const editor = await screen.findByRole("textbox", { name: "마크다운 편집기" });
    expect(editor.textContent).toContain("다시 읽은 제목");
    expect(container.querySelector(".ks-editor-error")).toBeNull();
    expect(control.reads).toBe(2);
    await expectRetryFocus();
    store.dispose();
  });

  it("다시 읽어도 실패하면 같은 칸에 다시 시도가 남는다", async () => {
    const { container, control, store } = setup(
      { type: "code", file: { permission: "docs", path: "README.md" } },
      { "README.md": "let value = 1;\n" },
    );
    await screen.findByRole("alert");
    control.hold = true;
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    await act(async () => { control.release(); });
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeTruthy();
    expect(container.querySelector(".ks-editor-loading")).toBeNull();
    expect(control.reads).toBeGreaterThanOrEqual(2);
    store.dispose();
  });
});
