// slide-shortcuts 자산 1판으로 등록한 뒤 예제 정의를 올린다.
(() => {
  const client = window.kaleidoscope;
  let count = 0;
  for (const name of ["space", "enter", "tab", "backspace", "escape", "left", "right", "shift_left", "shift_right", "reset", "undo", "redo", "click"]) {
    client.handle(name, (context) => client.publish({ result: `${++count}:${name}:${context.modifiers?.shift === true}` }));
  }
  client.onLifecycle((state) => client.publish({ lifecycle: `${state.phase}:${state.visible}:${Math.round(state.viewport.width)}x${Math.round(state.viewport.height)}` }));
})();
