// surface-gallery 자산 1판과 같은 이름의 예제 정의를 등록한다.
(() => {
  const client = window.kaleidoscope;
  const groups = ["첫 번째", "두 번째"].map((label, group) => ({
    id: String(group), label, open: false,
    items: Array.from({ length: 200 }, (_, index) => ({
      id: String(index), label: `견본 ${index + 1}`, surface: `sample-${group}-${index}`, index,
    })),
  }));
  const subscriptions = new Map();

  function subscribe(item) {
    let current = null;
    const draw = () => {
      if (!current?.visible) return;
      const { canvas, cssWidth, cssHeight, dpr } = current;
      canvas.width = Math.max(1, Math.round(cssWidth * dpr));
      canvas.height = Math.max(1, Math.round(cssHeight * dpr));
      const context = canvas.getContext("2d");
      context.fillStyle = `hsl(${item.index * 23 % 360} 55% 38%)`;
      context.fillRect(0, 0, canvas.width, canvas.height);
    };
    const off = client.surfaces.on(item.surface, (surface) => {
      if (current) current.resize.removeEventListener("resize", draw);
      current = surface;
      if (current) current.resize.addEventListener("resize", draw);
      draw();
    });
    return () => { if (current) current.resize.removeEventListener("resize", draw); off(); };
  }

  client.handle("toggle", ({ item }) => {
    const group = groups.find((entry) => entry.id === item?.id);
    if (!group) return;
    group.open = !group.open;
    for (const entry of group.items) {
      if (group.open) subscriptions.set(entry.surface, subscribe(entry));
      else { subscriptions.get(entry.surface)?.(); subscriptions.delete(entry.surface); }
    }
    client.publish({ groups: groups.map(({ id, label, open, items }) => ({ id, label, open, ...(open ? { items } : {}) })) });
  });
  client.publish({ groups: groups.map(({ id, label, open }) => ({ id, label, open })) });
})();
