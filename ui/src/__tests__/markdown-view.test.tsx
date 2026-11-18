import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppDefinition } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
import { grantFor, makeTestSeed } from "./fixtures";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const fileViewDefinition: AppDefinition = {
  id: "md-file-view", name: "파일 보기", requires: { blocks: 4, modules: { files: 1 } },
  permissions: [{ module: "files", id: "docs", access: "readwrite", label: "문서" }], state: {},
  ui: { type: "markdown", file: { permission: "docs", path: "README.md" }, read_only: true },
};

const documentViewDefinition: AppDefinition = {
  id: "md-viewer", name: "문서 보기", requires: { blocks: 4, modules: { storage: 1 } },
  permissions: [], state: {},
  storage: { entries: [{ id: "memo", key: "memo", kind: "md", default: "", label: "문서", presentation: "hidden" }] },
  ui: { type: "markdown", document: { entry: "memo" }, read_only: true },
};


describe("markdown_view block", () => {
  it("파일 읽기에 실패한 뒤 다시 시도하면 문서를 읽는다", async () => {
    const transport = createFakeTransport(makeTestSeed({ viewerPath: "README.md", grants: [grantFor("viewer-window", "docs")], files: { "README.md": "# 다시 읽음" } }));
    const original = transport.call.bind(transport);
    let fail = true;
    vi.spyOn(transport, "call").mockImplementation(async (request) => {
      if (request.op === "files.read" && fail) throw { code: "io", message: "읽기 실패", details: [] };
      return original(request);
    });
    render(<AppWindowContent store={createShellStore(transport)} windowId="viewer-window" />);
    const alert = await screen.findByRole("alert");
    fail = false;
    fireEvent.click(within(alert).getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByRole("heading", { name: "다시 읽음" })).toBeTruthy();
  });
  it("does not render raw HTML or images and prevents link navigation", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const transport = createFakeTransport(makeTestSeed({
      viewerPath: "README.md",
      grants: [grantFor("viewer-window", "docs")],
      files: {
        "README.md": "# Hello\n\n<script>window.compromised = true</script>\n\n[external](https://example.com)\n\n![Diagram](diagram.png)",
      },
    }));
    const store = createShellStore(transport);
    const { container } = render(<AppWindowContent store={store} windowId="viewer-window" />);

    expect(await screen.findByRole("heading", { name: "Hello" })).toBeTruthy();
    expect(container.querySelector(".ks-markdown-view > .ks-markdown-text h1")).toBeTruthy();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(await screen.findByText("Diagram")).toBeTruthy();

    const link = await screen.findByRole("link", { name: "external" });
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    expect(link.dispatchEvent(event)).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledWith("https://example.com/", "_blank", "noopener,noreferrer");
  });

  it.each(["editor-window", "viewer-window"])("keeps %s content blank until its folder permission is granted", async (windowId) => {
    const transport = createFakeTransport(makeTestSeed());
    const store = createShellStore(transport);
    const { container } = render(<AppWindowContent store={store} windowId={windowId} />);
    expect(screen.queryByText("폴더를 먼저 선택하세요")).toBeNull();
    expect(screen.queryByText("파일을 선택하세요")).toBeNull();
    expect(container.querySelector(".ks-markdown-view")).toBeNull();
  });

  it.each(["editor-window", "viewer-window"])("keeps %s content blank after permission is granted without a selected path", async (windowId) => {
    const transport = createFakeTransport(makeTestSeed({
      grants: [grantFor("editor-window", "docs"), grantFor("viewer-window", "docs")],
    }));
    const store = createShellStore(transport);
    const { container } = render(<AppWindowContent store={store} windowId={windowId} />);
    expect(screen.queryByText("폴더를 먼저 선택하세요")).toBeNull();
    expect(screen.queryByText("파일을 선택하세요")).toBeNull();
    expect(container.querySelector(".ks-markdown-view")).toBeNull();
  });

  it("창 초점 새로고침은 로더 없이 읽은 파일 내용을 두고 새 내용으로 바꾼다", async () => {
    const transport = createFakeTransport(makeTestSeed({
      definitions: [fileViewDefinition],
      grants: [grantFor("viewer-window", "docs")],
      files: { "README.md": "# 처음 내용" },
    }));
    const original = transport.call.bind(transport);
    const gate = { hold: false, waiters: [] as Array<() => void> };
    vi.spyOn(transport, "call").mockImplementation(async (request) => {
      if (request.op === "files.read" && gate.hold) await new Promise<void>((resolve) => gate.waiters.push(resolve));
      return original(request as never) as never;
    });
    const store = createShellStore(transport);
    const { container } = render(<AppWindowContent store={store} windowId="viewer-window" />);
    expect(await screen.findByRole("heading", { name: "처음 내용" })).toBeTruthy();

    const first = await transport.call({ op: "files.read", window_id: "viewer-window", permission: "docs", path: "README.md" });
    await transport.call({ op: "files.write", window_id: "viewer-window", permission: "docs", path: "README.md", text: "# 새 내용", expected_revision: first.revision });

    gate.hold = true;
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(container.querySelector(".ks-markdown-loading")).toBeNull();
    expect(screen.getByRole("heading", { name: "처음 내용" })).toBeTruthy();

    await act(async () => { gate.hold = false; gate.waiters.splice(0).forEach((wake) => wake()); });
    expect(await screen.findByRole("heading", { name: "새 내용" })).toBeTruthy();
    expect(container.querySelector(".ks-markdown-loading")).toBeNull();
    store.dispose();
  });

  it("창 초점 새로고침은 문서 저장소의 읽은 내용도 로더 없이 새 내용으로 바꾼다", async () => {
    const seed = makeTestSeed({ definitions: [documentViewDefinition] });
    const transport = createFakeTransport({ ...seed, storage: [{ window_id: "viewer-window", entry: "memo", content: "# 처음 문서" }] });
    const original = transport.call.bind(transport);
    const gate = { hold: false, waiters: [] as Array<() => void> };
    vi.spyOn(transport, "call").mockImplementation(async (request) => {
      if (request.op === "storage.get" && gate.hold) await new Promise<void>((resolve) => gate.waiters.push(resolve));
      return original(request as never) as never;
    });
    const store = createShellStore(transport);
    const { container } = render(<AppWindowContent store={store} windowId="viewer-window" />);
    expect(await screen.findByRole("heading", { name: "처음 문서" })).toBeTruthy();

    const first = await transport.call({ op: "storage.get", window_id: "viewer-window", entry: "memo" });
    gate.hold = true;
    await transport.call({ op: "storage.write", window_id: "viewer-window", entry: "memo", content: "# 새 문서", expected_revision: first.result.revision });
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(container.querySelector(".ks-markdown-loading")).toBeNull();
    expect(screen.getByRole("heading", { name: "처음 문서" })).toBeTruthy();

    await act(async () => { gate.hold = false; gate.waiters.splice(0).forEach((wake) => wake()); });
    expect(await screen.findByRole("heading", { name: "새 문서" })).toBeTruthy();
    expect(container.querySelector(".ks-markdown-loading")).toBeNull();
    store.dispose();
  });
});
