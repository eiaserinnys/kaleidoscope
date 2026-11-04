type FramePointHandler = (x: number, y: number, gesture: "click" | "double_click", requestId: string) => Promise<void>;
const handlers = new WeakMap<HTMLIFrameElement, FramePointHandler>();

export function registerFramePointHandler(frame: HTMLIFrameElement, handler: FramePointHandler): () => void {
  handlers.set(frame, handler);
  return () => { if (handlers.get(frame) === handler) handlers.delete(frame); };
}
export function framePointHandler(frame: HTMLIFrameElement): FramePointHandler | undefined { return handlers.get(frame); }
