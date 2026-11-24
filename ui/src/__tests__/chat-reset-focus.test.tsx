import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { useChatResetFocus } from "../blocks/chat-reset-focus";

afterEach(cleanup);

function Fixture({ generation, empty = true, ready = true }: { generation: number; empty?: boolean; ready?: boolean }) {
  const input = useRef<HTMLTextAreaElement>(null);
  useChatResetFocus(input, generation, empty, ready, () => true);
  return <div className="ks-data-window"><input aria-label="검색" /><div className="ks-data-section-actions"><button>새 항목</button></div><section className="ks-agent-chat"><textarea ref={input} aria-label="메시지" /></section><div data-ks-overlay><button>삭제 확인</button></div></div>;
}

describe("대화 초기화 뒤 초점", () => {
  it("창의 단추를 누른 뒤 빈 대화가 오면 메시지로 이동한다", () => {
    const view = render(<Fixture generation={1} />);
    const button = screen.getByRole("button", { name: "새 항목" });
    fireEvent.pointerDown(button); button.focus();
    view.rerender(<Fixture generation={2} />);
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "메시지" }));
  });

  it("입력이 잠겨 있으면 열린 뒤 이동한다", () => {
    const view = render(<Fixture generation={1} />);
    const button = screen.getByRole("button", { name: "새 항목" });
    fireEvent.pointerDown(button); button.focus();
    view.rerender(<Fixture generation={2} ready={false} />);
    expect(document.activeElement).toBe(button);
    view.rerender(<Fixture generation={2} />);
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "메시지" }));
  });

  it("사용자가 다른 곳으로 옮긴 초점과 조작 없이 바뀐 대화는 건드리지 않는다", () => {
    const view = render(<Fixture generation={1} />);
    const button = screen.getByRole("button", { name: "새 항목" });
    const search = screen.getByRole("textbox", { name: "검색" });
    fireEvent.pointerDown(button); button.focus();
    fireEvent.pointerDown(search); search.focus();
    view.rerender(<Fixture generation={2} />);
    expect(document.activeElement).toBe(search);
    view.rerender(<Fixture generation={3} />);
    expect(document.activeElement).toBe(search);
  });

  it("대화가 비지 않은 갱신은 초점을 바꾸지 않는다", () => {
    const view = render(<Fixture generation={1} />);
    const button = screen.getByRole("button", { name: "새 항목" });
    fireEvent.pointerDown(button); button.focus();
    view.rerender(<Fixture generation={2} empty={false} />);
    expect(document.activeElement).toBe(button);
  });

  it("대화상자의 확인은 빈 대화가 와도 목록의 초점 복구에 맡긴다", () => {
    const view = render(<Fixture generation={1} />);
    const button = screen.getByRole("button", { name: "삭제 확인" });
    fireEvent.pointerDown(button); button.focus();
    view.rerender(<Fixture generation={2} />);
    expect(document.activeElement).toBe(button);
  });
});
