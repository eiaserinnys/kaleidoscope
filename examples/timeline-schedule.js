// timeline-schedule 자산 1판으로 등록한 뒤 예제 정의를 올립니다.
(() => {
  const client = window.kaleidoscope;
  const viewport = { start: 0, end: 28_800 };
  const tracks = [{
    id: "day",
    label: "일정",
    items: [
      { id: "prepare", start: 1_800, end: 5_400, label: "자료 정리", resizable: true, resize_start_only: true },
      { id: "lunch", start: 8_100, end: 11_700, label: "점심", movable: false },
      { id: "review", start: 14_400, end: 19_800, label: "설계 검토", resizable: true, resize_start_only: true },
      { id: "wrap-up", start: 23_400, end: 27_000, label: "마감 점검", resizable: true, resize_start_only: true },
    ],
  }];
  let commits = 0;
  let cancels = 0;

  const publish = (status) => client.publish({ viewport, tracks, status });
  client.handle("set_viewport", ({ event }) => {
    viewport.start = event.start;
    viewport.end = event.end;
    client.publish({ viewport });
  });
  client.handle("edit", ({ event, modifiers }) => {
    if (event.phase === "cancel") {
      cancels += 1;
      publish(`취소 ${cancels}회 · 시작 ${Math.round(event.start)}초`);
      return;
    }
    if (event.phase !== "commit") return;
    commits += 1;
    const item = tracks[0].items.find(({ id }) => id === event.id);
    if (!item) return;
    item.start = event.start;
    item.end = event.end;
    const snap = modifiers?.shift === true ? " · 스냅 끔" : "";
    publish(`저장 ${commits}회 · ${item.label} · 시작 ${Math.round(event.start)}초${snap}`);
  });
  publish("시작 손잡이로 일정을 조정하세요.");
})();
