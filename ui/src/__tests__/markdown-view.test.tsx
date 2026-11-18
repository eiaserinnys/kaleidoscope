import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
import { grantFor, makeTestSeed } from "./fixtures";

afterEach(() => vi.restoreAllMocks());

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
});
