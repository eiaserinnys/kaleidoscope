import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatComposer, clipboardAttachmentFiles, extractClipboardFiles } from "../blocks/chat-composer";
import { requestChatAttachment } from "../blocks/chat-paste";
import { createRef } from "react";

afterEach(cleanup);

function renderComposer() {
  const onAttachmentsChange = vi.fn();
  render(<ChatComposer
    draft=""
    onDraft={vi.fn()}
    inputRef={createRef<HTMLTextAreaElement>()}
    attachments={[]}
    onAttachmentsChange={onAttachmentsChange}
    onSend={vi.fn()}
    disabled={false}
    busy={false}
    sharedWindows={[]}
    onRemoveShared={vi.fn()}
    onPreview={vi.fn()}
    error={null}
    onError={vi.fn()}
  />);
  return { onAttachmentsChange, input: screen.getByRole("textbox", { name: "메시지" }) as HTMLTextAreaElement };
}

function clipboardData(files: File[], options: { text?: string } = {}): DataTransfer {
  return {
    items: files.map((file) => ({ kind: "file", getAsFile: () => file })),
    files,
    types: options.text === undefined ? ["Files"] : ["Files", "text/plain", "text/html"],
    getData: (type: string) => type === "text/plain" ? options.text ?? "" : options.text ? "<a href=\"https://example.com\">링크</a>" : "",
  } as unknown as DataTransfer;
}

describe("ChatComposer", () => {
  it("disables spelling, completion, correction, and capitalization", () => {
    renderComposer();
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

  it("collects clipboard files from items and files without duplicates", () => {
    const image = new File(["a"], "", { type: "image/png" });
    const sameImage = new File(["a"], "image.png", { type: "image/png" });
    const document_ = new File(["b"], "보고서.pdf", { type: "application/pdf" });
    const files = extractClipboardFiles({
      items: [{ kind: "file", getAsFile: () => image }, { kind: "string", getAsFile: () => null }],
      files: [sameImage, document_],
    } as unknown as DataTransfer);
    expect(files).toEqual([image, document_]);
  });

  it("attaches pasted images even when the clipboard also carries html and text", () => {
    const { onAttachmentsChange, input } = renderComposer();
    const image = new File(["png"], "image.png", { type: "image/png" });
    expect(fireEvent.paste(input, { clipboardData: clipboardData([image], { text: "https://example.com" }) })).toBe(false);
    expect(onAttachmentsChange).toHaveBeenCalledWith([expect.objectContaining({ name: "붙여넣은 이미지.png" })]);
  });

  it("keeps non-image files out of the draft when the clipboard also carries text", () => {
    const { onAttachmentsChange, input } = renderComposer();
    const document_ = new File(["pdf"], "보고서.pdf", { type: "application/pdf" });
    expect(clipboardAttachmentFiles(clipboardData([document_], { text: "글" }))).toEqual([]);
    expect(fireEvent.paste(input, { clipboardData: clipboardData([document_], { text: "글" }) })).toBe(true);
    expect(onAttachmentsChange).not.toHaveBeenCalled();
    expect(clipboardAttachmentFiles(clipboardData([document_]))).toEqual([document_]);
  });

  it("adds files that the chat area forwards from its own paste handler", () => {
    const { onAttachmentsChange, input } = renderComposer();
    const image = new File(["png"], "clipboard.png", { type: "image/png" });
    act(() => { expect(requestChatAttachment(input, [image])).toBe(true); });
    expect(onAttachmentsChange).toHaveBeenCalledWith([expect.objectContaining({ name: "붙여넣은 이미지.png" })]);
  });
});
