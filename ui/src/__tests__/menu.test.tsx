import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Menu } from "../components/menu";

const innerHeightDescriptor = Object.getOwnPropertyDescriptor(window, "innerHeight");
const clientHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
const offsetTopDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetTop");
const offsetHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");

afterEach(() => {
  cleanup();
  document.documentElement.style.removeProperty("--ks-space-3");
  if (innerHeightDescriptor) Object.defineProperty(window, "innerHeight", innerHeightDescriptor);
  if (clientHeightDescriptor) Object.defineProperty(HTMLElement.prototype, "clientHeight", clientHeightDescriptor);
  if (offsetTopDescriptor) Object.defineProperty(HTMLElement.prototype, "offsetTop", offsetTopDescriptor);
  if (offsetHeightDescriptor) Object.defineProperty(HTMLElement.prototype, "offsetHeight", offsetHeightDescriptor);
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

  it("다른 창 머리처럼 전파를 멈추는 자리를 눌러도 닫는다", () => {
    const anchor = document.createElement("button");
    const onClose = vi.fn();
    render(<Menu anchor={anchor} items={[]} onClose={onClose} />);
    const titlebar = document.createElement("div");
    titlebar.addEventListener("pointerdown", (event) => event.stopPropagation());
    document.body.append(titlebar);

    fireEvent.pointerDown(titlebar, { button: 0 });

    expect(onClose).toHaveBeenCalledOnce();
    titlebar.remove();
  });

  it("closes a coordinate menu when its anchor row is clicked, but preserves button-anchored menus", () => {
    const anchor = document.createElement("button");
    const child = document.createElement("span");
    anchor.append(child);
    document.body.append(anchor);
    const onClose = vi.fn();
    const { unmount } = render(<Menu anchor={anchor} anchorPoint={{ x: 10, y: 10 }} items={[]} onClose={onClose} />);

    fireEvent.pointerDown(child);
    expect(onClose).toHaveBeenCalledOnce();

    onClose.mockClear();
    unmount();
    render(<Menu anchor={anchor} items={[]} onClose={onClose} />);
    fireEvent.pointerDown(child);
    expect(onClose).not.toHaveBeenCalled();
    anchor.remove();
  });

  it("opens above the anchor when there is not enough space below", () => {
    expect(renderAt(550, 570, 120)).toBe(430);
  });

  it("keeps the menu inside the viewport when neither side has enough space", () => {
    expect(renderAt(40, 50, 560)).toBe(28);
  });

  it("clamps an offscreen point after trying the space above it", () => {
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 600 });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("ks-menu") ? rect(0, 0, 180, 120) : rect(0, 0, 0, 0);
    });
    render(<Menu anchor={document.createElement("button")} anchorPoint={{ x: 5000, y: 1000 }} items={[]} onClose={() => undefined} />);
    expect(Number.parseFloat(screen.getByRole("menu").style.top)).toBeLessThanOrEqual(480);
    expect(Number.parseFloat(screen.getByRole("menu").style.left)).toBeLessThanOrEqual(window.innerWidth - 180);
  });

  it("shows and focuses the checked item when opening a long menu", () => {
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get() { return this.classList.contains("ks-menu") ? 100 : 0; } });
    Object.defineProperty(HTMLElement.prototype, "offsetTop", { configurable: true, get() { return this.getAttribute("aria-current") === "true" ? 120 : 0; } });
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get() { return this.getAttribute("aria-current") === "true" ? 20 : 0; } });
    const anchor = document.createElement("button");
    const onClose = vi.fn();

    render(<Menu anchor={anchor} onClose={onClose} items={[
      { id: "first", label: "First" },
      { id: "checked", label: "Checked", checked: true },
      { id: "last", label: "Last" },
    ]} />);

    const menu = screen.getByRole("menu") as HTMLElement;
    const checked = screen.getByRole("menuitem", { name: "Checked" });
    expect(document.activeElement).toBe(checked);
    expect(menu.scrollTop).toBe(80);
  });

  it("focuses the first enabled item when the checked item is disabled", () => {
    const anchor = document.createElement("button");
    render(<Menu anchor={anchor} onClose={() => undefined} items={[
      { id: "checked", label: "Checked", checked: true, disabled: true },
      { id: "available", label: "Available" },
    ]} />);

    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Available" }));
  });

  it("keeps focusing the first enabled item when nothing is checked", () => {
    const anchor = document.createElement("button");
    render(<Menu anchor={anchor} onClose={() => undefined} items={[
      { id: "blocked", label: "Blocked", disabled: true },
      { id: "available", label: "Available" },
    ]} />);

    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Available" }));
  });

  it("chooses a safe enabled item before a dangerous one", () => {
    render(<Menu anchor={document.createElement("button")} onClose={() => undefined} items={[
      { id: "danger", label: "삭제", danger: true },
      { id: "safe", label: "복사" },
    ]} />);
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "복사" }));
  });
});
