type FileDropTarget = {
  canDrop: () => boolean;
  hover: (active: boolean) => void;
  drop: (transfer: DataTransfer) => void;
};

const targets = new WeakMap<HTMLElement, FileDropTarget>();
let active: FileDropTarget | undefined;
let installed = false;

function show(target?: FileDropTarget) {
  if (active === target) return;
  active?.hover(false);
  active = target;
  active?.hover(true);
}

export function registerFileDropTarget(content: HTMLElement, target: FileDropTarget): () => void {
  targets.set(content, target);
  return () => {
    if (active === target) show();
    if (targets.get(content) === target) targets.delete(content);
  };
}

function targetAt(element: EventTarget | null): FileDropTarget | undefined {
  if (!(element instanceof Element) || element.closest("[data-ks-overlay], [inert]")) return;
  const content = element.closest<HTMLElement>(".ks-window-content");
  if (!content || content.closest(".ks-window") !== element.closest(".ks-window")) return;
  const target = targets.get(content);
  return target?.canDrop() ? target : undefined;
}

export function installShellDragGuard(): void {
  if (installed) return;
  installed = true;
  document.addEventListener("dragstart", (event) => {
    const target = event.target;
    if (target instanceof Element && target.closest("a, img")) event.preventDefault();
  });
  const route = (event: DragEvent) => {
    if (!event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
    const target = targetAt(event.target);
    event.dataTransfer.dropEffect = target ? "copy" : "none";
    if (event.type === "drop") {
      show();
      target?.drop(event.dataTransfer);
    } else show(target);
  };
  document.addEventListener("dragenter", route, true);
  document.addEventListener("dragover", route, true);
  document.addEventListener("drop", route, true);
  document.addEventListener("dragleave", (event) => {
    if (!event.dataTransfer?.types.includes("Files")) return;
    show(targetAt(event.relatedTarget));
  }, true);
  document.addEventListener("dragend", () => show(), true);
  window.addEventListener("blur", () => show());
}
