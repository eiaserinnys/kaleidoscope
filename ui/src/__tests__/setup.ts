import "../styles/foundation.css";

if (typeof ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    private readonly targets = new Set<Element>();
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) {
      this.targets.add(target);
      this.callback([...this.targets].map((observed) => ({
        target: observed,
        contentRect: { width: 960, height: observed.hasAttribute("data-tree-row") ? 32 : 552 },
      } as ResizeObserverEntry)), this);
    }
    unobserve(target: Element) { this.targets.delete(target); }
    disconnect() { this.targets.clear(); }
  };
}

if (typeof document !== "undefined") {
  document.documentElement.style.setProperty("--ks-control-height", "32px");
  const clientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
  const clientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
  const getBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return this.matches(".ks-file-tree-list, .ks-data-tree") ? 480 : clientHeight?.get?.call(this) ?? 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return this.matches(".ks-file-tree-list, .ks-data-tree") ? 800 : clientWidth?.get?.call(this) ?? 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      if (this.classList.contains("ks-tree-virtual-row")) {
        return Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ks-control-height"));
      }
      return offsetHeight?.get?.call(this) ?? 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value(this: HTMLElement) {
      if (this.matches(".ks-file-tree-list, .ks-data-tree")) {
        return { x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 480, width: 800, height: 480, toJSON() {} };
      }
      if (this.classList.contains("ks-tree-virtual-row")) {
        const height = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ks-control-height"));
        const top = Number.parseFloat(this.style.transform.match(/translateY\(([-\d.]+)px\)/)?.[1] ?? "0");
        return { x: 0, y: top, left: 0, top, right: 800, bottom: top + height, width: 800, height, toJSON() {} };
      }
      return getBoundingClientRect.call(this);
    },
  });
}
