import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
import { grantFor, makeTestSeed } from "./fixtures";

describe("markdown_view block", () => {
  it("does not render raw HTML or images and prevents link navigation", async () => {
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
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(await screen.findByText("Diagram")).toBeTruthy();

    const link = await screen.findByRole("link", { name: "external" });
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    expect(link.dispatchEvent(event)).toBe(false);
    expect(event.defaultPrevented).toBe(true);
  });

  it.each(["editor-window", "viewer-window"])("shows the folder prompt in %s until its permission is granted", async (windowId) => {
    const transport = createFakeTransport(makeTestSeed());
    const store = createShellStore(transport);
    render(<AppWindowContent store={store} windowId={windowId} />);
    expect(await screen.findByText("폴더를 먼저 선택하세요")).toBeTruthy();
  });

  it.each(["editor-window", "viewer-window"])("shows the file prompt in %s after permission is granted without a selected path", async (windowId) => {
    const transport = createFakeTransport(makeTestSeed({
      grants: [grantFor("editor-window", "docs"), grantFor("viewer-window", "docs")],
    }));
    const store = createShellStore(transport);
    render(<AppWindowContent store={store} windowId={windowId} />);
    expect(await screen.findByText("파일을 선택하세요")).toBeTruthy();
  });
});
