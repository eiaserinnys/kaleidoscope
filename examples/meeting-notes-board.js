// Register this file as meeting-notes-board asset version 1 before importing its definition.
(() => {
  const client = window.kaleidoscope;
  const items = [
    { id: "agenda-1", title: "분기 목표 정리", done: false, surface: "agenda-1" },
    { id: "agenda-2", title: "결정이 필요한 항목", done: false, surface: "agenda-2" },
    { id: "agenda-3", title: "담당자와 다음 일정", done: false, surface: "agenda-3" },
  ];
  const tracks = [{
    id: "meeting",
    label: "회의",
    items: [
      { id: "goals", start: 0, end: 900, label: "목표" },
      { id: "decisions", start: 1200, end: 2100, label: "결정" },
      { id: "next-steps", start: 2400, end: 3300, label: "다음 일정" },
    ],
  }];
  const viewport = { start: 0, end: 3600 };
  const surfaces = new Map();
  let nextId = 4;

  const publish = () => client.publish({ items, completed: items.filter((item) => item.done).length });
  const itemFor = (context) => items.find((item) => item.id === context?.item?.id);

  function draw(surfaceId, surface) {
    const item = items.find((entry) => entry.surface === surfaceId);
    if (!item || !surface) return;
    const canvas = surface.canvas;
    const width = Math.max(1, Math.round(surface.cssWidth * surface.dpr));
    const height = Math.max(1, Math.round(surface.cssHeight * surface.dpr));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#394b43";
    context.fillRect(0, 0, width, height);
    context.fillStyle = item.done ? "#96c6a8" : "#799a85";
    context.fillRect(0, 0, Math.round(width * (item.done ? 1 : 0.45)), height);
  }

  function watchSurface(item) {
    client.surfaces.on(item.surface, (surface) => {
      const previous = surfaces.get(item.surface);
      if (previous) previous.surface.resize.removeEventListener("resize", previous.resize);
      if (!surface) {
        surfaces.delete(item.surface);
        return;
      }
      const resize = () => draw(item.surface, surface);
      surface.resize.addEventListener("resize", resize);
      surfaces.set(item.surface, { surface, resize });
      resize();
    });
  }

  items.forEach(watchSurface);
  client.publish({ items, completed: 0, wide: false, viewport, tracks });
  client.onLifecycle((state) => client.publish({ wide: state.viewport.width >= 760 }));

  client.handle("add_item", () => {
    const id = `agenda-${nextId++}`;
    const item = { id, title: `새 안건 ${nextId - 1}`, done: false, surface: id };
    items.push(item);
    watchSurface(item);
    publish();
  });

  client.handle("edit_title", ({ event, ...context }) => {
    const item = itemFor(context);
    if (!item) return;
    item.title = typeof event === "string" ? event : "";
    publish();
    const surface = surfaces.get(item.surface)?.surface;
    if (surface) draw(item.surface, surface);
  });

  client.handle("mark_done", (context) => {
    if (!context.modifiers?.shift) return;
    const item = itemFor(context);
    if (!item) return;
    item.done = !item.done;
    publish();
    const surface = surfaces.get(item.surface)?.surface;
    if (surface) draw(item.surface, surface);
  });

  client.handle("set_viewport", ({ event }) => {
    if (!event || typeof event !== "object" || typeof event.start !== "number" || typeof event.end !== "number") return;
    viewport.start = event.start;
    viewport.end = event.end;
    client.publish({ viewport });
  });
})();
