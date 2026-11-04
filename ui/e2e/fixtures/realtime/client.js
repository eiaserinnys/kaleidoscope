(() => {
  const app = window.kaleidoscope;
  const Socket = app.connection.webSocketConstructor("live");
  let socket = null;
  let visible = false;
  let text = "", binary = "";
  function connect() {
    socket = new Socket("/socket");
    socket.binaryType = "arraybuffer";
    socket.onopen = () => {
      app.publish({ status: "연결됨" });
      socket.send("문자 왕복");
      socket.send(new Uint8Array([9, 0, 1, 255, 9]).subarray(1, 4));
    };
    socket.onmessage = (event) => {
      if (typeof event.data === "string") text = event.data;
      else binary = [...new Uint8Array(event.data)].join(",");
      app.publish({ text, binary });
    };
    socket.onerror = (event) => app.publish({ error: `${event.error?.id}: ${event.error?.message}` });
    socket.onclose = ({ code, reason }) => app.publish({ closed: `${code}:${reason}` });
  }
  app.handle("close_socket", () => socket?.close(3001, "앱 종료"));
  app.onLifecycle(({ visible: next, phase }) => {
    if (phase === "closing") { socket?.close(); return; }
    if (next === visible) return;
    visible = next;
    if (next) connect();
    else { socket?.close(); app.publish({ status: "숨김" }); }
  });
})();
