// animated-swatches 자산 1판으로 등록한 뒤 예제 정의를 올린다.
(() => {
  const client = window.kaleidoscope;
  const entries = Array.from({ length: 200 }, (_, index) => ({ id: String(index), surface: `swatch-${index}`, label: `견본 ${index + 1}` }));
  const stats = window.swatchStats = {};
  let filtered = false;
  client.handle("filter", () => { filtered = !filtered; client.publish({ swatches: filtered ? entries.filter((_, i) => i % 2 === 0) : entries }); });
  for (const [index, entry] of entries.entries()) {
    stats[entry.surface] = { frames: 0, visible: false, generation: 0 };
    client.surfaces.on(entry.surface, (surface) => {
      const state = stats[entry.surface];
      if (state.frame) cancelAnimationFrame(state.frame);
      state.frame = null;
      if (!surface) { state.visible = false; return; }
      state.generation = surface.generation;
      const context = surface.canvas.getContext("2d");
      const draw = (time) => {
        state.frame = null;
        if (!surface.visible) return;
        const canvas = surface.canvas;
        context.fillStyle = `hsl(${index * 23 % 360} 60% 35%)`;
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = "white";
        context.beginPath();
        context.arc(canvas.width * (0.5 + 0.25 * Math.sin(time / 700)), canvas.height / 2, canvas.height / 8, 0, Math.PI * 2);
        context.fill();
        state.frames += 1;
        state.frame = requestAnimationFrame(draw);
      };
      const update = () => {
        state.visible = surface.visible;
        const width = Math.max(1, Math.round(surface.cssWidth * surface.dpr));
        const height = Math.max(1, Math.round(surface.cssHeight * surface.dpr));
        if (surface.canvas.width !== width) surface.canvas.width = width;
        if (surface.canvas.height !== height) surface.canvas.height = height;
        if (!surface.visible && state.frame) { cancelAnimationFrame(state.frame); state.frame = null; }
        if (surface.visible && !state.frame) state.frame = requestAnimationFrame(draw);
      };
      surface.resize.addEventListener("resize", update);
      update();
    });
  }
  client.publish({ swatches: entries });
})();
