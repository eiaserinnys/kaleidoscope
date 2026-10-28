import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Menu } from "../components/menu";

afterEach(cleanup);

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
});
