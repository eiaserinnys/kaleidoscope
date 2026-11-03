// 시험 문서에서만 설치한다. 제품 렌더러에는 관측 코드를 넣지 않는다.
const previous = window.__ksE2eDrag;
if (previous) previous.dispose();
const started = performance.now();
const trace = { events: [], counts: {}, samples: [], sample, dispose };
const types = ['dragstart', 'dragover', 'drop', 'dragend'];
function sample(stage, points, state) {
  const frames = Array.from(document.querySelectorAll('.ks-window'));
  const windows = frames.map((frame, order) => {
    const style = getComputedStyle(frame), rect = frame.getBoundingClientRect();
    const app = frame.dataset.testid?.replace(/^app-window-/, '');
    const z = Number(style.zIndex);
    const saved = state.find(w => w.app_id === app && w.z === z);
    return { id: saved?.id ?? null, app, z, order, minimized: frame.dataset.minimized,
      visible: rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden',
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
  });
  const describe = element => {
    if (!element) return null;
    const frame = element.closest('.ks-window');
    return { tag: element.tagName, class: String(element.className),
      row: element.closest('[data-tree-id]')?.dataset.treeId ?? null,
      window_id: windows[frames.indexOf(frame)]?.id ?? null,
      window_testid: frame?.dataset.testid ?? null };
  };
  const hits = Object.fromEntries(Object.entries(points).map(([name, point]) => [name, {
    point, element: describe(document.elementFromPoint(point.x, point.y)),
    stack: document.elementsFromPoint(point.x, point.y).map(describe),
  }]));
  trace.samples.push({ stage, ms: Math.round(performance.now() - started),
    focused: document.hasFocus(), hits, windows: windows.sort((a, b) => b.z - a.z || b.order - a.order), state });
}
function observe(event) {
  const row = event.target?.closest?.('[data-tree-id]');
  trace.counts[event.type] = (trace.counts[event.type] || 0) + 1;
  const item = {
    type: event.type, ms: Math.round(performance.now() - started),
    row: row?.dataset.treeId ?? null, x: event.clientX, y: event.clientY,
    trusted: event.isTrusted, types: Array.from(event.dataTransfer?.types ?? []),
    effect: event.dataTransfer?.dropEffect ?? null,
  };
  // 같은 행의 dragover 반복은 개수만 센다. 종료 이벤트의 자리는 남긴다.
  const last = trace.events.at(-1);
  if (event.type === 'dragover' && (trace.events.length >= 120 ||
      (last?.type === 'dragover' && last.row === item.row))) return;
  trace.events.push(item);
}
function dispose() {
  for (const type of types) document.removeEventListener(type, observe, true);
}
for (const type of types) document.addEventListener(type, observe, true);
window.__ksE2eDrag = trace;
return true;
