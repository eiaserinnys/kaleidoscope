import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TextInput } from "../components/text-input";

afterEach(cleanup);

describe("TextInput", () => {
  it("selects the current name when rename input opens", () => {
    render(<TextInput aria-label="이름" value="작업 1" onCommit={vi.fn()} onCancel={vi.fn()} />);

    const input = screen.getByRole("textbox", { name: "이름" }) as HTMLInputElement;
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe("작업 1".length);
  });

  it("commits the edited value with Enter", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    render(<TextInput aria-label="이름" value="작업 1" onCommit={onCommit} onCancel={onCancel} />);

    const input = screen.getByRole("textbox", { name: "이름" });
    await user.clear(input);
    await user.type(input, "문서 작업{Enter}");

    expect(onCommit).toHaveBeenCalledWith("문서 작업");
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("cancels on Escape and treats an empty blur as cancel", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    const view = render(
      <>
        <TextInput aria-label="이름" value="작업 1" onCommit={onCommit} onCancel={onCancel} />
        <button type="button">바깥</button>
      </>,
    );

    screen.getByRole("textbox", { name: "이름" });
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledOnce();

    onCancel.mockClear();
    view.unmount();
    render(
      <>
        <TextInput aria-label="이름" value="작업 1" onCommit={onCommit} onCancel={onCancel} />
        <button type="button">바깥</button>
      </>,
    );
    const newInput = screen.getByRole("textbox", { name: "이름" });
    await user.clear(newInput);
    await user.click(screen.getByRole("button", { name: "바깥" }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onCommit).not.toHaveBeenCalled();
  });
});
