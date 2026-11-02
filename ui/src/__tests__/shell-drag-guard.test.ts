import { describe, expect, it } from "vitest";
import { installShellDragGuard } from "../shell-drag-guard";

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
});
