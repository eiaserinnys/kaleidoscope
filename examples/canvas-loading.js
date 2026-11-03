// 캔버스가 붙으면 같은 크기의 무대를 그려 준비 상태를 보여 줍니다.
(() => {
  const client = window.kaleidoscope;
  let surface = null;
  const draw = () => {
    if (!surface) return;
    const { canvas, cssWidth, cssHeight, dpr } = surface;
    canvas.width = Math.max(1, Math.round(cssWidth * dpr));
    canvas.height = Math.max(1, Math.round(cssHeight * dpr));
    const context = canvas.getContext("2d");
    if (!context) return;
    context.fillStyle = "#182a48";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#52c7b8";
    context.beginPath();
    context.arc(canvas.width * 0.5, canvas.height * 0.5, Math.min(canvas.width, canvas.height) * 0.2, 0, Math.PI * 2);
    context.fill();
  };
  client.surfaces.on("preview", (next) => {
    if (surface) surface.resize.removeEventListener("resize", draw);
    surface = next;
    if (surface) surface.resize.addEventListener("resize", draw);
    draw();
  });
})();
