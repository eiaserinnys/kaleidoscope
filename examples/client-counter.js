// 이 파일을 client-counter 자산 1판으로 등록한 뒤 예제 정의를 올립니다.
(() => {
  const client = window.kaleidoscope;
  let count = 0;
  const publish = () => client.publish({ rows: [{ key: "count", value: count }] });
  client.handle("increment", () => { count += 1; publish(); });
  publish();
})();
