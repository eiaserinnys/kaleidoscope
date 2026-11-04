(() => {
  const app = window.kaleidoscope;
  const Socket = app.connection.webSocketConstructor("live");
  let socket;
  let text = "", binary = "";
  function connect() {
    socket = new Socket("/socket");
    socket.onopen = () => {
      app.publish({ status: "연결됨" });
      socket.send("문자 왕복");
      socket.send(new Uint8Array([0, 1, 255]));
    };
    socket.onmessage = ({ data }) => {
      if (typeof data === "string") text = data;
      else binary = [...new Uint8Array(data)].join(",");
      app.publish({ text, binary });
    };
    socket.onerror = ({ error }) => app.publish({ error: `${error.code}: ${error.id}` });
    socket.onclose = ({ error }) => app.publish({ closed: error ? `${error.code}: ${error.id}` : "closed" });
  }
  app.handle("login", async () => {
    await app.connection.login("live");
    connect();
  });
  app.onLifecycle(({ visible, phase }) => {
    if (phase === "closing" || !visible) socket?.close();
    else if (!socket) connect();
  });
})();
