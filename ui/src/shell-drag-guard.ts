export function installShellDragGuard(): void {
  document.addEventListener("dragstart", (event) => {
    const target = event.target;
    if (target instanceof Element && target.closest("a, img")) event.preventDefault();
  });
}
