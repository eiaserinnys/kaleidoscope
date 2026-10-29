import { cleanup, fireEvent, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Menu } from "../components/menu";

const innerHeightDescriptor = Object.getOwnPropertyDescriptor(window, "innerHeight");

afterEach(() => {
  cleanup();
  document.documentElement.style.removeProperty("--ks-space-3");
  if (innerHeightDescriptor) Object.defineProperty(window, "innerHeight", innerHeightDescriptor);
  vi.restoreAllMocks();
});

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  };
}

function renderAt(anchorTop: number, anchorBottom: number, menuHeight: number): number {
  const anchor = document.createElement("button");
  const getComputedStyle = window.getComputedStyle.bind(window);
  vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue(rect(24, anchorTop, 80, anchorBottom - anchorTop));
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function getBounds(this: HTMLElement) {
    if (this.classList.contains("ks-menu")) return rect(0, 0, 180, menuHeight);
    return rect(0, 0, 0, 0);
  });
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
    if (element instanceof HTMLElement && element.classList.contains("ks-menu")) {
      return { getPropertyValue: (property: string) => property === "--ks-space-3" ? "12px" : "" } as CSSStyleDeclaration;
    }
    return getComputedStyle(element);
  });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 600 });

  render(<Menu anchor={anchor} items={[{ id: "item", label: "Item" }]} onClose={() => undefined} />);
  const menu = document.querySelector<HTMLElement>("[role=menu]");
  if (!menu) throw new Error("Menu did not render");
  return Number.parseFloat(menu.style.top);
}

describe("Menu", () => {
  it("moves through menu items with arrows and activates the focused item with Enter", async () => {
    const user = userEvent.setup();
    const anchor = document.createElement("button");
    const onClose = vi.fn();
    const first = vi.fn();
    const second = vi.fn();

    render(
      <Menu
        anchor={anchor}
        items={[
          { id: "first", label: "First", onSelect: first },
          { id: "second", label: "Second", onSelect: second },
        ]}
        onClose={onClose}
      />,
    );

    await user.keyboard("{ArrowDown}{Enter}");

    expect(second).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes on Escape and an outside pointer down", () => {
    const anchor = document.createElement("button");
    const onClose = vi.fn();
    const { unmount } = render(
      <Menu anchor={anchor} items={[]} onClose={onClose} />,
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();

    onClose.mockClear();
    unmount();
    render(<Menu anchor={anchor} items={[]} onClose={onClose} />);
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("opens above the anchor when there is not enough space below", () => {
    expect(renderAt(550, 570, 120)).toBe(430);
  });

  it("keeps the menu inside the viewport when neither side has enough space", () => {
    expect(renderAt(40, 50, 560)).toBe(28);
  });
});
