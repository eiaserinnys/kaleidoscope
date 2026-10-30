import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TextInput } from "../components/text-input";

afterEach(cleanup);

describe("TextInput", () => {
  it("keeps the default size and applies compact only when requested", () => {
    render(
      <>
        <TextInput aria-label="기본" value="기본" onCommit={vi.fn()} onCancel={vi.fn()} />
        <TextInput aria-label="간결" size="compact" value="주소" onCommit={vi.fn()} onCancel={vi.fn()} />
      </>,
    );

    expect((screen.getByRole("textbox", { name: "기본" }) as HTMLInputElement).className).toBe("ks-text-input");
    expect((screen.getByRole("textbox", { name: "간결" }) as HTMLInputElement).className)
      .toBe("ks-text-input ks-text-input-compact");
  });

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

describe("지속 입력", () => {
  it("자동 포커스 없이 여러 번 확정하고 빈 값도 전달한다", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<TextInput aria-label="설정" value="기본" persistent onCommit={onCommit} onCancel={vi.fn()} />);
    const input = screen.getByRole("textbox", { name: "설정" });
    expect(document.activeElement).not.toBe(input);
    await user.click(input);
    await user.clear(input);
    await user.keyboard("{Enter}");
    await user.type(input, "새 값{Enter}");
    expect(onCommit.mock.calls.map(([value]) => value)).toEqual(["", "새 값"]);
  });
});
