import { vi } from "vitest";

export function mockVirtualLayout() {
  const height = function (this: HTMLElement) {
    return this.classList.contains("ks-data-view") ? 480 : 40;
  };
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(height);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(height);
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: () => {} });
}
