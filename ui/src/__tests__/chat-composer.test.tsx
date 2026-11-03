import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatComposer } from "../blocks/chat-composer";

describe("ChatComposer", () => {
  it("disables spelling, completion, correction, and capitalization", () => {
    render(<ChatComposer
      draft=""
      onDraft={vi.fn()}
      inputRef={createRef<HTMLTextAreaElement>()}
      attachments={[]}
      onAttachmentsChange={vi.fn()}
      onSend={vi.fn()}
      disabled={false}
      busy={false}
      sharedWindows={[]}
      onRemoveShared={vi.fn()}
      onPreview={vi.fn()}
      error={null}
      onError={vi.fn()}
    />);
    const input = screen.getByRole("textbox", { name: "메시지" });
    expect(input.getAttribute("spellcheck")).toBe("false");
    expect(input.getAttribute("autocomplete")).toBe("off");
    expect(input.getAttribute("autocorrect")).toBe("off");
    expect(input.getAttribute("autocapitalize")).toBe("off");
  });

  it("returns focus to the message after stopping with the keyboard", () => {
    const onCancel = vi.fn();
    const inputRef = createRef<HTMLTextAreaElement>();
    render(<ChatComposer draft="" onDraft={vi.fn()} inputRef={inputRef}
      attachments={[]} onAttachmentsChange={vi.fn()} onSend={vi.fn()} disabled={false}
      busy onCancel={onCancel} sharedWindows={[]} onRemoveShared={vi.fn()}
      onPreview={vi.fn()} error={null} onError={vi.fn()} />);
    const stop = screen.getByRole("button", { name: "멈춤" });
    stop.focus();
    fireEvent.click(stop, { detail: 0 });
    expect(onCancel).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(inputRef.current);
  });
});
