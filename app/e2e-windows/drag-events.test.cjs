// 계측기 자체가 시작·목적지·종료와 누락을 구분하는지 작은 문서로 확인한다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const source = readFileSync(require('node:path').join(__dirname, '../src-tauri/src/e2e/drag-events.js'), 'utf8');
function fixture() {
  const handlers = new Map();
  const window = {};
  const document = {
    addEventListener: (type, fn) => handlers.set(type, fn),
    removeEventListener: (type) => handlers.delete(type),
  };
  const install = () => runInNewContext(`(function(){${source}})()`, { window, document, performance: { now: () => 0 } });
  const emit = (type, row) => handlers.get(type)?.({ type, isTrusted: true, target: { closest: () => ({ dataset: { treeId: row } }) } });
  install();
  return { window, handlers, install, emit };
}
test('시작 누락은 성공으로 기록되지 않고 단계와 행을 구분한다', () => {
  const f = fixture();
  f.emit('dragover', 'source');
  assert.equal(f.window.__ksE2eDrag.counts.dragstart, undefined);
  f.emit('dragstart', 'source');
  f.emit('dragover', 'destination');
  f.emit('drop', 'destination');
  f.emit('dragend', 'source');
  assert.equal(f.window.__ksE2eDrag.counts.dragstart, 1);
  assert.equal(f.window.__ksE2eDrag.events.find(e => e.type === 'drop').row, 'destination');
  assert.equal(f.window.__ksE2eDrag.events.at(-1).type, 'dragend');
});
test('반복 over는 제한하고 종료를 보존하며 재설치와 정리가 된다', () => {
  const f = fixture();
  for (let i = 0; i < 1000; i++) f.emit('dragover', String(i));
  f.emit('drop', 'destination');
  f.emit('dragend', 'source');
  assert.equal(f.window.__ksE2eDrag.events.length, 122);
  assert.equal(f.window.__ksE2eDrag.counts.dragover, 1000);
  f.install();
  assert.equal(f.window.__ksE2eDrag.events.length, 0);
  f.window.__ksE2eDrag.dispose();
  assert.equal(f.handlers.size, 0);
});
test('누르기와 놓기 시점의 가림 요소와 창 id, 쌓임 순서를 보존한다', () => {
  const handlers = new Map();
  const frame = (id, z) => ({ dataset: { testid: `app-window-${id}`, minimized: 'false' },
    zIndex: String(z), getBoundingClientRect: () => ({ x: 0, y: 0, width: 100, height: 100 }) });
  const back = frame('folder', 1), front = frame('overlay', 2);
  let target = front;
  const element = owner => ({ tagName: 'SPAN', className: 'label', closest: selector => selector === '.ks-window' ? owner : null });
  const window = {};
  const document = { addEventListener: (t, f) => handlers.set(t, f), removeEventListener: t => handlers.delete(t),
    querySelectorAll: () => [back, front], elementFromPoint: () => element(target),
    elementsFromPoint: () => [element(target)], hasFocus: () => true };
  runInNewContext(`(function(){${source}})()`, { window, document, performance: { now: () => 0 },
    getComputedStyle: el => ({ zIndex: el.zIndex, display: 'block', visibility: 'visible' }) });
  const state = [{ id: 'real-folder-id', app_id: 'folder', z: 1 }, { id: 'real-overlay-id', app_id: 'overlay', z: 2 }];
  const points = { from: { x: 10, y: 20 }, to: { x: 30, y: 40 } };
  window.__ksE2eDrag.sample('before_press', points, state);
  target = back;
  window.__ksE2eDrag.sample('before_release', points, state);
  const samples = window.__ksE2eDrag.samples;
  assert.equal(samples[0].hits.from.element.window_id, 'real-overlay-id');
  assert.equal(samples[1].hits.to.element.window_id, 'real-folder-id');
  assert.equal(samples[0].windows[0].id, 'real-overlay-id');
});
