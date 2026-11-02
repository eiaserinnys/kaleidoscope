export function installShellDragGuard(): void {
  document.addEventListener("dragstart", (event) => {
    const target = event.target;
    if (target instanceof Element && target.closest("a, img")) event.preventDefault();
  });
  const preventExternalFileDrop = (event: DragEvent) => {
    if (!event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "none";
  };
  document.addEventListener("dragover", preventExternalFileDrop, true);
  document.addEventListener("drop", preventExternalFileDrop, true);
}
