import { describe, expect, it, vi } from "vitest";
import { installShellDragGuard, registerFileDropTarget } from "../shell-drag-guard";

describe("쉘 파일 놓기 방지", () => {
  it("외부 파일 형식만 dragover와 drop을 막고 내부 끌기는 유지한다", () => {
    installShellDragGuard();
    for (const type of ["dragover", "drop"]) {
      const external = new Event(type, { bubbles: true, cancelable: true });
      const externalTransfer = { types: ["Files"], dropEffect: "move" };
      Object.defineProperty(external, "dataTransfer", { value: externalTransfer });
      document.dispatchEvent(external);
      expect(external.defaultPrevented).toBe(true);
      expect(externalTransfer.dropEffect).toBe("none");

      const internal = new Event(type, { bubbles: true, cancelable: true });
      const internalTransfer = { types: ["application/x-kaleidoscope-folder"], dropEffect: "move" };
      Object.defineProperty(internal, "dataTransfer", { value: internalTransfer });
      document.dispatchEvent(internal);
      expect(internal.defaultPrevented).toBe(false);
      expect(internalTransfer.dropEffect).toBe("move");
    }
  });

  it("가장 가까운 앱 본문만 수용하고 덮개와 비활성 본문은 막는다", () => {
    installShellDragGuard();
    const back = document.createElement("section"), front = document.createElement("section");
    back.className = front.className = "ks-window";
    back.innerHTML = '<div class="ks-window-content"><span>뒤</span></div>';
    front.innerHTML = '<header>제목</header><div class="ks-window-content"><span>앞</span></div>';
    document.body.append(back, front);
    const content = back.querySelector<HTMLElement>(".ks-window-content")!;
    const hover = vi.fn(), drop = vi.fn();
    let ready = true;
    const unregister = registerFileDropTarget(content, { canDrop: () => ready, hover, drop });
    const send = (target: Element, type: string, relatedTarget?: Element) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      const transfer = { types: ["Files"], dropEffect: "move", files: [], items: [] };
      Object.defineProperties(event, { dataTransfer: { value: transfer }, relatedTarget: { value: relatedTarget ?? null } });
      target.dispatchEvent(event);
      return { event, transfer };
    };
    expect(send(content.firstElementChild!, "dragover").transfer.dropEffect).toBe("copy");
    expect(hover).toHaveBeenLastCalledWith(true);
    send(content.firstElementChild!, "dragleave", content);
    expect(hover).toHaveBeenLastCalledWith(true);
    expect(send(front.querySelector("span")!, "dragover").transfer.dropEffect).toBe("none");
    expect(hover).toHaveBeenLastCalledWith(false);
    send(front.querySelector("span")!, "drop");
    expect(drop).not.toHaveBeenCalled();
    expect(send(back.querySelector("span")!, "drop").transfer.dropEffect).toBe("copy");
    expect(drop).toHaveBeenCalledOnce();
    content.setAttribute("inert", "");
    expect(send(content, "dragover").transfer.dropEffect).toBe("none");
    content.removeAttribute("inert");
    const overlay = document.createElement("div"); overlay.dataset.ksOverlay = ""; content.append(overlay);
    expect(send(overlay, "dragover").transfer.dropEffect).toBe("none");
    send(content, "dragover");
    send(content, "dragleave");
    expect(hover).toHaveBeenLastCalledWith(false);
    ready = false;
    expect(send(content, "drop").transfer.dropEffect).toBe("none");
    expect(drop).toHaveBeenCalledOnce();
    unregister(); back.remove(); front.remove();
  });
});
